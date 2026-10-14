// Tests of the proactive layer (server/proactive.mjs): defaults off, date resolution, scheduler limits,
// memory-check selection and answers, reminders, briefing. Gemini and the local models are faked.
// Run: npm run test:server
import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-proactive-"));
process.env.AURA_DATA_DIR = dataDir;
process.env.GEMINI_API_KEY = "test-key";
process.env.AURA_NO_WARMUP = "1";
process.env.AURA_TIMEZONE = "Asia/Kolkata";
for (const k of ["AURA_PROACTIVE_MEMORY", "AURA_PROACTIVE_REMINDERS", "AURA_PROACTIVE_BRIEFING", "AURA_QUIET_HOURS", "AURA_NUDGE_MAX_PER_DAY", "AURA_NUDGE_COOLDOWN_MIN", "AURA_BRIEFING_TIME"]) delete process.env[k];

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
const calls = [];
let briefingLines = [];
mock.module(new URL("../gemini.mjs", import.meta.url).href, {
  namedExports: {
    hasKey: () => true,
    usage: {},
    createLiveToken: async () => ({ token: "x" }),
    generateJSON: async (args) => {
      calls.push(args);
      if (/short briefing/.test(args.system || "")) return { lines: briefingLines };
      return { operations: [] };
    },
    transcribeSegments: async () => ({ texts: [], count: 0 }),
  },
});

const { start, server } = await import("../index.mjs");
const P = await import("../proactive.mjs");
const mem = await import("../memory.mjs");
const { db } = await import("../db.mjs");
const B = "http://127.0.0.1:3912";
const j = async (method, url, body) => {
  const r = await fetch(B + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { status: r.status, data: t ? JSON.parse(t) : null };
};

const IST = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000; // wall clock in India -> instant
const NOW = IST(2026, 10, 14, 12, 0); // Wednesday 14 Oct 2026, noon in India
const DAY = 86_400_000;
const on = (...keys) => keys.forEach((k) => (process.env[k] = "1"));
const allOff = () => ["AURA_PROACTIVE_MEMORY", "AURA_PROACTIVE_REMINDERS", "AURA_PROACTIVE_BRIEFING"].forEach((k) => delete process.env[k]);

before(async () => { await start(3912); });
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
beforeEach(() => {
  allOff();
  delete process.env.AURA_NUDGE_MAX_PER_DAY;
  delete process.env.AURA_NUDGE_COOLDOWN_MIN;
  process.env.AURA_QUIET_HOURS = "off";
  P.setPresence({ voice: false }, 0);
  P.deleteAllNudges();
  db.exec("DELETE FROM memories; DELETE FROM meetings; DELETE FROM conversations;");
  calls.length = 0;
});

test("proactive: everything is off by default and nothing is created", async () => {
  delete process.env.AURA_QUIET_HOURS;
  assert.deepEqual(P.switches(), { memory: false, reminders: false, briefing: false });
  assert.equal(P.anyOn(), false);
  assert.equal(P.startScheduler(), false, "no timer without a switch");
  const old = await mem.addMemory({ content: "Works at Infosys as an analyst", category: "work" });
  db.prepare("UPDATE memories SET updated_at = ? WHERE id = ?").run(Date.now() - 400 * DAY, old.id);
  const c = (await j("POST", "/api/conversations")).data;
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "user", text: "Remind me to call Mom tomorrow at 5pm" });
  assert.deepEqual(await P.tick(), []);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nudges").get().n, 0);
  assert.deepEqual((await j("GET", "/api/proactive")).data, { switches: { memory: false, reminders: false, briefing: false }, nudges: [], blocked: null });
  assert.equal((await j("POST", "/api/proactive/briefing")).status, 404);
  assert.equal(calls.length, 0, "no Gemini calls");
});

