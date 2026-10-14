// Experiment 2: does memory search find the right fact when the user asks about it?
// Runs AURA's real searchMemories() (local MiniLM embeddings + keyword overlap, minimum score 0.25) over
// stores of different sizes, with questions phrased the way people ask them ("What's my dog's name?"),
// and compares it with variants of the scoring rule. No Gemini calls.
//
//   npm run eval:retrieval
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { openIsolated, EVAL_DIR } from "./lib/env.mjs";
import { makePersona, SLOT, factOf, fillerSample } from "./lib/scenarios.mjs";
import { rng, hash } from "./lib/rng.mjs";
import { mean, fmt, toCSV, mdTable, writeJSON, wilson, outDir, appendRows, readRows, budget } from "./lib/stats.mjs";

const { values: a } = parseArgs({
  options: {
    personas: { type: "string", default: "20" },
    seeds: { type: "string", default: "3" },
    sizes: { type: "string", default: "25,100,350" },
    out: { type: "string" },
    budget: { type: "string", default: "0" },
  },
});
const out = outDir(EVAL_DIR, "retrieval", a.out);
const cfgFile = path.join(out, "config.json");
const cfg = fs.existsSync(cfgFile)
  ? JSON.parse(fs.readFileSync(cfgFile, "utf8"))
  : { experiment: "retrieval", personas: Number(a.personas), seeds: Number(a.seeds), sizes: a.sizes.split(",").map(Number) };
if (!fs.existsSync(cfgFile)) writeJSON(cfgFile, { ...cfg, startedAt: new Date().toISOString() });
const outOfTime = budget(Number(a.budget));
const doneSizes = new Set(readRows(out, "queries.jsonl").map((r) => r.size));

const env = await openIsolated();
const { mem, models, db } = env;
const DAY = 86400000;
const cos = models.cosine;

// Scoring variants. "aura" is the real function; the others re-score the same rows.
const VARIANTS = {
  aura_k6: { label: "AURA (hybrid 0.85/0.15, min 0.25), k=6 — recall tool", k: 6 },
  aura_k4: { label: "AURA (hybrid, min 0.25), k=4 — typed messages", k: 4 },
  hybrid_nomin_k6: { label: "hybrid, no minimum score, k=6", k: 6 },
  semantic_nomin_k6: { label: "embedding only, no minimum score, k=6", k: 6 },
  lexical_k6: { label: "keywords only (AURA fallback when the model is unavailable, min 0.1), k=6", k: 6 },
};

