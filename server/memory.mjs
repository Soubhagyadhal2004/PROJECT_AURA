// Long-term memory: extraction from conversations, storage, conflict handling, retrieval.
import { db, now, f32ToBlob, blobToF32, getSettings } from "./db.mjs";
import { embedText, cosine } from "./models.mjs";
import { generateJSON, hasKey } from "./gemini.mjs";
import { EventEmitter } from "node:events";

// Instrumentation: extraction calls, applied operations and the user's review decisions.
// Nothing in the app depends on it; the evaluation harness (eval/) listens to it.
export const memoryEvents = new EventEmitter();

// Minimum search score used when picking the existing memories shown to the extractor. Unset = the same
// minimum as normal search (0.25). The evaluation (eval/) sets AURA_EXTRACT_MIN_SCORE=0 to test always
// showing the 12 best matches.
const EXTRACT_MIN_SCORE = process.env.AURA_EXTRACT_MIN_SCORE ? Number(process.env.AURA_EXTRACT_MIN_SCORE) : undefined;

// Optional behaviours (all OFF by default, so the app behaves as before). Read on every call so the
// evaluation can switch them inside one process.
//   AURA_CANDIDATES = default | nomin | sentence | adaptive   how the memories shown to the extractor are chosen
//   AURA_REPROPOSE  = N   a change the user turned down may be proposed again, at most N times, but only after
//                         the user has said something new (0 = never again, as before)
const candidateMode = () => process.env.AURA_CANDIDATES || "default";
const reproposeMax = () => Math.max(0, Number(process.env.AURA_REPROPOSE || 0) || 0);

export const CATEGORIES = ["preference", "personal", "people", "work", "plan", "other"];

const STOP = new Set(
  "the a an and or but of to in on at for with is are was were be been am i me my mine you your it its this that these those what who whom which do does did have has had will would can could should about from as by not no yes so if then than there their they them he she his her we our us just also very really like".split(
    " "
  )
);
const tokens = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);

