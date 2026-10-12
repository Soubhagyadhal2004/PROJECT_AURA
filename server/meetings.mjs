// Meeting Mode: speaker-attributed transcription.
//
// Pipeline per speech segment (cut by the browser's voice-activity detector):
//   1. local speaker embedding (WavLM x-vector, transformers.js)
//   2. compare with registered voice profiles  -> registered name if confident
//   3. otherwise compare with voices already heard in this meeting -> "Speaker N"
//   4. transcription with the Gemini API (several segments per request)
import { db, now, f32ToBlob, blobToF32, getSettings, asBuffer } from "./db.mjs";
import { embedSpeaker, cosine, normalize } from "./models.mjs";
import { pcmToFloat32, pcmSeconds } from "./audio.mjs";
import { transcribeSegments, hasKey } from "./gemini.mjs";

// segments shorter than this carry too little voice for a reliable embedding
const MIN_EMBED_SECONDS = 1.0;
// a registered match must beat the runner-up profile by this margin
const PROFILE_MARGIN = 0.03;

// ---- voice profiles ----------------------------------------------------------
export function listProfiles() {
  return db
    .prepare("SELECT id, name, sample_seconds, consent_note, created_at FROM speaker_profiles ORDER BY name")
    .all()
    .map((p) => ({ id: p.id, name: p.name, sampleSeconds: p.sample_seconds, consentNote: p.consent_note, createdAt: p.created_at }));
}