for (const size of cfg.sizes) {
  if (doneSizes.has(size)) continue;
  if (outOfTime()) break;
  const rows = [];
  const absent = [];
  for (let seed = 1; seed <= cfg.seeds; seed++) {
    for (let i = 0; i < cfg.personas; i++) {
      const persona = makePersona(seed, i);
      env.reset();
      const r = rng(hash(`retrieval|${size}|${persona.id}`));
      // store: the persona's current facts + unrelated facts, learned at random times over 90 days
      const facts = [...persona.finalGold.state].filter(([, v]) => v != null).map(([k, v]) => ({ slot: k, content: factOf(k, v) }));
      const contents = [...facts.map((f) => f.content), ...fillerSample(size, `retrieval|${persona.id}`)];
      const ins = db.prepare("INSERT INTO memories(content, category, status, source, embedding, created_at, updated_at) VALUES (?, 'other', 'active', 'manual', ?, ?, ?)");
      for (const c of contents) {
        const t = Date.now() - Math.floor(r() * 90 * DAY);
        ins.run(c, env.f32ToBlob(await models.embedText(c)), t, t);
      }
      const all = db.prepare("SELECT id, content, embedding FROM memories").all().map((x) => ({ ...x, vec: new Float32Array(new Uint8Array(x.embedding).buffer) }));
      const idOf = new Map(all.map((x) => [x.content, x.id]));

      for (const f of facts) {
        for (const q of SLOT[f.slot].queries) {
          const target = idOf.get(f.content);
          const qv = await models.embedText(q);
          const scored = all.map((x) => {
            const sem = cos(qv, x.vec);
            const lex = mem.lexicalScore(q, x.content);
            return { id: x.id, sem, lex, hyb: 0.85 * sem + 0.15 * lex };
          });
          const rankBy = (key, min, k) => scored.filter((s) => s[key] >= min).sort((p, q2) => q2[key] - p[key]).slice(0, k).map((s) => s.id);
          const real6 = (await mem.searchMemories(q, 6)).map((m) => m.id);
          const real4 = (await mem.searchMemories(q, 4)).map((m) => m.id);
          // sanity: our re-scoring reproduces the real function (ties aside)
          const sanity = rankBy("hyb", 0.25, 6).join() === real6.join() ? 1 : 0;
          const results = {
            aura_k6: real6,
            aura_k4: real4,
            hybrid_nomin_k6: rankBy("hyb", -Infinity, 6),
            semantic_nomin_k6: rankBy("sem", -Infinity, 6),
            lexical_k6: rankBy("lex", 0.1, 6),
          };
          const t = scored.find((s) => s.id === target);
          const fullRank = [...scored].sort((p, q2) => q2.hyb - p.hyb).findIndex((s) => s.id === target) + 1;
          const row = { size, seed, persona: i, slot: f.slot, query: q, targetSem: t.sem, targetLex: t.lex, targetHybrid: t.hyb, hybridRank: fullRank, sanity };
          for (const [v, ids] of Object.entries(results)) {
            row[`${v}_hit`] = ids.includes(target) ? 1 : 0;
            row[`${v}_top1`] = ids[0] === target ? 1 : 0;
            row[`${v}_empty`] = ids.length === 0 ? 1 : 0;
          }
          rows.push(row);
        }
      }
      // questions about facts this user never stated (or that are no longer true): whatever comes back is unrelated
      const present = new Set(facts.map((f) => f.slot));
      for (const sl of Object.values(SLOT)) {
        if (present.has(sl.key)) continue;
        for (const q of sl.queries) {
          const qv = await models.embedText(q);
          let best = -Infinity;
          for (const x of all) best = Math.max(best, 0.85 * cos(qv, x.vec) + 0.15 * mem.lexicalScore(q, x.content));
          absent.push({ size, seed, persona: i, slot: sl.key, query: q, bestHybrid: best, auraReturned: (await mem.searchMemories(q, 6)).length });
        }
      }
    }
  }
  appendRows(out, "absent.jsonl", absent);
  appendRows(out, "queries.jsonl", rows);
  console.log(`size ${size}: ${rows.length} queries, AURA hit@6 ${fmt(mean(rows.map((x) => x.aura_k6_hit)))}`);
}
const embedStats = { ...models.embedStats };
env.cleanup();
const rows = readRows(out, "queries.jsonl");
if (!cfg.sizes.every((z) => rows.some((r) => r.size === z))) {
  console.log(`\nNot finished. Continue with:  npm run eval:retrieval -- --out "${out}"`);
  process.exit(0);
}
const absentRows = readRows(out, "absent.jsonl");
const sanityChecked = rows.length;
const sanityMismatch = rows.filter((r) => !r.sanity).length;

fs.writeFileSync(path.join(out, "queries.csv"), toCSV(rows));
const summary = [];
for (const size of cfg.sizes) {
  const sel = rows.filter((x) => x.size === size);
  for (const [v, info] of Object.entries(VARIANTS)) {
    const hits = sel.reduce((t, x) => t + x[`${v}_hit`], 0);
    const [lo, hi] = wilson(hits, sel.length);
    summary.push({
      size, variant: v, label: info.label, n: sel.length,
      hitAtK: hits / sel.length, hitLo: lo, hitHi: hi,
      top1: mean(sel.map((x) => x[`${v}_top1`])),
      emptyRate: mean(sel.map((x) => x[`${v}_empty`])),
    });
  }
}
fs.writeFileSync(path.join(out, "summary.csv"), toCSV(summary));

// per-slot view at the largest size (which kinds of facts are hard to find)
const big = Math.max(...cfg.sizes);
const perSlot = Object.keys(SLOT).map((k) => {
  const sel = rows.filter((x) => x.size === big && x.slot === k);
  return sel.length ? [k, sel.length, fmt(mean(sel.map((x) => x.aura_k6_hit)), 2), fmt(mean(sel.map((x) => x.hybrid_nomin_k6_hit)), 2), fmt(mean(sel.map((x) => x.targetSem)), 3)] : null;
}).filter(Boolean);