// crude stemming so "works"/"working"/"worked" meet "work" in keyword mode
function stem(w) {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function lexicalScore(q, d) {
  const qt = new Set(tokens(q));
  const dt = new Set(tokens(d));
  if (!qt.size || !dt.size) return 0;
  let hit = 0;
  for (const t of qt) if (dt.has(t)) hit++;
  return hit / Math.sqrt(qt.size * dt.size);
}

async function tryEmbed(text) {
  try {
    return await embedText(text);
  } catch {
    return null; // model unavailable -> lexical retrieval still works
  }
}

const rowOut = (r) => ({
  id: r.id,
  content: r.content,
  category: r.category,
  status: r.status,
  supersededBy: r.superseded_by,
  source: r.source,
  conversationId: r.conversation_id,
  meetingId: r.meeting_id ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listMemories() {
  return db
    .prepare("SELECT * FROM memories ORDER BY status = 'active' DESC, updated_at DESC")
    .all()
    .map(rowOut);
}

export function getMemory(id) {
  const r = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
  return r ? rowOut(r) : null;
}

const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export async function addMemory({ content, category = "other", source = "manual", conversationId = null, meetingId = null }) {
  const t = now();
  const emb = await tryEmbed(content);
  // safety net against the extractor storing the same fact twice
  for (const r of db.prepare("SELECT * FROM memories WHERE status = 'active'").all()) {
    const same = norm(r.content) === norm(content) || (emb && r.embedding && cosine(emb, blobToF32(r.embedding)) > 0.97);
    if (same) {
      db.prepare("UPDATE memories SET updated_at = ? WHERE id = ?").run(t, r.id); // re-confirmed
      return getMemory(r.id);
    }
  }
  const info = db
    .prepare(
      `INSERT INTO memories(content, category, status, source, conversation_id, meeting_id, embedding, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?)`
    )
    .run(content.trim(), CATEGORIES.includes(category) ? category : "other", source, conversationId, meetingId, f32ToBlob(emb), t, t);
  return getMemory(info.lastInsertRowid);
}

/** Direct edit from the Memory page. */
export async function editMemory(id, { content, category, status }) {
  const cur = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
  if (!cur) return null;
  const newContent = content != null ? String(content).trim() : cur.content;
  const emb = newContent !== cur.content ? await tryEmbed(newContent) : blobToF32(cur.embedding);
  db.prepare(
    `UPDATE memories SET content = ?, category = ?, status = ?, embedding = ?, updated_at = ?,
       superseded_by = CASE WHEN ? = 'active' THEN NULL ELSE superseded_by END
     WHERE id = ?`
  ).run(
    newContent,
    category && CATEGORIES.includes(category) ? category : cur.category,
    status && ["active", "superseded", "outdated"].includes(status) ? status : cur.status,
    f32ToBlob(emb),
    now(),
    status || cur.status,
    id
  );
  return getMemory(id);
}

export function deleteMemory(id) {
  return db.prepare("DELETE FROM memories WHERE id = ?").run(id).changes > 0;
}

export function deleteAllMemories() {
  return db.prepare("DELETE FROM memories").run().changes;
}

/** Replace an outdated fact with a new one, keeping the old one as history. */
// origin: { source: "conversation" | "meeting", conversationId?, meetingId? }
async function supersede(oldId, content, category, origin) {
  const old = db.prepare("SELECT * FROM memories WHERE id = ? AND status = 'active'").get(oldId);
  if (!old) return addMemory({ content, category, ...origin });
  const created = await addMemory({ content, category: category || old.category, ...origin });
  if (created.id === oldId) return created; // same fact restated: nothing to replace
  db.prepare("UPDATE memories SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?").run(
    created.id,
    now(),
    oldId
  );
  return created;
}

/**
 * Semantic search over active memories. Falls back to keyword overlap when the
 * local embedding model is unavailable.
 */
export async function searchMemories(query, k = 6, { includeInactive = false, minScore: floor } = {}) {
  const rows = db
    .prepare(`SELECT * FROM memories ${includeInactive ? "" : "WHERE status = 'active'"}`)
    .all();
  if (!rows.length || !String(query || "").trim()) return [];
  const qv = await tryEmbed(query);
  const scored = [];
  for (const r of rows) {
    let ev = blobToF32(r.embedding);
    if (qv && !ev) {
      // backfill rows saved while the model was unavailable
      ev = await tryEmbed(r.content);
      if (ev) db.prepare("UPDATE memories SET embedding = ? WHERE id = ?").run(f32ToBlob(ev), r.id);
    }
    const sem = qv && ev ? cosine(qv, ev) : 0;
    const lex = lexicalScore(query, r.content);
    const score = qv && ev ? 0.85 * sem + 0.15 * lex : lex;
    scored.push({ ...rowOut(r), score });
  }
  const minScore = floor ?? (qv ? 0.25 : 0.1);
  return scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Most recently confirmed active memories, used to prime a new Live session. */
export function coreMemories(limit = 30) {
  return db
    .prepare("SELECT * FROM memories WHERE status = 'active' ORDER BY updated_at DESC LIMIT ?")
    .all(limit)
    .map(rowOut);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM = `You maintain the long-term memory of AURA, a personal assistant, about its single user.
You receive the latest part of a conversation and the existing memories that may be related.
Decide which durable facts to store so AURA can use them in future conversations.

Store only things the USER said or confirmed about themselves or their world:
preferences, personal details, people in their life, work and projects, plans with dates, routines.
Do NOT store: small talk, questions the user asked, general knowledge, the assistant's own suggestions,
one-off requests, or anything the user did not actually say.

Write each memory as one short self-contained sentence in the third person, e.g. "The user's sister is named Priya."
For time-bound facts include the date context (today's date is given).

Operations:
- "add": a new fact that is not already stored.
- "update": an existing memory (memory_id) has changed; content is the full new fact. The old one is kept as history.
- "retire": an existing memory (memory_id) is no longer true and there is no replacement.
- "forget": the user explicitly asked AURA to forget an existing memory (memory_id).
If the fact is already stored with the same meaning, do nothing. Return an empty list when nothing is worth storing.`;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    operations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "update", "retire", "forget"] },
          memory_id: { type: "integer" },
          content: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
        },
        required: ["action"],
      },
    },
  },
  required: ["operations"],
};

