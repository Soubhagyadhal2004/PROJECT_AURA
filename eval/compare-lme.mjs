// Paired comparison of two LongMemEval runs (same questions): baseline vs. +F1+F2, per system.
//
//   npm run eval:compare-lme
//   npm run eval:compare-lme -- --base eval/results/lme/baseline --other eval/results/lme/both --out eval/ABLATION-LME.md
//
// "none" and "context" use no memory, so their difference between the two runs is run-to-run noise of the
// answering and judging model; it tells how much of a difference in the memory systems to believe.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { mdTable } from "./lib/stats.mjs";

const EVAL = path.dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({
  options: {
    base: { type: "string", default: path.join(EVAL, "results", "lme", "baseline") },
    other: { type: "string", default: path.join(EVAL, "results", "lme", "both") },
    out: { type: "string", default: path.join(EVAL, "ABLATION-LME.md") },
  },
});
const rows = (d) => fs.readFileSync(path.join(d, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rel = (p) => path.relative(EVAL, p).split(path.sep).join("/");
const A = rows(a.base), B = rows(a.other);
const key = (r) => `${r.policy}|${r.qid}`;
const bm = new Map(B.map((r) => [key(r), r]));

function signP(b, c) {
  const n = b + c;
  if (!n) return 1;
  const lo = Math.min(b, c);
  let p = 0, t = 1;
  for (let i = 0; i <= lo; i++) { p += t; t = (t * (n - i)) / (i + 1); }
  return Math.min(1, (2 * p) / 2 ** n);
}
const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const out = [`# LongMemEval: baseline vs. F1 + F2 (paired by question)`, ``];
out.push(`Baseline: \`${rel(a.base)}\` (candidates default, no re-propose). Other: \`${rel(a.other)}\`. Same ${new Set(A.map((r) => r.qid)).size} questions, same model; "judged" = the judge model's verdict, "strict" = strict string match. b = right only in the baseline run, c = right only in the other run; exact two-sided sign test on the discordant pairs.`, ``);
const table = [];
for (const policy of ["none", "context", "append", "auto", "gate"]) {
  const pairs = A.filter((r) => r.policy === policy && bm.has(key(r))).map((r) => [r, bm.get(key(r))]);
  if (!pairs.length) continue;
  for (const [field, label] of [["judged", "judged"], ["strict", "strict"]]) {
    const n = pairs.length;
    const acc0 = pairs.reduce((t, [x]) => t + x[field], 0) / n, acc1 = pairs.reduce((t, [, y]) => t + y[field], 0) / n;
    const b = pairs.filter(([x, y]) => x[field] && !y[field]).length, c = pairs.filter(([x, y]) => !x[field] && y[field]).length;
    table.push([policy, label, n, f(acc0), f(acc1), `${acc1 - acc0 >= 0 ? "+" : ""}${f(acc1 - acc0)}`, b, c, f(signP(b, c))]);
  }
}
out.push(mdTable(["system", "measure", "questions", "baseline run", "other run", "difference", "b", "c", "p (sign)"], table), ``);
out.push(`The rows for \`none\` and \`context\` use no memory: any difference there is noise between runs (sampling of the answering and judging model). Differences of the memory systems (append, auto, gate) of that size should not be read as an effect.`, ``);
fs.writeFileSync(a.out, out.join("\n"));
console.log(`Wrote ${a.out}`);
