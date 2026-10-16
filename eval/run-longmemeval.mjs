// Experiment 5: AURA's memory pipeline on the LongMemEval knowledge-update questions.
//
// LongMemEval (Wu et al., 2024) gives chat histories in which a fact changes ("I live in Pune" ... later
// "I have just moved to Hyderabad") and asks a question whose right answer is the LATEST value. Here each
// question is played through AURA's real extractor (Gemini), real memory store and real search, under the
// same policies as Experiment 1, and then answered from the memories AURA retrieves.
//
// Setup (once):
//   1. Download a LongMemEval file and put it in eval/data/ (the folder is created for you):
//        longmemeval_s_cleaned.json   (the "S" setting, ~115k-token histories; recommended)
//      from the benchmark's Hugging Face dataset `xiaowu0162/longmemeval-cleaned`
//      (project page: github.com/xiaowu0162/LongMemEval). Check the license before you redistribute it.
//   2. GEMINI_API_KEY in .env, as for Experiment 4.
//
//   npm run eval:lme                          shows the plan and the number of requests, sends nothing
//   npm run eval:lme -- --yes                 runs it (78 questions x policies by default; see the plan for the count)
//   npm run eval:lme -- --out <folder> --yes  continues an interrupted run
//   npm run eval:lme -- --check-with-sim      no Gemini, no dataset: tests the plumbing on a made-up fixture
//
// What is real and what is a choice made for the evaluation:
//   real     : extractor (Gemini), memory store, operations, review proposals, embeddings, memory search.
//   a choice : a LongMemEval history has ~50 sessions. To keep the request count manageable, each question
//              is played with ALL of its evidence sessions plus --distractors randomly chosen other
//              sessions (same sessions for every policy, in date order). One extraction call per session,
//              as the app extracts a conversation's new messages in one batch. Assistant messages are cut
//              to --assistant-chars characters.
//   answer   : the LLM answers from the top --k memories found by AURA's own search (no dates, in relevance
//              order, as the app does). Correctness is judged by a Gemini judge written after LongMemEval's
//              knowledge-update grading rule (the exact LongMemEval prompt is not reproduced here) and by a
//              strict string match. Both are saved so they can be compared. Use --no-judge to skip the judge.
//   append   : a changed fact is added as one more fact; the old one stays active (an update becomes an add).
//   auto     : every operation is applied.
//   gate     : LongMemEval has no labels saying which memory changes are right, so the reviewer is an oracle
//              approximation: --reviewer evidence accepts every proposal made while reading an evidence
//              session and rejects the rest; accept = accepts all (so gate == auto in the end state, with the
//              prompts counted); reject = rejects all. Treat gate results as a bracket, not as a measurement
//              of real users.
//   baselines: none = answer without memory; context = answer from the raw text of the same sessions.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { openIsolated, EVAL_DIR } from "./lib/env.mjs";
import { rng, hash, shuffle } from "./lib/rng.mjs";
import { parseCandidates } from "./lib/harness.mjs";
import { makeFixture } from "./lib/lme-fixture.mjs";
import { mean, wilson, fmt, toCSV, mdTable, writeJSON, outDir, appendRows, readRows, budget } from "./lib/stats.mjs";

const { values: a } = parseArgs({
  options: {
    data: { type: "string", default: path.join(EVAL_DIR, "data", "longmemeval_s_cleaned.json") },
    types: { type: "string", default: "knowledge-update" },
    questions: { type: "string" }, // default: all 78 knowledge-update questions; a resumed run keeps the number it started with
    distractors: { type: "string", default: "3" },
    policies: { type: "string", default: "append,auto,gate" },
    baselines: { type: "string", default: "none,context" },
    reviewer: { type: "string", default: "evidence" },
    k: { type: "string", default: "10" },
    "assistant-chars": { type: "string", default: "1500" },
    "with-dates": { type: "boolean", default: false },
    "no-judge": { type: "boolean", default: false },
    seed: { type: "string", default: "1" },
    rpm: { type: "string", default: "12" },
    "extract-min-score": { type: "string" },
    // the two memory features under test (see server/memory.mjs); defaults = AURA as shipped
    candidates: { type: "string", default: "default" },
    repropose: { type: "string", default: "0" },
    out: { type: "string" },
    budget: { type: "string", default: "0" },
    yes: { type: "boolean", default: false },
    "check-with-sim": { type: "boolean", default: false },
  },
});
if (a["extract-min-score"] != null) process.env.AURA_EXTRACT_MIN_SCORE = a["extract-min-score"];
const check = a["check-with-sim"];
const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

