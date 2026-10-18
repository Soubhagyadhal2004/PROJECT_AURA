// Ambient mode: AURA stays in the background, listens, and keeps quiet until it is actually needed.
//
// The browser cuts the microphone stream into utterances and posts each one here (audio or text).
// For every utterance:
//   1. it is transcribed (audio) and stored in the conversation as an "ambient" line;
//   2. if it is spoken TO AURA ("Aura, ..." or a reply right after AURA spoke) AURA always answers;
//   3. otherwise the NEED for AURA to chip in is scored (0..1) from the recent transcript and what AURA knows
//      that bears on it: memories, this conversation's documents, past meetings, upcoming reminders;
//   4. the score joins a per-conversation series and the decision follows its TREND, never a single score:
//        rising,  smoothed level at/over the threshold  -> speak
//        rising,  still under the threshold             -> wait     (the need is building)
//        flat                                           -> defer    (keep listening, decide on a later turn)
//        falling                                        -> suppress (the moment is passing, hold back)
//      A downturn on the latest step counts as falling even if the window as a whole still rises.
//   5. when AURA speaks, it gets a short brief that weaves the relevant facts into what is being discussed.
//
// Tuning (all optional, read on every call):
//   AURA_AMBIENT_THRESHOLD=0.6      smoothed need needed before AURA speaks on its own
//   AURA_AMBIENT_WINDOW=3           utterances in the slope fit
//   AURA_AMBIENT_MIN_POINTS=3       utterances scored (since AURA last spoke) before it may speak on its own
//   AURA_AMBIENT_FLAT=0.04          |slope| per utterance below this counts as flat
//   AURA_AMBIENT_SMOOTHING=0.6      weight of the newest score in the moving average
//   AURA_AMBIENT_COOLDOWN_SEC=60    no unprompted contribution on the same topic for this long after AURA spoke
//   AURA_AMBIENT_FOLLOWUP_SEC=25    after AURA spoke, a reply aimed at it is answered without saying its name
//   AURA_AMBIENT_STALE_SEC=180      scores older than this are dropped (a long pause starts a new trend)
//   AURA_AMBIENT_PERSIST=3          a need that stays high but flat for this many utterances in a row is finally spoken (0 = never)
import { db } from "./db.mjs";
import { getSettings } from "./db.mjs";
import { generateJSON, hasKey, transcribeSegments } from "./gemini.mjs";
import * as mem from "./memory.mjs";
import * as conv from "./conversations.mjs";
import * as docs from "./documents.mjs";
import * as notes from "./meeting-notes.mjs";
import * as proactive from "./proactive.mjs";
import { checkVoice } from "./voicegate.mjs";

// ---- settings ------------------------------------------------------------------------------------

