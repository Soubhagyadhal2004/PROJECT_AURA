// Agent: multi-step tasks with AURA's own tools, run safely.
//
//   plan     -> the text model turns a goal into at most MAX_STEPS tool calls (or the caller gives the steps);
//               every step is checked against the tool registry before anything runs.
//   execute  -> steps run in order; a step may use an earlier result ("$1.meetings.0.id").
//   monitor  -> each step is recorded (arguments, result, status, timing, why it was chosen) in agent_steps.
//   recover  -> transient errors are retried; a failed or empty step lets the planner re-plan once
//               with the failure in view; otherwise the task stops and says what went wrong.
//   safety   -> every tool has a risk level:
//                 read     runs on its own
//                 write    runs on its own when it can be undone (AURA_AGENT_AUTO_WRITE=0 asks for these too)
//                 confirm  never runs without the user's yes (the task pauses until approve/reject)
//               Changing or deleting an existing memory is never done directly: it becomes a memory review
//               that waits for the user's OK, as everywhere else in AURA.
//               Tasks can be cancelled at any time; finished write steps can be undone (newest first).
import { db } from "./db.mjs";
import { generateJSON, hasKey } from "./gemini.mjs";
import * as mem from "./memory.mjs";
import * as notes from "./meeting-notes.mjs";
import * as docs from "./documents.mjs";
import * as proactive from "./proactive.mjs";

const httpError = (status, message) => Object.assign(new Error(message), { status });
const MAX_STEPS = 6;
const RETRIES = 2;
const now = () => Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS agent_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,          -- planning | running | awaiting_approval | done | failed | cancelled | rejected | undone
  planner TEXT,                  -- gemini | given
  summary TEXT,                  -- what AURA tells the user at the end
  error TEXT,
  replans INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  tool TEXT NOT NULL,
  args TEXT,                     -- JSON as planned (may hold $n references)
  resolved TEXT,                 -- JSON as run
  why TEXT,                      -- the planner's reason, shown to the user
  risk TEXT NOT NULL,
  status TEXT NOT NULL,          -- pending | awaiting_approval | running | done | empty | failed | skipped | rejected | undone
  result TEXT,                   -- JSON (shortened)
  error TEXT,
  undo TEXT,                     -- JSON: how to reverse it
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS agent_steps_task ON agent_steps(task_id, pos);
`);

// ---- tool registry ---------------------------------------------------------------------------------

const str = (v) => String(v ?? "").trim();
const need = (v, what) => {
  if (!str(v)) throw httpError(400, `${what} is required`);
  return str(v);
};
const toTime = (v) => {
  if (v == null || v === "") return undefined;
  if (Number.isFinite(Number(v))) return Number(v);
  const d = proactive.resolveDate(String(v));
  return d?.at;
};

/**
 * Without the model: facts that open the same way ("The user's father is named ...", "The user lives in ...")
 * and then differ are probably a changed value, so AURA asks; anything else is a different fact.
 * (Embedding similarity alone can't tell these apart: on real memories a changed name scored 0.68 and an
 * unrelated plan 0.67.)
 */
export function heuristicRelation(newFact, oldFact) {
  const toks = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
  const a = toks(newFact);
  const b = toks(oldFact);
  if (a.join(" ") === b.join(" ")) return { relation: "same", reason: "same wording" };
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  if (k >= 4 && k < Math.max(a.length, b.length)) return { relation: "unsure", reason: `both say "${a.slice(0, k).join(" ")} ..." with a different ending` };
  return { relation: "different", reason: "about something else" };
}

/** How a new fact relates to the closest existing one: same | contradicts | different | unsure (ask the user). */
export async function relationTo(newFact, oldFact) {
  // without a working comparison AURA can't be sure a new detail isn't a changed fact: it asks rather than overwrite
  if (!hasKey()) return heuristicRelation(newFact, oldFact);
  const limitMs = Number(process.env.AURA_AGENT_COMPARE_TIMEOUT_MS) || 4000; // a slow model must not hold up the answer
  let timer;
  try {
    const r = await Promise.race([generateJSON({
      system:
        "Compare two short facts about the same user. same = they say the same thing. contradicts = both cannot be true now (a changed value: new job, new city, different name, a moved date). different = they are about different things, or one adds detail without conflict.",
      prompt: `Existing fact: ${oldFact}\nNew fact: ${newFact}`,
      schema: {
        type: "object",
        properties: { relation: { type: "string", enum: ["same", "contradicts", "different"] }, reason: { type: "string" } },
        required: ["relation"],
      },
    }), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`no answer within ${limitMs} ms`)), limitMs)))]);
    return { relation: ["same", "contradicts", "different"].includes(r?.relation) ? r.relation : "different", reason: r?.reason || "" };
  } catch (e) {
    const h = heuristicRelation(newFact, oldFact);
    return { ...h, reason: `couldn't compare with the model (${e.message}); ${h.reason}` };
  } finally {
    clearTimeout(timer);
  }
}

