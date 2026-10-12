// Meeting Mode: speaker-attributed transcription.
//
// Pipeline per piece of speech (cut at pauses by the browser):
//   1. speaker-change detection inside the piece (pyannote segmentation, local)
//      -> the piece is split into one turn per speaker
//   2. a voiceprint per turn (WeSpeaker ResNet34, local)
//   3. match against voices already heard in this meeting and registered voice
//      profiles -> registered name, the same "Speaker N" as before, or a new one
//   4. transcription with the Gemini API, several turns per request
//   5. when the meeting ends, a refinement pass re-checks every line against the
//      final picture of each voice (early decisions are made with little data)
import { db, now, f32ToBlob, blobToF32, getSettings, asBuffer } from "./db.mjs";
import { embedSpeaker, speakerTurns, cosine, normalize } from "./models.mjs";
import { pcmToFloat32, pcmSeconds, SAMPLE_RATE } from "./audio.mjs";
import { transcribeSegments, hasKey } from "./gemini.mjs";
import { SPEAKER_MODEL } from "./config.mjs";

// turns shorter than this carry too little voice for a reliable voiceprint
const MIN_EMBED_SECONDS = 1.0;
// only look for speaker changes in pieces at least this long
const MIN_SPLIT_SECONDS = 2.0;
// a registered name must beat the runner-up profile by this margin
const PROFILE_MARGIN = 0.06;
// decisions this close to the threshold are flagged as unsure in the transcript
const UNSURE_BAND = 0.08;
// transcription batching: send when this much audio is waiting, or the oldest turn waited this long
const BATCH_AUDIO_SECONDS = 25;
const BATCH_MAX_WAIT_MS = Number(process.env.AURA_BATCH_WAIT_MS ?? 6000);
const BATCH_MAX_CLIPS = 10;

// ---- voice profiles ----------------------------------------------------------
export function listProfiles() {
  return db
    .prepare("SELECT id, name, sample_seconds, consent_note, created_at, model FROM speaker_profiles ORDER BY name")
    .all()
    .map((p) => ({
      id: p.id,
      name: p.name,
      sampleSeconds: p.sample_seconds,
      consentNote: p.consent_note,
      createdAt: p.created_at,
      // recorded with an older speaker model: the voiceprint can't be compared any more
      outdated: p.model !== SPEAKER_MODEL,
    }));
}

/** Profiles whose voiceprint was made by the current speaker model. */
function currentProfiles() {
  return db
    .prepare("SELECT id, name, embedding FROM speaker_profiles WHERE model = ?")
    .all(SPEAKER_MODEL)
    .map((p) => ({ id: p.id, name: p.name, emb: blobToF32(p.embedding) }));
}

export async function enrollProfile({ name, pcm, consentNote, replaceId }) {
  const secs = pcmSeconds(pcm);
  if (secs < 8) throw Object.assign(new Error("Need at least 8 seconds of speech to enroll a voice."), { status: 400 });
  const emb = await embedSpeaker(pcmToFloat32(pcm));
  if (replaceId) {
    const n = db
      .prepare("UPDATE speaker_profiles SET name = ?, embedding = ?, sample_seconds = ?, consent_note = ?, created_at = ?, model = ? WHERE id = ?")
      .run(name.trim(), f32ToBlob(emb), secs, consentNote, now(), SPEAKER_MODEL, replaceId).changes;
    if (n) return listProfiles().find((p) => p.id === Number(replaceId));
  }
  const info = db
    .prepare("INSERT INTO speaker_profiles(name, embedding, sample_seconds, consent_note, created_at, model) VALUES (?, ?, ?, ?, ?, ?)")
    .run(name.trim(), f32ToBlob(emb), secs, consentNote, now(), SPEAKER_MODEL);
  return listProfiles().find((p) => p.id === Number(info.lastInsertRowid));
}

export function renameProfile(id, name) {
  db.prepare("UPDATE speaker_profiles SET name = ? WHERE id = ?").run(name.trim(), id);
  // keep labels in past meetings in sync unless the user renamed them by hand
  db.prepare("UPDATE meeting_speakers SET label = ? WHERE profile_id = ? AND renamed = 0").run(name.trim(), id);
}

export function deleteProfile(id) {
  return db.prepare("DELETE FROM speaker_profiles WHERE id = ?").run(id).changes > 0;
}

/** Score a recording against the registered profiles (used by the "test recognition" check). */
export async function identify(pcm) {
  const emb = await embedSpeaker(pcmToFloat32(pcm));
  return currentProfiles()
    .map((p) => ({ id: p.id, name: p.name, score: cosine(emb, p.emb) }))
    .sort((a, b) => b.score - a.score);
}