const num = (k, d, lo = -Infinity, hi = Infinity) => {
  const v = process.env[k];
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
export function config() {
  return {
    threshold: num("AURA_AMBIENT_THRESHOLD", 0.6, 0, 1),
    window: Math.round(num("AURA_AMBIENT_WINDOW", 3, 2, 12)),
    minPoints: Math.round(num("AURA_AMBIENT_MIN_POINTS", 3, 1, 20)),
    flat: num("AURA_AMBIENT_FLAT", 0.04, 0, 1),
    smoothing: num("AURA_AMBIENT_SMOOTHING", 0.6, 0.05, 1),
    cooldownMs: num("AURA_AMBIENT_COOLDOWN_SEC", 60, 0) * 1000,
    followUpMs: num("AURA_AMBIENT_FOLLOWUP_SEC", 25, 0) * 1000,
    staleMs: num("AURA_AMBIENT_STALE_SEC", 180, 10) * 1000,
    persist: Math.round(num("AURA_AMBIENT_PERSIST", 3, 0, 20)),
  };
}

// ---- the trend (pure functions, unit-tested) -----------------------------------------------------

/** Exponential moving average of the raw scores. */
export function smooth(values, alpha) {
  let s = null;
  return values.map((v) => (s = s == null ? v : alpha * v + (1 - alpha) * s));
}

/** Least-squares slope of ys against 0, 1, 2, ... (change in need per utterance). */
export function slopeOf(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  ys.forEach((y, x) => {
    cov += (x - mx) * (y - my);
    vx += (x - mx) ** 2;
  });
  return cov / vx;
}

/**
 * Direction of the need over the last few utterances.
 * points: [{ need, base? }] oldest first. A point with base: true is the zero level that starts a new trend
 * (after AURA spoke, or the topic changed): it gives the next utterance something to rise from, but it is not
 * an utterance that was heard, so it does not count towards `real`.
 * Returns { direction, slope, step, level, n, real }.
 *   direction: unknown (fewer than 2 points) | rising | flat | falling
 */
export function trend(points, cfg = config()) {
  const sm = smooth(points.map((p) => clamp01(p.need)), cfg.smoothing);
  const n = sm.length;
  const real = points.filter((p) => !p.base).length;
  const level = n ? sm[n - 1] : 0;
  if (n < 2) return { direction: "unknown", slope: 0, step: 0, level, n, real, smoothed: sm };
  const slope = slopeOf(sm.slice(-cfg.window));
  const step = sm[n - 1] - sm[n - 2];
  let direction;
  // raw scores are noisy (1.0 then 0.8 is the same need), so one step must drop clearly to count on its own
  if (step < -cfg.flat * 3) direction = "falling"; // it has turned down: whatever came before, the moment is passing
  else if (slope > cfg.flat) direction = "rising";
  else if (slope < -cfg.flat) direction = step > cfg.flat ? "flat" : "falling"; // an upturn after a fall isn't a rise yet
  else direction = "flat";
  return { direction, slope, step, level, n, real, smoothed: sm };
}

/**
 * What to do with an unprompted contribution, from the trend alone.
 * action: speak | wait | defer | suppress
 * persisted: how many utterances in a row (this one included) were flat with the level at or over the threshold.
 */
export function decideAction(tr, cfg = config(), { inCooldown = false, persisted = 0 } = {}) {
  const heard = tr.real ?? tr.n;
  if (tr.direction === "falling") return { action: "suppress", reason: "the need is falling" };
  if (tr.direction === "flat") {
    // steady and high for several turns: nobody has met the need, so AURA finally says something (once)
    if (cfg.persist > 0 && persisted >= cfg.persist && tr.level >= cfg.threshold && heard >= cfg.minPoints) {
      return inCooldown
        ? { action: "defer", reason: "the need has stayed high, but AURA spoke only a moment ago" }
        : { action: "speak", reason: `the need has stayed high and unmet for ${persisted} turns` };
    }
    return { action: "defer", reason: "the need is steady" };
  }
  if (tr.direction === "unknown" || heard < cfg.minPoints) return { action: "wait", reason: "not enough of the conversation yet" };
  if (tr.level < cfg.threshold) return { action: "wait", reason: "the need is rising but still under the threshold" };
  if (inCooldown) return { action: "defer", reason: "the need is rising and high, but AURA spoke only a moment ago" };
  return { action: "speak", reason: "the need is rising and has crossed the threshold" };
}

const clamp01 = (v) => (Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : 0);

// ---- "is this said to AURA?" -------------------------------------------------------------------

// "Aura, ...", "hey Aura", "okay Aura". Transcripts sometimes write the name as "Ora" or "Aurah";
// "ora" alone is a common word in several Indian languages, so it only counts after hey/hi/ok.
// The transcriber also writes it as "Auditor" or "Aurora" (only after hey/ok, so a sentence about an auditor
// doesn't count), and sometimes spells it out: "A U R A", "H U R A".
const WAKE = /\b(?:aura|aurah)\b|\b(?:hey|hi|hello|ok|okay)[\s,]+(?:ora|aura|aurah|oura|auditor|aurora)\b|\b[ah][\s.\-]+u[\s.\-]+r[\s.\-]+a\b/i;
export const mentionsAura = (text) => WAKE.test(String(text || ""));

// ---- AURA hearing itself ---------------------------------------------------------------------------

const words = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1);
/**
 * True when what was heard is (almost) all words AURA itself said a moment ago: its own voice, picked up by the
 * microphone. Needs a few words, so a short reply of the user's ("Got it.", "Yes.") is never taken for an echo.
 */