export const TOOLS = {
  recall_memories: {
    risk: "read",
    description: "Search what AURA knows about the user. args: { query }",
    run: async ({ query }) => ({ memories: (await mem.searchMemories(need(query, "query"), 6, { temporal: true })).map(({ id, content, category, updatedAt, mayBeOutdated, why }) => ({ id, content, category, updatedAt, ...(mayBeOutdated ? { mayBeOutdated, why } : {}) })) }),
    empty: (r) => !r.memories.length,
  },
  find_meetings: {
    risk: "read",
    description: "Find recorded meetings. args: { from?, to? (date words like 'last Monday' or ms), q? (topic) }",
    run: async ({ from, to, q }) => notes.findMeetings({ from: toTime(from), to: toTime(to), q: str(q) || undefined }), // { matchedQuery, meetings }
    empty: (r) => !r.meetings?.length,
  },
  get_meeting: {
    risk: "read",
    description: "Minutes, memories and transcript of one meeting. args: { meeting_id }",
    run: async ({ meeting_id }) => {
      const b = notes.meetingBrief(Number(meeting_id));
      if (!b) throw httpError(404, `No meeting ${meeting_id}`);
      return { meeting: b };
    },
  },
  ask_document: {
    risk: "read",
    description: "Answer a question from the documents in this conversation. args: { question, document_id? }",
    run: async ({ question, document_id }, ctx) => docs.askDocuments(ctx.conversationId, { question: need(question, "question"), documentId: document_id }),
    empty: (r) => r.found === false,
  },
  briefing: {
    risk: "read",
    description: "Upcoming reminders, recent memory changes, open reviews and the last meeting's action items. args: {}",
    run: async () => ({ context: proactive.briefingContext() }),
  },
  remember: {
    risk: "write",
    description:
      "Save a new fact about the user. If it contradicts something already known, AURA asks the user before changing it. args: { content, category? (preference|personal|people|work|plan|other) }",
    run: async ({ content, category }, ctx) => {
      const text = need(content, "content");
      const close = (await mem.searchMemories(text, 1, { minScore: 0.6 }))[0];
      if (close) {
        const rel = await relationTo(text, close.content);
        if (rel.relation === "same") return { saved: false, alreadyKnown: close.content, memoryId: close.id };
        if (rel.relation === "contradicts" || rel.relation === "unsure") {
          const p = mem.propose({ action: "update", memoryId: close.id, content: text, category, conversationId: ctx.conversationId, explicit: true });
          return { saved: false, needsUserOk: true, conflictsWith: close.content, proposalId: p?.id ?? null, reason: rel.reason };
        }
      }
      const cat = mem.CATEGORIES.includes(category) ? category : "other";
      const before = now();
      const m = await mem.addMemory({ content: text, category: cat, source: "agent", conversationId: ctx.conversationId });
      // addMemory returns the existing row for a duplicate: that one must never be "undone" (deleted)
      const created = m && m.createdAt >= before;
      if (!created) return { saved: false, alreadyKnown: m?.content, memoryId: m?.id };
      return { saved: true, memoryId: m.id, content: m.content, undo: { kind: "delete_memory", id: m.id } };
    },
  },
  change_memory: {
    risk: "write",
    description: "Ask the user to approve changing an existing memory (never changes it directly). args: { memory_id, content }",
    run: async ({ memory_id, content }, ctx) => {
      const p = mem.propose({ action: "update", memoryId: Number(memory_id), content: need(content, "content"), conversationId: ctx.conversationId, explicit: true });
      if (!p) return { proposed: false, reason: "no such active memory, or nothing would change" };
      return { proposed: true, needsUserOk: true, proposalId: p.id, undo: { kind: "reject_proposal", id: p.id } };
    },
  },
  forget_memory: {
    risk: "write",
    description: "Ask the user to approve deleting an existing memory (never deletes it directly). args: { memory_id }",
    run: async ({ memory_id }, ctx) => {
      const p = mem.propose({ action: "forget", memoryId: Number(memory_id), conversationId: ctx.conversationId, explicit: true });
      if (!p) return { proposed: false, reason: "no such active memory" };
      return { proposed: true, needsUserOk: true, proposalId: p.id, undo: { kind: "reject_proposal", id: p.id } };
    },
  },
  set_reminder: {
    risk: "write",
    description: "Suggest a reminder; the user confirms the day and time on a card. args: { what, when }",
    run: async ({ what, when }, ctx) => {
      const r = proactive.requestReminder({ what: need(what, "what"), when: need(when, "when"), conversationId: ctx.conversationId });
      if (!r.ok) throw httpError(400, r.error);
      return { ...r, undo: r.reminderId && !r.alreadySet ? { kind: "cancel_reminder", id: r.reminderId } : null };
    },
  },
  write_minutes: {
    risk: "confirm", // one paid model call, replaces the meeting's minutes and may rename it
    description: "Write (or rewrite) the minutes of a finished meeting. args: { meeting_id }",
    run: async ({ meeting_id }) => {
      const m = await notes.writeMinutes(Number(meeting_id));
      return { minutes: m?.minutes ?? m, undo: null };
    },
  },
};

