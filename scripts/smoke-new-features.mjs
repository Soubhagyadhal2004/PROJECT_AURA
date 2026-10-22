// Smoke test of the newest AURA features against a THROWAWAY server (own port, empty temp database,
// no Gemini key, no internet). Your real data in data/ is never touched.
//
//   node scripts/smoke-new-features.mjs
//
// Prints PASS/FAIL per check with the value it expected, and exits 1 if anything failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3919;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-smoke-"));

// the server runs inside this process, configured through the environment before it is loaded
Object.assign(process.env, {
  AURA_DATA_DIR: dataDir,
  GEMINI_API_KEY: "", // keyless on purpose: every check below must work without the model
  AURA_NO_WARMUP: "1",
  AURA_PROACTIVE_REMINDERS: "1",
  AURA_AMBIENT_VOICE_GATE: "on", // gate forced on: with no voice profiles nothing may pass
  AURA_TIMEZONE: "Asia/Kolkata",
  // easy-to-reach settings so the keyless keyword scorer can trigger an unprompted remark in the feedback check
  AURA_AMBIENT_THRESHOLD: "0.3",
  AURA_AMBIENT_MIN_POINTS: "2",
});
const { start, server } = await import(pathToFileURL(path.join(ROOT, "server", "index.mjs")).href);

const call = async (method, url, body, raw) => {
  const r = await fetch(BASE + url, {
    method,
    headers: raw ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const t = await r.text();
  return { status: r.status, data: t ? JSON.parse(t) : null };
};

let failed = 0;
const check = (name, ok, expected, got) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        expected: ${expected}\n        got:      ${JSON.stringify(got)}`}`);
};
const step = (t, i) => t.steps[i];