test("dates: phrases resolve in the user's time zone against a fixed now", () => {
  const tz = "Asia/Kolkata";
  const at = (s, now = NOW, zone = tz) => P.resolveDate(s, { now, tz: zone })?.at;
  assert.equal(at("tomorrow at 5pm"), IST(2026, 10, 15, 17));
  assert.equal(at("Friday"), IST(2026, 10, 16, 9), "a day without a time means 9:00");
  assert.equal(at("next Wednesday"), IST(2026, 10, 21, 9));
  assert.equal(at("20 Oct"), IST(2026, 10, 20, 9));
  assert.equal(at("in 2 hours"), NOW + 2 * 3_600_000);
  assert.equal(at("in 3 minutes", NOW + 8_000), NOW + 3 * 60_000, "to the minute");
  assert.equal(at("sometime"), undefined);
  // 23:30 in India is still the same day in UTC: "tomorrow" must follow the local day
  assert.equal(at("tomorrow at 8am", IST(2026, 10, 14, 23, 30)), IST(2026, 10, 15, 8));
  // daylight saving ends in New York on 1 Nov 2026: 9 am that day is 14:00 UTC (not 13:00)
  assert.equal(at("tomorrow at 9am", Date.UTC(2026, 9, 31, 16), "America/New_York"), Date.UTC(2026, 10, 1, 14));
  assert.equal(P.formatWhen(IST(2026, 10, 15, 17), tz), "Thu 15 Oct, 5:00 PM");

  const r = P.parseReminder("Thanks! Can you remind me to call Mom tomorrow at 5pm?", { now: NOW, tz });
  assert.deepEqual(r, { what: "call Mom", at: IST(2026, 10, 15, 17), when: "tomorrow at 5pm" });
  assert.equal(P.parseReminder("remind me about the rent on Friday", { now: NOW, tz }).what, "the rent");
  assert.equal(P.parseReminder("remind me to stretch", { now: NOW, tz }).at, null);
  assert.equal(P.parseReminder("what's the weather tomorrow?", { now: NOW, tz }), null);
  // other ways of asking
  const t = (x) => P.parseReminder(x, { now: NOW, tz });
  // what was actually said at 11:01: same day; said at noon it means tomorrow
  assert.deepEqual(P.parseReminder("Remind me to call my mother at 11:05 a.m.", { now: IST(2026, 10, 14, 11, 1), tz }), { what: "call my mother", at: IST(2026, 10, 14, 11, 5), when: "at 11:05 am" });
  assert.equal(t("Remind me to call my mother at 11:05 a.m.").at, IST(2026, 10, 15, 11, 5));
  assert.equal(t("Could you set a reminder for 1:00 p.m. exam?").at, IST(2026, 10, 14, 13));
  assert.equal(t("Could you set a reminder for 1:00 p.m. exam?").what, "exam");
  assert.equal(t("please set an alarm for 6am tomorrow").at, IST(2026, 10, 15, 6));
  assert.equal(t("don't let me forget the rent on Friday").what, "the rent");
  assert.equal(t("add a reminder to book tickets next Monday").at, IST(2026, 10, 19, 9));
  assert.equal(t("did you see the reminder I wrote?"), null, "talking about a reminder isn't asking for one");
});

// three reminder confirmations, all due now
const threeDue = (now) => ["water the plants", "pay rent", "call Ravi"].map((w, i) => P.onUserMessage(null, `remind me to ${w} on Friday at ${i + 1}pm`, now));