async function reverse(undo) {
  if (!undo) return false;
  if (undo.kind === "delete_memory") return mem.deleteMemory(undo.id);
  if (undo.kind === "cancel_reminder") return (await proactive.cancelReminder(undo.id)).ok;
  if (undo.kind === "reject_proposal") {
    mem.rejectProposal(undo.id);
    return true;
  }
  return false;
}

const autoWrite = () => process.env.AURA_AGENT_AUTO_WRITE !== "0";
export const needsApproval = (tool) => TOOLS[tool].risk === "confirm" || (TOOLS[tool].risk === "write" && !autoWrite());

// ---- planning --------------------------------------------------------------------------------------

/** Check a plan against the registry. Returns { steps, problems }. */
export function validatePlan(steps) {
  const problems = [];
  const out = [];
  if (!Array.isArray(steps) || !steps.length) return { steps: [], problems: ["the plan has no steps"] };
  if (steps.length > MAX_STEPS) problems.push(`at most ${MAX_STEPS} steps (got ${steps.length})`);
  steps.slice(0, MAX_STEPS).forEach((s, i) => {
    const tool = str(s?.tool);
    if (!TOOLS[tool]) return problems.push(`step ${i + 1}: unknown tool "${tool}"`);
    let args = s.args ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        return problems.push(`step ${i + 1}: arguments are not JSON`);
      }
    }
    for (const ref of JSON.stringify(args).match(/\$(\d+)/g) || []) {
      const n = Number(ref.slice(1));
      if (!(n >= 1 && n <= i)) problems.push(`step ${i + 1}: ${ref} does not point to an earlier step`);
    }
    out.push({ tool, args, why: str(s.why).slice(0, 300) });
  });
  return { steps: out, problems };
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { tool: { type: "string" }, args: { type: "string", description: "JSON object" }, why: { type: "string" } },
        required: ["tool", "args", "why"],
      },
    },
    cannot: { type: "string", description: "set when the tools cannot do this goal; then steps is empty" },
  },
  required: ["steps"],
};