export function isEchoOfAura(text, said, { minWords = 4, share = 0.8 } = {}) {
  const heard = words(text);
  if (heard.length < minWords) return false;
  const bag = new Set(said.flatMap(words));
  return heard.filter((w) => bag.has(w)).length / heard.length >= share;
}

// ---- per-conversation state ----------------------------------------------------------------------

const sessions = new Map();
function session(conversationId) {
  let s = sessions.get(conversationId);
  if (!s) {
    s = { points: [], lastSpokeAt: 0, unpromptedAt: 0, persist: 0, newTopic: false, chain: Promise.resolve(), on: false };
    sessions.set(conversationId, s);
  }
  return s;
}

/** Ambient mode was switched on (or off) for a conversation: start a fresh trend. */
export function reset(conversationId, { on = true } = {}) {
  const s = session(conversationId);
  s.points = [];
  s.lastSpokeAt = 0;
  s.persist = 0;
  s.on = !!on;
  return state(conversationId);
}

/** AURA just spoke in this conversation (in ambient mode or because it was asked). */
export function markSpoke(conversationId, at = Date.now()) {
  const s = session(conversationId);
  s.lastSpokeAt = at;
  s.newTopic = false;
  newTrend(s, at); // the need it answered is spent; a new contribution needs a new rise
}

/** Start a fresh trend from a zero level, so the next utterance can rise from it (a jump to high counts as rising). */
function newTrend(s, at) {
  s.points = [{ at, need: 0, base: true }];
  s.persist = 0;
}

export function state(conversationId, at = Date.now()) {
  const s = session(conversationId);
  const cfg = withFeedback(config(), at); // the bar shown is the one in use (after feedback)
  dropStale(s, at, cfg);
  const tr = trend(s.points, cfg);
  return {
    on: s.on,
    config: cfg,
    trend: { direction: tr.direction, slope: round(tr.slope), level: round(tr.level), n: tr.n },
    series: s.points.map((p, i) => ({ at: p.at, need: round(p.need), smoothed: round(tr.smoothed[i]), ...(p.base ? { base: true } : {}) })),
    lastSpokeAt: s.lastSpokeAt || null,
  };
}

function dropStale(s, at, cfg) {
  if (s.points.length && at - s.points[s.points.length - 1].at > cfg.staleMs) s.points = [];
}

const round = (v) => Math.round(v * 1000) / 1000;

// ---- what AURA knows about the current topic -----------------------------------------------------

const DAY = 86_400_000;

/** The last few lines of the conversation, oldest first, as "Overheard:", "User:" or "AURA:". */
export function recentLines(conversationId, limit = 12) {
  return db
    .prepare("SELECT role, modality, text, created_at FROM messages WHERE conversation_id = ? AND modality != 'document' ORDER BY id DESC LIMIT ?")
    .all(conversationId, limit)
    .reverse()
    .map((m) => ({ who: m.role === "assistant" ? "AURA" : m.modality === "ambient" ? "Overheard" : "User", text: m.text, at: m.created_at }));
}

/**
 * Facts that bear on what is being said now: memories, documents, meetings and reminders.
 * Each fact has an id (M12, D3, MT5, R7) so the scorer can say which ones it would use.
 */