// a nudge of any type, due now
const insert = (type, at, extra = {}) =>
  Number(db.prepare("INSERT INTO nudges(type, kind, text, due_at, status, created_at, payload) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
    .run(type, extra.kind ?? null, extra.text ?? type, at, at, extra.payload ? JSON.stringify(extra.payload) : null).lastInsertRowid);

const briefings = (n, at) => Array.from({ length: n }, () => insert("briefing", at, { kind: "daily" }));

test("scheduler: daily limit, per local day", () => {
  on("AURA_PROACTIVE_BRIEFING");
  process.env.AURA_NUDGE_MAX_PER_DAY = "2";
  briefings(3, NOW);
  assert.equal(P.surface(NOW).length, 2);
  assert.equal(P.blockedReason(NOW), "daily limit");
  assert.equal(P.surface(NOW + 3_600_000).length, 0, "still the same day");
  assert.equal(P.surface(IST(2026, 10, 15, 0, 5)).length, 1, "a new local day");
});

test("scheduler: quiet hours (across midnight)", () => {
  on("AURA_PROACTIVE_BRIEFING");
  process.env.AURA_QUIET_HOURS = "22:00-08:00";
  briefings(2, IST(2026, 10, 14, 21));
  assert.equal(P.blockedReason(IST(2026, 10, 14, 23)), "quiet hours");
  assert.equal(P.surface(IST(2026, 10, 14, 23)).length, 0);
  assert.equal(P.surface(IST(2026, 10, 15, 7, 59)).length, 0);
  assert.ok(P.surface(IST(2026, 10, 15, 8, 0)).length > 0);
});

test("reminders you asked for ignore the daily limit, quiet hours and cooldown, and don't use up the allowance", async () => {
  on("AURA_PROACTIVE_REMINDERS", "AURA_PROACTIVE_BRIEFING");
  process.env.AURA_NUDGE_MAX_PER_DAY = "1";
  process.env.AURA_QUIET_HOURS = "22:00-08:00";
  // what happened on 14 Oct: asked at 11:23 for "in 3 minutes", by voice: the spoken text and the tool
  const t0 = IST(2026, 10, 14, 11, 23) + 8_000;
  const c = (await j("POST", "/api/conversations")).data;
  P.onUserMessage(c.id, "Remind me to drink water in 3 minutes.", t0);
  const tool = P.requestReminder({ what: "drink water", when: "in 3 minutes", conversationId: null }, t0 + 40);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nudges WHERE type = 'reminder'").get().n, 1, "one card, not two");
  assert.equal(P.formatWhen(P.getNudge(tool.reminderId).payload.at), "Wed 14 Oct, 11:26 AM");
  await P.confirmReminder(tool.reminderId, t0 + 13_000);
  // a briefing used up the day's one unsolicited nudge, and the user dismissed it (cooldown)
  const b = insert("briefing", t0, { kind: "daily" });
  P.surface(t0 + 14_000);
  await P.decide(b, { decision: "dismiss" }, t0 + 15_000);
  assert.equal(P.blockedReason(t0 + 20_000), "cooldown");
  // ...the reminder still appears on time
  const due = P.surface(IST(2026, 10, 14, 11, 26));
  assert.equal(due.length, 1);
  assert.equal(due[0].text, "drink water");
  // and at night too
  P.onUserMessage(c.id, "remind me to take my medicine at 11pm", t0);
  const ask = P.surface(t0 + 30_000).find((n) => n.kind === "confirm");
  await P.decide(ask.id, { decision: "accept" }, t0 + 31_000);
  assert.equal(P.surface(IST(2026, 10, 14, 23, 0)).length, 1, "quiet hours don't hold a reminder you set");
});

test("scheduler: cooldown after a dismissal (saying no to a reminder doesn't count)", async () => {
  on("AURA_PROACTIVE_REMINDERS", "AURA_PROACTIVE_BRIEFING");
  process.env.AURA_NUDGE_COOLDOWN_MIN = "120";
  process.env.AURA_NUDGE_MAX_PER_DAY = "10";
  // declining a reminder suggestion: no cooldown
  const [ask] = threeDue(NOW);
  P.surface(NOW);
  await P.decide(ask.id, { decision: "dismiss" }, NOW + 60_000);
  assert.equal(P.getNudge(ask.id).outcome, "declined");
  assert.equal(P.blockedReason(NOW + 2 * 60_000), null);
  // dismissing anything else: nothing new for two hours
  const b = insert("briefing", NOW, { kind: "daily" });
  P.surface(NOW + 2 * 60_000);
  await P.decide(b, { decision: "dismiss" }, NOW + 3 * 60_000);
  assert.equal(P.blockedReason(NOW + 30 * 60_000), "cooldown");
  insert("briefing", NOW + 30 * 60_000, { kind: "daily" });
  assert.equal(P.surface(NOW + 30 * 60_000).length, 0);
  assert.ok(P.surface(NOW + 124 * 60_000).length > 0);
});

test("scheduler: during voice chat only reminder cards appear; nothing during a meeting recording", () => {
  on("AURA_PROACTIVE_REMINDERS", "AURA_PROACTIVE_BRIEFING");
  process.env.AURA_NUDGE_MAX_PER_DAY = "10";
  threeDue(NOW);
  insert("briefing", NOW, { kind: "daily" });
  P.setPresence({ voice: true }, NOW);
  assert.equal(P.blockedReason(NOW + 60_000), "voice conversation");
  const shown = P.surface(NOW + 60_000);
  assert.ok(shown.length > 0 && shown.every((n) => n.type === "reminder"), "reminders only");
  // the browser stopped reporting (tab closed): the voice flag expires, the briefing shows
  assert.equal(P.blockedReason(NOW + 3 * 60_000), null);
  assert.ok(P.surface(NOW + 3 * 60_000).some((n) => n.type === "briefing"));
  P.setPresence({ voice: false }, NOW);
  // a meeting with speech in the last two minutes blocks everything, reminders too
  P.onUserMessage(null, "remind me to stretch on Saturday at 10am", NOW);
  const m = db.prepare("INSERT INTO meetings(title, started_at) VALUES ('Standup', ?)").run(NOW - 10 * 60_000).lastInsertRowid;
  db.prepare("INSERT INTO segments(meeting_id, start_ms, end_ms, status) VALUES (?, 0, ?, 'done')").run(m, 9 * 60_000);
  assert.equal(P.blockedReason(NOW, { requested: true }), "meeting recording");
  assert.equal(P.surface(NOW).length, 0);
  db.prepare("UPDATE meetings SET ended_at = ? WHERE id = ?").run(NOW, m);
  assert.equal(P.blockedReason(NOW), null);
  assert.ok(P.surface(NOW).length > 0);
});

test("scheduler: types that are switched off are neither created nor shown", async () => {
  on("AURA_PROACTIVE_REMINDERS");
  threeDue(NOW);
  allOff();
  on("AURA_PROACTIVE_MEMORY");
  assert.deepEqual(P.surface(NOW), []);
  assert.deepEqual(P.openNudges(), []);
});

async function memoryAged(content, category, days, source = "conversation") {
  const m = await mem.addMemory({ content, category, source });
  db.prepare("UPDATE memories SET updated_at = ?, created_at = ? WHERE id = ?").run(NOW - days * DAY, NOW - days * DAY, m.id);
  return m;
}

test("memory checks: only older facts that tend to change, most overdue first", async () => {
  on("AURA_PROACTIVE_MEMORY");
  const job = await memoryAged("Works at Infosys as an analyst", "work", 50);
  const city = await memoryAged("Lives in Pune", "personal", 100);
  await memoryAged("Birthday is on 3 May", "personal", 300); // lasting fact
  await memoryAged("Likes filter coffee", "preference", 300); // preference
  await memoryAged("Is writing an IEEE paper", "plan", 5); // recent
  const meeting = await memoryAged("Ravi leads the payments project", "work", 20, "meeting"); // less certain: half the wait
  const reviewed = await memoryAged("Sister Ria studies in Delhi", "people", 200);
  mem.propose({ action: "update", memoryId: reviewed.id, content: "Sister Ria studies in Mumbai" });

  const picked = P.selectMemoryChecks({ at: NOW, limit: 10 });
  assert.deepEqual(picked.map((c) => c.id), [city.id, job.id, meeting.id]);
  assert.equal(picked.find((c) => c.id === meeting.id).lowConfidence, true);

  // one per day by default, and not while one is open
  const n = P.queueMemoryCheck(NOW);
  assert.equal(n.sourceMemoryId, city.id);
  assert.match(n.text, /Is this still true\? "Lives in Pune"/);
  assert.equal(P.queueMemoryCheck(NOW + 1000), null);
  db.prepare("UPDATE nudges SET status = 'dismissed' WHERE id = ?").run(n.id);
  assert.equal(P.queueMemoryCheck(NOW + 2000), null, "daily allowance used");
  process.env.AURA_MEMORY_CHECKS_PER_DAY = "2";
  assert.equal(P.queueMemoryCheck(NOW + 3000).sourceMemoryId, job.id, "the dismissed one is not asked again");
  process.env.AURA_MEMORY_CHECKS_PER_DAY = "5";
  assert.equal(P.limits().memoryChecksPerDay, 2, "never more than 2 a day");
  delete process.env.AURA_MEMORY_CHECKS_PER_DAY;
});

test("memory checks: Yes confirms, Changed goes through propose(), Forget deletes", async () => {
  on("AURA_PROACTIVE_MEMORY");
  const a = await memoryAged("Lives in Pune", "personal", 100);
  const b = await memoryAged("Works at Infosys", "work", 90);
  const c = await memoryAged("Dating Priya", "people", 80);
  const ask = (id) => {
    const n = db.prepare("INSERT INTO nudges(type, text, due_at, status, source_memory_id, created_at, shown_at) VALUES ('memory_check', 'q', ?, 'shown', ?, ?, ?)").run(NOW, id, NOW, NOW).lastInsertRowid;
    return Number(n);
  };

  const t0 = Date.now();
  const yes = (await j("POST", `/api/nudges/${ask(a.id)}/decide`, { decision: "accept", answer: "yes" })).data;
  assert.equal(yes.nudge.outcome, "yes");
  assert.ok(mem.getMemory(a.id).updatedAt >= t0, "confirmed now");
  assert.ok(!P.selectMemoryChecks({ at: Date.now(), limit: 10 }).some((x) => x.id === a.id));

  const before = db.prepare("SELECT COUNT(*) AS n FROM memory_proposals WHERE status = 'accepted'").get().n;
  const ch = await j("POST", `/api/nudges/${ask(b.id)}/decide`, { decision: "accept", answer: "changed", content: "Works at TCS" });
  assert.equal(ch.data.nudge.outcome, "changed");
  assert.equal(mem.getMemory(b.id).status, "superseded");
  assert.equal(ch.data.memory.content, "Works at TCS");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_proposals WHERE status = 'accepted'").get().n, before + 1, "recorded as an accepted proposal");
  assert.equal((await j("POST", `/api/nudges/${ask(b.id)}/decide`, { decision: "accept", answer: "yes" })).status, 409, "the old fact is gone");

  const id = ask(c.id);
  const fg = await j("POST", `/api/nudges/${id}/decide`, { decision: "accept", answer: "forget" });
  assert.equal(fg.status, 200);
  assert.equal(mem.getMemory(c.id), null);
  const after = P.getNudge(id);
  assert.equal(after.outcome, "forget");
  assert.equal(after.text, "(memory deleted)", "the forgotten fact isn't kept in the nudge");

  assert.equal((await j("POST", `/api/nudges/${ask(a.id)}/decide`, { decision: "accept", answer: "maybe" })).status, 400);
  const s = P.stats().memory_check;
  assert.equal(s.byOutcome.yes, 1);
  assert.equal(s.byOutcome.changed, 1);
  assert.equal(s.byOutcome.forget, 1);
});

test("reminders: asked first with the resolved date, then shown when due", async () => {
  on("AURA_PROACTIVE_REMINDERS");
  const ask = P.onUserMessage(null, "Remind me to call Mom tomorrow at 5pm", NOW);
  assert.equal(ask.kind, "confirm");
  assert.equal(ask.text, 'Set a reminder: "call Mom" on Thu 15 Oct, 5:00 PM?');
  assert.equal(P.onUserMessage(null, "remind me to call Mom tomorrow at 5pm", NOW + 5000), null, "not twice");
  assert.equal(P.onUserMessage(null, "remind me to stretch", NOW), null, "no date: no reminder");

  const [shown] = P.surface(NOW);
  const r = await P.decide(shown.id, { decision: "accept" }, NOW + 1000);
  assert.equal(r.nudge.outcome, "scheduled");
  assert.equal(r.reminder.dueAt, IST(2026, 10, 15, 17));
  assert.deepEqual(P.surface(IST(2026, 10, 15, 16, 59)), [], "not before it's due");
  const [due] = P.surface(IST(2026, 10, 15, 17));
  assert.equal(due.text, "call Mom");
  const sn = await P.decide(due.id, { decision: "snooze" }, IST(2026, 10, 15, 17, 1));
  assert.equal(sn.nudge.dueAt, IST(2026, 10, 15, 17, 11));
  assert.equal((await P.decide(P.surface(IST(2026, 10, 15, 17, 11))[0].id, { decision: "accept" })).nudge.outcome, "done");

  // a confirmation nobody answered in time is dropped
  P.onUserMessage(null, "remind me to leave in 2 hours", NOW);
  P.surface(NOW + 3 * 3_600_000);
  assert.equal(db.prepare("SELECT outcome FROM nudges WHERE text LIKE '%leave%'").get().outcome, "expired");
});

test("reminders: dated action items from meeting minutes, read from the meeting's day", () => {
  on("AURA_PROACTIVE_REMINDERS");
  const startedAt = IST(2026, 10, 12, 11); // Monday
  const meeting = {
    id: null,
    startedAt,
    minutes: {
      actionItems: [
        { task: "Send the budget", owner: "Anita", due: "Friday" },
        { task: "Book the room", owner: null, due: null },
        { task: "Old item", owner: null, due: "yesterday" },
      ],
    },
  };
  const made = P.onMinutes(meeting, NOW);
  assert.equal(made.length, 1);
  assert.equal(made[0].payload.at, IST(2026, 10, 16, 9));
  assert.equal(made[0].text, 'Set a reminder: "Send the budget (Anita)" on Fri 16 Oct, 9:00 AM?');
  assert.equal(P.onMinutes(meeting, NOW).length, 0, "minutes written again: no duplicates");
});

test("briefing: one Gemini call on a short context, at most 5 lines", async () => {
  on("AURA_PROACTIVE_BRIEFING");
  const empty = await P.buildBriefing(NOW);
  assert.equal(empty.lines.length, 1);
  assert.equal(calls.length, 0, "nothing to say: no call");

  on("AURA_PROACTIVE_REMINDERS");
  P.onUserMessage(null, "remind me to pay rent tomorrow", Date.now());
  await P.decide(P.surface(Date.now())[0].id, { decision: "accept" });
  await mem.addMemory({ content: "Moved to Bengaluru", category: "personal" });
  db.prepare("INSERT INTO meetings(title, started_at, ended_at, minutes) VALUES ('Review', ?, ?, ?)").run(Date.now() - DAY, Date.now() - DAY, JSON.stringify({ actionItems: [{ task: "Fix the login bug", owner: "Sam", due: "Monday" }] }));
  briefingLines = ["a", "b", "c", "d", "e", "f", "g"];
  const res = await j("POST", "/api/proactive/briefing");
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.lines, ["a", "b", "c", "d", "e"]);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].prompt.length <= 4000);
  assert.match(calls[0].prompt, /pay rent/);
  assert.match(calls[0].prompt, /Moved to Bengaluru/);
  assert.match(calls[0].prompt, /Fix the login bug/);
  assert.equal(P.stats().briefing.byOutcome.on_demand, 1);

  // once a day after AURA_BRIEFING_TIME
  process.env.AURA_BRIEFING_TIME = "08:30";
  await P.tick(IST(2026, 10, 14, 8, 0));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nudges WHERE kind = 'daily'").get().n, 0, "too early");
  await P.tick(IST(2026, 10, 14, 8, 31));
  await P.tick(IST(2026, 10, 14, 9, 31));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nudges WHERE kind = 'daily'").get().n, 1, "once that day");
  await P.tick(IST(2026, 10, 15, 8, 31));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nudges WHERE kind = 'daily'").get().n, 2, "and again the next day");
  delete process.env.AURA_BRIEFING_TIME;
});