async function plan(goal, { failure = null, done = [] } = {}) {
  if (!hasKey()) throw httpError(503, "GEMINI_API_KEY is not set, so AURA can't plan a task.");
  const tools = Object.entries(TOOLS).map(([n, t]) => `- ${n} [${t.risk}]: ${t.description}`).join("\n");
  const prompt = [
    `Today: ${proactive.formatWhen(now())}`,
    `Goal: ${goal}`,
    done.length ? `Steps already done (results shortened):\n${done.map((d, i) => `$${i + 1} ${d.tool} -> ${short(d.result, 600)}`).join("\n")}` : "",
    failure ? `The last step failed or found nothing: ${failure}. Plan only the REMAINING steps, a different way.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await generateJSON({
    system: [
      "You plan tasks for AURA, a personal assistant, using ONLY these tools:",
      tools,
      `Use as few steps as needed (max ${MAX_STEPS}). args is a JSON object string. A later step can use an earlier result with "$N.path", e.g. "$1.meetings.0.id".`,
      "Never invent facts or ids; look them up with a read tool first. If the tools can't do the goal, return no steps and say why in cannot.",
      "Changing or deleting what AURA knows must go through change_memory / forget_memory, which ask the user.",
    ].join("\n"),
    prompt,
    schema: PLAN_SCHEMA,
  });
  return { ...validatePlan(r?.steps || []), cannot: str(r?.cannot) };
}

// ---- execution -------------------------------------------------------------------------------------

const short = (v, n = 4000) => {
  const s = JSON.stringify(v ?? null);
  return s.length > n ? s.slice(0, n) + "…" : s;
};
const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** Replace "$N.path" with values from earlier results (a whole-string reference keeps its type). */
export function resolveRefs(args, results) {
  const get = (n, path) => {
    let v = results[n - 1];
    for (const k of path ? path.split(".") : []) v = v == null ? undefined : v[k];
    return v;
  };
  const walk = (v) => {
    if (typeof v === "string") {
      const whole = v.match(/^\$(\d+)(?:\.([\w.]+))?$/);
      if (whole) return get(Number(whole[1]), whole[2]);
      return v.replace(/\$(\d+)(?:\.([\w.]+))?/g, (_, n, p) => {
        const x = get(Number(n), p);
        return typeof x === "object" ? JSON.stringify(x) : String(x ?? "");
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(args);
}

const transient = (e) => e?.status === 429 || e?.status >= 500 || /timeout|ECONNRESET|fetch failed|overloaded/i.test(e?.message || "");
const runs = new Map(); // taskId -> { cancelled }

const taskRow = (id) => db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(id);
const setTask = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE agent_tasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]), now(), id);
};
const setStep = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE agent_steps SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
};
const stepsOf = (taskId) => db.prepare("SELECT * FROM agent_steps WHERE task_id = ? ORDER BY pos").all(taskId);
function addSteps(taskId, steps, from) {
  const ins = db.prepare("INSERT INTO agent_steps(task_id, pos, tool, args, why, risk, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')");
  steps.forEach((s, i) => ins.run(taskId, from + i, s.tool, JSON.stringify(s.args), s.why || null, TOOLS[s.tool].risk));
}

export function getTask(id) {
  const t = taskRow(id);
  if (!t) return null;
  return {
    id: t.id,
    conversationId: t.conversation_id,
    goal: t.goal,
    status: t.status,
    planner: t.planner,
    summary: t.summary,
    error: t.error,
    replans: t.replans,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    steps: stepsOf(id).map((s) => ({
      id: s.id,
      pos: s.pos,
      tool: s.tool,
      args: parse(s.resolved) ?? parse(s.args),
      why: s.why,
      risk: s.risk,
      status: s.status,
      result: parse(s.result),
      error: s.error,
      undoable: Boolean(s.undo) && s.status === "done",
      attempts: s.attempts,
    })),
  };
}
export const listTasks = (limit = 20) => db.prepare("SELECT id FROM agent_tasks ORDER BY id DESC LIMIT ?").all(limit).map((r) => getTask(r.id));

/**
 * Start a task. Either give steps ([{ tool, args, why }]) or let the text model plan the goal.
 * Runs until it is done, fails, or reaches a step that needs the user's yes. Returns the task.
 */
export async function startTask({ goal, steps = null, conversationId = null }) {
  const g = need(goal, "goal");
  const t = now();
  const id = Number(
    db.prepare("INSERT INTO agent_tasks(conversation_id, goal, status, planner, created_at, updated_at) VALUES (?, ?, 'planning', ?, ?, ?)")
      .run(conversationId, g, steps ? "given" : "gemini", t, t).lastInsertRowid
  );
  let p;
  try {
    p = steps ? validatePlan(steps) : await plan(g);
  } catch (e) {
    setTask(id, { status: "failed", error: `Planning failed: ${e.message}` });
    return getTask(id);
  }
  if (p.cannot && !p.steps.length) {
    setTask(id, { status: "failed", error: p.cannot, summary: `I can't do that with the tools I have: ${p.cannot}` });
    return getTask(id);
  }
  if (p.problems.length) {
    setTask(id, { status: "failed", error: `The plan was rejected: ${p.problems.join("; ")}` });
    return getTask(id);
  }
  addSteps(id, p.steps, 1);
  return execute(id);
}