// ---------- data ----------
function loadData() {
  if (check) return makeFixture(6, 1);
  if (!fs.existsSync(a.data)) {
    console.log(`LongMemEval file not found: ${a.data}\nDownload longmemeval_s_cleaned.json (see the header of this script) and put it in eval/data/, or pass --data <file>.`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(a.data, "utf8"));
  if (!Array.isArray(raw)) throw new Error("Expected a JSON array of LongMemEval instances.");
  return raw;
}
const REQUIRED = ["question_id", "question_type", "question", "answer", "haystack_sessions", "haystack_session_ids"];
function validate(q) {
  const miss = REQUIRED.filter((k) => !(k in q));
  if (miss.length) throw new Error(`Unexpected file format: instance ${q.question_id ?? "?"} lacks ${miss.join(", ")}. This script expects the LongMemEval format (see lib/lme-fixture.mjs).`);
}
function parseDate(s, fallback) {
  const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[^\d]+(\d{1,2}):(\d{2}))?/.exec(String(s || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : fallback;
}

const data = loadData();
const types = new Set(list(a.types));
let pool = data.filter((q) => (types.has("all") || types.has(q.question_type)) && !String(q.question_id).endsWith("_abs"));
pool.forEach(validate);
pool = pool.sort((x, y) => hash(`${x.question_id}|${a.seed}`) - hash(`${y.question_id}|${a.seed}`));
// number of questions: --questions if given, else the number the run in --out was started with, else all (78).
// The order is fixed by the seed, so a larger number only adds questions; finished ones are kept and skipped.
const out = outDir(EVAL_DIR, check ? "lme-check" : "longmemeval", a.out);
const cfgFile = path.join(out, "config.json");
const savedCfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, "utf8")) : null;
const wanted = a.questions != null ? Number(a.questions) : savedCfg?.questions ?? 78;
pool = pool.slice(0, wanted);

function sessionsFor(q) {
  const ids = q.haystack_session_ids;
  const ans = new Set(q.answer_session_ids || []);
  const isEv = (i) => ans.has(ids[i]) || (q.haystack_sessions[i] || []).some((t) => t.has_answer);
  const idx = ids.map((_, i) => i);
  const ev = idx.filter(isEv);
  const r = rng(hash(`${q.question_id}|${a.seed}|distractors`));
  const others = shuffle(idx.filter((i) => !isEv(i)), r).slice(0, Number(a.distractors));
  return [...ev, ...others]
    .map((i) => ({ id: ids[i], date: parseDate(q.haystack_dates?.[i], Date.UTC(2023, 0, 1) + i * 86400000), turns: q.haystack_sessions[i], evidence: isEv(i) }))
    .sort((x, y) => x.date - y.date);
}

// ---------- config and plan ----------
const baselines = list(a.baselines);
const policies = list(a.policies);
const noJudge = a["no-judge"];

const env = await openIsolated({ clock: "real" });
const cfg = savedCfg
  ? { ...savedCfg, questions: pool.length }
  : {
      experiment: check ? "lme-check" : "longmemeval",
      dataFile: check ? "made-up fixture (lib/lme-fixture.mjs)" : path.basename(a.data),
      questionTypes: [...types],
      questions: pool.length,
      distractorSessions: Number(a.distractors),
      policies,
      baselines,
      reviewer: a.reviewer,
      k: Number(a.k),
      assistantChars: Number(a["assistant-chars"]),
      withDates: a["with-dates"],
      judge: !noJudge,
      seed: Number(a.seed),
      rpm: Number(a.rpm),
      extractMinScore: process.env.AURA_EXTRACT_MIN_SCORE ?? "default (0.25)",
      candidates: a.candidates,
      repropose: Number(a.repropose),
      model: check ? "simulated rule-based extractor" : `Gemini ${env.config.TEXT_MODEL}`,
    };