// ---- meetings ----------------------------------------------------------------
export function createMeeting(title) {
  const t = now();
  const info = db
    .prepare("INSERT INTO meetings(title, started_at) VALUES (?, ?)")
    .run(title?.trim() || `Meeting ${new Date(t).toLocaleString()}`, t);
  return getMeeting(info.lastInsertRowid);
}

export function listMeetings() {
  return db
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM segments s WHERE s.meeting_id = m.id) AS segment_count,
              (SELECT MAX(end_ms) FROM segments s WHERE s.meeting_id = m.id) AS duration_ms
       FROM meetings m ORDER BY started_at DESC`
    )
    .all()
    .map((m) => ({
      id: m.id,
      title: m.title,
      startedAt: m.started_at,
      endedAt: m.ended_at,
      hasMinutes: !!m.minutes,
      segmentCount: m.segment_count,
      durationMs: m.duration_ms || 0,
    }));
}

export function getMeeting(id) {
  const m = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id);
  if (!m) return null;
  const speakers = db
    .prepare("SELECT id, label, profile_id, match_score, renamed, n FROM meeting_speakers WHERE meeting_id = ? AND merged_into IS NULL ORDER BY id")
    .all(id)
    .map((s) => ({ id: s.id, label: s.label, profileId: s.profile_id, matchScore: s.match_score, renamed: !!s.renamed, segments: s.n }));
  const segments = db
    .prepare(
      `SELECT id, speaker_id, start_ms, end_ms, text, speaker_score, speaker_uncertain, status, error, manual,
              (audio IS NOT NULL) AS has_audio
       FROM segments WHERE meeting_id = ? ORDER BY start_ms`
    )
    .all(id)
    .map((s) => ({
      id: s.id,
      speakerId: s.speaker_id,
      startMs: s.start_ms,
      endMs: s.end_ms,
      text: s.text,
      speakerScore: s.speaker_score,
      speakerUncertain: !!s.speaker_uncertain,
      status: s.status,
      error: s.error,
      retryable: (s.status === "error" || s.status === "empty") && !!s.has_audio,
    }));
  return {
    id: m.id,
    title: m.title,
    startedAt: m.started_at,
    endedAt: m.ended_at,
    refined: !!m.refined,
    minutes: parseMinutes(m.minutes),
    minutesAt: m.minutes_at ?? null,
    memoryStatus: m.memory_status ?? null,
    memoryCount: m.memory_count ?? 0,
    memoryError: m.memory_error ?? null,
    speakers,
    segments,
  };
}

export function parseMinutes(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Transcript lines with speaker names, in order. */
export function meetingLines(id) {
  const m = getMeeting(id);
  if (!m) return null;
  const name = new Map(m.speakers.map((s) => [s.id, s.label]));
  return m.segments
    .filter((s) => String(s.text || "").trim())
    .map((s) => ({ startMs: s.startMs, endMs: s.endMs, speaker: name.get(s.speakerId) || "Unknown speaker", text: s.text.trim() }));
}

export function updateMeeting(id, { title, ended }) {
  if (title != null) db.prepare("UPDATE meetings SET title = ? WHERE id = ?").run(String(title).trim(), id);
  if (ended) {
    db.prepare("UPDATE meetings SET ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(now(), id);
    kick(); // flush the transcription queue and refine speakers
  }
  return getMeeting(id);
}

export function deleteMeeting(id) {
  return db.prepare("DELETE FROM meetings WHERE id = ?").run(id).changes > 0;
}

export function deleteAllMeetings() {
  return db.prepare("DELETE FROM meetings").run().changes;
}

export function addSegment(meetingId, { startMs, endMs, pcm }) {
  const info = db
    .prepare("INSERT INTO segments(meeting_id, start_ms, end_ms, status, audio) VALUES (?, ?, ?, 'pending', ?)")
    .run(meetingId, Math.round(startMs), Math.round(endMs), pcm);
  kick();
  return Number(info.lastInsertRowid);
}

/**
 * Live-transcription mode: analyse the piece right away and return its speaker
 * turns; the browser transcribes each turn over the Live API and posts the text back.
 */
export async function addSegmentLive(meetingId, { startMs, endMs, pcm }) {
  const id = Number(
    db
      .prepare("INSERT INTO segments(meeting_id, start_ms, end_ms, status, audio) VALUES (?, ?, ?, 'analysing', ?)")
      .run(meetingId, Math.round(startMs), Math.round(endMs), pcm).lastInsertRowid
  );
  const seg = db.prepare("SELECT id, meeting_id, start_ms, end_ms, audio FROM segments WHERE id = ?").get(id);
  let ids;
  try {
    ids = await analysePiece(seg, getSettings(), "live");
  } catch (e) {
    console.error("[meeting] speaker analysis failed:", e.message);
    workerState.lastError = `Speaker model: ${e.message}`;
    workerState.lastErrorAt = now();
    db.prepare("UPDATE segments SET status = 'live' WHERE id = ?").run(id);
    liveSince.set(id, Date.now());
    ids = [id];
  }
  return db
    .prepare(`SELECT id, start_ms, end_ms FROM segments WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY start_ms`)
    .all(...ids)
    .map((r) => ({ id: r.id, startMs: r.start_ms, endMs: r.end_ms }));
}

/** Text for a turn transcribed in the browser. `failed` hands it to the standard transcription instead. */
export function setLiveTranscript(meetingId, segmentId, { text, failed }) {
  const seg = db.prepare("SELECT status FROM segments WHERE id = ? AND meeting_id = ?").get(segmentId, meetingId);
  if (!seg || seg.status !== "live") return false;
  liveSince.delete(segmentId);
  if (failed) {
    db.prepare("UPDATE segments SET status = 'queued' WHERE id = ?").run(segmentId);
    queuedAt.set(segmentId, 0);
    kick();
  } else if (String(text || "").trim()) {
    db.prepare("UPDATE segments SET text = ?, status = 'done', error = NULL, audio = NULL WHERE id = ?").run(String(text).trim(), segmentId);
  } else {
    db.prepare("UPDATE segments SET text = '', status = 'empty' WHERE id = ?").run(segmentId);
  }
  kick(); // may complete the meeting -> refinement
  return true;
}

// ---- corrections ---------------------------------------------------------------
/** Rename a voice everywhere in the meeting. */
export function renameSpeaker(meetingId, speakerId, label) {
  db.prepare("UPDATE meeting_speakers SET label = ?, renamed = 1 WHERE id = ? AND meeting_id = ?").run(label.trim(), speakerId, meetingId);
}

/** Move one segment to another (or a new) speaker. */
export function reassignSegment(meetingId, segmentId, { speakerId, newLabel }) {
  let target = speakerId;
  if (!target && newLabel) {
    target = Number(
      db.prepare("INSERT INTO meeting_speakers(meeting_id, label, renamed, n) VALUES (?, ?, 1, 0)").run(meetingId, newLabel.trim())
        .lastInsertRowid
    );
  }
  const seg = db.prepare("SELECT speaker_id FROM segments WHERE id = ? AND meeting_id = ?").get(segmentId, meetingId);
  if (!seg) return;
  db.prepare("UPDATE segments SET speaker_id = ?, speaker_uncertain = 0, manual = 1 WHERE id = ?").run(target, segmentId);
  db.prepare("UPDATE meeting_speakers SET n = n - 1 WHERE id = ?").run(seg.speaker_id);
  db.prepare("UPDATE meeting_speakers SET n = n + 1 WHERE id = ?").run(target);
}

/** Merge speaker `fromId` into `intoId` (e.g. one person was split into two labels). */
export function mergeSpeakers(meetingId, fromId, intoId) {
  db.transaction(() => {
    const moved = db.prepare("UPDATE segments SET speaker_id = ? WHERE speaker_id = ? AND meeting_id = ?").run(intoId, fromId, meetingId).changes;
    db.prepare("UPDATE meeting_speakers SET n = n + ? WHERE id = ?").run(moved, intoId);
    // keep the voice's centroid so its future lines land on the merged speaker
    db.prepare("UPDATE meeting_speakers SET merged_into = ?, n = 0 WHERE id = ? AND meeting_id = ?").run(intoId, fromId, meetingId);
    db.prepare("UPDATE meeting_speakers SET merged_into = ? WHERE merged_into = ? AND meeting_id = ?").run(intoId, fromId, meetingId);
  })();
}

export function editSegmentText(meetingId, segmentId, text) {
  db.prepare("UPDATE segments SET text = ?, status = 'done' WHERE id = ? AND meeting_id = ?").run(text, segmentId, meetingId);
}

// ---- export ----------------------------------------------------------------------
const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

function minutesText(mi, md) {
  if (!mi) return [];
  const h = (t) => (md ? `### ${t}` : t.toUpperCase());
  const li = (t) => (md ? `- ${t}` : `  - ${t}`);
  const out = [md ? "## Minutes of meeting" : "MINUTES OF MEETING", ""];
  if (mi.summary) out.push(h("Summary"), mi.summary, "");
  const list = (title, items) => {
    if (items?.length) out.push(h(title), ...items.map(li), "");
  };
  list("Key points", mi.keyPoints);
  list("Decisions", mi.decisions);
  list(
    "Action items",
    (mi.actionItems || []).map((a) => [a.task, a.owner ? `owner: ${a.owner}` : "", a.due ? `due: ${a.due}` : ""].filter(Boolean).join(" | "))
  );
  list("Open questions", mi.openQuestions);
  return out;
}