// Words that suggest the user is changing something they said before. Used only by the "adaptive" mode.
const CHANGE_CUE = /\b(moved|relocated|now|no longer|anymore|any more|stopped|quit|gave up|given up|sold|bought|switched|changed|instead|used to|finished|left|resigned|passed away|died|forget|delete|correction|actually|new|just)\b/i;
const splitSentences = (text) =>
  String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);

/**
 * The existing memories shown to the extractor. Only these can be changed, so a change whose target is not
 * among them cannot be carried out.
 *   default  : the 12 best matches for the whole text (search minimum score) + the 8 most recently confirmed
 *   nomin    : same, without the minimum score
 *   sentence : also search each sentence on its own, keep the best score per memory (search minimum score)
 *   adaptive : sentence search without the minimum score, and 24 matches instead of 12 when the text sounds
 *              like a change ("moved", "no longer", "sold", ...)
 */
export async function selectCandidates(userText, mode = candidateMode()) {
  const floor = mode === "nomin" || mode === "adaptive" ? 0 : EXTRACT_MIN_SCORE;
  let related;
  if (mode === "sentence" || mode === "adaptive") {
    const k = mode === "adaptive" && CHANGE_CUE.test(userText) ? 24 : 12;
    const best = new Map();
    for (const q of new Set([userText, ...splitSentences(userText)])) {
      for (const m of await searchMemories(q, k, { minScore: floor })) {
        const prev = best.get(m.id);
        if (!prev || m.score > prev.score) best.set(m.id, m);
      }
    }
    related = [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
  } else {
    related = await searchMemories(userText, 12, { minScore: floor });
  }
  return [...new Map([...related, ...coreMemories(8)].map((m) => [m.id, m])).values()];
}

export async function extractFromConversation(conversationId) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) return [];
  const fresh = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id")
    .all(conversationId, conv.extracted_upto);
  if (!fresh.some((m) => m.role === "user")) return [];
  const lastId = fresh[fresh.length - 1].id;
  const before = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? AND id <= ? ORDER BY id DESC LIMIT 6")
    .all(conversationId, conv.extracted_upto)
    .reverse();

  const userText = fresh.filter((m) => m.role === "user").map((m) => m.text).join("\n");
  const candidates = await selectCandidates(userText);

  const fmt = (m) => `${m.role === "user" ? "User" : "AURA"}: ${m.text}`;
  const prompt = [
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Existing related memories:",
    candidates.length ? candidates.map((m) => `[${m.id}] (${m.category}) ${m.content}`).join("\n") : "(none)",
    "",
    before.length ? "Earlier context (already processed):\n" + before.map(fmt).join("\n") + "\n" : "",
    "New messages to process:",
    fresh.map(fmt).join("\n"),
  ].join("\n");

  const t0 = Date.now();
  const out = await generateJSON({ system: EXTRACT_SYSTEM, prompt, schema: EXTRACT_SCHEMA });
  memoryEvents.emit("extraction", {
    source: "conversation",
    conversationId,
    candidateIds: candidates.map((c) => c.id),
    operations: (out.operations || []).length,
    latencyMs: Date.now() - t0,
  });
  const applied = await applyOperations(out.operations, candidates, { source: "conversation", conversationId, meetingId: null });
  db.prepare("UPDATE conversations SET extracted_upto = ? WHERE id = ?").run(lastId, conversationId);
  if (applied.length) console.log(`[memory] conversation ${conversationId}:`, applied.map((a) => a.op).join(", "));
  return applied;
}