try {
  await start(PORT);
  console.log(`\nThrowaway server on ${BASE}, data in ${dataDir}\n`);

  console.log("--- Tasks: planning checks ---");
  let t = (await call("POST", "/api/agent/tasks", { goal: "email my boss", steps: [{ tool: "send_email", args: {} }] })).data;
  check("a plan with an unknown tool is refused before anything runs", t.status === "failed" && /unknown tool/.test(t.error), 'status "failed", error mentions "unknown tool"', t);
  t = (await call("POST", "/api/agent/tasks", { goal: "bad ref", steps: [{ tool: "get_meeting", args: { meeting_id: "$2.x" } }, { tool: "briefing", args: {} }] })).data;
  check("a reference to a later step is refused", t.status === "failed" && /earlier step/.test(t.error), 'status "failed", error mentions "earlier step"', t);

  console.log("\n--- Tasks: remember + undo ---");
  t = (await call("POST", "/api/agent/tasks", { goal: "remember coffee", steps: [{ tool: "remember", args: { content: "The user likes filter coffee", category: "preference" } }] })).data;
  check("a reversible write runs on its own", t.status === "done" && step(t, 0).result.saved === true, 'status "done", result.saved true', t);
  let mems = (await call("GET", "/api/memories")).data;
  check("the memory exists", mems.some((m) => m.content === "The user likes filter coffee" && m.status === "active"), "one active memory about filter coffee", mems);
  let u = (await call("POST", `/api/agent/tasks/${t.id}/undo`)).data;
  mems = (await call("GET", "/api/memories")).data;
  check("undo removes it again", u.undone?.[0] === "remember" && !mems.some((m) => m.content.includes("filter coffee")), 'undone ["remember"], memory gone', { undone: u.undone, mems });

  console.log("\n--- Memory safety: a conflicting fact is never written over the old one ---");
  await call("POST", "/api/memories", { content: "The user's father is named Sunil Kumar Dhal", category: "people" });
  t = (await call("POST", "/api/agent/tasks", { goal: "remember father", steps: [{ tool: "remember", args: { content: "The user's father is named Ramesh", category: "people" } }] })).data;
  check("the result says the user must OK it", step(t, 0).result.needsUserOk === true, "result.needsUserOk true", step(t, 0).result);
  mems = (await call("GET", "/api/memories")).data;
  check("the old fact is untouched and Ramesh was not saved", mems.length === 1 && mems[0].content.includes("Sunil Kumar Dhal"), "exactly one memory: Sunil Kumar Dhal", mems);
  const props = (await call("GET", "/api/memories/proposals")).data;
  check("a review is waiting on the Memory page", props.length === 1 && props[0].action === "update", "one pending proposal, action update", props);
  await call("POST", `/api/memories/proposals/${props[0]?.id}/reject`);

  console.log("\n--- Approval: a consequential step waits for you ---");
  t = (await call("POST", "/api/agent/tasks", { goal: "write minutes", steps: [{ tool: "write_minutes", args: { meeting_id: 999 } }, { tool: "briefing", args: {} }] })).data;
  check("it stops and asks", t.status === "awaiting_approval" && step(t, 0).status === "awaiting_approval" && step(t, 1).status === "pending", 'status "awaiting_approval"; step 1 awaiting_approval, step 2 pending', t.steps.map((s) => s.status));
  const r = (await call("POST", `/api/agent/tasks/${t.id}/reject`)).data;
  check("saying no runs nothing after it", r.status === "rejected" && r.steps[0].status === "rejected" && r.steps[1].status === "skipped", 'status "rejected"; steps rejected, skipped', r.steps.map((s) => s.status));
  const again = await call("POST", `/api/agent/tasks/${t.id}/approve`);
  check("approving a task that isn't waiting is refused", again.status === 409, "HTTP 409", again.status);

  console.log("\n--- Reminder suggestion + undo-last ---");
  t = (await call("POST", "/api/agent/tasks", { goal: "rent reminder", steps: [{ tool: "set_reminder", args: { what: "pay rent", when: "tomorrow at 9am" } }] })).data;
  check("a reminder card is suggested (not set until you accept)", step(t, 0).result?.needsConfirmation === true, "result.needsConfirmation true", step(t, 0));
  const last = (await call("POST", "/api/agent/undo-last", {})).data;
  check("undo-last withdraws it", last.undone?.includes("set_reminder"), 'undone includes "set_reminder"', last);

  console.log("\n--- Voice gate (forced on, no voice profiles) ---");
  const conv = (await call("POST", "/api/conversations")).data;
  const twoSecondsOfSilence = Buffer.alloc(16000 * 2 * 2);
  const g = (await call("POST", `/api/ambient/${conv.id}/audio`, null, twoSecondsOfSilence)).data;
  check("audio from an unregistered voice is ignored", g.decision?.action === "ignore" && g.message === null, 'decision.action "ignore", message null', g);
  const after = (await call("GET", `/api/conversations/${conv.id}`)).data;
  check("nothing from it was stored", after.messages.length === 0, "0 messages", after.messages.length);

  console.log("\n--- Ambient feedback: AURA chips in unprompted, you say \"not now\" ---");
  let st = (await call("GET", "/api/ambient/stats")).data;
  check("stats start at no adjustment", st.thresholdAdjustment === 0 && typeof st.feedback === "object", "thresholdAdjustment 0 and a feedback object", st);
  await call("POST", "/api/memories", { content: "The user has to pay home rent of Rs 18,000 to Mr. Mehta on November 10, 2026", category: "plan" });
  const amb = (await call("POST", "/api/conversations")).data;
  await call("POST", `/api/ambient/${amb.id}/start`);
  const lines = ["so we were talking about the flat", "when is the rent due again?", "I can't remember the date for the rent", "I don't remember how much rent I have to pay", "when is the rent due, who do I pay?", "I can't recall the rent amount at all"];
  let spoke = null;
  for (const text of lines) {
    const r = (await call("POST", `/api/ambient/${amb.id}/text`, { text })).data;
    if (r.decision.action === "speak") { spoke = r; break; }
  }
  check("AURA chips in on its own once the need keeps rising", spoke && /^\[AURA app\] Ambient mode/.test(spoke.say), 'decision "speak" with a note for the voice model', spoke?.decision);
  const nn = (await call("POST", `/api/ambient/${amb.id}/text`, { text: "not now" })).data;
  check('"not now" right after it is taken as feedback, and nothing is said back', nn.decision.action === "suppress" && nn.decision.feedback === "negative" && !nn.say, 'decision "suppress", feedback "negative", no say', nn.decision);
  st = (await call("GET", "/api/ambient/stats")).data;
  check("the bar was raised by 0.05 and the feedback counted", st.thresholdAdjustment === 0.05 && st.feedback?.negative === 1, "thresholdAdjustment 0.05, feedback.negative 1", st);
  const cfgNow = (await call("GET", `/api/ambient/${amb.id}`)).data.config;
  check("the threshold in use is now 0.35 (0.30 + 0.05)", Math.abs(cfgNow.threshold - 0.35) < 1e-9, "0.35", cfgNow.threshold);

  console.log("\n--- Time-aware recall ---");
  await call("POST", "/api/memories", { content: "The user has an exam on 3 March 2026", category: "plan" });
  const found = (await call("GET", "/api/memories/search?q=exam&k=3")).data;
  const exam = found.find((m) => m.content.includes("exam"));
  check("a plan whose date has passed is flagged", exam?.mayBeOutdated === true && /passed/.test(exam.why), 'mayBeOutdated true, why "its date has passed"', exam);

  console.log("\n--- Delete everything clears the task log ---");
  const wipe = (await call("DELETE", "/api/data")).data;
  const left = (await call("GET", "/api/agent/tasks")).data;
  check("tasks are deleted too", wipe.agentTasks >= 1 && left.length === 0, "agentTasks >= 1 and an empty task list", { wipe: wipe.agentTasks, left: left.length });
} catch (e) {
  failed++;
  console.log("FAIL  script error:", e.message);
} finally {
  // print the verdict first: cleaning up must never hide it (on Windows an open database file can't be deleted)
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  try { server.close(); } catch {}
  try { (await import(pathToFileURL(path.join(ROOT, "server", "db.mjs")).href)).db.close(); } catch {}
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    console.log(`(could not delete the temporary folder ${dataDir}; it only holds test data and can be removed by hand)`);
  }
}
process.exit(failed ? 1 : 0);