export function exportMeeting(id, format) {
  const m = getMeeting(id);
  if (!m) return null;
  const name = new Map(m.speakers.map((s) => [s.id, s.label]));
  const rows = m.segments
    .filter((s) => s.text)
    .map((s) => ({ start: clock(s.startMs), end: clock(s.endMs), speaker: name.get(s.speakerId) || "Unknown", text: s.text }));
  const date = new Date(m.startedAt).toLocaleString();
  if (format === "json") {
    return {
      mime: "application/json",
      ext: "json",
      body: JSON.stringify({ title: m.title, startedAt: new Date(m.startedAt).toISOString(), minutes: m.minutes, segments: rows }, null, 2),
    };
  }
  if (format === "md") {
    const body = [
      `# ${m.title}`,
      ``,
      `_${date}_`,
      ``,
      ...minutesText(m.minutes, true),
      ...(m.minutes ? ["## Transcript", ""] : []),
      ...rows.map((r) => `**${r.speaker}** \`[${r.start}]\`  \n${r.text}\n`),
    ].join("\n");
    return { mime: "text/markdown", ext: "md", body };
  }
  const body = [
    m.title,
    date,
    "",
    ...minutesText(m.minutes, false),
    ...(m.minutes ? ["TRANSCRIPT", ""] : []),
    ...rows.map((r) => `[${r.start} - ${r.end}] ${r.speaker}: ${r.text}`),
  ].join("\n");
  return { mime: "text/plain", ext: "txt", body };
}