/** Apply the extractor's operations. Only memories the model was shown (candidates) can be changed. */
async function applyOperations(operations, candidates, origin) {
  const applied = [];
  const known = new Set(candidates.map((c) => c.id));
  const confirm = getSettings().confirmMemoryChanges;
  for (const op of operations || []) {
    const content = String(op.content || "").trim();
    try {
      // changes to facts the user already has: ask first
      if (confirm && ["update", "retire", "forget"].includes(op.action) && known.has(op.memory_id)) {
        if (op.action === "update" && !content) continue;
        const p = propose({ action: op.action, memoryId: op.memory_id, content, category: op.category, ...origin });
        if (p) applied.push({ op: "proposed", proposal: p });
        continue;
      }
      if (op.action === "add" && content) {
        applied.push({ op: "add", memory: await addMemory({ content, category: op.category, ...origin }) });
      } else if (op.action === "update" && content && known.has(op.memory_id)) {
        applied.push({ op: "update", replaced: op.memory_id, memory: await supersede(op.memory_id, content, op.category, origin) });
      } else if (op.action === "retire" && known.has(op.memory_id)) {
        db.prepare("UPDATE memories SET status = 'outdated', updated_at = ? WHERE id = ? AND status = 'active'").run(now(), op.memory_id);
        applied.push({ op: "retire", id: op.memory_id });
      } else if (op.action === "forget" && known.has(op.memory_id)) {
        deleteMemory(op.memory_id);
        applied.push({ op: "forget", id: op.memory_id });
      }
    } catch (e) {
      console.error("[memory] failed to apply", op, e.message);
    }
  }
  memoryEvents.emit("applied", { ...origin, requested: (operations || []).length, applied });
  return applied;
}

const MEETING_SYSTEM = `You maintain the long-term memory of AURA, a personal assistant, about its single user.
You receive the transcript of a meeting the user recorded with AURA, plus existing memories that may be related.
Decide which durable facts from this meeting are worth remembering for future conversations.

Speaker names come from voice recognition and can be wrong. "Speaker N" means an unidentified person.
Only attribute a statement to a named person when the transcript labels it with that name; otherwise write "someone in the meeting".
The transcript may be in Hindi, English or a mix; always write memories in English.

Store: facts about the user, people they met and what those people said about themselves (roles, preferences, plans),
decisions that were made, commitments and deadlines (who will do what, by when), and plans with dates.
Do NOT store: small talk, jokes, greetings, questions without answers, or details that only matter inside the meeting.
Usually a meeting gives 0 to 8 memories; prefer fewer, more useful ones.

Write each memory as one short self-contained sentence in the third person that names the meeting date,
e.g. "In the meeting on 13 Oct 2026, Vaibhav said he is vegetarian." or "The user agreed to send the budget to Basant by 20 Oct 2026."

Operations:
- "add": a new fact that is not already stored.
- "update": an existing memory (memory_id) has changed; content is the full new fact. The old one is kept as history.
- "retire": an existing memory (memory_id) is clearly no longer true and there is no replacement.
Never use "forget" for meetings. If a fact is already stored with the same meaning, do nothing. Return an empty list when nothing is worth storing.`;

/**
 * Learn from a finished meeting.
 * lines: [{ speaker, text }] in order; startedAt: ms epoch.
 */