// a resumed run keeps the features it was started with
process.env.AURA_CANDIDATES = cfg.candidates ?? "default";
process.env.AURA_REPROPOSE = String(cfg.repropose ?? 0);
const plan = pool.map((q) => ({ q, sessions: sessionsFor(q) }));
const perQ = (extra) => 1 + (cfg.judge ? 1 : 0) + extra;
const requests = plan.reduce(
  (t, { sessions }) => t + cfg.policies.reduce((s) => s + sessions.length + perQ(0), 0) + cfg.baselines.reduce((s) => s + perQ(0), 0),
  0
);
if (!check) {
  if (!env.gem.hasKey()) {
    console.log("GEMINI_API_KEY is not set. Add it to the .env file in the project root.");
    env.cleanup();
    process.exit(1);
  }
  console.log(
    `Plan: ${plan.length} question(s) of type ${cfg.questionTypes.join("/")}, ${cfg.policies.length} policies + ${cfg.baselines.length} baselines, ` +
      `${cfg.distractorSessions} distractor session(s) each; about ${requests} requests to ${env.config.TEXT_MODEL} at most ${cfg.rpm} per minute ` +
      `(about ${Math.ceil(requests / cfg.rpm)} min).`
  );
  if (!a.yes) {
    console.log("Nothing was sent. Add --yes to run it.");
    env.cleanup();
    process.exit(0);
  }
}
if (!fs.existsSync(cfgFile)) writeJSON(cfgFile, { ...cfg, startedAt: new Date().toISOString() });
else if (savedCfg && savedCfg.questions !== cfg.questions) writeJSON(cfgFile, { ...savedCfg, questions: cfg.questions, extendedAt: new Date().toISOString() });

// ---------- simulated clock (memory timestamps follow the session dates; "today" in prompts too) ----------
let clockT = Date.UTC(2023, 0, 1);
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(clockT);
    else super(...args);
  }
  static now() {
    return ++clockT;
  }
};

// ---------- model calls ----------
const ANSWER_SYSTEM =
  "You are AURA, a personal assistant. Answer the user's question about themselves as briefly and exactly as you can, using only the information given. " +
  "If the information is not enough, say that you do not know.";
const JUDGE_SYSTEM =
  "You grade an assistant's answer against a reference answer. Reply with JSON {\"correct\": true|false}. " +
  "Answer true if the response contains the correct answer, or is equivalent to it, or contains all the intermediate steps to get it. " +
  "Answer false if the response only contains a subset of the information required, or gives a different answer. " +
  "If the response contains some previous (outdated) information together with an updated answer, it is correct as long as the updated answer is the required answer.";
const ANSWER_SCHEMA = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const JUDGE_SCHEMA = { type: "object", properties: { correct: { type: "boolean" } }, required: ["correct"] };

let policyNow = "auto";
let lastCall = 0;
const gap = 60000 / cfg.rpm;
const latency = [];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

// rule-based stand-in for Gemini, used only with --check-with-sim (understands the fixture's sentences)
function simHandler(args) {
  const { system = "", prompt = "" } = args;
  if (/maintain the long-term memory/.test(system)) {
    const cands = parseCandidates(prompt);
    const lines = prompt.split("New messages to process:")[1]?.split("\n").filter((l) => l.startsWith("User: ")).map((l) => l.slice(6)) || [];
    const ops = [];
    const findC = (re) => cands.find((c) => re.test(c.content));
    for (const line of lines) {
      let m;
      if ((m = /I live in (\w+)|moved to (\w+)/.exec(line))) {
        const v = m[1] || m[2];
        const c = findC(/^The user lives in/);
        const content = `The user lives in ${v}.`;
        if (!c) ops.push({ action: "add", content, category: "personal" });
        else if (c.content !== content) ops.push({ action: "update", memory_id: c.id, content, category: "personal" });
      } else if ((m = /I (?:now )?work at (\w+)/.exec(line))) {
        const content = `The user works at ${m[1]}.`;
        const c = findC(/^The user works at/);
        if (!c) ops.push({ action: "add", content, category: "work" });
        else if (c.content !== content) ops.push({ action: "update", memory_id: c.id, content, category: "work" });
      } else if ((m = /I like (\w+)/.exec(line))) {
        const content = `The user likes ${m[1]}.`;
        if (!cands.some((c) => c.content === content)) ops.push({ action: "add", content, category: "preference" });
      }
    }
    return { operations: ops };
  }
  if (system.startsWith("You are AURA, a personal assistant. Answer")) {
    const q = /Question: (.*)/.exec(prompt)?.[1] || "";
    const re = /live/i.test(q) ? /(?:lives in|live in|moved to) (\w+)/g : /(?:works at|work at) (\w+)/g;
    const found = [...prompt.matchAll(re)].map((m) => m[1]);
    const context = prompt.includes("Conversation history:");
    return { answer: found.length ? (context ? found[found.length - 1] : found[0]) : "I do not know." };
  }
  if (system.startsWith("You grade")) {
    const gold = /Correct answer: (.*)/.exec(prompt)?.[1] || "";
    const resp = /Model response: (.*)/.exec(prompt)?.[1] || "";
    return { correct: norm(resp).includes(norm(gold)) };
  }
  throw new Error("unexpected model call in the simulation");
}