async function execute(taskId) {
  const ctl = { cancelled: false };
  runs.set(taskId, ctl);
  const task = taskRow(taskId);
  setTask(taskId, { status: "running" });
  try {
    for (;;) {
      const all = stepsOf(taskId);
      const results = all.map((s) => parse(s.result));
      const step = all.find((s) => ["pending", "awaiting_approval", "approved"].includes(s.status));
      if (!step) break;
      if (ctl.cancelled || taskRow(taskId).status === "cancelled") return finishCancelled(taskId);

      if (step.status === "pending" && needsApproval(step.tool)) {
        setStep(step.id, { status: "awaiting_approval", resolved: JSON.stringify(resolveRefs(parse(step.args), results)) });
        setTask(taskId, { status: "awaiting_approval" });
        setTask(taskId, { summary: await summarise(taskId) }); // says what needs the user's OK
        return getTask(taskId);
      }
      if (step.status === "awaiting_approval") {
        setTask(taskId, { status: "awaiting_approval" });
        return getTask(taskId);
      }

      const args = step.resolved ? parse(step.resolved) : resolveRefs(parse(step.args), results);
      setStep(step.id, { status: "running", resolved: JSON.stringify(args), started_at: now() });
      let result = null;
      let error = null;
      let attempts = 0;
      for (; attempts <= RETRIES; attempts++) {
        try {
          result = await TOOLS[step.tool].run(args, { conversationId: task.conversation_id, taskId });
          error = null;
          break;
        } catch (e) {
          error = e;
          if (!transient(e)) break;
          await new Promise((r) => setTimeout(r, 300 * 2 ** attempts));
        }
      }
      if (ctl.cancelled) {
        // the step finished while the user cancelled: keep its result (and its undo), stop here
        if (!error) setStep(step.id, { status: "done", result: short(stripUndo(result)), undo: result?.undo ? JSON.stringify(result.undo) : null, attempts: attempts + 1, ended_at: now() });
        return finishCancelled(taskId);
      }
      if (error) {
        setStep(step.id, { status: "failed", error: error.message, attempts: attempts + 1, ended_at: now() });
        if (await recover(taskId, step, `${step.tool} failed: ${error.message}`)) continue;
        skipRest(taskId);
        setTask(taskId, { status: "failed", error: `${step.tool} failed: ${error.message}` });
        break;
      }
      const empty = TOOLS[step.tool].empty?.(result) ?? false;
      setStep(step.id, {
        status: empty ? "empty" : "done",
        result: short(stripUndo(result)),
        undo: result?.undo ? JSON.stringify(result.undo) : null,
        attempts: attempts + 1,
        ended_at: now(),
      });
      if (empty && dependsOn(taskId, step.pos)) {
        if (await recover(taskId, step, `${step.tool} found nothing`)) continue;
        skipRest(taskId);
        setTask(taskId, { status: "failed", error: `${step.tool} found nothing, so the later steps could not run.` });
        break;
      }
    }
    const t = taskRow(taskId);
    if (t.status === "running") setTask(taskId, { status: "done" });
    setTask(taskId, { summary: await summarise(taskId) });
    return getTask(taskId);
  } finally {
    runs.delete(taskId);
  }
}