export async function gatherContext(conversationId, focusText, at = Date.now()) {
  const facts = [];
  const q = String(focusText || "").slice(-600);
  try {
    for (const m of await mem.searchMemories(q, 5, { temporal: true })) facts.push({ id: `M${m.id}`, kind: "memory", text: m.mayBeOutdated ? `${m.content} (may be outdated: ${m.why})` : m.content, score: round(m.matchScore ?? m.score ?? 0) });
  } catch (e) {
    console.warn("[ambient] memory search:", e.message);
  }
  try {
    for (const line of docs.documentsForPrompt(conversationId)) {
      const id = /document_id (\d+)/.exec(line)?.[1];
      facts.push({ id: `D${id}`, kind: "document", text: line.replace(/^-\s*/, "") });
    }
  } catch {}
  try {
    const found = notes.findMeetings({ q, limit: 2 });
    if (found.matchedQuery) {
      for (const m of found.meetings) facts.push({ id: `MT${m.id}`, kind: "meeting", text: `"${m.title}" on ${m.when}${m.summary ? `: ${m.summary}` : ""}` });
    }
  } catch {}
  try {
    const rows = db
      .prepare("SELECT id, text, due_at FROM nudges WHERE type = 'reminder' AND kind = 'due' AND status IN ('pending','snoozed','shown') AND due_at BETWEEN ? AND ? ORDER BY due_at LIMIT 4")
      .all(at - DAY, at + 7 * DAY);
    for (const r of rows) facts.push({ id: `R${r.id}`, kind: "reminder", text: `${r.text} (${proactive.formatWhen(r.due_at)})` });
  } catch {}
  return facts;
}

// ---- scoring the need ----------------------------------------------------------------------------

const SCORE_SYSTEM = `You are the ambient listener of AURA, a personal assistant that sits quietly in the background while its user talks, with other people or to themselves. AURA must not interrupt unless it can clearly help.

Rate NEED for the newest line: how much the people talking would benefit, right now, from AURA chipping in with something it knows. Typical needs: they are trying to recall a fact AURA has; what they say conflicts with what AURA knows; a reminder or deadline is relevant; a document or a past meeting holds the detail; they are about to act on a clear mistake.
0 = no need (small talk, they have it in hand, nothing AURA knows helps). 0.5 = AURA has something mildly useful. 1 = they are stuck or about to go wrong and AURA has the answer.
Judge only help AURA could give from the facts listed (or simple general knowledge). If nothing listed helps, keep NEED low even when they are unsure.
Rate the newest line in the light of the lines before it: need that keeps building should keep rising; a question someone else has just answered means need has dropped.

Also give: addressed = the newest line is said TO AURA (asks or tells the assistant something), not to another person; topic = a few words; topicShift = the topic just changed from the lines before; kind; a one-line reason.
When NEED is 0.3 or more, write contribution: what AURA would say, one or two short spoken sentences, grounded in the listed facts (never invent facts about the user), and list the ids of the facts used.`;

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    need: { type: "number", description: "0 to 1" },
    addressed: { type: "boolean" },
    topic: { type: "string" },
    topicShift: { type: "boolean" },
    kind: { type: "string", enum: ["none", "recall", "conflict", "reminder", "document", "meeting", "mistake", "general"] },
    reason: { type: "string" },
    contribution: { type: "string" },
    factIds: { type: "array", items: { type: "string" } },
  },
  required: ["need", "addressed", "topic", "topicShift", "kind", "reason"],
};

