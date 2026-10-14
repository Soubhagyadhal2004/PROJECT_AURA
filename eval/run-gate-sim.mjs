// Experiment 1: how the review policy affects memory accuracy and user burden, as the extractor's error
// rate grows. Uses AURA's real memory code, database and local embedding model; only the Gemini extractor
// is simulated, with known error rates, so the effect of the policy can be isolated.
//
//   npm run eval:gate                                   full run (defaults below)
//   npm run eval:gate -- --personas 5 --seeds 1         quick check
//   npm run eval:gate -- --out <folder> --budget 150    resume an unfinished run, stop starting new work after 150 s
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { openIsolated, EVAL_DIR } from "./lib/env.mjs";
import { makePersona, withRestates } from "./lib/scenarios.mjs";
import { runPersona, POLICIES } from "./lib/harness.mjs";
import { mean, ci95, fmt, toCSV, mdTable, writeJSON, outDir, appendRows, readRows, budget } from "./lib/stats.mjs";

const { values: a } = parseArgs({
  options: {
    personas: { type: "string", default: "20" },
    seeds: { type: "string", default: "3" },
    errors: { type: "string", default: "0,0.05,0.1,0.2,0.3" },
    u: { type: "string", default: "0.05" },
    "u-sweep": { type: "string", default: "0,0.1,0.2,0.3" },
    "u-sweep-error": { type: "string", default: "0.1" },
    policies: { type: "string", default: POLICIES.join(",") },
    "filler-initial": { type: "string", default: "30" },
    "filler-gap": { type: "string", default: "10" },
    out: { type: "string" },
    "extract-min-score": { type: "string" },
    // the two memory features under test (see server/memory.mjs); defaults = AURA as shipped
    candidates: { type: "string", default: "default" },
    repropose: { type: "string", default: "0" },
    restate: { type: "string", default: "0" },
    budget: { type: "string", default: "0" },
  },
});
if (a["extract-min-score"] != null) process.env.AURA_EXTRACT_MIN_SCORE = a["extract-min-score"];
const out = outDir(EVAL_DIR, "gate-sim", a.out);
const cfgFile = path.join(out, "config.json");
// a resumed run keeps the configuration it was started with
const cfg = fs.existsSync(cfgFile)
  ? JSON.parse(fs.readFileSync(cfgFile, "utf8"))
  : {
      experiment: "gate-sim",
      personas: Number(a.personas),
      seeds: Number(a.seeds),
      errors: a.errors.split(",").map(Number),
      u: Number(a.u),
      uSweep: a["u-sweep"] ? a["u-sweep"].split(",").map(Number) : [],
      uSweepError: Number(a["u-sweep-error"]),
      policies: a.policies.split(","),
      fillerInitial: Number(a["filler-initial"]),
      fillerPerGap: Number(a["filler-gap"]),
      extractor: "simulated (eval/lib/harness.mjs makeSimExtractor)",
      // candidate selection for the extractor: AURA default (search minimum 0.25) or the tested change
      extractMinScore: process.env.AURA_EXTRACT_MIN_SCORE ?? "default (0.25)",
      candidates: a.candidates,
      repropose: Number(a.repropose),
      restate: Number(a.restate),
    };
// a resumed run keeps the features it was started with
process.env.AURA_CANDIDATES = cfg.candidates ?? "default";
process.env.AURA_REPROPOSE = String(cfg.repropose ?? 0);
if (!fs.existsSync(cfgFile)) writeJSON(cfgFile, { ...cfg, startedAt: new Date().toISOString() });

const cells = [];
for (const e of cfg.errors) for (const p of cfg.policies) cells.push({ sweep: "error", policy: p, e, u: cfg.u });
for (const u of cfg.uSweep) for (const p of ["gate", "gateAll"].filter((x) => cfg.policies.includes(x))) cells.push({ sweep: "user", policy: p, e: cfg.uSweepError, u });
const key = (c) => `${c.sweep}|${c.policy}|${c.e}|${c.u}`;

const env = await openIsolated();
const outOfTime = budget(Number(a.budget));
const done = new Set(readRows(out, "runs.jsonl").map((r) => `${key(r)}|${r.seed}|${r.persona}`));
const t0 = performance.now();

for (const c of cells) {
  const pending = [];
  for (let seed = 1; seed <= cfg.seeds; seed++) for (let i = 0; i < cfg.personas; i++) if (!done.has(`${key(c)}|${seed}|${i}`)) pending.push([seed, i]);
  if (!pending.length) continue;
  if (outOfTime()) break;
  const rows = [];
  for (const [seed, i] of pending) {
    const persona = withRestates(makePersona(seed, i), cfg.restate ?? 0, `${seed}`);
    const m = await runPersona(env, persona, { policy: c.policy, e: c.e, u: c.u, fillerInitial: cfg.fillerInitial, fillerPerGap: cfg.fillerPerGap, extractor: "sim", restateUpdates: (cfg.restate ?? 0) > 0 });
    rows.push({ ...c, seed, persona: i, ...m, restates: persona.restates || 0, promptsPer100Turns: (100 * m.prompts) / m.userTurns });
  }
  appendRows(out, "runs.jsonl", rows);
  console.log(`${key(c).padEnd(24)} F1 ${fmt(mean(rows.map((r) => r.f1)))}  stale ${fmt(mean(rows.map((r) => r.stale)), 2)}  false ${fmt(mean(rows.map((r) => r.falseMem)), 2)}  prompts/100 ${fmt(mean(rows.map((r) => r.promptsPer100Turns)), 1)}`);
}
const embedStats = { ...env.models.embedStats };
env.cleanup();