const stripUndo = (r) => (r && typeof r === "object" ? (({ undo, ...rest }) => rest)(r) : r);
const dependsOn = (taskId, pos) =>
  stepsOf(taskId).some((s) => s.pos > pos && s.status === "pending" && new RegExp(`\\$${pos}(?!\\d)`).test(s.args || ""));
function skipRest(taskId) {
  db.prepare("UPDATE agent_steps SET status = 'skipped' WHERE task_id = ? AND status IN ('pending','awaiting_approval')").run(taskId);
}
function finishCancelled(taskId) {
  skipRest(taskId);
  setTask(taskId, { status: "cancelled", summary: "Cancelled. Finished steps were kept; you can undo them." });
  return getTask(taskId);
}

/** One re-plan per task, only for planned (not given) tasks. Returns true when new steps were added. */
async function recover(taskId, failedStep, failure) {
  const t = taskRow(taskId);
  if (t.planner !== "gemini" || t.replans >= 1 || !hasKey()) return false;
  setTask(taskId, { replans: t.replans + 1 });
  const done = stepsOf(taskId).filter((s) => s.pos < failedStep.pos || s.id === failedStep.id).map((s) => ({ tool: s.tool, result: parse(s.result) }));
  let p;
  try {
    p = await plan(t.goal, { failure, done });
  } catch {
    return false;
  }
  if (!p.steps.length || p.problems.length) return false;
  db.prepare("DELETE FROM agent_steps WHERE task_id = ? AND status = 'pending'").run(taskId);
  // new steps may refer to done steps by their position ($1..$k) or to each other
  addSteps(taskId, p.steps, done.length + 1);
  renumber(taskId);
  return true;
}
function renumber(taskId) {
  stepsOf(taskId).forEach((s, i) => setStep(s.id, { pos: i + 1 }));
}

async function summarise(taskId) {
  const t = getTask(taskId);
  const facts = t.steps.map((s) => `${s.pos}. ${s.tool} [${s.status}]${s.error ? " error: " + s.error : ""} ${short(s.result, 800)}`).join("\n");
  const plain = () => {
    const waiting = t.steps.find((s) => s.status === "awaiting_approval");
    if (waiting) return `I need your OK before I ${waiting.tool.replace(/_/g, " ")}${waiting.why ? ` (${waiting.why})` : ""}.`;
    if (t.status === "failed") return `I couldn't finish: ${t.error}`;
    const asks = t.steps.filter((s) => s.result?.needsUserOk || s.result?.needsConfirmation);
    return asks.length ? "Done, but some changes wait for your OK on a card." : "Done.";
  };
  // A model call here only rewords what the voice model says itself, and costs 4-5 s per task. Opt in with AURA_AGENT_SUMMARY=model.
  if (process.env.AURA_AGENT_SUMMARY !== "model" || !hasKey() || t.status === "awaiting_approval") return plain();
  try {
    const r = await generateJSON({
      system:
        "Tell the user, in at most three short spoken sentences, what was found or done for their goal, using ONLY the step results given. Say plainly what failed or found nothing. Mention anything that still waits for their OK. Never add facts that are not in the results.",
      prompt: `Goal: ${t.goal}\nStatus: ${t.status}${t.error ? " (" + t.error + ")" : ""}\nSteps:\n${facts}`.slice(0, 12000),
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    });
    return str(r?.summary) || plain();
  } catch {
    return plain();
  }
}

// ---- user control ----------------------------------------------------------------------------------