// Without a Gemini key: a rough score from words that signal being stuck, and how well AURA's facts match.
const STUCK = /\b(i (?:don'?t|do not|can'?t|cannot) (?:remember|recall)|i forg[eo]t|what was (?:it|that|the)|what'?s (?:it|that|the) called|not sure|no idea|which one|when is|when was|where (?:is|was|did)|who (?:is|was)|how much|did we|do we have|is it)\b|\?/i;
export function heuristicNeed(text, facts) {
  const best = Math.max(0, ...facts.filter((f) => f.kind === "memory").map((f) => f.score || 0));
  const stuck = STUCK.test(String(text || "")) ? 0.45 : 0;
  const docs = facts.some((f) => f.kind === "document") && /\b(document|file|pdf|page|sheet|report|contract|says)\b/i.test(text) ? 0.2 : 0;
  return clamp01(stuck + 0.5 * best + docs);
}

async function score(lines, facts, newest, { followUp }) {
  if (!hasKey()) return { need: heuristicNeed(newest, facts), addressed: false, topic: "", topicShift: false, kind: "general", reason: "keyword estimate (no Gemini key)", contribution: "", factIds: [], heuristic: true };
  const prompt = [
    `Now: ${proactive.formatWhen(Date.now())}`,
    followUp ? `AURA spoke a few seconds ago, so the newest line may be a reply to AURA.` : ``,
    ``,
    `Conversation so far (oldest first):`,
    ...lines.slice(0, -1).map((l) => `${l.who}: ${l.text}`),
    ``,
    `NEWEST LINE: ${newest}`,
    ``,
    `What AURA knows that may bear on it:`,
    facts.length ? facts.map((f) => `[${f.id}] (${f.kind}) ${f.text}`).join("\n") : `(nothing relevant found)`,
  ]
    .filter((l) => l !== null)
    .join("\n")
    .slice(-6000);
  const out = await generateJSON({ system: SCORE_SYSTEM, prompt, schema: SCORE_SCHEMA });
  return {
    need: clamp01(out?.need),
    addressed: !!out?.addressed,
    topic: String(out?.topic || "").slice(0, 80),
    topicShift: !!out?.topicShift,
    kind: String(out?.kind || "none"),
    reason: String(out?.reason || "").slice(0, 300),
    contribution: String(out?.contribution || "").slice(0, 600),
    factIds: Array.isArray(out?.factIds) ? out.factIds.map(String).slice(0, 8) : [],
  };
}

// ---- briefs for the voice model -------------------------------------------------------------------

const transcriptBlock = (lines) => lines.map((l) => `${l.who}: ${l.text}`).join("\n");
const factsBlock = (facts, ids) => {
  const use = ids?.length ? facts.filter((f) => ids.includes(f.id)) : facts;
  return (use.length ? use : facts).slice(0, 6).map((f) => `- (${f.kind}) ${f.text}`).join("\n");
};

/** AURA decided to chip in on its own. */
const ONLY_KNOWN = `Use only what you know from the facts below, your tools and general knowledge. If none of it contains what they are missing, say so in one short sentence and offer to remember it once they tell you; never guess or invent personal details.`;

export function speakBrief({ lines, facts, scored, tr, why = "" }) {
  const known = factsBlock(facts, scored.factIds);
  return [
    `[AURA app] Ambient mode: you have been listening quietly and nobody has asked you anything, but ${why || "over the last few turns the need for your help has kept rising and is now high"} (${scored.reason || scored.kind}).`,
    `Chip in now, once: one or two short, natural spoken sentences that add what they are missing. Don't say you were listening, don't mention scores or this note, don't ask a follow-up question unless it is essential. Then stop and let them carry on.`,
    ONLY_KNOWN,
    ``,
    `What was said (oldest first):`,
    transcriptBlock(lines),
    known ? `\nWhat you know that bears on it:\n${known}` : ``,
    scored.contribution ? `\nSuggested point: ${scored.contribution}` : ``,
    facts.some((f) => f.kind === "document") ? `\nIf the detail is in a document, call ask_document first. For a past meeting, use find_meetings / get_meeting.` : ``,
    `(trend: ${tr.direction}, level ${round(tr.level)})`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Someone spoke to AURA directly. */
export function addressedBrief({ lines, facts, text }) {
  const known = factsBlock(facts);
  return [
    `[AURA app] Ambient mode: the user just spoke to you directly: "${text}"`,
    `Answer them now, briefly and naturally (your tools work as usual). After answering, go back to listening quietly.`,
    ONLY_KNOWN,
    lines.length > 1 ? `\nWhat was said just before (oldest first):\n${transcriptBlock(lines.slice(0, -1))}` : ``,
    known ? `\nPossibly relevant (use only if it helps):\n${known}` : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- the decision log -----------------------------------------------------------------------------

function logEvent(e) {
  try {
    db.prepare(
      `INSERT INTO ambient_events(conversation_id, message_id, at, text, addressed, need, smoothed, slope, direction, action, reason, kind, topic, heuristic)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(e.conversationId, e.messageId ?? null, e.at, e.text, e.addressed ? 1 : 0, e.need ?? null, e.smoothed ?? null, e.slope ?? null, e.direction ?? null, e.action, e.reason ?? null, e.kind ?? null, e.topic ?? null, e.heuristic ? 1 : 0);
  } catch (err) {
    console.warn("[ambient] log:", err.message);
  }
  console.log(`[ambient] ${e.action}${e.addressed ? " (addressed)" : ""} need=${e.need ?? "-"} level=${e.smoothed ?? "-"} slope=${e.slope ?? "-"} ${e.direction ?? ""}`);
}

export function events(conversationId, limit = 50) {
  return db
    .prepare("SELECT * FROM ambient_events WHERE conversation_id = ? ORDER BY id DESC LIMIT ?")
    .all(conversationId, limit)
    .reverse()
    .map((r) => ({ id: r.id, at: r.at, text: r.text, addressed: !!r.addressed, need: r.need, level: r.smoothed, slope: r.slope, direction: r.direction, action: r.action, reason: r.reason, kind: r.kind, topic: r.topic }));
}

/** Counts of decisions, for judging how often AURA held back. */
// ---- learning from feedback ------------------------------------------------------------------------
// Right after AURA chipped in on its own, "not now" / "stop" / "I didn't ask" raises the bar for the next
// unprompted contribution; "thanks" / "good point" lowers it a little. The adjustment is kept on disk, fades
// after AURA_AMBIENT_FEEDBACK_DAYS (30) and stays within -0.1 .. +0.25 of the configured threshold.
db.exec(`
CREATE TABLE IF NOT EXISTS ambient_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,       -- negative | positive
  delta REAL NOT NULL,
  text TEXT
);
`);
const NEGATIVE = /\b(not now|stop( it| talking)?|be quiet|keep quiet|quiet|shut up|(i )?didn'?t ask( you)?|nobody asked|no one asked|go away|not you|leave it|not helpful|don'?t interrupt|stop interrupting)\b/i;
const POSITIVE = /\b(thanks|thank you|good point|good one|helpful|that helps|nice|right,? (aura|thanks)|exactly)\b/i;
export function feedbackOf(text) {
  const t = String(text || "");
  if (NEGATIVE.test(t)) return "negative";
  if (POSITIVE.test(t)) return "positive";
  return null;
}
export function thresholdAdjustment(at = Date.now()) {
  const days = num("AURA_AMBIENT_FEEDBACK_DAYS", 30, 1, 365);
  const r = db.prepare("SELECT COALESCE(SUM(delta), 0) AS d FROM ambient_feedback WHERE at > ?").get(at - days * 86_400_000);
  return Math.min(0.25, Math.max(-0.1, Number(r.d) || 0));
}
function withFeedback(cfg, at) {
  const adj = thresholdAdjustment(at);
  return { ...cfg, baseThreshold: cfg.threshold, adjustment: round(adj), threshold: Math.min(0.95, Math.max(0.3, cfg.threshold + adj)) };
}
function recordFeedback(kind, text, at) {
  db.prepare("INSERT INTO ambient_feedback(at, kind, delta, text) VALUES (?, ?, ?, ?)").run(at, kind, kind === "negative" ? 0.05 : -0.02, String(text).slice(0, 200));
}

export function stats() {
  const rows = db.prepare("SELECT action, COUNT(*) AS n FROM ambient_events GROUP BY action").all();
  const fb = db.prepare("SELECT kind, COUNT(*) AS n FROM ambient_feedback GROUP BY kind").all();
  return { ...Object.fromEntries(rows.map((r) => [r.action, r.n])), feedback: Object.fromEntries(fb.map((r) => [r.kind, r.n])), thresholdAdjustment: round(thresholdAdjustment()) };
}

// ---- one utterance ----------------------------------------------------------------------------------

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * An utterance heard in ambient mode. Utterances of one conversation are handled one at a time, in order.
 * Returns { message, addressed, decision: { action, reason, direction, level, slope, threshold, need }, say? }
 *   say: text for the voice model when AURA should speak now (it answers it as a turn).
 */
export function observe(conversationId, text, at = Date.now()) {
  const s = session(conversationId);
  const run = s.chain.then(() => observeNow(conversationId, String(text || "").trim(), at));
  s.chain = run.catch(() => {});
  return run;
}

async function observeNow(conversationId, text, at) {
  if (!conv.getConversation(conversationId)) throw httpError(404, "Not found");
  if (!text) return { message: null, addressed: false, decision: { action: "ignore", reason: "nothing was said" } };
  const s = session(conversationId);
  const cfg = withFeedback(config(), at);
  dropStale(s, at, cfg);
  const followUp = s.lastSpokeAt > 0 && at - s.lastSpokeAt < cfg.followUpMs;

  // the browser already stays deaf while AURA talks; this catches whatever still gets through
  const said = db
    .prepare("SELECT text FROM messages WHERE conversation_id = ? AND role = 'assistant' AND created_at > ? ORDER BY id DESC LIMIT 6")
    .all(conversationId, at - 90_000)
    .map((r) => r.text);
  if (isEchoOfAura(text, said)) {
    const decision = { action: "echo", reason: "AURA's own voice picked up by the microphone" };
    logEvent({ conversationId, at, text, addressed: false, action: "echo", reason: decision.reason });
    return { message: null, addressed: false, decision };
  }
  const wake = mentionsAura(text);

  // the first reaction after AURA chipped in on its own tells whether that was welcome
  if (s.unpromptedAt > 0 && at - s.unpromptedAt < cfg.followUpMs) {
    const fb = feedbackOf(text);
    s.unpromptedAt = 0;
    if (fb) {
      recordFeedback(fb, text, at);
      if (fb === "negative") {
        const message = conv.addMessage(conversationId, { role: "user", text, modality: "ambient" });
        newTrend(s, at);
        // the cooldown restarts, but the next line is not taken as a reply to AURA (it is past the follow-up window)
        s.lastSpokeAt = at - cfg.followUpMs;
        const decision = { action: "suppress", reason: "told AURA to hold back: it will wait for a clearer need next time", threshold: round(withFeedback(config(), at).threshold) };
        logEvent({ conversationId, messageId: message.id, at, text, addressed: true, action: "suppress", reason: decision.reason });
        return { message, addressed: true, decision };
      }
    }
  }

  // store the line first so it is part of the transcript the scorer reads
  const message = conv.addMessage(conversationId, { role: "user", text, modality: wake ? "voice" : "ambient" });
  const lines = recentLines(conversationId);
  const focus = lines.slice(-3).map((l) => l.text).join(" ");
  const facts = await gatherContext(conversationId, focus, at);

  if (wake) {
    // said to AURA by name: always answer, no scoring needed
    proactive.onUserMessage(conversationId, text, at);
    markSpoke(conversationId, at);
    const decision = { action: "answer", reason: "AURA was addressed by name" };
    logEvent({ conversationId, messageId: message.id, at, text, addressed: true, action: "answer", reason: decision.reason });
    return { message, addressed: true, decision, say: addressedBrief({ lines, facts, text }) };
  }

  let scored;
  try {
    scored = await score(lines, facts, text, { followUp });
  } catch (e) {
    console.warn("[ambient] scoring failed:", e.message);
    scored = { need: heuristicNeed(text, facts), addressed: false, topic: "", topicShift: false, kind: "general", reason: "keyword estimate (scoring failed)", contribution: "", factIds: [], heuristic: true };
  }

  if (followUp && scored.addressed) {
    // a reply to what AURA just said
    db.prepare("UPDATE messages SET modality = 'voice' WHERE id = ?").run(message.id);
    message.modality = "voice";
    proactive.onUserMessage(conversationId, text, at);
    markSpoke(conversationId, at);
    const decision = { action: "answer", reason: "a reply to AURA", need: scored.need };
    logEvent({ conversationId, messageId: message.id, at, text, addressed: true, need: scored.need, action: "answer", reason: decision.reason, kind: scored.kind, topic: scored.topic, heuristic: scored.heuristic });
    return { message, addressed: true, decision, say: addressedBrief({ lines, facts, text }) };
  }

  // a new topic starts a new trend: the need about the old one no longer applies
  if (scored.topicShift) {
    newTrend(s, at);
    s.newTopic = true; // the cooldown is against repeating itself on the same topic, so a new topic lifts it
  }
  s.points.push({ at, need: scored.need });
  if (s.points.length > 24) s.points.splice(0, s.points.length - 24);
  const tr = trend(s.points, cfg);
  const inCooldown = s.lastSpokeAt > 0 && at - s.lastSpokeAt < cfg.cooldownMs && !s.newTopic;
  s.persist = tr.direction === "flat" && tr.level >= cfg.threshold ? s.persist + 1 : 0;
  const d = decideAction(tr, cfg, { inCooldown, persisted: s.persist });
  const decision = { ...d, direction: tr.direction, level: round(tr.level), slope: round(tr.slope), threshold: cfg.threshold, need: round(scored.need), kind: scored.kind, topic: scored.topic };
  logEvent({ conversationId, messageId: message.id, at, text, addressed: false, need: round(scored.need), smoothed: round(tr.level), slope: round(tr.slope), direction: tr.direction, action: d.action, reason: d.reason, kind: scored.kind, topic: scored.topic, heuristic: scored.heuristic });
  if (d.action !== "speak") return { message, addressed: false, decision };
  const say = speakBrief({ lines, facts, scored, tr, why: s.persist >= cfg.persist && cfg.persist > 0 ? "the need for your help has stayed high without anyone meeting it" : "" });
  markSpoke(conversationId, at);
  s.unpromptedAt = at;
  return { message, addressed: false, decision, say };
}

/** An utterance as audio (16 kHz PCM16): transcribed, then handled like text. */
export async function observeAudio(conversationId, pcm, at = Date.now()) {
  if (!conv.getConversation(conversationId)) throw httpError(404, "Not found");
  if (!pcm?.length) throw httpError(400, "audio body required");
  // only registered voices are listened to: films, calls and AURA's own speaker belong to nobody on the list
  const voice = await checkVoice(pcm);
  if (!voice.pass) {
    const decision = { action: "ignore", reason: voice.reason, voice: voice.verdict };
    logEvent({ conversationId, at, text: "(voice not recognised)", addressed: false, action: "ignore", reason: voice.reason });
    return { message: null, addressed: false, decision };
  }
  const context = recentLines(conversationId, 6).map((l) => l.text).join("\n");
  const { texts } = await transcribeSegments([pcm], { context, language: getSettings().meetingLanguage || "" });
  const text = String(texts?.[0] || "").trim();
  if (!text) return { message: null, addressed: false, decision: { action: "ignore", reason: "no speech" } };
  if (voice.requireAddressed) {
    // a clip too short to recognise a voice counts only when it is aimed at AURA
    const s = session(conversationId);
    const followUp = s.lastSpokeAt > 0 && at - s.lastSpokeAt < config().followUpMs;
    if (!mentionsAura(text) && !followUp) {
      const decision = { action: "ignore", reason: voice.reason, voice: "short" };
      logEvent({ conversationId, at, text: "(short clip, voice unverified)", addressed: false, action: "ignore", reason: voice.reason });
      return { message: null, addressed: false, decision };
    }
  }
  const r = await observe(conversationId, text, at);
  if (voice.name) r.decision.speaker = voice.name;
  return r;
}
