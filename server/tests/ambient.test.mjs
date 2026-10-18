// Tests of ambient mode (server/ambient.mjs): the trend of the need decides, never one score.
// rising + over threshold -> speak; rising under it -> wait; flat -> defer; falling -> suppress;
// AURA always answers when spoken to. Gemini and the local models are faked.
// Run: npm run test:server
import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-ambient-"));
process.env.AURA_DATA_DIR = dataDir;
process.env.GEMINI_API_KEY = "test-key";
process.env.AURA_NO_WARMUP = "1";
process.env.AURA_TIMEZONE = "Asia/Kolkata";
for (const k of Object.keys(process.env)) if (k.startsWith("AURA_AMBIENT_") || k.startsWith("AURA_PROACTIVE_")) delete process.env[k];

mock.module(new URL("../models.mjs", import.meta.url).href, {
  namedExports: {
    modelStatus: { text: { state: "error" }, speaker: { state: "error" }, segmentation: { state: "error" } },
    warmUp: () => {},
    normalize: (v) => v,
    cosine: () => 0,
    embedText: async () => { throw new Error("no text model in tests"); },
    embedSpeaker: async () => { throw new Error("not used"); },
    speakerTurns: async () => [],
  },
});
// the scorer's answers, one per utterance, in order
let script = [];
const prompts = [];
let transcript = "";
mock.module(new URL("../gemini.mjs", import.meta.url).href, {
  namedExports: {
    hasKey: () => true,
    usage: {},
    createLiveToken: async () => ({ token: "x" }),
    generateJSON: async (args) => {
      if (/ambient listener/.test(args.system || "")) {
        prompts.push(args.prompt);
        const next = script.shift() ?? {};
        return { need: 0, addressed: false, topic: "t", topicShift: false, kind: "none", reason: "r", contribution: "", factIds: [], ...next };
      }
      return { operations: [] };
    },
    transcribeSegments: async () => ({ texts: [transcript], count: 1 }),
  },
});

const { start, server } = await import("../index.mjs");
const A = await import("../ambient.mjs");
const mem = await import("../memory.mjs");
const { db } = await import("../db.mjs");
const B = "http://127.0.0.1:3913";
const j = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, data: t ? JSON.parse(t) : null };
};
const cfg = () => A.config();
const pts = (...needs) => needs.map((need) => ({ need }));

before(async () => { await start(3913); });
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith("AURA_AMBIENT_")) delete process.env[k];
  db.exec("DELETE FROM memories; DELETE FROM conversations; DELETE FROM ambient_events;");
  script = [];
  prompts.length = 0;
});

// ---- the pure trend -------------------------------------------------------------------------------

test("trend: slope is the least-squares change per utterance", () => {
  assert.equal(A.slopeOf([0.1, 0.2, 0.3]).toFixed(3), "0.100");
  assert.equal(A.slopeOf([0.5, 0.5, 0.5]), 0);
  assert.equal(A.slopeOf([0.9]), 0);
});

test("trend: rising, flat and falling", () => {
  assert.equal(A.trend(pts(0.1, 0.4, 0.7), cfg()).direction, "rising");
  assert.equal(A.trend(pts(0.5, 0.5, 0.52), cfg()).direction, "flat");
  assert.equal(A.trend(pts(0.8, 0.5, 0.2), cfg()).direction, "falling");
  assert.equal(A.trend(pts(0.4), cfg()).direction, "unknown");
  // the latest step turned down: falling, even though the window as a whole still rises
  assert.equal(A.trend(pts(0.1, 0.1, 0.9, 0.3), cfg()).direction, "falling");
  // an upturn right after a fall is not a rise yet
  assert.equal(A.trend(pts(0.9, 0.3, 0.8), cfg()).direction, "flat");
});

test("decision: only a rising need over the threshold speaks", () => {
  const c = cfg();
  const d = (...n) => A.decideAction(A.trend(pts(...n), c), c).action;
  assert.equal(d(0.2, 0.6, 0.9, 0.95), "speak");
  assert.equal(d(0.05, 0.15, 0.25), "wait", "rising, under the threshold");
  assert.equal(d(0.9, 0.9, 0.9), "defer", "high but steady: defer");
  assert.equal(d(0.9, 0.95, 0.6), "suppress", "high but falling: suppress");
  assert.equal(d(0.1, 0.95), "wait", "a single jump is not enough context");
  // one high score never speaks on its own
  assert.notEqual(d(0.99), "speak");
  // cooldown after AURA spoke
  assert.equal(A.decideAction(A.trend(pts(0.2, 0.6, 0.9, 0.95), c), c, { inCooldown: true }).action, "defer");
});