export async function extractFromMeeting({ meetingId, title, startedAt, lines }) {
  const spoken = lines.filter((l) => String(l.text || "").trim());
  if (!spoken.length) return [];
  const s = getSettings();
  const all = spoken.map((l) => `${l.speaker}: ${l.text}`);
  // long meetings: keep the request a sane size (the start and the end carry most decisions)
  const MAX = 60000;
  let transcript = all.join("\n");
  if (transcript.length > MAX) {
    const head = all.slice(0, Math.floor(all.length * 0.6)).join("\n").slice(0, MAX * 0.6);
    const tail = all.join("\n").slice(-MAX * 0.4);
    transcript = `${head}\n[... middle of the meeting left out ...]\n${tail}`;
  }
  const related = await searchMemories(spoken.map((l) => l.text).join(" ").slice(0, 3000), 12, { minScore: EXTRACT_MIN_SCORE });
  const recent = coreMemories(8);
  const candidates = [...new Map([...related, ...recent].map((m) => [m.id, m])).values()];
  const date = new Date(startedAt);
  const prompt = [
    `Meeting: ${title}`,
    `Meeting date: ${date.toDateString()} (${date.toISOString().slice(0, 10)})`,
    s.userName
      ? `The user's name is ${s.userName}. Lines labelled "${s.userName}" are the user.`
      : `The user's name is not known; don't assume which speaker is the user.`,
    "",
    "Existing related memories:",
    candidates.length ? candidates.map((m) => `[${m.id}] (${m.category}) ${m.content}`).join("\n") : "(none)",
    "",
    "Transcript:",
    transcript,
  ].join("\n");
  const t0 = Date.now();
  const out = await generateJSON({ system: MEETING_SYSTEM, prompt, schema: EXTRACT_SCHEMA });
  memoryEvents.emit("extraction", {
    source: "meeting",
    meetingId,
    candidateIds: candidates.map((c) => c.id),
    operations: (out.operations || []).length,
    latencyMs: Date.now() - t0,
  });
  const ops = (out.operations || []).filter((o) => o.action !== "forget");
  const applied = await applyOperations(ops, candidates, { source: "meeting", conversationId: null, meetingId });
  if (applied.length) {
    console.log(`[memory] meeting ${meetingId}:`, applied.map((a) => a.op).join(", "));
    extractionLog.unshift({ at: now(), meetingId, applied });
    extractionLog.length = Math.min(extractionLog.length, 20);
  }
  return applied;
}

// ---------------------------------------------------------------------------
// Review: proposed changes to existing memories
// ---------------------------------------------------------------------------

const proposalOut = (r) => ({
  id: r.id,
  action: r.action,
  memoryId: r.memory_id,
  content: r.content,
  category: r.category,
  conversationId: r.conversation_id,
  meetingId: r.meeting_id ?? null,
  status: r.status,
  createdAt: r.created_at,
  current: getMemory(r.memory_id),
});

