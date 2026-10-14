// Proactive nudges: AURA brings something up on its own (memory checks, reminders, a short briefing).
// Everything here is OFF unless switched on in .env, one switch per type:
//   AURA_PROACTIVE_MEMORY=1      ask "Is this still true?" about older facts that tend to change
//   AURA_PROACTIVE_REMINDERS=1   "remind me ..." and dated meeting action items become reminders (after you approve them)
//   AURA_PROACTIVE_BRIEFING=1    a short briefing on demand, and once a day when AURA_BRIEFING_TIME=HH:MM is set
// With all three off nothing is created, scheduled or shown, so AURA behaves exactly as before.
//
// Limits that apply to every type (all optional):
//   AURA_NUDGE_MAX_PER_DAY=3          nudges shown per day
//   AURA_NUDGE_COOLDOWN_MIN=120       nothing new is shown for this long after you dismiss one
//   AURA_QUIET_HOURS=22:00-08:00      nothing is shown in these hours ("off" to disable)
//   AURA_MEMORY_CHECKS_PER_DAY=1      memory checks per day (1 or 2)
//   AURA_MEMORY_CHECK_AFTER_DAYS=30   a fact is checked once it hasn't been confirmed for this long
//   AURA_TIMEZONE=Asia/Kolkata        time zone for days, quiet hours and reminders (default: this computer's)
// Nothing is shown while a meeting is recording. During a voice conversation only reminder cards are shown
// (they come from what the user just asked for); everything else waits until the conversation ends.
import { EventEmitter } from "node:events";
import * as chrono from "chrono-node";
import { db } from "./db.mjs";
import { generateJSON, hasKey } from "./gemini.mjs";
import * as mem from "./memory.mjs";

// what happens to nudges (created, shown, decided); also printed to the server log
export const proactiveEvents = new EventEmitter();
const log = (event, data) => {
  proactiveEvents.emit(event, data);
  console.log(`[proactive] ${event}`, JSON.stringify(data));
};

// ---- switches and limits (read on every call, so tests can change them) ----------------------------

const flag = (k) => process.env[k] === "1";
export const switches = () => ({
  memory: flag("AURA_PROACTIVE_MEMORY"),
  reminders: flag("AURA_PROACTIVE_REMINDERS"),
  briefing: flag("AURA_PROACTIVE_BRIEFING"),
});
export const anyOn = () => Object.values(switches()).some(Boolean);
const typeOn = (type) => {
  const s = switches();
  return type === "memory_check" ? s.memory : type === "reminder" ? s.reminders : type === "briefing" ? s.briefing : false;
};

const int = (k, d) => {
  const n = Number(process.env[k]);
  return process.env[k] != null && process.env[k] !== "" && Number.isFinite(n) ? n : d;
};
export function limits() {
  return {
    maxPerDay: Math.max(0, int("AURA_NUDGE_MAX_PER_DAY", 3)),
    cooldownMs: Math.max(0, int("AURA_NUDGE_COOLDOWN_MIN", 120)) * 60_000,
    quietHours: parseQuiet(process.env.AURA_QUIET_HOURS ?? "22:00-08:00"),
    memoryChecksPerDay: Math.min(2, Math.max(0, int("AURA_MEMORY_CHECKS_PER_DAY", 1))),
    staleMs: Math.max(1, int("AURA_MEMORY_CHECK_AFTER_DAYS", 30)) * DAY,
    recheckMs: 90 * DAY, // the same fact is not asked about again for this long
    briefingTime: parseClock(process.env.AURA_BRIEFING_TIME || ""),
    timeZone: timeZone(),
  };
}
const DAY = 86_400_000;
const SNOOZE_MS = { memory_check: DAY, reminder: 10 * 60_000, briefing: 60 * 60_000 };

export function timeZone() {
  const tz = process.env.AURA_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
}
function parseQuiet(s) {
  if (!s || /^(off|none|0)$/i.test(s.trim())) return null;
  const [a, b] = s.split("-").map(parseClock);
  return a == null || b == null || a === b ? null : { from: a, to: b };
}