test("wiping all data removes nudges too", async () => {
  on("AURA_PROACTIVE_REMINDERS");
  threeDue(NOW);
  const r = (await j("DELETE", "/api/data")).data;
  assert.equal(r.nudges, 3);
});

test("voice: set_reminder reads back the time, a spoken yes sets it, the card shows during voice", async () => {
  on("AURA_PROACTIVE_REMINDERS");
  const now = Date.now();
  P.setPresence({ voice: true }, now);
  assert.equal((await j("POST", "/api/proactive/reminders", { what: "x", when: "tomorrow" })).status, 200);
  P.deleteAllNudges();

  const r = (await j("POST", "/api/proactive/reminders", { what: "call my mother", when: "in 4 minutes" })).data;
  assert.equal(r.ok, true);
  assert.equal(r.needsConfirmation, true);
  assert.equal(r.what, "call my mother");
  assert.match(r.when, /\d:\d\d (AM|PM)/);
  const card = (await j("GET", "/api/proactive")).data.nudges;
  assert.equal(card.length, 1, "the confirmation card is shown although voice chat is on");
  assert.equal(card[0].id, r.reminderId);

  // the chat text that triggered the tool made its own card first: reused, not doubled
  const c = (await j("POST", "/api/conversations")).data;
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "user", text: "Remind me to water the plants tomorrow at 7pm" });
  const viaTool = (await j("POST", "/api/proactive/reminders", { what: "water the plants", when: "tomorrow at 7pm", conversationId: c.id })).data;
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM nudges WHERE text LIKE '%water the plants%'").get().n, 1);

  const yes = (await j("POST", `/api/proactive/reminders/${r.reminderId}/confirm`)).data;
  assert.equal(yes.set, true);
  assert.equal(P.getNudge(r.reminderId).outcome, "scheduled");
  assert.equal((await j("POST", `/api/proactive/reminders/${r.reminderId}/confirm`)).data.alreadySet, true);
  const no = (await j("POST", `/api/proactive/reminders/${viaTool.reminderId}/cancel`)).data;
  assert.equal(no.cancelled, true);
  assert.equal(P.getNudge(viaTool.reminderId).outcome, "declined");

  // the reminder itself appears when due, even during voice chat
  const due = db.prepare("SELECT id FROM nudges WHERE kind = 'due'").get().id;
  const shown = P.surface(now + 5 * 60_000);
  assert.ok(shown.some((n) => n.id === due));

  // unusable times are reported back so the assistant can ask again
  assert.equal((await j("POST", "/api/proactive/reminders", { what: "x", when: "whenever" })).data.ok, false);
  assert.match((await j("POST", "/api/proactive/reminders", { what: "x", when: "yesterday at 9am" })).data.error, /already passed/);
  allOff();
  assert.equal((await j("POST", "/api/proactive/reminders", { what: "x", when: "tomorrow" })).status, 404);
});

test("voice: the assistant's instructions match whether reminders are on", async () => {
  const off = (await j("GET", "/api/live/setup")).data;
  assert.equal(off.reminders, false);
  assert.match(off.systemInstruction, /cannot set reminders/);
  on("AURA_PROACTIVE_REMINDERS");
  const onS = (await j("GET", "/api/live/setup")).data;
  assert.equal(onS.reminders, true);
  assert.match(onS.systemInstruction, /call set_reminder/);
  assert.match(onS.systemInstruction, /Never say a reminder is set unless confirm_reminder succeeded/);
});
