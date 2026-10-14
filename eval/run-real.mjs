// Experiment 4: the same scenarios with the REAL Gemini extractor (gemini-3.5-flash-lite by default).
// Needs internet access and GEMINI_API_KEY in .env. Uses requests from your daily quota, so it asks first.
//
//   npm run eval:real                        shows the plan and the number of requests, does nothing
//   npm run eval:real -- --yes               runs it (4 personas x auto + gate, about 170 requests)
//   npm run eval:real -- --yes --personas 8 --policies auto,gate,gateAll
//   npm run eval:real -- --out <folder> --yes    continue an interrupted run
//   npm run eval:real -- --check-with-sim    no Gemini: checks the value-based scorer against exact scoring
//
// Gemini writes memories in its own words, so memories are scored by the values they mention
// (eval/lib/loose.mjs). Every final memory is saved in memories.jsonl for manual inspection.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { openIsolated, EVAL_DIR } from "./lib/env.mjs";
import { makePersona, withRestates, isFiller } from "./lib/scenarios.mjs";
import { runPersona, score as exactScore, exactJudge } from "./lib/harness.mjs";
import { looseJudge, looseScore, classify } from "./lib/loose.mjs";
import { mean, ci95, fmt, toCSV, mdTable, writeJSON, outDir, appendRows, readRows, budget } from "./lib/stats.mjs";

const { values: a } = parseArgs({
  options: {
    personas: { type: "string", default: "4" },
    seeds: { type: "string", default: "1" },
    policies: { type: "string", default: "auto,gate" },
    u: { type: "string", default: "0" },
    rpm: { type: "string", default: "12" },
    "filler-initial": { type: "string", default: "30" },
    "filler-gap": { type: "string", default: "10" },
    out: { type: "string" },
    "extract-min-score": { type: "string" },
    // the two memory features under test (see server/memory.mjs); defaults = AURA as shipped
    candidates: { type: "string", default: "default" },
    repropose: { type: "string", default: "0" },
    restate: { type: "string", default: "0" },
    budget: { type: "string", default: "0" },
    yes: { type: "boolean", default: false },
    "check-with-sim": { type: "boolean", default: false },
    e: { type: "string", default: "0.1" },
  },
});
if (a["extract-min-score"] != null) process.env.AURA_EXTRACT_MIN_SCORE = a["extract-min-score"];
const check = a["check-with-sim"];

const env = await openIsolated({ clock: check ? "fake" : "real" });
const out = outDir(EVAL_DIR, check ? "real-scorer-check" : "real-gemini", a.out);
const cfgFile = path.join(out, "config.json");
const cfg = fs.existsSync(cfgFile)
  ? JSON.parse(fs.readFileSync(cfgFile, "utf8"))
  : {
      experiment: check ? "real-scorer-check" : "real-gemini",
      personas: Number(a.personas),
      seeds: Number(a.seeds),
      policies: a.policies.split(","),
      u: Number(a.u),
      rpm: Number(a.rpm),
      fillerInitial: Number(a["filler-initial"]),
      fillerPerGap: Number(a["filler-gap"]),
      extractor: check ? `simulated, e = ${a.e}` : `Gemini ${env.config.TEXT_MODEL}`,
      e: check ? Number(a.e) : null,
      extractMinScore: process.env.AURA_EXTRACT_MIN_SCORE ?? "default (0.25)",
      candidates: a.candidates,
      repropose: Number(a.repropose),
      restate: Number(a.restate),
    };
// a resumed run keeps the features it was started with
process.env.AURA_CANDIDATES = cfg.candidates ?? "default";
process.env.AURA_REPROPOSE = String(cfg.repropose ?? 0);

const jobs = [];
for (const policy of cfg.policies) for (let seed = 1; seed <= cfg.seeds; seed++) for (let i = 0; i < cfg.personas; i++) jobs.push({ policy, seed, persona: i });
const turnsPer = mean(Array.from({ length: cfg.personas }, (_, i) => withRestates(makePersona(1, i), cfg.restate ?? 0, "1").sessions.flat().length));

