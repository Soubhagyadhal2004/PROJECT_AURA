// What happens with a meeting after the transcript is written:
//   - minutes of meeting (on request)
//   - durable facts go to long-term memory (automatically, when enabled)
//   - lookup by date / topic for the assistant
import { db, now, getSettings } from "./db.mjs";
import { generateJSON, hasKey } from "./gemini.mjs";
import { getMeeting, meetingLines, parseMinutes, hooks } from "./meetings.mjs";
import { extractFromMeeting } from "./memory.mjs";

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** "Tuesday 13 October 2026 at 01:18" in the computer's time zone. */
export const longDate = (t) =>
  new Date(t).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---- minutes ------------------------------------------------------------------------------

const MINUTES_SYSTEM = `You write the minutes of a meeting from its transcript.
Write in clear, plain English, even when the transcript is in Hindi or a mix of languages.
Use only what was said. Never invent decisions, owners, numbers or dates.

Speaker names come from voice recognition and can be wrong; "Speaker N" is an unidentified person.
Name an owner for an action item only when it is clear from the transcript who will do it.
When a deadline is relative ("tomorrow", "next Friday"), turn it into a date using the meeting date.

For a short or casual conversation keep everything short, and leave lists empty when there is nothing for them.
summary: 2 to 5 sentences on what the meeting was about and how it ended.
suggested_title: 3 to 8 words naming the main topic, no date.`;

const MINUTES_SCHEMA = {
  type: "object",
  properties: {
    suggested_title: { type: "string" },
    summary: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    decisions: { type: "array", items: { type: "string" } },
    action_items: {
      type: "array",
      items: {
        type: "object",
        properties: { task: { type: "string" }, owner: { type: "string" }, due: { type: "string" } },
        required: ["task"],
      },
    },
    open_questions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "key_points", "decisions", "action_items", "open_questions"],
};

const strList = (a) => (Array.isArray(a) ? a.map((x) => String(x || "").trim()).filter(Boolean) : []);
const DEFAULT_TITLE = /^Meeting \d/; // createMeeting's automatic "Meeting <date>" title

export async function writeMinutes(id) {
  const m = getMeeting(id);
  if (!m) throw httpError(404, "Not found");
  const lines = meetingLines(id);
  if (!lines.length) throw httpError(400, "This meeting has no transcript yet, so there is nothing to summarise.");
  const busy = m.segments.some((s) => ["pending", "queued", "analysing", "live"].includes(s.status));
  const transcript = lines.map((l) => `[${clock(l.startMs)}] ${l.speaker}: ${l.text}`).join("\n").slice(0, 120000);
  const prompt = [
    `Meeting: ${m.title}`,
    `Meeting date: ${longDate(m.startedAt)}`,
    `Participants (from voice recognition): ${m.speakers.filter((s) => s.segments > 0).map((s) => s.label).join(", ") || "unknown"}`,
    busy ? `Note: the last few lines may still be missing from the transcript.` : ``,
    ``,
    `Transcript:`,
    transcript,
  ].join("\n");
  const out = await generateJSON({ system: MINUTES_SYSTEM, prompt, schema: MINUTES_SCHEMA });
  const minutes = {
    summary: String(out.summary || "").trim(),
    keyPoints: strList(out.key_points),
    decisions: strList(out.decisions),
    actionItems: (Array.isArray(out.action_items) ? out.action_items : [])
      .map((a) => ({ task: String(a?.task || "").trim(), owner: String(a?.owner || "").trim() || null, due: String(a?.due || "").trim() || null }))
      .filter((a) => a.task),
    openQuestions: strList(out.open_questions),
    suggestedTitle: String(out.suggested_title || "").trim() || null,
    lines: lines.length, // how much transcript the minutes are based on
  };
  db.prepare("UPDATE meetings SET minutes = ?, minutes_at = ? WHERE id = ?").run(JSON.stringify(minutes), now(), id);
  // an automatic title becomes something you can recognise in the list
  if (minutes.suggestedTitle && DEFAULT_TITLE.test(m.title)) {
    db.prepare("UPDATE meetings SET title = ? WHERE id = ?").run(minutes.suggestedTitle.slice(0, 120), id);
  }
  return getMeeting(id);
}

export function deleteMinutes(id) {
  db.prepare("UPDATE meetings SET minutes = NULL, minutes_at = NULL WHERE id = ?").run(id);
  return getMeeting(id);
}

// ---- memory -------------------------------------------------------------------------------

let chain = Promise.resolve();

