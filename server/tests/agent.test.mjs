// Tests of the agent (server/agent.mjs): plans are checked before they run, read and reversible steps run on their
// own, consequential steps wait for the user's yes, failures are retried or re-planned once, tasks can be
// cancelled and undone, and a fact that contradicts a memory becomes a review instead of an overwrite.
// Gemini and the local models are faked. Run: npm run test:server
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-agent-"));
process.env.AURA_DATA_DIR = dataDir;
process.env.GEMINI_API_KEY = "test-key";
process.env.AURA_NO_WARMUP = "1";
process.env.AURA_TIMEZONE = "Asia/Kolkata";
process.env.AURA_PROACTIVE_REMINDERS = "1";
delete process.env.AURA_AGENT_AUTO_WRITE;

// a tiny bag-of-words "embedding" so that similar sentences really are similar
const DIM = 128;
const hash = (w) => [...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % DIM;
const bow = (t) => {
  const v = new Float32Array(DIM);
  for (const w of String(t).toLowerCase().match(/[a-z0-9]+/g) || []) v[hash(w)] += 1;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
mock.module(new URL("../models.mjs", import.meta.url).href, {
  namedExports: {
    modelStatus: { text: { state: "ready" }, speaker: { state: "error" }, segmentation: { state: "error" } },
    warmUp: () => {},
    normalize: (v) => v,
    cosine: (a, b) => a.reduce((s, x, i) => s + x * b[i], 0),
    embedText: async (t) => bow(t),
    embedSpeaker: async () => { throw new Error("not used"); },
    speakerTurns: async () => [],
  },
});

let plans = [];       // planner answers, in order
let relation = "different";
const calls = { plan: 0, summary: 0 };
mock.module(new URL("../gemini.mjs", import.meta.url).href, {
  namedExports: {
    hasKey: () => true,
    usage: {},
    createLiveToken: async () => ({ token: "x" }),
    transcribeSegments: async () => ({ texts: [""], count: 1 }),
    generateJSON: async ({ system }) => {
      if (/You plan tasks/.test(system)) {
        calls.plan++;
        return plans.shift() ?? { steps: [], cannot: "no plan scripted" };
      }
      if (/Compare two short facts/.test(system)) {
        if (relation === "throw") throw new Error("fetch failed");
        return { relation, reason: "test" };
      }
      if (/Tell the user/.test(system)) {
        calls.summary++;
        return { summary: "summary from the results" };
      }
      return { operations: [] };
    },
  },
});

const A = await import("../agent.mjs");
const mem = await import("../memory.mjs");
const conv = await import("../conversations.mjs");
const { db } = await import("../db.mjs");
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
beforeEach(() => {
  db.exec("DELETE FROM agent_tasks; DELETE FROM memory_proposals; DELETE FROM memories; DELETE FROM nudges;");
  plans = [];
  relation = "different";
  calls.plan = calls.summary = 0;
  delete process.env.AURA_AGENT_AUTO_WRITE;
  for (const k of Object.keys(A.TOOLS)) if (k.startsWith("test_")) delete A.TOOLS[k];
});
const step = (tool, args = {}, why = "") => ({ tool, args: JSON.stringify(args), why });

// ---- plan checks ---------------------------------------------------------------------------------

test("a plan with an unknown tool, a forward reference or too many steps is rejected before anything runs", () => {
  assert.match(A.validatePlan([step("send_email")]).problems[0], /unknown tool/);
  assert.match(A.validatePlan([step("get_meeting", { meeting_id: "$2.id" }), step("briefing")]).problems[0], /earlier step/);
  assert.match(A.validatePlan(Array.from({ length: 7 }, () => step("briefing"))).problems[0], /at most 6/);
  assert.equal(A.validatePlan([step("briefing"), step("get_meeting", { meeting_id: "$1.x" })]).problems.length, 0);
});

test("references to earlier results keep their type", () => {
  const r = A.resolveRefs({ meeting_id: "$1.meetings.0.id", note: "about $1.meetings.0.title" }, [{ meetings: [{ id: 7, title: "Budget" }] }]);
  assert.deepEqual(r, { meeting_id: 7, note: "about Budget" });
});

test("a task the tools can't do fails honestly instead of improvising", async () => {
  plans = [{ steps: [], cannot: "there is no email tool" }];
  const t = await A.startTask({ goal: "email my boss" });
  assert.equal(t.status, "failed");
  assert.match(t.summary, /can't do that/);
});

// ---- running ---------------------------------------------------------------------------------------

test("read and reversible steps run on their own; every step is logged with why it ran", async () => {
  plans = [{ steps: [step("recall_memories", { query: "exam" }, "check what is known"), step("remember", { content: "The user's exam is on 3 December", category: "plan" }, "user said so")] }];
  const t = await A.startTask({ goal: "remember that my exam is on 3 December" });
  assert.equal(t.status, "done");
  assert.deepEqual(t.steps.map((s) => s.status), ["empty", "done"]);
  assert.equal(t.steps[0].why, "check what is known");
  assert.equal(t.steps[1].result.saved, true);
  assert.equal(t.summary, "summary from the results");
  assert.equal(mem.listMemories().filter((m) => m.status === "active").length, 1);
});

test("a consequential step waits for the user's yes; rejecting it runs nothing after it", async () => {
  let ran = 0;
  A.TOOLS.test_after = { risk: "read", description: "", run: async () => (ran++, {}) };
  const t = await A.startTask({ goal: "write the minutes", steps: [{ tool: "write_minutes", args: { meeting_id: 1 } }, { tool: "test_after", args: {} }] });
  assert.equal(t.status, "awaiting_approval");
  assert.equal(t.steps[0].status, "awaiting_approval");
  assert.match(t.summary ?? "", /OK/);
  const r = A.reject(t.id);
  assert.equal(r.status, "rejected");
  assert.deepEqual(r.steps.map((s) => s.status), ["rejected", "skipped"]);
  assert.equal(ran, 0);
});

test("approving a waiting step runs it and continues the task", async () => {
  let ran = 0;
  A.TOOLS.test_risky = { risk: "confirm", description: "", run: async () => (ran++, { ok: true }) };
  A.TOOLS.test_after = { risk: "read", description: "", run: async () => (ran++, { ok: true }) };
  const t = await A.startTask({ goal: "g", steps: [{ tool: "test_risky", args: {} }, { tool: "test_after", args: {} }] });
  assert.equal(ran, 0);
  const done = await A.approve(t.id);
  assert.equal(done.status, "done");
  assert.equal(ran, 2);
  await assert.rejects(() => A.approve(t.id), /Nothing in this task/);
});

test("with AURA_AGENT_AUTO_WRITE=0 even reversible writes wait for approval", async () => {
  process.env.AURA_AGENT_AUTO_WRITE = "0";
  const t = await A.startTask({ goal: "g", steps: [{ tool: "remember", args: { content: "The user likes filter coffee" } }] });
  assert.equal(t.status, "awaiting_approval");
  assert.equal(mem.listMemories().length, 0);
  const done = await A.approve(t.id);
  assert.equal(done.steps[0].result.saved, true);
});

test("transient errors are retried; a permanent error stops the task and says why", async () => {
  let n = 0;
  A.TOOLS.test_flaky = { risk: "read", description: "", run: async () => { if (++n < 3) throw Object.assign(new Error("overloaded"), { status: 503 }); return { ok: 1 }; } };
  const t = await A.startTask({ goal: "g", steps: [{ tool: "test_flaky", args: {} }] });
  assert.equal(t.status, "done");
  assert.equal(t.steps[0].attempts, 3);
  A.TOOLS.test_broken = { risk: "read", description: "", run: async () => { throw Object.assign(new Error("bad id"), { status: 400 }); } };
  A.TOOLS.test_after = { risk: "read", description: "", run: async () => ({}) };
  const f = await A.startTask({ goal: "g", steps: [{ tool: "test_broken", args: {} }, { tool: "test_after", args: {} }] });
  assert.equal(f.status, "failed");
  assert.equal(f.steps[0].attempts, 1, "a 400 is not retried");
  assert.match(f.error, /bad id/);
  assert.equal(f.steps[1].status, "skipped");
});

test("when a step the rest depends on finds nothing, the planner gets one chance to re-plan", async () => {
  plans = [
    { steps: [step("find_meetings", { q: "budget" }), step("get_meeting", { meeting_id: "$1.meetings.0.id" })] },
    { steps: [step("recall_memories", { query: "budget" }, "no meeting found, look in memory instead")] },
  ];
  await mem.addMemory({ content: "The team budget for the trip is 40,000 rupees", category: "plan" });
  const t = await A.startTask({ goal: "what did we decide about the budget?" });
  assert.equal(calls.plan, 2);
  assert.equal(t.replans, 1);
  assert.deepEqual(t.steps.map((s) => [s.tool, s.status]), [["find_meetings", "empty"], ["recall_memories", "done"]]);
  assert.equal(t.status, "done");
});

test("re-planning happens at most once", async () => {
  plans = [
    { steps: [step("find_meetings", { q: "x" }), step("get_meeting", { meeting_id: "$1.meetings.0.id" })] },
    { steps: [step("find_meetings", { q: "y" }), step("get_meeting", { meeting_id: "$2.meetings.0.id" })] },
  ];
  const t = await A.startTask({ goal: "g" });
  assert.equal(calls.plan, 2);
  assert.equal(t.status, "failed");
});

// ---- memory safety ------------------------------------------------------------------------------

test("a fact that contradicts a memory is never written over it: it becomes a review for the user", async () => {
  const old = await mem.addMemory({ content: "The user works at Infosys in Pune", category: "work" });
  relation = "contradicts";
  const t = await A.startTask({ goal: "g", steps: [{ tool: "remember", args: { content: "The user works at TCS in Pune", category: "work" } }] });
  assert.equal(t.steps[0].result.needsUserOk, true);
  assert.equal(mem.getMemory(old.id).content, "The user works at Infosys in Pune", "unchanged until the user says yes");
  assert.equal(mem.listProposals().length, 1);
  assert.equal(mem.listMemories().length, 1);
});

test("the same fact again is not stored twice, and undo never deletes the older copy", async () => {
  const old = await mem.addMemory({ content: "The user's father is named Sunil Kumar Dhal", category: "people" });
  relation = "same";
  const t = await A.startTask({ goal: "g", steps: [{ tool: "remember", args: { content: "The user's father is named Sunil Kumar Dhal" } }] });
  assert.equal(t.steps[0].result.saved, false);
  const u = await A.undo(t.id);
  assert.equal(u.nothingToUndo, true);
  assert.equal(mem.getMemory(old.id).status, "active");
});

test("change_memory and forget_memory only ask; they never change the memory themselves", async () => {
  const m = await mem.addMemory({ content: "The user lives in Bhubaneswar", category: "personal" });
  const t = await A.startTask({ goal: "g", steps: [{ tool: "forget_memory", args: { memory_id: m.id } }] });
  assert.equal(t.steps[0].result.needsUserOk, true);
  assert.equal(mem.getMemory(m.id).status, "active");
});

// ---- cancel and undo ---------------------------------------------------------------------------

test("undo reverses finished writes, newest first: a new memory is removed and a reminder is cancelled", async () => {
  const t = await A.startTask({
    goal: "g",
    steps: [
      { tool: "remember", args: { content: "The user's rent is due on the 10th" } },
      { tool: "set_reminder", args: { what: "pay rent", when: "tomorrow at 9am" } },
    ],
  });
  assert.equal(t.status, "done", JSON.stringify(t.steps.map((s) => s.error)));
  const reminderId = t.steps[1].result.reminderId;
  assert.ok(reminderId);
  const u = await A.undo(t.id);
  assert.deepEqual(u.undone, ["set_reminder", "remember"]);
  assert.equal(u.task.status, "undone");
  assert.equal(mem.listMemories().length, 0);
  assert.equal(db.prepare("SELECT status FROM nudges WHERE id = ?").get(reminderId).status, "dismissed");
  assert.equal(A.lastUndoable(), null);
});

test("cancel stops a running task after the current step; finished steps stay undoable", async () => {
  let release;
  A.TOOLS.test_slow = { risk: "write", description: "", run: () => new Promise((r) => (release = () => r({ ok: true, undo: null }))) };
  A.TOOLS.test_after = { risk: "read", description: "", run: async () => { throw new Error("must not run"); } };
  const p = A.startTask({ goal: "g", steps: [{ tool: "test_slow", args: {} }, { tool: "test_after", args: {} }] });
  await new Promise((r) => setTimeout(r, 30));
  const id = A.listTasks(1)[0].id;
  assert.equal(A.cancel(id).status, "cancelled");
  release();
  const t = await p;
  assert.equal(t.status, "cancelled");
  assert.deepEqual(t.steps.map((s) => s.status), ["done", "skipped"]);
});

test("delete everything also clears the task log", async () => {
  await A.startTask({ goal: "g", steps: [{ tool: "briefing", args: {} }] });
  assert.ok(A.deleteAllTasks() >= 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_steps").get().n, 0);
});

// ---- time awareness of memories ---------------------------------------------------------------

test("freshness: a plan whose explicit date has passed, or an old changing fact, may be outdated", () => {
  const at = Date.UTC(2026, 9, 18);
  const day = 86_400_000;
  assert.equal(mem.freshness({ category: "plan", content: "Exam on 3 March 2026", updatedAt: at - 300 * day, createdAt: at - 300 * day }, at).mayBeOutdated, true);
  assert.equal(mem.freshness({ category: "plan", content: "Exam on 3 December 2026", updatedAt: at - day, createdAt: at - day }, at).mayBeOutdated, false);
  assert.equal(mem.freshness({ category: "personal", content: "Birthday is on 5 March", updatedAt: at - 400 * day }, at).mayBeOutdated, false, "lasting facts never go stale");
  assert.equal(mem.freshness({ category: "work", content: "Works at Infosys", updatedAt: at - 400 * day }, at).mayBeOutdated, true);
  assert.equal(mem.freshness({ category: "work", content: "Works at Infosys", updatedAt: at - 10 * day }, at).mayBeOutdated, false);
});

test("temporal ranking: of two equally close changing facts the recently confirmed one comes first", () => {
  const at = Date.UTC(2026, 9, 18);
  const day = 86_400_000;
  const r = mem.temporalRank(
    [
      { id: 1, category: "work", content: "Works at Infosys", score: 0.8, updatedAt: at - 500 * day },
      { id: 2, category: "work", content: "Works at TCS", score: 0.79, updatedAt: at - 5 * day },
    ],
    2,
    at
  );
  assert.deepEqual(r.map((x) => x.id), [2, 1]);
  assert.equal(r[1].mayBeOutdated, true);
  assert.equal(r[1].matchScore, 0.8, "the raw match score is kept");
});

test("the plain search used by the evaluation harness is unchanged by the time option", async () => {
  await mem.addMemory({ content: "The user works at Infosys", category: "work" });
  const plain = await mem.searchMemories("where does the user work", 3);
  assert.equal(plain[0].mayBeOutdated, undefined);
  const timed = await mem.searchMemories("where does the user work", 3, { temporal: true });
  assert.equal(timed[0].mayBeOutdated, false);
});

test("if the comparison with a similar memory fails, AURA asks instead of saving a possibly conflicting fact", async () => {
  const old = await mem.addMemory({ content: "The user works at Infosys in Pune", category: "work" });
  relation = "throw";
  const t = await A.startTask({ goal: "g", steps: [{ tool: "remember", args: { content: "The user works at TCS in Pune", category: "work" } }] });
  assert.equal(t.steps[0].result.needsUserOk, true);
  assert.match(t.steps[0].result.reason, /couldn't compare/);
  // and an unrelated fact is still saved when the model is unavailable
  const t2 = await A.startTask({ goal: "g", steps: [{ tool: "remember", args: { content: "The user works out at a gym in Pune", category: "work" } }] });
  assert.equal(t2.steps[0].result.saved, true, JSON.stringify(t2.steps[0].result));
  assert.equal(mem.listMemories().length, 2, "the old fact and the unrelated new one; the conflicting one waits");
  assert.equal(mem.getMemory(old.id).content, "The user works at Infosys in Pune");
});

test("without the model: a changed value is asked about, an unrelated fact is not (pairs from real memories)", () => {
  const r = (a, b) => A.heuristicRelation(a, b).relation;
  assert.equal(r("The user's father is named Ramesh", "The user's father is named Sunil Kumar Dhal."), "unsure");
  assert.equal(r("The user lives in Hyderabad now", "The user lives in Bhubaneswar."), "unsure");
  assert.equal(r("The user's project demo is on 25 October 2026", "The user has a meeting discussing Project Aura on October 13, 2026."), "different");
  assert.equal(r("The user's mother is named Sabita Sahoo", "The user's mother is named Sabita Sahoo."), "same");
});

test("find_meetings hands its meetings straight to the next step", async () => {
  const r = await A.TOOLS.find_meetings.run({});
  assert.ok(Array.isArray(r.meetings));
});