if (!check) {
  if (!env.gem.hasKey()) {
    console.log("GEMINI_API_KEY is not set. Add it to the .env file in the project root.");
    env.cleanup();
    process.exit(1);
  }
  const est = Math.round(jobs.length * turnsPer);
  console.log(`Plan: ${jobs.length} persona runs (${cfg.personas} personas x ${cfg.seeds} seed(s) x ${cfg.policies.join(", ")}), ` +
    `about ${est} requests to ${env.config.TEXT_MODEL} at most ${cfg.rpm} per minute (about ${Math.ceil(est / cfg.rpm)} min).`);
  if (!a.yes) {
    console.log(`Nothing was sent. Add --yes to run it.`);
    env.cleanup();
    process.exit(0);
  }
}
if (!fs.existsSync(cfgFile)) writeJSON(cfgFile, { ...cfg, startedAt: new Date().toISOString() });

// pace the requests (free-tier keys allow only a few per minute)
let last = 0;
const paced = async (args, realGen) => {
  const gap = 60000 / cfg.rpm;
  const wait = last + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  return realGen(args);
};

const outOfTime = budget(Number(a.budget));
const done = new Set(readRows(out, "runs.jsonl").map((r) => `${r.policy}|${r.seed}|${r.persona}`));
let latency = [];
env.mem.memoryEvents.on("extraction", (x) => latency.push(x.latencyMs));

for (const job of jobs) {
  if (done.has(`${job.policy}|${job.seed}|${job.persona}`)) continue;
  if (outOfTime()) break;
  const persona = withRestates(makePersona(job.seed, job.persona), cfg.restate ?? 0, `${job.seed}`);
  const before = { ...env.gem.usage };
  latency = [];
  let memories = [];
  let exact = null;
  let decisions = [];
  // check mode: decide with the value-based judge, and count how often the exact judge agrees
  const judgeTally = { n: 0, agree: 0 };
  const judge = check
    ? {
        addIsCorrect(c, g) { const a = looseJudge.addIsCorrect(c, g); judgeTally.n++; if (a === exactJudge.addIsCorrect(c, g)) judgeTally.agree++; return a; },
        proposalIsCorrect(p, g) { const a = looseJudge.proposalIsCorrect(p, g); judgeTally.n++; if (a === exactJudge.proposalIsCorrect(p, g)) judgeTally.agree++; return a; },
      }
    : looseJudge;
  const m = await runPersona(env, persona, {
    policy: job.policy,
    e: check ? cfg.e : 0,
    u: cfg.u,
    fillerInitial: cfg.fillerInitial,
    fillerPerGap: cfg.fillerPerGap,
    extractor: check ? "sim" : "real",
    restateUpdates: check && (cfg.restate ?? 0) > 0,
    extractorFn: check ? undefined : paced,
    judge,
    scorer: looseScore,
    onFinish: (env2, gold, run) => {
      memories = env2.db.prepare("SELECT id, content, status, category, source FROM memories").all().filter((r) => !isFiller(r.content)).map((r) => ({ ...r, judged: classify(r.content, gold) }));
      if (check) exact = exactScore(env2, gold, run);
      decisions = run.decisions;
    },
  });
  if (m.extractionErrors > 0 && !check) {
    console.log(`Persona ${job.persona} (${job.policy}): ${m.extractionErrors} extraction request(s) failed (${m.lastError || "see server log"}). ` +
      `Not saved. Wait (quota?) and continue with: npm run eval:real -- --out "${out}" --yes`);
    break;
  }
  const row = {
    ...job,
    ...m,
    promptsPer100Turns: (100 * m.prompts) / m.userTurns,
    requests: env.gem.usage.calls - before.calls,
    promptTokens: env.gem.usage.promptTokens - before.promptTokens,
    outputTokens: env.gem.usage.outputTokens - before.outputTokens,
    meanLatencyMs: mean(latency),
  };
  if (check) {
    row.exactCorrect = exact.correct;
    row.exactStale = exact.stale;
    row.exactFalse = exact.falseMem;
    row.agree = exact.correct === m.correct && exact.stale === m.stale && exact.falseMem === m.falseMem ? 1 : 0;
    row.judgeDecisions = judgeTally.n;
    row.judgeAgree = judgeTally.agree;
  }
  appendRows(out, "runs.jsonl", [row]);
  appendRows(out, "memories.jsonl", [{ ...job, memories }]);
  appendRows(out, "decisions.jsonl", decisions.map((d) => ({ ...job, ...d })));
  console.log(`${job.policy.padEnd(7)} persona ${job.seed}-${job.persona}: F1 ${fmt(m.f1)}  stale ${m.stale}  false ${m.falseMem}  other ${m.otherMem}  prompts ${m.prompts}` + (check ? `  agrees with exact scoring: ${row.agree ? "yes" : "NO"}` : `  requests ${row.requests}`));
}
env.cleanup();