env.gem.setHandler(async (args, realGen) => {
  const isExtract = /maintain the long-term memory/.test(args.system || "");
  let res;
  if (check) res = simHandler(args);
  else {
    const wait = lastCall + gap - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = performance.now();
    const t0 = performance.now();
    res = await realGen(args);
    latency.push(performance.now() - t0);
  }
  // append-only memory (the usual default of memory layers): a changed fact is stored as one more fact and the
  // old one stays active; nothing is retired or deleted. (Experiment 1 simply drops changes; here the new value
  // is kept, which is what an append-only system does with "I have just moved to Hyderabad".)
  if (isExtract && policyNow === "append") {
    res = {
      ...res,
      operations: (res.operations || []).filter((o) => o.action === "add" || (o.action === "update" && o.content)).map((o) => ({ action: "add", content: o.content, category: o.category })),
    };
  }
  return res;
});

// ---------- one question under one policy ----------
const sessionText = (s) => s.turns.map((t) => `${t.role === "user" ? "User" : "AURA"}: ${trunc(t.content, t.role)}`).join("\n");
const trunc = (text, role) => (role === "assistant" && text.length > cfg.assistantChars ? text.slice(0, cfg.assistantChars) + " …" : text);

async function ingest(sessions, policy) {
  env.reset();
  env.saveSettings({ autoMemory: true, confirmMemoryChanges: policy === "gate" });
  const msg = env.db.prepare("INSERT INTO messages(conversation_id, role, modality, text, created_at) VALUES (?, ?, 'text', ?, ?)");
  const res = { prompts: 0, accepted: 0, rejected: 0, extractionErrors: 0, lastError: "" };
  for (const s of sessions) {
    clockT = s.date;
    const t = Date.now();
    const convId = Number(env.db.prepare("INSERT INTO conversations(started_at, updated_at) VALUES (?, ?)").run(t, t).lastInsertRowid);
    for (const turn of s.turns) msg.run(convId, turn.role === "user" ? "user" : "assistant", trunc(String(turn.content ?? ""), turn.role), Date.now());
    try {
      await env.mem.extractFromConversation(convId);
    } catch (err) {
      res.extractionErrors++;
      res.lastError = String(err?.message || err);
    }
    if (policy === "gate") {
      for (const p of env.mem.listProposals()) {
        res.prompts++;
        const ok = cfg.reviewer === "accept" ? true : cfg.reviewer === "reject" ? false : s.evidence;
        if (ok) {
          await env.mem.acceptProposal(p.id);
          res.accepted++;
        } else {
          env.mem.rejectProposal(p.id);
          res.rejected++;
        }
      }
    }
  }
  return res;
}

async function answerFrom(q, sessions, mode) {
  let body = "";
  let top = [];
  if (mode === "memory") {
    top = await env.mem.searchMemories(q.question, cfg.k);
    const fmtDate = (m) => (cfg.withDates ? `[${new Date(m.updatedAt).toISOString().slice(0, 10)}] ` : "");
    body = `Memories about the user:\n${top.length ? top.map((m) => `- ${fmtDate(m)}${m.content}`).join("\n") : "(none)"}\n`;
  } else if (mode === "context") {
    body = `Conversation history:\n${sessions.map((s) => `--- ${new Date(s.date).toISOString().slice(0, 10)} ---\n${sessionText(s)}`).join("\n")}\n`;
  }
  clockT = parseDate(q.question_date, clockT);
  const prompt = `Today's date: ${new Date().toISOString().slice(0, 10)}\n\n${body}\nQuestion: ${q.question}`;
  const res = await env.gem.generateJSON({ system: ANSWER_SYSTEM, prompt, schema: ANSWER_SCHEMA });
  return { response: String(res?.answer ?? ""), top };
}