test("decision: thresholds come from the environment", () => {
  process.env.AURA_AMBIENT_THRESHOLD = "0.95";
  const c = cfg();
  assert.equal(c.threshold, 0.95);
  assert.equal(A.decideAction(A.trend(pts(0.2, 0.6, 0.9, 0.95), c), c).action, "wait");
});

test("wake word: the name, but not the common word 'ora' alone", () => {
  assert.ok(A.mentionsAura("Aura, what time is my exam?"));
  assert.ok(A.mentionsAura("hey ora what's the rent"));
  assert.ok(!A.mentionsAura("ora kahin gale"));
  assert.ok(!A.mentionsAura("the aurora was lovely"));
  // how the transcriber actually wrote it in a test session
  assert.ok(A.mentionsAura("Hey Auditor, am I audible to you?"));
  assert.ok(A.mentionsAura("Hey, Auditor, am I audible to you?"));
  assert.ok(A.mentionsAura("A U R A"));
  assert.ok(A.mentionsAura("H U R A"));
  assert.ok(A.mentionsAura("hey aurora, what's the time"));
  assert.ok(!A.mentionsAura("the auditor came to the office yesterday"));
  assert.ok(!A.mentionsAura("hura hura"));
});

// ---- end to end over HTTP ----------------------------------------------------------------------

const newConv = async () => (await j("POST", "/api/conversations")).data.id;
const say = async (id, text) => (await j("POST", `/api/ambient/${id}/text`, { text })).data;