const rows = readRows(out, "runs.jsonl");
if (rows.length < jobs.length) {
  console.log(`\n${rows.length} of ${jobs.length} persona runs done. Continue with:  npm run eval:real -- --out "${out}" --yes`);
  process.exit(0);
}
fs.writeFileSync(path.join(out, "runs.csv"), toCSV(rows));
const md = [];
md.push(check ? `# Scorer check: value-based scoring vs. exact scoring (simulated extractor, e = ${cfg.e})` : `# Experiment 4: real Gemini extractor (${cfg.extractor})`);
md.push(``);
md.push(`${cfg.personas} personas x ${cfg.seeds} seed(s); simulated user slip rate u = ${cfg.u}; candidate selection: ${cfg.extractMinScore}; features: candidates \`${cfg.candidates ?? "default"}\`, re-proposal limit ${cfg.repropose ?? 0}, restate probability ${cfg.restate ?? 0}. ` +
  `Memories are scored by the values they mention (eval/lib/loose.mjs): true = mentions the current value; ended = correctly records that a retired fact ended; ` +
  `stale = only an earlier value; false = a value the user never stated as their own; hypothetical = a hypothetical kept as a memory (counted as an error); ` +
  `third-party = a fact about someone in the user's life (allowed, not counted); other = mentions none of the scenario values (not counted).`);
md.push(``);
md.push(mdTable(
  ["policy", "n", "F1", "precision", "recall", "ended", "stale", "false", "hypothetical", "third-party", "other", "prompts / 100 turns", "proposals judged correct", "requests", "mean latency (ms)", "tokens in / out per request"],
  cfg.policies.map((p) => {
    const sel = rows.filter((r) => r.policy === p);
    const decided = sel.reduce((t, r) => t + r.correctAccepted + r.correctRejected + r.wrongAccepted + r.wrongRejected, 0);
    const right = sel.reduce((t, r) => t + r.correctAccepted + r.correctRejected, 0);
    const req = sel.reduce((t, r) => t + r.requests, 0);
    return [p, sel.length, `${fmt(mean(sel.map((r) => r.f1)))} ± ${fmt(ci95(sel.map((r) => r.f1)))}`, fmt(mean(sel.map((r) => r.precision))), fmt(mean(sel.map((r) => r.recall))),
      fmt(mean(sel.map((r) => r.endedMem || 0)), 2), fmt(mean(sel.map((r) => r.stale)), 2), fmt(mean(sel.map((r) => r.falseMem)), 2),
      fmt(mean(sel.map((r) => r.hypotheticalMem || 0)), 2), fmt(mean(sel.map((r) => r.thirdPartyMem || 0)), 2), fmt(mean(sel.map((r) => r.otherMem)), 2), fmt(mean(sel.map((r) => r.promptsPer100Turns)), 1),
      decided ? `${right} of ${decided}` : "n/a", req, fmt(mean(sel.map((r) => r.meanLatencyMs)), 0),
      req ? `${Math.round(sel.reduce((t, r) => t + r.promptTokens, 0) / req)} / ${Math.round(sel.reduce((t, r) => t + r.outputTokens, 0) / req)}` : "n/a"];
  })
));
if (check) {
  md.push(``);
  md.push(`Agreement of value-based and exact scoring (correct, stale and false counts identical): ${rows.filter((r) => r.agree).length} of ${rows.length} persona runs.`);
  md.push(`Agreement of the value-based and exact review judges: ${rows.reduce((t, r) => t + (r.judgeAgree || 0), 0)} of ${rows.reduce((t, r) => t + (r.judgeDecisions || 0), 0)} decisions.`);
}
md.push(``);
md.push(`Every final memory with its judgement: memories.jsonl. Raw rows: runs.csv.`);
fs.writeFileSync(path.join(out, "summary.md"), md.join("\n") + "\n");
writeJSON(path.join(out, "run-info.json"), { finishedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}` });
console.log(`\nResults: ${out}`);