async function grade(q, response) {
  const strict = norm(response).includes(norm(q.answer)) ? 1 : 0;
  if (!cfg.judge) return { strict, judged: null };
  const res = await env.gem.generateJSON({
    system: JUDGE_SYSTEM,
    prompt: `Question: ${q.question}\nCorrect answer: ${q.answer}\nModel response: ${response.replace(/\n/g, " ")}`,
    schema: JUDGE_SCHEMA,
  });
  return { strict, judged: res?.correct ? 1 : 0 };
}

// ---------- main loop ----------
const outOfTime = budget(Number(a.budget));
const done = new Set(readRows(out, "runs.jsonl").map((r) => `${r.policy}|${r.qid}`));
let stop = false;

for (const { q, sessions } of plan) {
  if (stop || outOfTime()) break;
  const units = [...cfg.baselines.map((b) => ({ name: b, kind: "baseline" })), ...cfg.policies.map((p) => ({ name: p, kind: "policy" }))];
  for (const u of units) {
    if (done.has(`${u.name}|${q.question_id}`)) continue;
    const before = { ...env.gem.usage };
    policyNow = u.kind === "policy" ? u.name : "none";
    let ing = { prompts: 0, accepted: 0, rejected: 0, extractionErrors: 0, lastError: "" };
    let ans;
    if (u.kind === "policy") {
      ing = await ingest(sessions, u.name);
      if (ing.extractionErrors > 0 && !check) {
        console.log(`${u.name} ${q.question_id}: ${ing.extractionErrors} extraction request(s) failed (${ing.lastError}). Not saved. Wait (quota?) and continue with: npm run eval:lme -- --out "${out}" --yes`);
        stop = true;
        break;
      }
      ans = await answerFrom(q, sessions, "memory");
    } else {
      ans = await answerFrom(q, sessions, u.name === "context" ? "context" : "none");
    }
    const g = await grade(q, ans.response);
    const gold = norm(q.answer);
    const rows = env.db.prepare("SELECT content, status FROM memories").all();
    const activeText = norm(rows.filter((r) => r.status === "active").map((r) => r.content).join(" . "));
    const topText = norm(ans.top.map((m) => m.content).join(" . "));
    const row = {
      policy: u.name,
      kind: u.kind,
      qid: q.question_id,
      qtype: q.question_type,
      sessions: sessions.length,
      evidenceSessions: sessions.filter((s) => s.evidence).length,
      judged: g.judged,
      strict: g.strict,
      goldInActive: u.kind === "policy" && gold ? (activeText.includes(gold) ? 1 : 0) : null,
      goldInTop: u.kind === "policy" && gold ? (topText.includes(gold) ? 1 : 0) : null,
      activeN: u.kind === "policy" ? rows.filter((r) => r.status === "active").length : null,
      inactiveN: u.kind === "policy" ? rows.filter((r) => r.status !== "active").length : null,
      prompts: ing.prompts,
      accepted: ing.accepted,
      rejected: ing.rejected,
      requests: env.gem.usage.calls - before.calls,
      promptTokens: env.gem.usage.promptTokens - before.promptTokens,
      outputTokens: env.gem.usage.outputTokens - before.outputTokens,
      gold: q.answer,
      response: ans.response.slice(0, 300),
    };
    appendRows(out, "runs.jsonl", [row]);
    if (u.kind === "policy") appendRows(out, "memories.jsonl", [{ policy: u.name, qid: q.question_id, gold: q.answer, memories: rows }]);
    console.log(`${u.name.padEnd(8)} ${String(q.question_id).padEnd(12)} judged ${g.judged ?? "-"} strict ${g.strict}` + (u.kind === "policy" ? `  answer-in-memory ${row.goldInActive}  prompts ${row.prompts}  active ${row.activeN}/${row.activeN + row.inactiveN}` : ""));
  }
}
env.cleanup();