test("ambient: stays silent while the need builds, speaks once it rises over the threshold", async () => {
  await mem.addMemory({ content: "Landlord is Mr. Rao; rent of 18,000 is due on the 5th", category: "personal" });
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  script = [
    { need: 0.05 },
    { need: 0.3 },
    { need: 0.7, kind: "recall", reason: "they can't recall when rent is due", contribution: "Rent is due on the 5th.", factIds: ["M1"] },
    { need: 0.9, kind: "recall", reason: "still stuck on the due date", contribution: "Rent is due on the 5th, to Mr. Rao.", factIds: [] },
  ];
  const r1 = await say(id, "so we were talking about the flat");
  const r2 = await say(id, "when do we even pay the rent");
  const r3 = await say(id, "I really don't remember the date");
  const r4 = await say(id, "was it the 1st or the 10th?");
  assert.equal(r1.decision.action, "wait");
  assert.equal(r2.decision.action, "wait");
  assert.ok(!r1.say && !r2.say, "no reply while the need is low");
  assert.equal(r3.decision.direction, "rising");
  assert.equal(r3.decision.action, "wait", "rising but still under the threshold");
  assert.equal(r4.decision.action, "speak");
  assert.match(r4.say, /^\[AURA app\] Ambient mode/);
  assert.match(r4.say, /rent of 18,000 is due on the 5th/, "the brief weaves in the matching memory");
  assert.match(r4.say, /I really don't remember the date/, "and the transcript");
  // the overheard lines are stored, marked as ambient, and the scorer saw the memory
  const msgs = (await j("GET", `/api/conversations/${id}`)).data.messages;
  assert.deepEqual(msgs.map((m) => m.modality), ["ambient", "ambient", "ambient", "ambient"]);
  assert.match(prompts[3], /Mr\. Rao/);
  // the trend restarts after speaking, from a zero level
  const st = (await j("GET", `/api/ambient/${id}`)).data;
  assert.deepEqual(st.series.map((p) => [p.need, !!p.base]), [[0, true]]);
  assert.match(r4.say, /never guess/, "the brief tells AURA not to make things up");
  assert.deepEqual(st.events.map((e) => e.action), ["wait", "wait", "wait", "speak"]);
});

test("ambient: a high but steady need is deferred, a falling one suppressed", async () => {
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  script = [{ need: 0.8 }, { need: 0.8 }, { need: 0.8 }, { need: 0.4 }];
  const out = [];
  for (const t of ["a", "b", "c", "d"]) out.push((await say(id, `line ${t}`)).decision.action);
  assert.deepEqual(out, ["wait", "defer", "defer", "suppress"]);
});

test("ambient: speaking by name is always answered, without scoring", async () => {
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  const r = await say(id, "Aura, what's on my calendar today?");
  assert.equal(r.addressed, true);
  assert.equal(r.decision.action, "answer");
  assert.match(r.say, /spoke to you directly: "Aura, what's on my calendar today\?"/);
  assert.equal(prompts.length, 0, "no scoring call");
  assert.equal(r.message.modality, "voice", "kept as the user's own words (memory may learn from it)");
});

test("ambient: right after AURA spoke, a reply aimed at it is answered; later it isn't", async () => {
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  await say(id, "Aura, remind me what we decided");
  script = [{ need: 0.2, addressed: true }];
  const reply = await say(id, "and who was supposed to do that?");
  assert.equal(reply.decision.action, "answer");
  assert.match(prompts[0], /AURA spoke a few seconds ago/);
  // outside the follow-up window the same kind of line is just scored
  process.env.AURA_AMBIENT_FOLLOWUP_SEC = "0";
  script = [{ need: 0.2, addressed: true }];
  const later = await say(id, "and who was supposed to do that?");
  assert.equal(later.addressed, false);
  assert.ok(!later.say);
});

test("ambient: a topic change starts a new trend", async () => {
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  script = [{ need: 0.2 }, { need: 0.5 }, { need: 0.7, topicShift: true }];
  for (const t of ["a", "b", "c"]) await say(id, t);
  const st = (await j("GET", `/api/ambient/${id}`)).data;
  assert.deepEqual(st.series.map((p) => [p.need, !!p.base]), [[0, true], [0.7, false]], "zero level, then the new topic");
});

test("decision: a tiny dip at a high level is not 'falling'; a real drop is", () => {
  const c = cfg();
  assert.equal(A.trend(pts(1, 1, 1, 0.95), c).direction, "flat");
  assert.equal(A.trend(pts(1, 1, 1, 0.8), c).direction, "falling", "1.0 -> 0.8 is a decrease: suppressed, per the rule");
  assert.equal(A.trend(pts(1, 1, 1, 0.4), c).direction, "falling");
});

test("decision: a need that stays high and unmet is spoken after AURA_AMBIENT_PERSIST turns", () => {
  const c = cfg();
  const tr = A.trend(pts(1, 1, 1), c);
  assert.equal(A.decideAction(tr, c, { persisted: 2 }).action, "defer");
  assert.equal(A.decideAction(tr, c, { persisted: 3 }).action, "speak");
  assert.equal(A.decideAction(tr, c, { persisted: 3, inCooldown: true }).action, "defer");
  process.env.AURA_AMBIENT_PERSIST = "0";
  assert.equal(A.decideAction(tr, cfg(), { persisted: 9 }).action, "defer", "0 switches it off");
});

test("ambient: after AURA spoke, a jump straight to a high need on a new topic counts as rising (the father's-name case)", async () => {
  await mem.addMemory({ content: "The user's father is named Sunil Kumar Dhal.", category: "people" });
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  script = [{ need: 0.2 }, { need: 0.6 }, { need: 0.9 }];
  const rent = [];
  for (const t of ["a", "b", "c"]) rent.push(await say(id, `rent line ${t}`));
  assert.equal(rent[2].decision.action, "speak");
  // a few seconds later, a new topic: the 60 s cooldown doesn't hold it back
  script = [{ need: 1, topicShift: true }, { need: 1 }, { need: 1 }];
  const out = [];
  for (const t of ["I don't remember what my father's name is.", "Was it Anil?", "Do you know what my father's name is?"]) out.push(await say(id, t));
  assert.deepEqual(out.map((r) => r.decision.direction), ["rising", "rising", "rising"]);
  assert.deepEqual(out.map((r) => r.decision.action), ["wait", "wait", "speak"]);
  assert.match(out[2].say, /Sunil Kumar Dhal/, "the memory is woven into what AURA says");
});

test("ambient: the cooldown still holds on the same topic", async () => {
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  script = [{ need: 0.2 }, { need: 0.6 }, { need: 0.9 }, { need: 0.7 }, { need: 0.9 }, { need: 1 }];
  const out = [];
  for (const t of ["a", "b", "c", "d", "e", "f"]) out.push((await say(id, `line ${t}`)).decision.action);
  assert.equal(out[2], "speak");
  assert.equal(out[5], "defer", "rising again on the same topic, but AURA spoke seconds ago");
});

test("ambient: high and steady from the start is deferred, then spoken once it persists", async () => {
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  script = [{ need: 1 }, { need: 1 }, { need: 1 }, { need: 1 }];
  const out = [];
  for (const t of ["a", "b", "c", "d"]) out.push(await say(id, `line ${t}`));
  assert.deepEqual(out.map((r) => r.decision.action), ["wait", "defer", "defer", "speak"]);
  assert.match(out[3].say, /stayed high without anyone meeting it/);
});

test("ambient: audio is transcribed first; silence is ignored", async () => {
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  transcript = "";
  let r = await fetch(`${B}/api/ambient/${id}/audio`, { method: "POST", body: new Uint8Array(3200) });
  assert.equal((await r.json()).decision.action, "ignore");
  transcript = "hey aura, what's the weather";
  r = await fetch(`${B}/api/ambient/${id}/audio`, { method: "POST", body: new Uint8Array(3200) });
  const out = await r.json();
  assert.equal(out.decision.action, "answer");
  assert.equal(out.message.text, "hey aura, what's the weather");
});

test("ambient: overheard lines are not used for memory extraction", async () => {
  const id = await newConv();
  db.prepare("INSERT INTO messages(conversation_id, role, modality, text, created_at) VALUES (?, 'user', 'ambient', 'my sister lives in Pune', ?)").run(id, Date.now());
  assert.deepEqual(await mem.extractFromConversation(id), [], "nothing to extract from overheard speech");
});

test("ambient: without a key the keyword estimate still follows the same trend rules", () => {
  assert.ok(A.heuristicNeed("I don't remember when the exam is", []) >= 0.4);
  assert.equal(A.heuristicNeed("nice weather today", []), 0);
});

test("ambient: AURA's own voice coming back through the microphone is dropped", async () => {
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  db.prepare("INSERT INTO messages(conversation_id, role, modality, text, created_at) VALUES (?, 'assistant', 'voice', ?, ?)").run(id, "AURA's full form is Adaptive Unified Responsive Assistant.", Date.now() - 4000);
  // it says its own name, which would otherwise count as being spoken to
  const echo = await say(id, "AURA's full form is Adaptive Unified Responsive Assistant.");
  assert.equal(echo.decision.action, "echo");
  assert.equal(echo.message, null, "not stored, nothing answered");
  assert.ok(!echo.say);
  assert.equal(prompts.length, 0, "and not scored");
  // the user's own short reply, or their own words, are not an echo
  script = [{ need: 0 }];
  assert.notEqual((await say(id, "Got it.")).decision.action, "echo");
  script = [{ need: 0 }];
  assert.notEqual((await say(id, "Aura, what is the full form of VIT?")).decision.action, "echo");
  // an old reply doesn't count
  db.prepare("UPDATE messages SET created_at = ? WHERE role = 'assistant'").run(Date.now() - 5 * 60_000);
  script = [{ need: 0 }];
  assert.notEqual((await say(id, "AURA's full form is Adaptive Unified Responsive Assistant.")).decision.action, "echo");
});

test("echo check: needs several words, mostly AURA's own", () => {
  const said = ["Got it, I've noted that the rent amount is eighteen thousand rupees."];
  assert.ok(A.isEchoOfAura("I've noted that the rent amount is eighteen thousand rupees", said));
  assert.ok(!A.isEchoOfAura("Got it", said), "too short to tell");
  assert.ok(!A.isEchoOfAura("the rent is due next week and I have no money", said));
  assert.ok(!A.isEchoOfAura("anything at all about something else entirely", []));
});

// ---- voice gate wiring ----------------------------------------------------------------------------

test("voice gate: audio from an unregistered voice is dropped before it is transcribed or stored", async () => {
  process.env.AURA_AMBIENT_VOICE_GATE = "on"; // no profiles exist in this test database
  const c = (await j("POST", "/api/conversations", {})).data;
  transcript = "Aura, what time is it?";
  const r = await A.observeAudio(c.id, Buffer.alloc(16000 * 2 * 2));
  assert.equal(r.decision.action, "ignore");
  assert.equal(r.message, null);
  const stored = db.prepare("SELECT COUNT(*) n FROM messages WHERE conversation_id = ?").get(c.id).n;
  assert.equal(stored, 0, "nothing from a foreign voice is stored");
  assert.equal(db.prepare("SELECT action FROM ambient_events WHERE conversation_id = ?").get(c.id).action, "ignore");
});

test("voice gate: with the gate off, or auto and no profiles, audio is heard as before", async () => {
  const c = (await j("POST", "/api/conversations", {})).data;
  transcript = "Aura, what time is it?";
  const r = await A.observeAudio(c.id, Buffer.alloc(16000 * 2 * 2)); // auto, no profiles
  assert.equal(r.decision.action, "answer");
  process.env.AURA_AMBIENT_VOICE_GATE = "off";
  const r2 = await A.observeAudio(c.id, Buffer.alloc(16000 * 2 * 2));
  assert.equal(r2.decision.action, "answer");
});

// ---- learning from feedback -------------------------------------------------------------------------

const speakOnce = async (id) => {
  script = [{ need: 0.3 }, { need: 0.7 }, { need: 0.9, contribution: "x" }];
  const out = [];
  for (const t of ["one thing", "another thing", "a third thing"]) out.push(await say(id, t));
  assert.equal(out[2].decision.action, "speak");
};

test("feedback: 'not now' right after an unprompted remark raises the bar and AURA stays quiet", async () => {
  db.exec("DELETE FROM ambient_feedback");
  assert.equal(A.feedbackOf("not now please"), "negative");
  assert.equal(A.feedbackOf("thanks, that helps"), "positive");
  assert.equal(A.feedbackOf("so what about Friday"), null);
  const id = await newConv();
  await j("POST", `/api/ambient/${id}/start`);
  await speakOnce(id);
  const r = await say(id, "not now, Aura was not asked"); // no scorer call needed
  assert.equal(r.decision.action, "suppress");
  assert.ok(!r.say, "nothing is said back");
  assert.equal(A.thresholdAdjustment(), 0.05);
  // after three refusals the bar is 0.75
  db.exec("INSERT INTO ambient_feedback(at, kind, delta) VALUES (" + Date.now() + ", 'negative', 0.05), (" + Date.now() + ", 'negative', 0.05)");
  // control: without feedback this rise (levels 0.3 -> 0.48 -> 0.67) speaks at the default 0.6
  assert.equal(A.decideAction(A.trend(pts(0.3, 0.6, 0.8), cfg()), cfg()).action, "speak");
  const id2 = await newConv();
  script = [{ need: 0.3 }, { need: 0.6 }, { need: 0.8, contribution: "x" }];
  const out = [];
  for (const t of ["one thing", "another thing", "a third thing"]) out.push(await say(id2, t));
  assert.notEqual(out[2].decision.action, "speak", JSON.stringify(out.map((o) => o.decision)));
  assert.equal(out[2].decision.threshold, 0.75);
  db.exec("DELETE FROM ambient_feedback");
});

test("feedback: thanks lowers the bar a little, within limits; old feedback fades", async () => {
  db.exec("DELETE FROM ambient_feedback");
  const id = await newConv();
  await speakOnce(id);
  await say(id, "thanks, good point");
  assert.equal(A.thresholdAdjustment(), -0.02);
  const old = Date.now() - 40 * 86_400_000;
  for (let i = 0; i < 20; i++) db.prepare("INSERT INTO ambient_feedback(at, kind, delta) VALUES (?, 'negative', 0.05)").run(old);
  assert.equal(A.thresholdAdjustment(), -0.02, "feedback older than 30 days no longer counts");
  for (let i = 0; i < 20; i++) db.prepare("INSERT INTO ambient_feedback(at, kind, delta) VALUES (?, 'negative', 0.05)").run(Date.now());
  assert.equal(A.thresholdAdjustment(), 0.25, "capped");
  db.exec("DELETE FROM ambient_feedback");
});

test("feedback: an ordinary line after AURA spoke is not feedback, and later lines are never feedback", async () => {
  db.exec("DELETE FROM ambient_feedback");
  const id = await newConv();
  await speakOnce(id);
  script = [{ need: 0.1 }, { need: 0.1 }];
  await say(id, "ok so Friday then");
  await say(id, "stop the car near the gate"); // past the first reaction: not feedback
  assert.equal(A.thresholdAdjustment(), 0);
});