const all = readRows(out, "runs.jsonl");
const expected = cells.length * cfg.personas * cfg.seeds;
if (all.length < expected) {
  console.log(`\nNot finished: ${all.length} of ${expected} persona runs. Continue with:  npm run eval:gate -- --out "${out}"`);
  process.exit(0);
}
summarize(all);
console.log(`\nResults: ${out}`);

function summarize(rows) {
  fs.writeFileSync(path.join(out, "runs.csv"), toCSV(rows));
  const metrics = ["precision", "recall", "f1", "exactState", "stale", "falseMem", "destroyed", "fillerLost", "wrongChangesApplied", "promptsPer100Turns", "candidateMissesOnChange", "forgetMemResidual", "forgetTextResidual"];
  const summary = [];
  for (const c of cells) {
    const sel = rows.filter((r) => key(r) === key(c));
    const s = { ...c, n: sel.length };
    for (const m of metrics) {
      const xs = sel.map((r) => r[m]);
      s[`${m}_mean`] = mean(xs);
      s[`${m}_ci95`] = ci95(xs);
    }
    const sum = (f) => sel.reduce((t, r) => t + f(r), 0);
    s.candidateMissRate = sum((r) => r.changeTurns) ? sum((r) => r.candidateMissesOnChange) / sum((r) => r.changeTurns) : 0;
    const decided = sum((r) => r.correctAccepted + r.correctRejected + r.wrongAccepted + r.wrongRejected);
    s.promptPrecision = decided ? sum((r) => r.correctAccepted + r.correctRejected) / decided : NaN;
    s.injectedWrongChanges = sum((r) => r.injectedWrongChanges) / sel.length;
    summary.push(s);
  }
  fs.writeFileSync(path.join(out, "summary.csv"), toCSV(summary));

  const md = [];
  md.push(`# Experiment 1: review policy vs. extractor error rate (simulated extractor)`);
  md.push(``);
  md.push(`Features under test: candidate selection \`${cfg.candidates ?? "default"}\`, re-proposal limit ${cfg.repropose ?? 0}, restate probability ${cfg.restate ?? 0} (restated facts add turns to every persona and let a correct extractor update a stale memory it is shown).`);
  md.push(``);
  md.push(`Candidate selection for the extractor: ${cfg.extractMinScore === "default (0.25)" || cfg.extractMinScore == null ? "AURA as shipped (search minimum score 0.25)" : `minimum score ${cfg.extractMinScore} (AURA_EXTRACT_MIN_SCORE)`}.`);
  md.push(``);
  md.push(`${cfg.personas} personas x ${cfg.seeds} seeds per cell (n = ${cfg.personas * cfg.seeds}); each persona has 5 sessions (~21 user turns). ` +
    `The memory store starts with ${cfg.fillerInitial} unrelated facts and gains ${cfg.fillerPerGap} between sessions. ` +
    `Means with 95% CI half-widths. Extractor = simulated with error rate e (not Gemini); database, memory logic, candidate selection and embeddings are AURA's real code and local model.`);
  md.push(``);
  md.push(`## Error-rate sweep (user slip rate u = ${cfg.u})`);
  md.push(``);
  md.push(mdTable(
    ["policy", "e", "F1", "exact final state", "stale facts", "false facts", "true facts destroyed", "wrong changes applied", "prompts / 100 turns", "prompt precision"],
    summary.filter((s) => s.sweep === "error").map((s) => [s.policy, s.e, `${fmt(s.f1_mean)} ± ${fmt(s.f1_ci95)}`, fmt(s.exactState_mean, 2), fmt(s.stale_mean, 2), fmt(s.falseMem_mean, 2), fmt(s.destroyed_mean + s.fillerLost_mean, 2), fmt(s.wrongChangesApplied_mean, 2), fmt(s.promptsPer100Turns_mean, 1), fmt(s.promptPrecision, 2)])
  ));
  if (summary.some((s) => s.sweep === "user")) {
    md.push(``);
    md.push(`## User-reliability sweep (extractor error rate e = ${cfg.uSweepError})`);
    md.push(``);
    md.push(mdTable(
      ["policy", "u", "F1", "stale facts", "false facts", "wrong changes applied", "prompts / 100 turns"],
      summary.filter((s) => s.sweep === "user").map((s) => [s.policy, s.u, `${fmt(s.f1_mean)} ± ${fmt(s.f1_ci95)}`, fmt(s.stale_mean, 2), fmt(s.falseMem_mean, 2), fmt(s.wrongChangesApplied_mean, 2), fmt(s.promptsPer100Turns_mean, 1)])
    ));
  }
  md.push(``);
  md.push(`## Other measurements`);
  md.push(``);
  const e0 = summary.filter((s) => s.sweep === "error" && s.e === 0);
  md.push(`- Change turns whose target memory was not among the candidates shown to the extractor (e = 0): ` + e0.map((s) => `${s.policy} ${fmt(s.candidateMissRate, 3)}`).join(", ") + `.`);
  md.push(`- Forget requests (per persona) whose value is still in a memory row / still in the stored conversation text (e = 0): ` + e0.map((s) => `${s.policy} ${fmt(s.forgetMemResidual_mean, 2)} / ${fmt(s.forgetTextResidual_mean, 2)}`).join("; ") + ` (forget requests per persona: ${fmt(mean(rows.filter((r) => r.e === 0).map((r) => r.forgets)), 2)}).`);
  md.push(``);
  md.push(`Column definitions: eval/README.md. Raw rows: runs.csv. Configuration: config.json.`);
  fs.writeFileSync(path.join(out, "summary.md"), md.join("\n") + "\n");
  writeJSON(path.join(out, "run-info.json"), {
    finishedAt: new Date().toISOString(),
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    lastSessionEmbedStats: embedStats,
    lastSessionSeconds: (performance.now() - t0) / 1000,
  });
}