// ---- background worker -------------------------------------------------------------
let running = false;
let timer = null;
export const workerState = { lastError: null, lastErrorAt: null };
const queuedAt = new Map(); // segment id -> when it became ready for transcription
const liveSince = new Map(); // segment id -> when it was handed to the browser for Live transcription
// turns the browser never reported back (tab closed, network) fall back to the standard transcription
const LIVE_GIVE_UP_MS = 90000;
setInterval(() => {
  const stale = db.prepare("SELECT id FROM segments WHERE status = 'live'").all().filter((r) => Date.now() - (liveSince.get(r.id) ?? 0) > LIVE_GIVE_UP_MS);
  if (!stale.length) return;
  for (const r of stale) {
    db.prepare("UPDATE segments SET status = 'queued' WHERE id = ? AND status = 'live'").run(r.id);
    liveSince.delete(r.id);
    queuedAt.set(r.id, 0);
  }
  kick();
}, 15000).unref();

function kick(delay = 0) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const go = () => {
    if (running) return;
    running = true;
    work()
      .catch((e) => console.error("[meeting] worker crashed:", e))
      .finally(() => {
        running = false;
        // new pieces may have arrived while finishing
        if (db.prepare("SELECT 1 FROM segments WHERE status = 'pending' LIMIT 1").get()) kick();
      });
  };
  if (delay) timer = setTimeout(go, delay);
  else setImmediate(go);
}

const speakerRow = (id) => db.prepare("SELECT * FROM meeting_speakers WHERE id = ?").get(id);
const live = (sp) => (sp.merged_into ? speakerRow(sp.merged_into) || sp : sp);

/**
 * Decide who is speaking, given a voiceprint.
 * Compares with every voice already heard in this meeting (and, for named voices,
 * their registered profile) and with registered profiles not heard yet.
 */