// ---- time-zone helpers (Intl only; dates are parsed by chrono-node) --------------------------------

/** Wall-clock parts of an instant in a time zone. */
export function localParts(t, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(t))
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)])
  );
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}
/** Minutes the zone is ahead of UTC at that instant (330 for India). */
export function offsetMinutes(t, tz) {
  const p = localParts(t, tz);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000) / 60_000);
}
/** The instant of a wall-clock time in a zone. */
export function zonedTime(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMinutes(guess, tz) * 60_000;
  t = guess - offsetMinutes(t, tz) * 60_000; // second pass settles daylight-saving edges
  return t;
}
export function startOfDay(t, tz) {
  const p = localParts(t, tz);
  return zonedTime(p.y, p.mo, p.d, 0, 0, tz);
}
export function inQuietHours(t, tz, quiet) {
  if (!quiet) return false;
  const p = localParts(t, tz);
  const m = p.h * 60 + p.mi;
  return quiet.from < quiet.to ? m >= quiet.from && m < quiet.to : m >= quiet.from || m < quiet.to;
}
/** "Thu 15 Oct, 5:00 PM" in the user's time zone. */
export function formatWhen(t, tz = timeZone()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(t))
    .replace(/\b(am|pm)\b/, (x) => x.toUpperCase());
}

// ---- storage ---------------------------------------------------------------------------------------

const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const toNudge = (r) =>
  r && {
    id: r.id,
    type: r.type,
    kind: r.kind || null,
    text: r.text,
    dueAt: r.due_at,
    status: r.status,
    outcome: r.outcome || null,
    sourceMemoryId: r.source_memory_id ?? null,
    sourceConversationId: r.source_conversation_id ?? null,
    sourceMeetingId: r.source_meeting_id ?? null,
    payload: parse(r.payload),
    createdAt: r.created_at,
    shownAt: r.shown_at ?? null,
    decidedAt: r.decided_at ?? null,
    snoozes: r.snoozes,
  };
export const getNudge = (id) => toNudge(db.prepare("SELECT * FROM nudges WHERE id = ?").get(id));