/** Learn durable facts from a meeting. Runs one meeting at a time. */
export function memorizeMeeting(id) {
  if (!getMeeting(id)) throw httpError(404, "Not found");
  if (!hasKey()) throw httpError(503, "GEMINI_API_KEY is not set.");
  db.prepare("UPDATE meetings SET memory_status = 'running', memory_error = NULL WHERE id = ?").run(id);
  const job = chain.then(async () => {
    const m = getMeeting(id);
    if (!m) return;
    try {
      const applied = await extractFromMeeting({ meetingId: id, title: m.title, startedAt: m.startedAt, lines: meetingLines(id) });
      db.prepare("UPDATE meetings SET memory_status = 'done', memory_count = ?, memory_error = NULL WHERE id = ?").run(applied.length, id);
    } catch (e) {
      console.error(`[memory] meeting ${id} failed:`, e.message);
      db.prepare("UPDATE meetings SET memory_status = 'error', memory_error = ? WHERE id = ?").run(String(e.message).slice(0, 300), id);
    }
  });
  chain = job.catch(() => {});
  return job;
}

// a server restart interrupts a running extraction: let the user start it again
db.prepare("UPDATE meetings SET memory_status = NULL WHERE memory_status = 'running'").run();

hooks.finished = (id) => {
  const s = getSettings();
  if (!hasKey()) return;
  if (s.autoMemory && s.meetingMemory) memorizeMeeting(id).catch(() => {});
  else db.prepare("UPDATE meetings SET memory_status = 'off' WHERE id = ? AND memory_status IS NULL").run(id);
};

// ---- lookup for the assistant -------------------------------------------------------------

const participants = (id) =>
  db
    .prepare("SELECT label FROM meeting_speakers WHERE meeting_id = ? AND merged_into IS NULL AND n > 0 ORDER BY n DESC")
    .all(id)
    .map((r) => r.label);

const durationMin = (id) => {
  const r = db.prepare("SELECT MAX(end_ms) AS d FROM segments WHERE meeting_id = ?").get(id);
  const d = r?.d || 0;
  return d > 0 ? Math.max(1, Math.round(d / 60000)) : 0;
};

/**
 * Meetings that started in [from, to] (ms epoch, both optional), optionally matching `q`
 * in the title, minutes or transcript. Newest first.
 */
export function findMeetings({ from, to, q, limit = 10 } = {}) {
  const where = [];
  const args = [];
  if (Number.isFinite(from)) where.push("m.started_at >= ?"), args.push(from);
  if (Number.isFinite(to)) where.push("m.started_at <= ?"), args.push(to);
  const base = `SELECT m.* FROM meetings m ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  let rows = [];
  let matchedQuery = false;
  const query = String(q || "").trim();
  if (query) {
    const words = query.split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
    if (words.length) {
      const like = words.map(() => `(m.title LIKE ? OR m.minutes LIKE ? OR EXISTS (SELECT 1 FROM segments s WHERE s.meeting_id = m.id AND s.text LIKE ?))`);
      const wargs = words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]);
      rows = db
        .prepare(`${base} ${where.length ? "AND" : "WHERE"} (${like.join(" OR ")}) ORDER BY m.started_at DESC LIMIT ?`)
        .all(...args, ...wargs, limit);
      matchedQuery = rows.length > 0;
    }
  }
  // no topic match: fall back to the date range alone (the topic may be phrased differently)
  if (!rows.length && (where.length || !query)) rows = db.prepare(`${base} ORDER BY m.started_at DESC LIMIT ?`).all(...args, limit);
  return {
    matchedQuery,
    meetings: rows.map((m) => {
      const mi = parseMinutes(m.minutes);
      const preview = mi
        ? null
        : (meetingLines(m.id) || [])
            .slice(0, 4)
            .map((l) => `${l.speaker}: ${l.text}`)
            .join("\n") || null;
      return {
        id: m.id,
        title: m.title,
        when: longDate(m.started_at),
        startedAt: new Date(m.started_at).toISOString(),
        durationMinutes: durationMin(m.id),
        participants: participants(m.id),
        summary: mi?.summary || null,
        preview,
      };
    }),
  };
}

/** Everything the assistant needs to answer questions about one meeting. */
export function meetingBrief(id, maxChars = 30000) {
  const m = getMeeting(id);
  if (!m) return null;
  const lines = meetingLines(id).map((l) => `[${clock(l.startMs)}] ${l.speaker}: ${l.text}`);
  let transcript = lines.join("\n");
  let truncated = false;
  if (transcript.length > maxChars) {
    // keep the start and the end; the minutes cover the whole meeting
    transcript = `${transcript.slice(0, maxChars * 0.6)}\n[... part of the transcript left out ...]\n${transcript.slice(-maxChars * 0.4)}`;
    truncated = true;
  }
  const memories = db
    .prepare("SELECT content FROM memories WHERE meeting_id = ? AND status = 'active' ORDER BY id")
    .all(id)
    .map((r) => r.content);
  return {
    id: m.id,
    title: m.title,
    when: longDate(m.startedAt),
    durationMinutes: durationMin(id),
    participants: participants(id),
    speakerNamesNote: "Names come from voice recognition and can be wrong; 'Speaker N' is an unidentified person.",
    minutes: m.minutes,
    memoriesFromThisMeeting: memories,
    transcript: transcript || "(no transcript)",
    transcriptTruncated: truncated,
  };
}