function assignSpeaker(meetingId, emb, settings) {
  const profiles = currentProfiles();
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  // includes voices the user merged into someone else: their lines keep going to the merged speaker
  const speakers = db.prepare("SELECT * FROM meeting_speakers WHERE meeting_id = ? AND centroid IS NOT NULL").all(meetingId);

  // 1) voices already in this meeting
  let best = null;
  for (const sp of speakers) {
    let score = cosine(emb, blobToF32(sp.centroid));
    const prof = sp.profile_id && profileById.get(sp.profile_id);
    if (prof) score = Math.max(score, cosine(emb, prof.emb));
    if (!best || score > best.score) best = { sp, score };
  }

  // 2) registered voices not heard yet in this meeting
  const used = new Set(speakers.map((s) => s.profile_id).filter(Boolean));
  const ranked = profiles.map((p) => ({ p, score: cosine(emb, p.emb) })).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const runnerUp = ranked[1]?.score ?? -1;
  const profileHit =
    top && !used.has(top.p.id) && top.score >= settings.voiceMatchThreshold && top.score - runnerUp >= PROFILE_MARGIN
      ? top
      : null;

  if (best && best.score >= settings.voiceClusterThreshold && (!profileHit || best.score >= profileHit.score)) {
    updateCentroid(best.sp, emb);
    return { speakerId: live(best.sp).id, score: best.score, uncertain: best.score < settings.voiceClusterThreshold + UNSURE_BAND };
  }
  if (profileHit) {
    const id = Number(
      db
        .prepare("INSERT INTO meeting_speakers(meeting_id, label, profile_id, match_score, centroid, n) VALUES (?, ?, ?, ?, ?, 0)")
        .run(meetingId, profileHit.p.name, profileHit.p.id, profileHit.score, f32ToBlob(emb)).lastInsertRowid
    );
    return { speakerId: id, score: profileHit.score, uncertain: profileHit.score < settings.voiceMatchThreshold + UNSURE_BAND };
  }

  // 3) a new voice; numbers are never reused within a meeting, even after renames or merges
  db.prepare("UPDATE meetings SET speaker_seq = speaker_seq + 1 WHERE id = ?").run(meetingId);
  const n = db.prepare("SELECT speaker_seq FROM meetings WHERE id = ?").get(meetingId).speaker_seq;
  const id = db
    .prepare("INSERT INTO meeting_speakers(meeting_id, label, centroid, n) VALUES (?, ?, ?, 0)")
    .run(meetingId, `Speaker ${n}`, f32ToBlob(emb)).lastInsertRowid;
  return { speakerId: Number(id), score: best?.score ?? null, uncertain: false };
}

function updateCentroid(sp, emb) {
  const c = blobToF32(sp.centroid);
  const n = Math.min(sp.n || 0, 30); // cap so the centroid can still adapt
  let next = emb;
  if (c && c.length === emb.length) {
    next = new Float32Array(emb.length);
    for (let i = 0; i < emb.length; i++) next[i] = (c[i] * n + emb[i]) / (n + 1);
    next = normalize(next);
  }
  db.prepare("UPDATE meeting_speakers SET centroid = ? WHERE id = ?").run(f32ToBlob(next), sp.id);
}