function insertNudge({ type, kind = null, text, dueAt, memoryId = null, conversationId = null, meetingId = null, payload = null, at }) {
  const id = Number(
    db
      .prepare(
        `INSERT INTO nudges(type, kind, text, due_at, status, source_memory_id, source_conversation_id, source_meeting_id, payload, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
      )
      .run(type, kind, text, dueAt, memoryId, conversationId, meetingId, payload ? JSON.stringify(payload) : null, at).lastInsertRowid
  );
  log("created", { id, type, kind, dueAt });
  return getNudge(id);
}

/** Nudges waiting for an answer in the inbox (only types that are switched on). */
export function openNudges() {
  return db
    .prepare("SELECT * FROM nudges WHERE status = 'shown' ORDER BY shown_at, id")
    .all()
    .map(toNudge)
    .filter((n) => typeOn(n.type));
}

export function deleteAllNudges() {
  return db.prepare("DELETE FROM nudges").run().changes;
}

// ---- "never interrupt a live conversation" -------------------------------------------------------

const presence = { voice: false, at: 0 };
const PRESENCE_TTL = 2 * 60_000; // the browser repeats it every minute while voice is on
/** Called by the browser when a voice session starts or stops (and every minute while it runs). */
export function setPresence({ voice }, at = Date.now()) {
  presence.voice = !!voice;
  presence.at = at;
}
export function busy(at = Date.now()) {
  if (presence.voice && at - presence.at < PRESENCE_TTL) return "voice";
  // a meeting that is still recording (speech in the last two minutes)
  const rec = db
    .prepare(
      `SELECT 1 FROM meetings m WHERE m.ended_at IS NULL
         AND m.started_at + COALESCE((SELECT MAX(end_ms) FROM segments s WHERE s.meeting_id = m.id), 0) > ?`
    )
    .get(at - PRESENCE_TTL);
  return rec ? "meeting" : null;
}

// ---- the scheduler -------------------------------------------------------------------------------

/**
 * Why nothing can be shown right now (or null when something can).
 * Daily counts use the user's local day.
 */
// requested: a reminder the user asked for. It may appear during a voice conversation and ignores quiet hours,
// the cooldown and the daily limit (those are for things AURA brings up on its own); a meeting recording still holds it.
export function blockedReason(at = Date.now(), { requested = false } = {}) {
  const L = limits();
  const b = busy(at);
  if (b === "meeting") return "meeting recording";
  if (requested) return null;
  if (b === "voice") return "voice conversation";
  if (inQuietHours(at, L.timeZone, L.quietHours)) return "quiet hours";
  // only a real dismissal counts (not a declined or expired reminder suggestion)
  const lastDismiss = db.prepare("SELECT MAX(decided_at) AS t FROM nudges WHERE status = 'dismissed' AND outcome = 'dismissed'").get().t;
  if (lastDismiss && at - lastDismiss < L.cooldownMs) return "cooldown";
  if (shownToday(at) >= L.maxPerDay) return "daily limit";
  return null;
}
// reminders the user asked for don't use up the daily allowance
const shownToday = (at, type = null) =>
  db
    .prepare(`SELECT COUNT(*) AS n FROM nudges WHERE shown_at >= ? ${type ? "AND type = ?" : "AND type != 'reminder'"}`)
    .get(...[startOfDay(at, limits().timeZone), ...(type ? [type] : [])]).n;

/**
 * One scheduler step: create what is due (memory checks, the daily briefing), then show due nudges
 * within the limits. Returns the nudges it showed.
 */
export async function tick(at = Date.now()) {
  if (!anyOn()) return [];
  try {
    if (switches().memory) queueMemoryCheck(at);
    if (switches().briefing) await queueDailyBriefing(at);
  } catch (e) {
    console.error("[proactive] could not create a nudge:", e.message);
  }
  return surface(at);
}

/** Move due nudges to the inbox ("shown"), respecting every limit. */
export function surface(at = Date.now()) {
  if (!anyOn()) return [];
  const L = limits();
  const shown = [];
  // reminder confirmations whose time has already passed are no use any more
  for (const r of db.prepare("SELECT * FROM nudges WHERE type = 'reminder' AND kind = 'confirm' AND status IN ('pending','snoozed')").all()) {
    const when = parse(r.payload)?.at;
    if (when && when <= at) {
      db.prepare("UPDATE nudges SET status = 'dismissed', outcome = 'expired', decided_at = ? WHERE id = ?").run(at, r.id);
      log("expired", { id: r.id, type: r.type });
    }
  }
  const due = db
    .prepare("SELECT * FROM nudges WHERE status IN ('pending','snoozed') AND due_at <= ? ORDER BY due_at, id")
    .all(at)
    .map(toNudge)
    .filter((n) => typeOn(n.type));
  for (const n of due) {
    if (blockedReason(at, { requested: n.type === "reminder" })) continue;
    if (n.type === "memory_check") {
      if (shownToday(at, "memory_check") >= L.memoryChecksPerDay) continue;
      const m = n.sourceMemoryId && mem.getMemory(n.sourceMemoryId);
      if (!m || m.status !== "active") {
        db.prepare("UPDATE nudges SET status = 'dismissed', outcome = 'gone', decided_at = ? WHERE id = ?").run(at, n.id);
        continue;
      }
    }
    db.prepare("UPDATE nudges SET status = 'shown', shown_at = ? WHERE id = ?").run(at, n.id);
    log("shown", { id: n.id, type: n.type, kind: n.kind });
    shown.push(getNudge(n.id));
  }
  return shown;
}

let timer = null;
/** Runs tick() every 60 s. Does nothing when every switch is off. */
export function startScheduler(everyMs = 60_000) {
  if (timer || !anyOn()) return false;
  const run = () => tick().catch((e) => console.error("[proactive] tick failed:", e.message));
  timer = setInterval(run, everyMs);
  timer.unref?.();
  setTimeout(run, 5_000).unref?.();
  console.log(`[proactive] on: ${Object.entries(switches()).filter(([, v]) => v).map(([k]) => k).join(", ")}`);
  return true;
}
export function stopScheduler() {
  clearInterval(timer);
  timer = null;
}

// ---- the user's answer -----------------------------------------------------------------------------

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * decision: accept | snooze | dismiss
 * For a memory check, accept needs answer: yes | changed (with content) | forget.
 */
export async function decide(id, { decision, answer, content } = {}, at = Date.now()) {
  const n = getNudge(id);
  if (!n || !typeOn(n.type)) throw httpError(404, "Not found");
  if (!["shown", "pending", "snoozed"].includes(n.status)) throw httpError(409, "This has already been answered.");
  const finish = (status, outcome) => {
    db.prepare("UPDATE nudges SET status = ?, outcome = ?, decided_at = ? WHERE id = ?").run(status, outcome, at, id);
    log("decided", { id, type: n.type, kind: n.kind, status, outcome, waitMs: n.shownAt ? at - n.shownAt : null });
  };

  if (decision === "snooze") {
    db.prepare("UPDATE nudges SET status = 'snoozed', due_at = ?, snoozes = snoozes + 1, decided_at = ? WHERE id = ?").run(at + SNOOZE_MS[n.type], at, id);
    log("decided", { id, type: n.type, kind: n.kind, status: "snoozed", outcome: null });
    return { nudge: getNudge(id) };
  }
  if (decision === "dismiss") {
    // saying no to a reminder isn't a sign of too many nudges, so only other dismissals start the cooldown
    finish("dismissed", n.type === "reminder" ? (n.kind === "confirm" ? "declined" : "cancelled") : "dismissed");
    return { nudge: getNudge(id) };
  }
  if (decision !== "accept") throw httpError(400, "decision must be accept, snooze or dismiss");

  if (n.type === "memory_check") {
    const r = await answerMemoryCheck(n, { answer, content }, finish);
    return { nudge: getNudge(id), ...r };
  }
  if (n.type === "reminder" && n.kind === "confirm") {
    const p = n.payload || {};
    if (!p.at || p.at <= at) {
      finish("dismissed", "expired");
      throw httpError(409, "That time has already passed.");
    }
    finish("accepted", "scheduled");
    const due = insertNudge({
      type: "reminder",
      kind: "due",
      text: p.what,
      dueAt: p.at,
      conversationId: n.sourceConversationId,
      meetingId: n.sourceMeetingId,
      payload: { what: p.what, at: p.at, when: p.when, key: p.key, confirmedFrom: id },
      at,
    });
    return { nudge: getNudge(id), reminder: due };
  }
  finish("accepted", n.type === "reminder" ? "done" : "read");
  return { nudge: getNudge(id) };
}

// ---- 1. memory checks ------------------------------------------------------------------------------

// AURA's categories for facts that change: work (job, projects), people (relationships), plan (projects, plans).
// "personal" also holds lasting facts (birthday, home town), so only where-you-live facts are taken from it.
const FAST_CATEGORIES = ["work", "people", "plan"];
const WHERE_YOU_LIVE = /\b(live|lives|living|based|moved|stay|stays|staying|city|flat|apartment|rent|rents|renting|house|home|hostel|neighbou?rhood)\b/i;

/**
 * Memories worth checking, most overdue first: active, in a fast-changing category, not confirmed for a while,
 * not already waiting for review and not asked about recently. Memories learned from a meeting transcript are
 * treated as less certain (speaker names can be wrong) and are checked after half the time.
 */
export function selectMemoryChecks({ at = Date.now(), limit = 1 } = {}) {
  const L = limits();
  const rows = db
    .prepare(
      `SELECT * FROM memories m WHERE m.status = 'active'
         AND m.category IN ('work','people','plan','personal')
         AND NOT EXISTS (SELECT 1 FROM memory_proposals p WHERE p.memory_id = m.id AND p.status = 'pending')
         AND NOT EXISTS (SELECT 1 FROM nudges n WHERE n.type = 'memory_check' AND n.source_memory_id = m.id
                         AND (n.status IN ('pending','shown','snoozed') OR n.created_at > ?))`
    )
    .all(at - L.recheckMs);
  return rows
    .filter((r) => FAST_CATEGORIES.includes(r.category) || WHERE_YOU_LIVE.test(r.content))
    .map((r) => {
      const lowConfidence = r.source === "meeting";
      const threshold = lowConfidence ? L.staleMs / 2 : L.staleMs;
      return { id: r.id, content: r.content, category: r.category, source: r.source, confirmedAt: r.updated_at, lowConfidence, overdue: (at - r.updated_at) / threshold };
    })
    .filter((c) => c.overdue >= 1)
    .sort((a, b) => b.overdue - a.overdue || a.id - b.id)
    .slice(0, limit);
}

/** Add one memory check when the day's allowance isn't used up and none is open. */
export function queueMemoryCheck(at = Date.now()) {
  if (!switches().memory) return null;
  const L = limits();
  const today = db.prepare("SELECT COUNT(*) AS n FROM nudges WHERE type = 'memory_check' AND created_at >= ?").get(startOfDay(at, L.timeZone)).n;
  if (today >= L.memoryChecksPerDay) return null;
  const open = db.prepare("SELECT COUNT(*) AS n FROM nudges WHERE type = 'memory_check' AND status IN ('pending','shown','snoozed')").get().n;
  if (open) return null;
  const [c] = selectMemoryChecks({ at, limit: 1 });
  if (!c) return null;
  return insertNudge({
    type: "memory_check",
    text: `Is this still true? "${c.content}"`,
    dueAt: at,
    memoryId: c.id,
    payload: { memory: c.content, category: c.category, confirmedAt: c.confirmedAt, lowConfidence: c.lowConfidence },
    at,
  });
}

async function answerMemoryCheck(n, { answer, content }, finish) {
  const m = n.sourceMemoryId && mem.getMemory(n.sourceMemoryId);
  if (!m || m.status !== "active") {
    finish("dismissed", "gone");
    throw httpError(409, "That memory has already been changed or deleted.");
  }
  if (answer === "yes") {
    mem.confirmMemory(m.id);
    finish("accepted", "yes");
    return { memory: mem.getMemory(m.id) };
  }
  if (answer === "changed") {
    const text = String(content || "").trim();
    if (!text) throw httpError(400, "Write what is true now.");
    const r = await mem.applyUserChange({ action: "update", memoryId: m.id, content: text });
    if (!r) {
      // same wording as before: the user confirmed it
      mem.confirmMemory(m.id);
      finish("accepted", "yes");
      return { memory: mem.getMemory(m.id) };
    }
    finish("accepted", "changed");
    return { memory: r.memory };
  }
  if (answer === "forget") {
    // record the answer first: deleting the memory blanks the text of its checks
    finish("accepted", "forget");
    await mem.applyUserChange({ action: "forget", memoryId: m.id });
    return { memory: null };
  }
  throw httpError(400, "answer must be yes, changed or forget");
}

// ---- 2. reminders ----------------------------------------------------------------------------------

const DEFAULT_HOUR = 9; // a date without a time means 9:00 in the morning
const RELATIVE = /\b(in|after|within)\s+(\d+|an?|a few|half an?)\s*(sec|second|min|minute|hour|hr)/i;
const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Resolve a date phrase ("tomorrow at 5pm", "next Wednesday", "20 Oct") against a fixed "now" in a time zone.
 * Returns { at, text, index } or null. Future dates are preferred ("Friday" = the coming Friday).
 */
export function resolveDate(phrase, { now = Date.now(), tz = timeZone() } = {}) {
  const ref = { instant: new Date(now), timezone: offsetMinutes(now, tz) };
  const r = chrono.parse(String(phrase || ""), ref, { forwardDate: true })[0];
  if (!r) return null;
  let at;
  if (RELATIVE.test(r.text)) {
    // "in 3 minutes": counted from now, to the minute (so the same request made twice gives the same time)
    at = Math.floor(r.start.date().getTime() / 60_000) * 60_000;
  } else {
    // wall-clock date and time in the user's zone (the zone's offset on that day, not today's)
    const g = (k) => r.start.get(k);
    const timed = r.start.isCertain("hour");
    at = zonedTime(g("year"), g("month"), g("day"), timed ? g("hour") : DEFAULT_HOUR, timed ? g("minute") || 0 : 0, tz);
  }
  return { at, text: r.text, index: r.index };
}

// "remind me", "set / add / create / make a reminder", "set an alarm", "don't let me forget"
const REMINDER_ASK = /\b(?:remind me|(?:set|add|create|make|put|schedule)\s+(?:me\s+)?(?:a|an|one)?\s*(?:reminder|alarm)|don'?t let me forget)\b/i;

/**
 * "Remind me to call Mom tomorrow at 5pm" / "Could you set a reminder for my exam at 11am?"
 * -> { what, at, when } (at is null when no date or time was given), or null when nothing asks for a reminder.
 */
export function parseReminder(text, { now = Date.now(), tz = timeZone() } = {}) {
  // "p.m." is not the end of a sentence
  const s = String(text || "").replace(/\b([ap])\.\s?m\.?(?=\s|$|[,;!?])/gi, "$1m");
  const sentence = s.split(/(?<=[.!?])\s+|\n+/).find((x) => REMINDER_ASK.test(x));
  if (!sentence) return null;
  const m = REMINDER_ASK.exec(sentence);
  const after = sentence.slice(m.index + m[0].length);
  const d = resolveDate(after, { now, tz });
  if (!d) return { what: cleanWhat(after), at: null, when: null };
  const what = cleanWhat(after.slice(0, d.index) + " " + after.slice(d.index + d.text.length));
  return { what, at: d.at, when: d.text };
}
const cleanWhat = (s) =>
  String(s)
    .replace(/^\s*(to|that|about|of|for)\s+/i, "")
    .replace(/\s+(at|on|by|in|for|this|next)\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:-]+|[\s,;:.!?-]+$/g, "")
    .trim();

/** Ask (through the inbox) whether to set a reminder. Nothing is scheduled until the user accepts. */
function proposeReminder({ what, at, when, conversationId = null, meetingId = null, now }) {
  if (!what || !at || at <= now) return null;
  const key = `${norm(what)}@${at}`;
  const dup = db.prepare("SELECT 1 FROM nudges WHERE type = 'reminder' AND json_extract(payload, '$.key') = ?").get(key);
  if (dup) return null;
  const tz = timeZone();
  return insertNudge({
    type: "reminder",
    kind: "confirm",
    text: `Set a reminder: "${what}" on ${formatWhen(at, tz)}?`,
    dueAt: now,
    conversationId,
    meetingId,
    payload: { what, at, when, key, timeZone: tz },
    at: now,
  });
}

/**
 * The voice assistant's set_reminder tool: resolve the time and open a confirmation (also shown as a card).
 * The assistant reads the time back and calls confirmReminder only after the user says yes.
 * A matching open confirmation from the same conversation (e.g. made from the chat text) is reused.
 */
export function requestReminder({ what, when, conversationId = null }, at = Date.now()) {
  if (!switches().reminders) throw httpError(404, "Reminders are switched off (AURA_PROACTIVE_REMINDERS=1 turns them on).");
  const task = cleanWhat(what);
  if (!task) throw httpError(400, "what is the reminder for?");
  const d = resolveDate(when, { now: at });
  if (!d) return { ok: false, error: `Couldn't work out a date or time from "${when}". Ask the user for the day and time.` };
  if (d.at <= at) return { ok: false, error: `${formatWhen(d.at)} has already passed. Ask the user for a time in the future.` };
  const open = db
    .prepare("SELECT * FROM nudges WHERE type = 'reminder' AND kind = 'confirm' AND status IN ('pending','shown','snoozed') AND json_extract(payload, '$.at') = ? AND (source_conversation_id IS ? OR source_conversation_id IS NULL OR ? IS NULL) ORDER BY id DESC")
    .get(d.at, conversationId, conversationId);
  let n = open ? toNudge(open) : proposeReminder({ what: task, at: d.at, when: d.text, conversationId, now: at });
  if (!n) {
    // the same reminder was already set or declined before
    const prev = db.prepare("SELECT * FROM nudges WHERE type = 'reminder' AND json_extract(payload, '$.key') = ? ORDER BY id DESC").get(`${norm(task)}@${d.at}`);
    if (prev?.kind === "due") return { ok: true, alreadySet: true, reminderId: prev.id, what: task, when: formatWhen(d.at) };
    n = insertNudge({ type: "reminder", kind: "confirm", text: `Set a reminder: "${task}" on ${formatWhen(d.at)}?`, dueAt: at, conversationId, payload: { what: task, at: d.at, when: d.text, key: `${norm(task)}@${d.at}#${at}`, timeZone: timeZone() }, at });
  }
  surface(at); // show the card now (cards are allowed during voice)
  return { ok: true, needsConfirmation: true, reminderId: n.id, what: n.payload?.what || task, when: formatWhen(d.at), whenSaid: d.text };
}

/** The user said yes (by voice): set the reminder. */
export async function confirmReminder(id, at = Date.now()) {
  const n = getNudge(id);
  if (!n || n.type !== "reminder" || n.kind !== "confirm") throw httpError(404, "No reminder suggestion with that id.");
  if (n.status === "accepted") return { ok: true, alreadySet: true, what: n.payload?.what, when: formatWhen(n.payload?.at) };
  const r = await decide(id, { decision: "accept" }, at);
  return { ok: true, set: true, what: r.reminder.text, when: formatWhen(r.reminder.dueAt) };
}

/** The user said no (by voice). */
export async function cancelReminder(id, at = Date.now()) {
  const n = getNudge(id);
  if (!n || n.type !== "reminder") throw httpError(404, "No reminder with that id.");
  if (!["pending", "shown", "snoozed"].includes(n.status)) return { ok: true, alreadyClosed: true };
  await decide(id, { decision: "dismiss" }, at);
  return { ok: true, cancelled: true };
}

/** A user message in a conversation (typed or spoken). */
export function onUserMessage(conversationId, text, at = Date.now()) {
  if (!switches().reminders) return null;
  try {
    const r = parseReminder(text, { now: at });
    if (!r) return null;
    if (!r.at) {
      log("unresolved", { conversationId, what: r.what });
      return null;
    }
    return proposeReminder({ ...r, conversationId, now: at });
  } catch (e) {
    console.error("[proactive] reminder:", e.message);
    return null;
  }
}

/** Minutes were written: action items with a due date become reminder suggestions (dates read from the meeting day). */
export function onMinutes(meeting, at = Date.now()) {
  if (!switches().reminders || !meeting?.minutes) return [];
  const out = [];
  for (const a of meeting.minutes.actionItems || []) {
    if (!a.due) continue;
    const d = resolveDate(a.due, { now: meeting.startedAt });
    if (!d) {
      log("unresolved", { meetingId: meeting.id, what: a.task, due: a.due });
      continue;
    }
    const what = a.owner ? `${a.task} (${a.owner})` : a.task;
    const n = proposeReminder({ what, at: d.at, when: a.due, meetingId: meeting.id, now: at });
    if (n) out.push(n);
  }
  return out;
}

// ---- 3. briefing -----------------------------------------------------------------------------------

const BRIEF_SYSTEM = `You write a short briefing for the user of a personal assistant.
Use only the facts given. At most 5 lines, each one short sentence, most useful first. No greeting, no filler.
Write dates the way they are given.`;
const BRIEF_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" }, description: "At most 5 short lines" } },
  required: ["lines"],
};

/** The short context the briefing is written from. */
export function briefingContext(at = Date.now()) {
  const tz = timeZone();
  const reminders = db
    .prepare("SELECT * FROM nudges WHERE type = 'reminder' AND kind = 'due' AND status IN ('pending','snoozed','shown') AND due_at < ? ORDER BY due_at LIMIT 5")
    .all(at + 7 * DAY)
    .map((r) => `${r.text} - ${formatWhen(r.due_at, tz)}`);
  const changes = db
    .prepare("SELECT content, status FROM memories WHERE updated_at > ? ORDER BY updated_at DESC LIMIT 6")
    .all(at - 7 * DAY)
    .map((r) => (r.status === "active" ? r.content : `${r.content} (no longer true)`));
  const reviews = mem.listProposals().slice(0, 3).map((p) => (p.action === "update" ? `"${p.current?.content}" -> "${p.content}"` : `${p.action}: "${p.current?.content}"`));
  const last = db.prepare("SELECT id, title, started_at, minutes FROM meetings WHERE minutes IS NOT NULL ORDER BY started_at DESC LIMIT 1").get();
  const items = (parse(last?.minutes)?.actionItems || []).slice(0, 5).map((a) => [a.task, a.owner && `owner ${a.owner}`, a.due && `due ${a.due}`].filter(Boolean).join(", "));
  return {
    reminders,
    memoryChanges: changes,
    pendingReviews: { count: mem.pendingProposalCount(), examples: reviews },
    lastMeeting: last ? { title: last.title, date: formatWhen(last.started_at, tz), actionItems: items } : null,
  };
}

/** A briefing of up to 5 lines. One Gemini call; none when there is nothing to say. */
export async function buildBriefing(at = Date.now()) {
  const c = briefingContext(at);
  const empty = !c.reminders.length && !c.memoryChanges.length && !c.pendingReviews.count && !c.lastMeeting?.actionItems.length;
  if (empty) return { lines: ["Nothing new: no upcoming reminders, recent memory changes, open reviews or meeting action items."], context: c };
  if (!hasKey()) throw httpError(503, "GEMINI_API_KEY is not set");
  const prompt = [`Now: ${formatWhen(at)}`, "", JSON.stringify(c, null, 1)].join("\n").slice(0, 4000);
  const out = await generateJSON({ system: BRIEF_SYSTEM, prompt, schema: BRIEF_SCHEMA });
  const lines = (Array.isArray(out.lines) ? out.lines : []).map((l) => String(l || "").trim()).filter(Boolean).slice(0, 5);
  return { lines: lines.length ? lines : ["Nothing to report."], context: c };
}

/** "Brief me" button. Not limited (the user asked for it); logged like any other nudge. */
export async function briefingNow(at = Date.now()) {
  if (!switches().briefing) throw httpError(404, "The briefing is switched off (AURA_PROACTIVE_BRIEFING=1 turns it on).");
  const b = await buildBriefing(at);
  const n = insertNudge({ type: "briefing", kind: "on_demand", text: b.lines.join("\n"), dueAt: at, payload: { lines: b.lines }, at });
  db.prepare("UPDATE nudges SET status = 'accepted', outcome = 'on_demand', decided_at = ? WHERE id = ?").run(at, n.id);
  return { lines: b.lines };
}

/** Once a day after AURA_BRIEFING_TIME (if set). */
async function queueDailyBriefing(at) {
  const L = limits();
  if (L.briefingTime == null) return null;
  const p = localParts(at, L.timeZone);
  if (p.h * 60 + p.mi < L.briefingTime) return null;
  const done = db.prepare("SELECT 1 FROM nudges WHERE type = 'briefing' AND kind = 'daily' AND created_at >= ?").get(startOfDay(at, L.timeZone));
  if (done) return null;
  const b = await buildBriefing(at);
  return insertNudge({ type: "briefing", kind: "daily", text: b.lines.join("\n"), dueAt: at, payload: { lines: b.lines }, at });
}

// ---- outcomes --------------------------------------------------------------------------------------

/** Counts per type: how nudges ended (for judging whether they help). */
export function stats() {
  const rows = db.prepare("SELECT type, kind, status, outcome, COUNT(*) AS n FROM nudges GROUP BY type, kind, status, outcome").all();
  const out = {};
  for (const r of rows) {
    const t = (out[r.type] ||= { total: 0, byStatus: {}, byOutcome: {} });
    t.total += r.n;
    t.byStatus[r.status] = (t.byStatus[r.status] || 0) + r.n;
    if (r.outcome) t.byOutcome[r.outcome] = (t.byOutcome[r.outcome] || 0) + r.n;
  }
  return out;
}