// explicit: the user stated this change themselves (e.g. answering a memory check), so earlier pending or
// turned-down proposals for the same change don't block it.
export function propose({ action, memoryId, content, category, conversationId = null, meetingId = null, explicit = false }) {
  const target = db.prepare("SELECT * FROM memories WHERE id = ? AND status = 'active'").get(memoryId);
  if (!target) return null;
  if (action === "update" && norm(content) === norm(target.content)) return null; // nothing changes
  // don't ask twice for the same change, and (by default) don't re-ask one the user turned down
  const matching = db
    .prepare("SELECT * FROM memory_proposals WHERE memory_id = ? AND action = ? AND status IN ('pending','rejected') ORDER BY id")
    .all(memoryId, action)
    .filter((p) => action !== "update" || norm(p.content) === norm(content));
  if (!explicit && matching.some((p) => p.status === "pending")) return null;
  const rejections = matching.filter((p) => p.status === "rejected");
  if (!explicit && rejections.length) {
    // AURA_REPROPOSE=N: a turned-down change may come back up to N times, only after the user said something new
    if (rejections.length > reproposeMax()) return null;
    if (conversationId != null) {
      const last = db.prepare("SELECT MAX(created_at) AS t FROM messages WHERE conversation_id = ? AND role = 'user'").get(conversationId);
      if (!last?.t || last.t <= rejections[rejections.length - 1].decided_at) return null;
    }
  }
  // a newer proposal for the same memory replaces an older pending one
  db.prepare("DELETE FROM memory_proposals WHERE memory_id = ? AND status = 'pending'").run(memoryId);
  const id = db
    .prepare("INSERT INTO memory_proposals(action, memory_id, content, category, conversation_id, meeting_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(action, memoryId, content || null, CATEGORIES.includes(category) ? category : null, conversationId, meetingId, now()).lastInsertRowid;
  return proposalOut(db.prepare("SELECT * FROM memory_proposals WHERE id = ?").get(id));
}

export function listProposals() {
  return db
    .prepare(
      `SELECT p.* FROM memory_proposals p JOIN memories m ON m.id = p.memory_id
       WHERE p.status = 'pending' AND m.status = 'active' ORDER BY p.created_at`
    )
    .all()
    .map(proposalOut);
}

export const pendingProposalCount = () =>
  db
    .prepare(
      `SELECT COUNT(*) AS n FROM memory_proposals p JOIN memories m ON m.id = p.memory_id
       WHERE p.status = 'pending' AND m.status = 'active'`
    )
    .get().n;

/** Apply a proposed change. For updates the user may adjust the wording first. */
export async function acceptProposal(id, { content } = {}) {
  const p = db.prepare("SELECT * FROM memory_proposals WHERE id = ? AND status = 'pending'").get(id);
  if (!p) return null;
  let result = null;
  if (p.action === "update") {
    const text = String(content ?? p.content ?? "").trim();
    if (!text) throw Object.assign(new Error("The new memory can't be empty."), { status: 400 });
    result = await supersede(p.memory_id, text, p.category, {
      source: p.meeting_id ? "meeting" : "conversation",
      conversationId: p.conversation_id,
      meetingId: p.meeting_id ?? null,
    });
  } else if (p.action === "retire") {
    db.prepare("UPDATE memories SET status = 'outdated', updated_at = ? WHERE id = ? AND status = 'active'").run(now(), p.memory_id);
  } else if (p.action === "forget") {
    deleteMemory(p.memory_id); // also removes the proposal (cascade)
  }
  db.prepare("UPDATE memory_proposals SET status = 'accepted', decided_at = ? WHERE id = ?").run(now(), id);
  memoryEvents.emit("decision", {
    proposalId: id,
    action: p.action,
    memoryId: p.memory_id,
    decision: "accepted",
    // the user changed the wording before accepting
    edited: p.action === "update" && content != null && norm(content) !== norm(p.content || ""),
    waitMs: now() - p.created_at,
  });
  return { ok: true, memory: result };
}

/** Keep the memory as it is. */
export function rejectProposal(id) {
  const p = db.prepare("SELECT * FROM memory_proposals WHERE id = ?").get(id);
  const n = db.prepare("UPDATE memory_proposals SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'").run(now(), id).changes;
  if (n) memoryEvents.emit("decision", { proposalId: id, action: p.action, memoryId: p.memory_id, decision: "rejected", edited: false, waitMs: now() - p.created_at });
  // the user just confirmed the current fact
  if (n) db.prepare("UPDATE memories SET updated_at = ? WHERE id = (SELECT memory_id FROM memory_proposals WHERE id = ?)").run(now(), id);
  return n > 0;
}

/** The user said a memory is still true: it counts as confirmed now (same as turning down a change). */
export function confirmMemory(id) {
  return db.prepare("UPDATE memories SET updated_at = ? WHERE id = ? AND status = 'active'").run(now(), id).changes > 0;
}

/**
 * A change the user asked for directly (answering "Is this still true?"): it goes through the normal proposal
 * path (propose -> acceptProposal) so it is recorded like any reviewed change, then is applied at once.
 * action: update (needs content) | forget. Returns acceptProposal's result, or null when nothing changes.
 */
export async function applyUserChange({ action, memoryId, content = null }) {
  const p = propose({ action, memoryId, content, explicit: true });
  if (!p) return null;
  return acceptProposal(p.id, action === "update" ? { content } : {});
}

// Debounced, serialised background extraction ---------------------------------
const timers = new Map();
let chain = Promise.resolve();
export const extractionLog = []; // last few results, shown in the UI

export function scheduleExtraction(conversationId, delayMs = 4000) {
  if (!hasKey() || !getSettings().autoMemory) return;
  clearTimeout(timers.get(conversationId));
  timers.set(
    conversationId,
    setTimeout(() => {
      timers.delete(conversationId);
      chain = chain
        .then(() => extractFromConversation(conversationId))
        .then((applied) => {
          if (applied.length) {
            extractionLog.unshift({ at: now(), conversationId, applied });
            extractionLog.length = Math.min(extractionLog.length, 20);
          }
        })
        .catch((e) => console.error("[memory] extraction failed:", e.message));
    }, delayMs)
  );
}