/** An unnamed voice that turns out to match a registered profile gets that name. */
function maybeNameSpeaker(speakerId, settings) {
  const sp = speakerRow(speakerId);
  if (!sp || sp.profile_id || sp.renamed || sp.n < 3) return;
  const ranked = currentProfiles()
    .map((p) => ({ p, score: cosine(blobToF32(sp.centroid), p.emb) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top || top.score < settings.voiceMatchThreshold || top.score - (ranked[1]?.score ?? -1) < PROFILE_MARGIN) return;
  const taken = db.prepare("SELECT 1 FROM meeting_speakers WHERE meeting_id = ? AND profile_id = ? AND merged_into IS NULL").get(sp.meeting_id, top.p.id);
  if (taken) return;
  db.prepare("UPDATE meeting_speakers SET label = ?, profile_id = ?, match_score = ? WHERE id = ?").run(top.p.name, top.p.id, top.score, sp.id);
}

/** Step 1-3 for one uploaded piece: split by speaker, voiceprint, attribute. */
async function analysePiece(seg, settings, nextStatus = "queued") {
  const audio = asBuffer(seg.audio);
  const samples = pcmToFloat32(audio);
  const secs = samples.length / SAMPLE_RATE;

  // speaker changes inside the piece
  let turns = [{ start: 0, end: secs, local: 0 }];
  if (secs >= MIN_SPLIT_SECONDS) {
    try {
      turns = await speakerTurns(samples);
    } catch (e) {
      console.error("[meeting] speaker-change detection failed:", e.message);
    }
  }

  // one voiceprint per local speaker, from all of their audio in this piece
  const locals = [...new Set(turns.map((t) => t.local))];
  const decision = new Map();
  for (const l of locals) {
    const mine = turns.filter((t) => t.local === l);
    const total = mine.reduce((a, t) => a + (t.end - t.start), 0);
    if (total < MIN_EMBED_SECONDS) continue;
    const joined = new Float32Array(Math.round(total * SAMPLE_RATE) + mine.length);
    let off = 0;
    for (const t of mine) {
      const part = samples.subarray(Math.round(t.start * SAMPLE_RATE), Math.round(t.end * SAMPLE_RATE));
      joined.set(part, off);
      off += part.length;
    }
    const emb = await embedSpeaker(joined.subarray(0, off));
    decision.set(l, { emb, ...assignSpeaker(seg.meeting_id, emb, settings) });
  }

  // turns without their own decision (too short) join the neighbouring turn
  let pieces = turns.map((t) => ({ ...t, d: decision.get(t.local) || null }));
  if (!pieces.some((p) => p.d)) {
    pieces = [{ start: 0, end: secs, d: null }];
  } else {
    for (let i = 0; i < pieces.length; i++) {
      if (!pieces[i].d) pieces[i].d = (pieces[i - 1] || pieces[i + 1]).d || pieces.find((p) => p.d).d;
    }
  }
  // adjacent turns that ended up with the same speaker become one line again
  const merged = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.d && p.d && last.d.speakerId === p.d.speakerId) last.end = p.end;
    else merged.push({ ...p });
  }

  const prevSpeaker = () =>
    db
      .prepare("SELECT speaker_id FROM segments WHERE meeting_id = ? AND start_ms < ? AND speaker_id IS NOT NULL ORDER BY start_ms DESC LIMIT 1")
      .get(seg.meeting_id, seg.start_ms)?.speaker_id ?? null;

  const ins = db.prepare(
    `INSERT INTO segments(meeting_id, speaker_id, start_ms, end_ms, speaker_score, speaker_uncertain, status, audio, embedding)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const upd = db.prepare(
    `UPDATE segments SET speaker_id = ?, start_ms = ?, end_ms = ?, speaker_score = ?, speaker_uncertain = ?, status = ?, audio = ?, embedding = ?
     WHERE id = ?`
  );
  const ready = [];
  db.transaction(() => {
    merged.forEach((p, i) => {
      const a = audio.subarray(Math.round(p.start * SAMPLE_RATE) * 2, Math.round(p.end * SAMPLE_RATE) * 2);
      const startMs = Math.round(seg.start_ms + p.start * 1000);
      const endMs = Math.round(seg.start_ms + p.end * 1000);
      // too short for a voiceprint: attach to the previous speaker, flagged as unsure
      const speakerId = p.d ? p.d.speakerId : prevSpeaker();
      const score = p.d ? p.d.score : null;
      const unsure = p.d ? (p.d.uncertain ? 1 : 0) : 1;
      const emb = p.d ? f32ToBlob(p.d.emb) : null;
      let segId = seg.id;
      if (i === 0) upd.run(speakerId, startMs, endMs, score, unsure, nextStatus, Buffer.from(a), emb, seg.id);
      else segId = Number(ins.run(seg.meeting_id, speakerId, startMs, endMs, score, unsure, nextStatus, Buffer.from(a), emb).lastInsertRowid);
      if (speakerId) db.prepare("UPDATE meeting_speakers SET n = n + 1 WHERE id = ?").run(speakerId);
      ready.push(segId);
    });
  })();
  for (const id of ready) (nextStatus === "live" ? liveSince : queuedAt).set(id, Date.now());
  for (const d of decision.values()) maybeNameSpeaker(d.speakerId, settings);
  return ready;
}

/** Recent transcript lines, to give the transcriber context. */
function transcriptContext(meetingId, beforeMs) {
  return db
    .prepare(
      `SELECT s.text, COALESCE(sp.label, 'Unknown') AS label FROM segments s
       LEFT JOIN meeting_speakers sp ON sp.id = s.speaker_id
       WHERE s.meeting_id = ? AND s.status = 'done' AND s.start_ms < ? ORDER BY s.start_ms DESC LIMIT 6`
    )
    .all(meetingId, beforeMs)
    .reverse()
    .map((r) => `${r.label}: ${r.text}`)
    .join("\n");
}

async function transcribeBatch(batch, settings) {
  const meetingId = batch[0].meeting_id;
  const context = transcriptContext(meetingId, batch[0].start_ms);
  const audios = batch.map((b) => asBuffer(b.audio));
  const { texts, raw, count } = await transcribeSegments(audios, { context, language: settings.meetingLanguage });
  if (count !== batch.length) {
    console.warn(`[meeting] transcriber returned ${count} texts for ${batch.length} clips`);
  }
  if (texts.every((t) => !t)) {
    console.warn("[meeting] transcriber returned no text for", batch.length, "clip(s). Raw reply:", JSON.stringify(raw).slice(0, 500));
  }
  // keep the audio of empty clips so "Retry" can try them again
  const done = db.prepare("UPDATE segments SET text = ?, status = 'done', error = NULL, audio = NULL WHERE id = ?");
  const empty = db.prepare("UPDATE segments SET text = '', status = 'empty', error = NULL WHERE id = ?");
  db.transaction(() => batch.forEach((b, i) => (texts[i] ? done.run(texts[i], b.id) : empty.run(b.id))))();
  batch.forEach((b) => queuedAt.delete(b.id));
}

async function work() {
  for (;;) {
    const settings = getSettings();

    // local analysis first: it is fast and decides how pieces are split
    const pending = db.prepare("SELECT id, meeting_id, start_ms, end_ms, audio FROM segments WHERE status = 'pending' ORDER BY id LIMIT 1").get();
    if (pending) {
      try {
        await analysePiece(pending, settings);
      } catch (e) {
        console.error("[meeting] speaker analysis failed:", e.message);
        workerState.lastError = `Speaker model: ${e.message}`;
        workerState.lastErrorAt = now();
        // still transcribe it, just without a speaker
        db.prepare("UPDATE segments SET status = 'queued' WHERE id = ?").run(pending.id);
        queuedAt.set(pending.id, Date.now());
      }
      continue;
    }

    // transcription, batched per meeting
    const queued = db
      .prepare("SELECT id, meeting_id, start_ms, end_ms, audio FROM segments WHERE status = 'queued' ORDER BY meeting_id, start_ms")
      .all();
    if (!queued.length) break;
    if (!hasKey()) {
      db.prepare("UPDATE segments SET status = 'error', error = 'GEMINI_API_KEY missing' WHERE status = 'queued'").run();
      break;
    }
    const meetingId = queued[0].meeting_id;
    const mine = queued.filter((q) => q.meeting_id === meetingId);
    const ended = !!db.prepare("SELECT ended_at FROM meetings WHERE id = ?").get(meetingId)?.ended_at;
    const audioSecs = mine.reduce((a, q) => a + pcmSeconds(asBuffer(q.audio) || Buffer.alloc(0)), 0);
    const oldest = Math.min(...mine.map((q) => queuedAt.get(q.id) ?? 0));
    const waited = Date.now() - oldest;
    if (!ended && audioSecs < BATCH_AUDIO_SECONDS && mine.length < BATCH_MAX_CLIPS && waited < BATCH_MAX_WAIT_MS) {
      kick(BATCH_MAX_WAIT_MS - waited + 50); // wait a little for more speech, then send
      return;
    }
    // keep requests a reasonable size
    const batch = [];
    let secs = 0;
    for (const q of mine) {
      const d = pcmSeconds(asBuffer(q.audio) || Buffer.alloc(0));
      if (batch.length && (secs + d > 60 || batch.length >= BATCH_MAX_CLIPS)) break;
      batch.push(q);
      secs += d;
    }
    try {
      await transcribeBatch(batch, settings);
      workerState.lastError = null;
    } catch (e) {
      console.error("[meeting] transcription failed:", e.message);
      workerState.lastError = `Transcription: ${e.message}`;
      workerState.lastErrorAt = now();
      const upd = db.prepare("UPDATE segments SET status = 'error', error = ? WHERE id = ?");
      db.transaction(() => batch.forEach((b) => upd.run(String(e.message).slice(0, 300), b.id)))();
      batch.forEach((b) => queuedAt.delete(b.id));
    }
  }

  // nothing left to do: refine meetings that have ended
  const toRefine = db
    .prepare(
      `SELECT id FROM meetings m WHERE ended_at IS NOT NULL AND refined = 0
       AND NOT EXISTS (SELECT 1 FROM segments s WHERE s.meeting_id = m.id AND s.status IN ('pending','queued','analysing','live'))`
    )
    .all();
  for (const m of toRefine) {
    try {
      refineMeeting(m.id);
    } catch (e) {
      console.error("[meeting] refinement failed:", e.message);
    }
    db.prepare("UPDATE meetings SET refined = 1 WHERE id = ?").run(m.id);
    try {
      hooks.finished?.(m.id); // e.g. learn from the meeting
    } catch (e) {
      console.error("[meeting] after-meeting hook failed:", e.message);
    }
  }
}

/** Set by meeting-notes.mjs: runs once a meeting has ended and its transcript is final. */
export const hooks = { finished: null };

/**
 * After a meeting: look at every line again with the final voiceprint of each speaker.
 * - unnamed speakers that sound like another speaker are merged into them
 * - lines that clearly sound like a different speaker are moved
 * Lines the user moved by hand and speakers the user renamed are left alone.
 */
export function refineMeeting(meetingId) {
  const settings = getSettings();
  const segs = db
    .prepare("SELECT id, speaker_id, embedding, manual FROM segments WHERE meeting_id = ? AND embedding IS NOT NULL AND speaker_id IS NOT NULL")
    .all(meetingId)
    .map((s) => ({ ...s, emb: blobToF32(s.embedding) }));
  if (segs.length < 2) return;

  const centroids = () => {
    const acc = new Map();
    for (const s of segs) {
      let a = acc.get(s.speaker_id);
      if (!a) acc.set(s.speaker_id, (a = { sum: new Float32Array(s.emb.length), n: 0 }));
      for (let i = 0; i < s.emb.length; i++) a.sum[i] += s.emb[i];
      a.n++;
    }
    return new Map([...acc].map(([id, a]) => [id, { c: normalize(a.sum), n: a.n }]));
  };

  // 1) merge unnamed voices into a very similar voice (one person split in two)
  const mergeAt = settings.voiceClusterThreshold + 0.1;
  for (let again = true; again; ) {
    again = false;
    const cs = centroids();
    const rows = new Map(
      db.prepare("SELECT * FROM meeting_speakers WHERE meeting_id = ? AND merged_into IS NULL").all(meetingId).map((r) => [r.id, r])
    );
    let bestPair = null;
    for (const [a, ca] of cs) {
      const ra = rows.get(a);
      if (!ra || ra.profile_id || ra.renamed) continue; // only automatic "Speaker N" labels
      for (const [b, cb] of cs) {
        if (a === b || !rows.get(b)) continue;
        const sc = cosine(ca.c, cb.c);
        if (sc >= mergeAt && (!bestPair || sc > bestPair.sc)) bestPair = { from: a, into: b, sc };
      }
    }
    if (bestPair) {
      mergeSpeakers(meetingId, bestPair.from, bestPair.into);
      for (const s of segs) if (s.speaker_id === bestPair.from) s.speaker_id = bestPair.into;
      again = true;
    }
  }

  // 2) move lines that clearly fit another speaker better
  const cs = centroids();
  const move = db.prepare("UPDATE segments SET speaker_id = ?, speaker_score = ?, speaker_uncertain = ? WHERE id = ?");
  for (const s of segs) {
    if (s.manual) continue;
    const own = cs.get(s.speaker_id);
    // leave single-line speakers alone: their centroid is the line itself
    if (!own || own.n < 2) continue;
    const ownScore = cosine(s.emb, own.c);
    let best = { id: s.speaker_id, sc: ownScore };
    for (const [id, c] of cs) {
      if (id === s.speaker_id || c.n < 2) continue;
      const sc = cosine(s.emb, c.c);
      if (sc > best.sc) best = { id, sc };
    }
    if (best.id !== s.speaker_id && best.sc >= settings.voiceClusterThreshold && best.sc - ownScore >= 0.1) {
      move.run(best.id, best.sc, best.sc < settings.voiceClusterThreshold + UNSURE_BAND ? 1 : 0, s.id);
      s.speaker_id = best.id;
    }
  }

  // 3) recount lines per speaker
  db.prepare(
    `UPDATE meeting_speakers SET n = (SELECT COUNT(*) FROM segments s WHERE s.speaker_id = meeting_speakers.id)
     WHERE meeting_id = ? AND merged_into IS NULL`
  ).run(meetingId);
}

/** Put failed or empty lines back in the queue (their audio is kept until they succeed). */
export function retryFailed(meetingId) {
  const ids = db
    .prepare("SELECT id FROM segments WHERE meeting_id = ? AND status IN ('error','empty') AND audio IS NOT NULL")
    .all(meetingId)
    .map((r) => r.id);
  if (!ids.length) return 0;
  db.prepare(
    `UPDATE segments SET status = CASE WHEN speaker_id IS NULL AND embedding IS NULL THEN 'pending' ELSE 'queued' END, error = NULL
     WHERE id IN (${ids.map(() => "?").join(",")})`
  ).run(...ids);
  for (const id of ids) queuedAt.set(id, 0); // send right away
  kick();
  return ids.length;
}

// resume anything left unfinished by a previous run
export function resumePending() {
  // turns that were with the browser when the server stopped go to the standard transcription
  db.prepare("UPDATE segments SET status = 'pending' WHERE status = 'analysing'").run();
  db.prepare("UPDATE segments SET status = 'queued' WHERE status = 'live'").run();
  if (db.prepare("SELECT 1 FROM segments WHERE status IN ('pending','queued') LIMIT 1").get()) kick();
}