const belowMin = rows.filter((x) => x.targetHybrid < 0.25).length;
const md = [];
md.push(`# Experiment 2: memory retrieval with AURA's search`);
md.push(``);
md.push(`Real local embedding model (Xenova/all-MiniLM-L6-v2) and AURA's real searchMemories(). ` +
  `Each store holds one persona's current facts plus N unrelated facts; each fact is asked about with 2 natural questions. ${cfg.personas} personas x ${cfg.seeds} seeds per size. ` +
  `Hit@k = the right fact is among the k results; 95% Wilson intervals in brackets.`);
md.push(``);
md.push(mdTable(
  ["store size N", "variant", "queries", "hit@k", "top-1", "no results"],
  summary.map((s) => [s.size, s.label, s.n, `${fmt(s.hitAtK)} [${fmt(s.hitLo)}, ${fmt(s.hitHi)}]`, fmt(s.top1), fmt(s.emptyRate)])
));
md.push(``);
md.push(`- Right fact scores below AURA's minimum (0.25) on the hybrid score: ${belowMin} of ${rows.length} queries (${fmt(belowMin / rows.length)}). Mean hybrid score of the right fact: ${fmt(mean(rows.map((x) => x.targetHybrid)))}; mean embedding similarity: ${fmt(mean(rows.map((x) => x.targetSem)))}.`);
md.push(`- Sanity check: re-scoring reproduced the real searchMemories() top-6 in ${sanityChecked - sanityMismatch} of ${sanityChecked} queries (differences come only from ties).`);
md.push(``);
md.push(`## By kind of fact (N = ${big})`);
md.push(``);
md.push(mdTable(["slot", "queries", "AURA hit@6", "hybrid no-min hit@6", "mean embedding similarity"], perSlot));
md.push(``);
md.push(`## Choosing the minimum score`);
md.push(``);
md.push(`Trade-off for the hybrid score at k = 6: "found" = questions about a stored fact that get it among the results; ` +
  `"noise" = questions about something the user never stated (or that is no longer true) that still return memories (unrelated ones). ${absentRows.length / cfg.sizes.length} such questions per size.`);
md.push(``);
const TH = [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];
const thRows = [];
for (const size of cfg.sizes) {
  const pres = rows.filter((x) => x.size === size);
  const abs = absentRows.filter((x) => x.size === size);
  for (const t of TH) {
    const found = mean(pres.map((x) => (x.targetHybrid >= t && x.hybridRank <= 6 ? 1 : 0)));
    const noise = mean(abs.map((x) => (x.bestHybrid >= t ? 1 : 0)));
    thRows.push({ size, threshold: t, found, noise });
  }
}
fs.writeFileSync(path.join(out, "threshold.csv"), toCSV(thRows));
md.push(mdTable(["store size N", ...TH.map((t) => `min ${t}`)], cfg.sizes.map((size) => [size, ...TH.map((t) => { const r = thRows.find((x) => x.size === size && x.threshold === t); return `${fmt(r.found, 2)} / ${fmt(r.noise, 2)}`; })])));
md.push(``);
md.push(`Cells: found / noise. AURA uses min 0.25. Check: AURA's real search returned something for ${fmt(mean(absentRows.filter((x) => x.size === Math.max(...cfg.sizes)).map((x) => (x.auraReturned > 0 ? 1 : 0))), 2)} of the never-stated questions at N = ${Math.max(...cfg.sizes)} (table: ${fmt(thRows.find((x) => x.size === Math.max(...cfg.sizes) && x.threshold === 0.25).noise, 2)}).`);
md.push(``);
md.push(`Note: AURA puts the 30 most recently confirmed memories into the Live system prompt, so search matters once a user has more than 30 active memories.`);
fs.writeFileSync(path.join(out, "summary.md"), md.join("\n") + "\n");
writeJSON(path.join(out, "run-info.json"), { finishedAt: new Date().toISOString(), embeddingModel: "Xenova/all-MiniLM-L6-v2", node: process.version, platform: `${process.platform}-${process.arch}`, sanityChecked, sanityMismatch, lastSessionEmbedStats: embedStats });
console.log(`\nResults: ${out}`);