export async function approve(taskId) {
  const t = taskRow(taskId);
  if (!t) throw httpError(404, "No such task");
  const step = stepsOf(taskId).find((s) => s.status === "awaiting_approval");
  if (!step || t.status !== "awaiting_approval") throw httpError(409, "Nothing in this task is waiting for approval.");
  setStep(step.id, { status: "approved" });
  return execute(taskId);
}

export async function reject(taskId) {
  const t = taskRow(taskId);
  if (!t) throw httpError(404, "No such task");
  const step = stepsOf(taskId).find((s) => s.status === "awaiting_approval");
  if (!step) {
    // "no" after the task finished: it is a no to what the task still offers (reminder cards waiting for a yes)
    const offered = stepsOf(taskId).filter((s) => s.tool === "set_reminder" && s.status === "done" && parse(s.result)?.needsConfirmation);
    const declined = [];
    for (const s of offered) {
      const r = await proactive.cancelReminder(parse(s.result).reminderId).catch(() => null);
      if (r?.cancelled) {
        setStep(s.id, { status: "rejected" });
        declined.push(parse(s.result).what);
      }
    }
    if (!declined.length) throw httpError(409, "Nothing in this task is waiting for approval.");
    return { ...getTask(taskId), declinedReminders: declined };
  }
  setStep(step.id, { status: "rejected" });
  skipRest(taskId);
  setTask(taskId, { status: "rejected", summary: `OK, I won't ${step.tool.replace(/_/g, " ")}. Nothing after it was run.` });
  return getTask(taskId);
}

export function cancel(taskId) {
  const t = taskRow(taskId);
  if (!t) throw httpError(404, "No such task");
  if (["done", "failed", "cancelled", "rejected", "undone"].includes(t.status)) return getTask(taskId);
  const ctl = runs.get(taskId);
  if (ctl) ctl.cancelled = true;
  setTask(taskId, { status: "cancelled" });
  if (!ctl) return finishCancelled(taskId);
  return getTask(taskId);
}

/** Reverse every finished, reversible step of a task, newest first. */
export async function undo(taskId) {
  const t = taskRow(taskId);
  if (!t) throw httpError(404, "No such task");
  if (runs.has(taskId)) throw httpError(409, "The task is still running; cancel it first.");
  const done = stepsOf(taskId).filter((s) => s.status === "done" && s.undo).reverse();
  const undone = [];
  const failed = [];
  for (const s of done) {
    try {
      if (await reverse(parse(s.undo))) {
        setStep(s.id, { status: "undone" });
        undone.push(s.tool);
      } else failed.push(s.tool);
    } catch (e) {
      failed.push(`${s.tool} (${e.message})`);
    }
  }
  if (undone.length && !failed.length) setTask(taskId, { status: "undone", summary: `Undone: ${undone.join(", ")}.` });
  return { task: getTask(taskId), undone, failed, nothingToUndo: !done.length };
}

/** The newest task of a conversation that has something to undo. */
export function lastUndoable(conversationId = null) {
  const row = db
    .prepare(
      `SELECT t.id FROM agent_tasks t WHERE (? IS NULL OR t.conversation_id = ?) AND EXISTS
         (SELECT 1 FROM agent_steps s WHERE s.task_id = t.id AND s.status = 'done' AND s.undo IS NOT NULL) ORDER BY t.id DESC LIMIT 1`
    )
    .get(conversationId, conversationId);
  return row?.id ?? null;
}

export function stats() {
  const by = (col) => Object.fromEntries(db.prepare(`SELECT ${col} k, COUNT(*) n FROM agent_tasks GROUP BY ${col}`).all().map((r) => [r.k, r.n]));
  const steps = Object.fromEntries(db.prepare("SELECT status k, COUNT(*) n FROM agent_steps GROUP BY status").all().map((r) => [r.k, r.n]));
  return { tasks: by("status"), steps, tools: Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.risk])) };
}

/** "Delete everything": the task log holds arguments and results, so it goes too. */
export function deleteAllTasks() {
  for (const c of runs.values()) c.cancelled = true;
  return Number(db.prepare("DELETE FROM agent_tasks").run().changes);
}