// ---------- summary ----------
const rowsAll = readRows(out, "runs.jsonl");
const names = [...cfg.baselines, ...cfg.policies];
const complete = plan.filter(({ q }) => names.every((n) => rowsAll.some((r) => r.policy === n && r.qid === q.question_id))).map(({ q }) => q.question_id);
if (complete.length < plan.length) {
  console.log(`\n${complete.length} of ${plan.length} questions complete. Continue with:  npm run eval:lme -- --out "${out}" --yes`);
  process.exit(0);
}
fs.writeFileSync(path.join(out, "runs.csv"), toCSV(rowsAll));

// exact two-sided sign test for paired outcomes (b = only first right, c = only second right)
function signTest(b, c) {
  const n = b + c;
  if (!n) return 1;
  const k = Math.min(b, c);
  let p = 0;
  let coef = 1; // C(n, i)
  for (let i = 0; i <= k; i++) {
    p += coef;
    coef = (coef * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * p) / 2 ** n);
}

const score = (r) => (cfg.judge ? r.judged : r.strict);
const by = (n) => rowsAll.filter((r) => r.policy === n);
const md = [];
md.push(`# Experiment 5: LongMemEval ${cfg.questionTypes.join("/")} (${cfg.model})`);
md.push("");
md.push(
  `${plan.length} questions from ${cfg.dataFile}; each played with its evidence sessions plus ${cfg.distractorSessions} distractor session(s) (seed ${cfg.seed}); ` +
    `answers from the top ${cfg.k} memories of AURA's search; candidate selection: ${cfg.extractMinScore}, mode \`${cfg.candidates ?? "default"}\`, re-proposal limit ${cfg.repropose ?? 0}; gate reviewer: ${cfg.reviewer}. ` +
    `Accuracy = ${cfg.judge ? "Gemini judge (knowledge-update rule)" : "strict string match"}, with 95% Wilson interval. ` +
    `"Answer in memory" = a normalised active memory contains the reference answer string (a heuristic, only meaningful for short answers).`
);
md.push("");
md.push(
  mdTable(
    ["system", "n", "accuracy [95% CI]", "strict match", "answer in active memory", "answer in top-k", "prompts / question", "active memories", "superseded or outdated", "requests"],
    names.map((n) => {
      const s = by(n);
      const k = s.reduce((t, r) => t + (score(r) || 0), 0);
      const [lo, hi] = wilson(k, s.length);
      const pol = s.filter((r) => r.kind === "policy");
      const m = (key) => (pol.length ? fmt(mean(pol.map((r) => r[key])), 2) : "n/a");
      return [n, s.length, `${fmt(k / s.length)} [${fmt(lo)}, ${fmt(hi)}]`, fmt(mean(s.map((r) => r.strict))), pol.length ? fmt(mean(pol.map((r) => r.goldInActive))) : "n/a", pol.length ? fmt(mean(pol.map((r) => r.goldInTop))) : "n/a", m("prompts"), m("activeN"), m("inactiveN"), s.reduce((t, r) => t + r.requests, 0)];
    })
  )
);
md.push("");
md.push("Paired comparisons (same questions; b = only the first system is right, c = only the second; exact two-sided sign test):");
md.push("");
const pairs = [];
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) pairs.push([names[i], names[j]]);
md.push(
  mdTable(
    ["first", "second", "b", "c", "p"],
    pairs.map(([x, y]) => {
      let b = 0;
      let c = 0;
      for (const id of complete) {
        const rx = by(x).find((r) => r.qid === id);
        const ry = by(y).find((r) => r.qid === id);
        const sx = score(rx) || 0;
        const sy = score(ry) || 0;
        if (sx && !sy) b++;
        if (!sx && sy) c++;
      }
      return [x, y, b, c, fmt(signTest(b, c))];
    })
  )
);
md.push("");
md.push("Every row: runs.csv. Every final memory store: memories.jsonl. The model's answers are in the `response` column.");
fs.writeFileSync(path.join(out, "summary.md"), md.join("\n") + "\n");
writeJSON(path.join(out, "run-info.json"), { finishedAt: new RealDate().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}`, meanLatencyMs: mean(latency) });
console.log(`\nResults: ${out}`);