export async function enrollProfile({ name, pcm, consentNote }) {
  const secs = pcmSeconds(pcm);
  if (secs < 8) throw Object.assign(new Error("Need at least 8 seconds of speech to enroll a voice."), { status: 400 });
  const emb = await embedSpeaker(pcmToFloat32(pcm));
  const info = db
    .prepare("INSERT INTO speaker_profiles(name, embedding, sample_seconds, consent_note, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(name.trim(), f32ToBlob(emb), secs, consentNote, now());
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

/** Score a recording against the registered profiles (used by the "test my voice" check). */
export async function identify(pcm) {
  const emb = await embedSpeaker(pcmToFloat32(pcm));
  const profiles = db.prepare("SELECT id, name, embedding FROM speaker_profiles").all();
  return profiles
    .map((p) => ({ id: p.id, name: p.name, score: cosine(emb, blobToF32(p.embedding)) }))
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
      `SELECT id, speaker_id, start_ms, end_ms, text, speaker_score, speaker_uncertain, status, error
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
    }));
  return { id: m.id, title: m.title, startedAt: m.started_at, endedAt: m.ended_at, speakers, segments };
}

export function updateMeeting(id, { title, ended }) {
  if (title != null) db.prepare("UPDATE meetings SET title = ? WHERE id = ?").run(String(title).trim(), id);
  if (ended) db.prepare("UPDATE meetings SET ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(now(), id);
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
  db.prepare("UPDATE segments SET speaker_id = ?, speaker_uncertain = 0 WHERE id = ?").run(target, segmentId);
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

export function exportMeeting(id, format) {
  const m = getMeeting(id);
  if (!m) return null;
  const name = new Map(m.speakers.map((s) => [s.id, s.label]));
  const rows = m.segments
    .filter((s) => s.text)
    .map((s) => ({ start: clock(s.startMs), end: clock(s.endMs), speaker: name.get(s.speakerId) || "Unknown", text: s.text }));
  const date = new Date(m.startedAt).toLocaleString();
  if (format === "json") {
    return { mime: "application/json", ext: "json", body: JSON.stringify({ title: m.title, startedAt: new Date(m.startedAt).toISOString(), segments: rows }, null, 2) };
  }
  if (format === "md") {
    const body = [`# ${m.title}`, ``, `_${date}_`, ``, ...rows.map((r) => `**${r.speaker}** \`[${r.start}]\`  \n${r.text}\n`)].join("\n");
    return { mime: "text/markdown", ext: "md", body };
  }
  const body = [m.title, date, "", ...rows.map((r) => `[${r.start} - ${r.end}] ${r.speaker}: ${r.text}`)].join("\n");
  return { mime: "text/plain", ext: "txt", body };
}

// ---- background worker -------------------------------------------------------------
let running = false;
export const workerState = { lastError: null, lastErrorAt: null };

function kick() {
  if (!running) {
    running = true;
    setImmediate(() =>
      work()
        .catch((e) => console.error("[meeting] worker crashed:", e))
        .finally(() => {
          running = false;
          // new segments may have arrived while finishing
          if (db.prepare("SELECT 1 FROM segments WHERE status = 'pending' LIMIT 1").get()) kick();
        })
    );
  }
}

function assignSpeaker(meetingId, emb, settings) {
  // 1) registered voices
  const profiles = db.prepare("SELECT id, name, embedding FROM speaker_profiles").all();
  const ranked = profiles
    .map((p) => ({ ...p, score: cosine(emb, blobToF32(p.embedding)) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1]?.score ?? -1;
  if (best && best.score >= settings.speakerMatchThreshold && best.score - runnerUp >= PROFILE_MARGIN) {
    let sp = db.prepare("SELECT * FROM meeting_speakers WHERE meeting_id = ? AND profile_id = ? ORDER BY merged_into IS NULL DESC").get(meetingId, best.id);
    if (!sp) {
      const id = db
        .prepare("INSERT INTO meeting_speakers(meeting_id, label, profile_id, match_score, centroid, n) VALUES (?, ?, ?, ?, ?, 0)")
        .run(meetingId, best.name, best.id, best.score, f32ToBlob(emb)).lastInsertRowid;
      sp = db.prepare("SELECT * FROM meeting_speakers WHERE id = ?").get(id);
    } else {
      db.prepare("UPDATE meeting_speakers SET match_score = MAX(COALESCE(match_score, 0), ?) WHERE id = ?").run(best.score, sp.id);
    }
    updateCentroid(sp, emb);
    return { speakerId: sp.merged_into || sp.id, score: best.score, uncertain: false };
  }

  // 2) unknown voices already heard in this meeting
  const clusters = db.prepare("SELECT * FROM meeting_speakers WHERE meeting_id = ? AND centroid IS NOT NULL").all(meetingId);
  let bestC = null;
  for (const c of clusters) {
    const s = cosine(emb, blobToF32(c.centroid));
    if (!bestC || s > bestC.score) bestC = { c, score: s };
  }
  if (bestC && bestC.score >= settings.speakerClusterThreshold) {
    updateCentroid(bestC.c, emb);
    // near the threshold the decision is shaky -> flag it in the UI
    return { speakerId: bestC.c.merged_into || bestC.c.id, score: bestC.score, uncertain: bestC.score < settings.speakerClusterThreshold + 0.04 };
  }

  // 3) a new voice
  // numbers are never reused within a meeting, even after renames or merges
  db.prepare("UPDATE meetings SET speaker_seq = speaker_seq + 1 WHERE id = ?").run(meetingId);
  const n = db.prepare("SELECT speaker_seq FROM meetings WHERE id = ?").get(meetingId).speaker_seq;
  const id = db
    .prepare("INSERT INTO meeting_speakers(meeting_id, label, centroid, n) VALUES (?, ?, ?, 0)")
    .run(meetingId, `Speaker ${n}`, f32ToBlob(emb)).lastInsertRowid;
  return { speakerId: Number(id), score: bestC?.score ?? null, uncertain: false };
}

function updateCentroid(sp, emb) {
  const c = blobToF32(sp.centroid);
  const n = Math.min(sp.n || 0, 20); // cap so the centroid can still adapt
  let next = emb;
  if (c && c.length === emb.length) {
    next = new Float32Array(emb.length);
    for (let i = 0; i < emb.length; i++) next[i] = (c[i] * n + emb[i]) / (n + 1);
    next = normalize(next);
  }
  db.prepare("UPDATE meeting_speakers SET centroid = ? WHERE id = ?").run(f32ToBlob(next), sp.id);
}

async function work() {
  for (;;) {
    const batch = db
      .prepare("SELECT id, meeting_id, start_ms, end_ms, audio FROM segments WHERE status = 'pending' ORDER BY id LIMIT 6")
      .all();
    if (!batch.length) return;
    for (const b of batch) b.audio = asBuffer(b.audio);
    const settings = getSettings();

    // speaker attribution (local)
    for (const seg of batch) {
      const already = db.prepare("SELECT speaker_id FROM segments WHERE id = ?").get(seg.id).speaker_id;
      if (already) continue;
      try {
        const secs = pcmSeconds(seg.audio);
        if (secs >= MIN_EMBED_SECONDS) {
          const emb = await embedSpeaker(pcmToFloat32(seg.audio));
          const r = assignSpeaker(seg.meeting_id, emb, settings);
          db.prepare("UPDATE segments SET speaker_id = ?, speaker_score = ?, speaker_uncertain = ? WHERE id = ?").run(
            r.speakerId, r.score, r.uncertain ? 1 : 0, seg.id
          );
          db.prepare("UPDATE meeting_speakers SET n = n + 1 WHERE id = ?").run(r.speakerId);
        } else {
          // too short to tell: attach to the previous speaker and mark as uncertain
          const prev = db
            .prepare("SELECT speaker_id FROM segments WHERE meeting_id = ? AND start_ms < ? AND speaker_id IS NOT NULL ORDER BY start_ms DESC LIMIT 1")
            .get(seg.meeting_id, seg.start_ms);
          if (prev) {
            db.prepare("UPDATE segments SET speaker_id = ?, speaker_uncertain = 1 WHERE id = ?").run(prev.speaker_id, seg.id);
            db.prepare("UPDATE meeting_speakers SET n = n + 1 WHERE id = ?").run(prev.speaker_id);
          }
        }
      } catch (e) {
        console.error("[meeting] speaker embedding failed:", e.message);
        workerState.lastError = `Speaker model: ${e.message}`;
        workerState.lastErrorAt = now();
      }
    }

    // transcription (Gemini API)
    if (!hasKey()) {
      db.prepare(`UPDATE segments SET status = 'error', error = 'GEMINI_API_KEY missing' WHERE id IN (${batch.map(() => "?").join(",")})`).run(...batch.map((b) => b.id));
      continue;
    }
    try {
      const texts = await transcribeSegments(batch.map((b) => b.audio));
      const upd = db.prepare("UPDATE segments SET text = ?, status = ?, error = NULL, audio = NULL WHERE id = ?");
      db.transaction(() => batch.forEach((b, i) => upd.run(texts[i], texts[i] ? "done" : "empty", b.id)))();
      workerState.lastError = null;
    } catch (e) {
      console.error("[meeting] transcription failed:", e.message);
      workerState.lastError = `Transcription: ${e.message}`;
      workerState.lastErrorAt = now();
      const upd = db.prepare("UPDATE segments SET status = 'error', error = ? WHERE id = ?");
      db.transaction(() => batch.forEach((b) => upd.run(String(e.message).slice(0, 300), b.id)))();
    }
  }
}

/** Put failed segments back in the queue (their audio is kept until they succeed). */
export function retryFailed(meetingId) {
  const n = db.prepare("UPDATE segments SET status = 'pending', error = NULL WHERE meeting_id = ? AND status = 'error' AND audio IS NOT NULL").run(meetingId).changes;
  if (n) kick();
  return n;
}

// resume anything left pending by a previous run
export function resumePending() {
  if (db.prepare("SELECT 1 FROM segments WHERE status = 'pending' LIMIT 1").get()) kick();
}
