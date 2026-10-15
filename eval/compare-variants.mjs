// Paired comparison of variants (baseline vs. +F1 / +F2 / both) from the run folders, for simulated and real runs.
//
//   npm run eval:compare                                   the simulated ablation in eval/results/ablation
//   npm run eval:compare -- --dir eval/results/real-ablation --out eval/ABLATION-REAL.md
//   npm run eval:compare -- --base eval/results/x/base --variants f1=eval/results/x/f1,both=eval/results/x/both
//
// Rows are matched by (sweep, policy, e, u, seed, persona), so every difference is paired (same persona, same
// seed). Per cell and metric: mean difference (variant - baseline), 95% bootstrap interval, and an exact two-sided
// sign test on the non-tied pairs. No multiple-comparison correction is applied; the tables say how many tests
// were run so the reader can apply one.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { mean, mdTable, toCSV } from "./lib/stats.mjs";

const EVAL = path.dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({
  options: {
    dir: { type: "string", default: path.join(EVAL, "results", "ablation") },
    base: { type: "string" },
    variants: { type: "string" },
    out: { type: "string", default: path.join(EVAL, "ABLATION.md") },
    boot: { type: "string", default: "4000" },
  },
});
const rows = (dir) => fs.readFileSync(path.join(dir, "runs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const rel = (p) => path.relative(EVAL, p).split(path.sep).join("/");

let baseDir, variants;
if (a.base) {
  baseDir = path.resolve(a.base);
  variants = Object.fromEntries((a.variants || "").split(",").filter(Boolean).map((s) => s.split("=")).map(([k, v]) => [k, path.resolve(v)]));
} else {
  baseDir = path.join(a.dir, "baseline");
  variants = Object.fromEntries(["f1", "f2", "both"].filter((v) => fs.existsSync(path.join(a.dir, v, "runs.jsonl"))).map((v) => [v, path.join(a.dir, v)]));
}
const LABEL = { f1: "+F1 (re-propose)", f2: "+F2 (adaptive candidates)", both: "F1 + F2" };
const METRICS = [
  ["f1", "F1", +1],
  ["stale", "stale facts", -1],
  ["falseMem", "false facts", -1],
  ["destroyed", "true facts destroyed", -1],
  ["wrongChangesApplied", "wrong changes applied", -1],
  ["promptsPer100Turns", "prompts / 100 turns", 0],
  ["exactState", "exact final state", +1],
  ["promptTokens", "prompt tokens", 0],
];
const key = (r) => [r.sweep ?? "", r.policy, r.e ?? "", r.u ?? "", r.seed, r.persona].join("|");
const cellOf = (r) => [r.sweep ?? "", r.policy, r.e ?? "", r.u ?? ""].join("|");

// small deterministic RNG so the intervals are repeatable
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function bootCI(d, B) {
  const r = lcg(12345), m = [];
  for (let b = 0; b < B; b++) { let t = 0; for (let i = 0; i < d.length; i++) t += d[Math.floor(r() * d.length)]; m.push(t / d.length); }
  m.sort((x, y) => x - y);
  return [m[Math.floor(0.025 * B)], m[Math.min(B - 1, Math.floor(0.975 * B))]];
}
function signP(d) {
  const nz = d.filter((x) => Math.abs(x) > 1e-12), n = nz.length, k = nz.filter((x) => x > 0).length;
  if (!n) return 1;
  const lo = Math.min(k, n - k);
  let p = 0, c = 1; // C(n,0)
  for (let i = 0; i <= lo; i++) { p += c; c = (c * (n - i)) / (i + 1); }
  return Math.min(1, (2 * p) / 2 ** n);
}

const base = new Map(rows(baseDir).map((r) => [key(r), r]));
const out = [], csvRows = [];
let tests = 0;
const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const pfmt = (p) => (p < 0.001 ? "<0.001" : p.toFixed(3));
out.push(`# Variant comparison (paired)`, ``);
out.push(`Baseline: \`${rel(baseDir)}\`. ${Object.entries(variants).map(([k, v]) => `${LABEL[k] || k}: \`${rel(v)}\``).join("; ")}.`, ``);
out.push(`Each row is a paired difference (variant - baseline) over the same persona and seed. Interval = 95% bootstrap (${a.boot} resamples); p = exact two-sided sign test on non-tied pairs. "better" means the direction that helps (higher F1, fewer stale/false/destroyed). No correction for multiple tests is applied.`, ``);

for (const [name, dir] of Object.entries(variants)) {
  const vr = rows(dir), groups = new Map();
  for (const r of vr) {
    const b = base.get(key(r));
    if (!b) continue;
    const c = cellOf(r);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push([b, r]);
  }
  out.push(`## ${LABEL[name] || name} vs. baseline`, ``);
  const table = [];
  for (const [c, pairs] of [...groups].sort()) {
    const [sweep, policy, e, u] = c.split("|");
    for (const [m, label, good] of METRICS) {
      const d = pairs.filter(([b, r]) => Number.isFinite(b[m]) && Number.isFinite(r[m])).map(([b, r]) => r[m] - b[m]);
      if (d.length < 2) continue;
      const md = mean(d), [lo, hi] = bootCI(d, +a.boot), p = signP(d);
      tests++;
      const better = good === 0 ? "" : md * good > 0 ? "better" : md * good < 0 ? "worse" : "same";
      table.push([sweep || "-", policy, e === "" ? "-" : e, u === "" ? "-" : u, label, d.length, `${fmt(mean(pairs.map(([b]) => b[m])))} -> ${fmt(mean(pairs.map(([, r]) => r[m])))}`, `${md >= 0 ? "+" : ""}${fmt(md)} [${fmt(lo)}, ${fmt(hi)}]`, pfmt(p), better]);
      csvRows.push({ variant: name, sweep, policy, e, u, metric: m, pairs: d.length, base: mean(pairs.map(([b]) => b[m])), variantMean: mean(pairs.map(([, r]) => r[m])), diff: md, lo, hi, signP: p });
    }
  }
  // the main table: F1 and stale facts only; the full table follows
  const main = table.filter((r) => r[4] === "F1" || r[4] === "stale facts" || r[4] === "prompts / 100 turns");
  out.push(mdTable(["sweep", "policy", "e", "u", "metric", "pairs", "baseline -> variant", "difference [95% CI]", "p (sign)", ""], main), ``);
  out.push(`<details><summary>All metrics</summary>`, ``, mdTable(["sweep", "policy", "e", "u", "metric", "pairs", "baseline -> variant", "difference [95% CI]", "p (sign)", ""], table), ``, `</details>`, ``);
}
out.push(`${tests} paired tests were run in total.`, ``);
fs.writeFileSync(a.out, out.join("\n"));
fs.writeFileSync(a.out.replace(/\.md$/, ".csv"), toCSV(csvRows));
console.log(`Wrote ${a.out} (${tests} tests)`);
