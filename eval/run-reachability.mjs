// Experiment 3: can the extractor see the memory it should change?
// AURA's extractor may only update, retire or forget memories that are shown in its prompt: the 12 most
// related to the new messages (searchMemories) plus the 8 most recently confirmed (coreMemories). When the
// user says "I've just moved to Hyderabad" and the old "The user lives in Pune." is not among them, the
// old fact cannot be replaced and stays active next to the new one. This measures how often that happens
// as the store grows, using AURA's real candidate selection and the local embedding model. No Gemini calls.
//
//   npm run eval:reach
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { openIsolated, EVAL_DIR } from "./lib/env.mjs";
import { SLOTS, factOf, fillerSample } from "./lib/scenarios.mjs";
import { rng, hash, pick, shuffle } from "./lib/rng.mjs";
import { mean, fmt, toCSV, mdTable, writeJSON, wilson, outDir, appendRows, readRows, budget } from "./lib/stats.mjs";

const { values: a } = parseArgs({
  options: {
    stores: { type: "string", default: "30" },
    sizes: { type: "string", default: "0,25,50,100,200,350" },
    out: { type: "string" },
    budget: { type: "string", default: "0" },
  },
});
const out = outDir(EVAL_DIR, "reachability", a.out);
const cfgFile = path.join(out, "config.json");
const cfg = fs.existsSync(cfgFile)
  ? JSON.parse(fs.readFileSync(cfgFile, "utf8"))
  : { experiment: "reachability", stores: Number(a.stores), sizes: a.sizes.split(",").map(Number), related: 12, recent: 8 };
if (!fs.existsSync(cfgFile)) writeJSON(cfgFile, { ...cfg, startedAt: new Date().toISOString() });
const outOfTime = budget(Number(a.budget));
const doneStores = new Set(readRows(out, "changes.jsonl").map((r) => `${r.size}|${r.store}`)); // checkpoint per store

const env = await openIsolated();
const { mem, models, db } = env;
const DAY = 86400000;
const fill = (tpl, v) => tpl.replaceAll("{v}", v);

// Two more ways to say each change (the first phrasing comes from scenarios.mjs), so the result does not
// hinge on one sentence. Used only here; Experiment 1 keeps its original sentences.
const MORE = {
  city: { update: ["We relocated to {v} last month.", "My new address is in {v}."] },
  employer: { update: ["I started a new job at {v}.", "I'm now working for {v}."], retire: ["I resigned and I'm taking a break from work.", "I'm unemployed at the moment."] },
  pet: { update: ["Sorry, I got it wrong earlier: my dog's name is {v}.", "We renamed our dog to {v}."], retire: ["Our dog died recently.", "We don't have a dog anymore."] },
  sister: {},
  diet: { update: ["I've become {v}.", "From now on my diet is {v}."] },
  gym: { update: ["My workouts are now at {v}.", "I changed my gym slot to {v}."], retire: ["I cancelled my gym membership.", "I don't work out anymore."] },
  language: { update: ["I switched to studying {v}.", "Now I'm taking {v} classes."], retire: ["I stopped my language classes.", "I'm not studying any language now."] },
  car: { update: ["I upgraded to a {v}.", "My new car is a {v}."], retire: ["I got rid of my car.", "I don't own a car anymore."] },
  project: { update: ["I'm now heading the {v} project.", "They put me on project {v}."], retire: ["The project I was leading is done.", "I'm not on any project right now."] },
  coffee: { update: ["I've switched to having my coffee {v}.", "Now I drink my coffee {v}."], retire: ["I don't drink coffee anymore.", "I gave up coffee."] },
  hobby: { update: ["These days I'm really into {v}.", "I've picked up {v} as my main hobby."] },
  birthday: {},
};
const MODES = ["default", "nomin", "sentence", "adaptive"]; // candidate selection modes compared (server/memory.mjs)
const FORGET = ["Please forget what I told you about {l}.", "Delete what you know about {l}.", "Don't remember anything about {l}."];
for (const size of cfg.sizes) {
  for (let s = 0; s < cfg.stores; s++) {
    if (doneStores.has(`${size}|${s}`)) continue;
    if (outOfTime()) break;
    const rows = [];
    env.reset();
    const r = rng(hash(`reach|${size}|${s}`));
    // one value for every slot, plus N unrelated facts, learned at random times over 90 days
    const values = Object.fromEntries(SLOTS.map((sl) => [sl.key, pick(sl.values, r)]));
    const contents = shuffle([...SLOTS.map((sl) => factOf(sl.key, values[sl.key])), ...fillerSample(size, `reach|${size}|${s}`)], r);
    const ins = db.prepare("INSERT INTO memories(content, category, status, source, embedding, created_at, updated_at) VALUES (?, 'other', 'active', 'manual', ?, ?, ?)");
    for (const c of contents) {
      const t = Date.now() - Math.floor(r() * 90 * DAY);
      ins.run(c, env.f32ToBlob(await models.embedText(c)), t, t);
    }
    const all = db.prepare("SELECT id, content, embedding FROM memories").all().map((x) => ({ ...x, vec: new Float32Array(new Uint8Array(x.embedding).buffer) }));
    const idOf = new Map(all.map((x) => [x.content, x.id]));
    const recentIds = new Set(mem.coreMemories(cfg.recent).map((m) => m.id));

    for (const sl of SLOTS) {
      const target = idOf.get(factOf(sl.key, values[sl.key]));
      const newV = sl.values.find((v) => v !== values[sl.key]);
      const utterances = [];
      if (sl.update) [sl.update, ...(MORE[sl.key].update || [])].forEach((t, k) => utterances.push(["update", k, fill(t, newV)]));
      if (sl.retire) [sl.retire, ...(MORE[sl.key].retire || [])].forEach((t, k) => utterances.push(["retire", k, t]));
      FORGET.forEach((t, k) => utterances.push(["forget", k, t.replace("{l}", sl.label)]));
      // the same changes buried in a longer turn (two unrelated sentences added), as in real conversations
      const MIXERS = ["Can you set a timer for ten minutes?", "What's the weather like in Shimla today?", "Is it true that octopuses have three hearts?"];
      const plainCount = utterances.length;
      utterances.slice(0, plainCount).forEach(([kind, phrasing, text], k) =>
        utterances.push([kind, phrasing, `${text} ${MIXERS[(k + SLOTS.indexOf(sl)) % 3]} ${MIXERS[(k + SLOTS.indexOf(sl) + 1) % 3]}`, 1])
      );
      for (const [kind, phrasing, text, mixed = 0] of utterances) {
        // exactly how extractFromConversation picks candidates: searchMemories(userText, 12) + coreMemories(8)
        const related = (await mem.searchMemories(text, cfg.related)).map((m) => m.id);
        const viaRelated = related.includes(target);
        const viaRecent = recentIds.has(target);
        // the same selection without the minimum score of 0.25 (always the 12 best matches)
        const qv = await models.embedText(text);
        const ranked = all.map((x) => ({ id: x.id, h: 0.85 * models.cosine(qv, x.vec) + 0.15 * mem.lexicalScore(text, x.content) })).sort((p, q) => q.h - p.h);
        const top12 = ranked.slice(0, cfg.related).map((x) => x.id);
        const rank = ranked.findIndex((x) => x.id === target) + 1;
        // the candidate-selection modes of server/memory.mjs (selectCandidates): is the target shown, and how many are shown
        const byMode = {};
        for (const m of MODES) {
          const shown = await mem.selectCandidates(text, m);
          byMode[`reach_${m}`] = shown.some((x) => x.id === target) ? 1 : 0;
          byMode[`cand_${m}`] = shown.length;
        }
        rows.push({
          size, store: s, slot: sl.key, kind, phrasing, mixed, text,
          reachable: viaRelated || viaRecent ? 1 : 0, viaRelated: viaRelated ? 1 : 0, viaRecent: viaRecent ? 1 : 0,
          reachableNoMin: top12.includes(target) || viaRecent ? 1 : 0,
          hybridRank: rank,
          ...byMode,
        });
      }
    }
    appendRows(out, "changes.jsonl", rows);
  }
  const done = readRows(out, "changes.jsonl").filter((x) => x.size === size && !x.mixed);
  console.log(`N=${size}: ${done.length ? `reachable ${fmt(mean(done.map((x) => x.reachable)))} (related ${fmt(mean(done.map((x) => x.viaRelated)))}) after ${new Set(done.map((x) => x.store)).size} store(s)` : "not started"}`);
}
const embedStats = { ...models.embedStats };
env.cleanup();
const rows0 = readRows(out, "changes.jsonl");
const rows = rows0.filter((x) => !x.mixed);
if (!cfg.sizes.every((z) => new Set(rows0.filter((r) => r.size === z).map((r) => r.store)).size === cfg.stores)) {
  console.log(`\nNot finished. Continue with:  npm run eval:reach -- --out "${out}"`);
  process.exit(0);
}
fs.writeFileSync(path.join(out, "changes.csv"), toCSV(rows));
const allRows = rows0; // plain and mixed turns; the first tables below use the single-sentence turns only (as in earlier runs)
const summary = [];
for (const size of cfg.sizes) {
  for (const kind of ["all", "update", "retire", "forget"]) {
    const sel = rows.filter((x) => x.size === size && (kind === "all" || x.kind === kind));
    const k = sel.reduce((t, x) => t + x.reachable, 0);
    const [lo, hi] = wilson(k, sel.length);
    const k2 = sel.reduce((t, x) => t + x.reachableNoMin, 0);
    const [lo2, hi2] = wilson(k2, sel.length);
    summary.push({ size, kind, n: sel.length, reachable: k / sel.length, lo, hi, viaRelated: mean(sel.map((x) => x.viaRelated)), viaRecentOnly: mean(sel.map((x) => (x.viaRecent && !x.viaRelated ? 1 : 0))), reachableNoMin: k2 / sel.length, lo2, hi2 });
  }
}
fs.writeFileSync(path.join(out, "summary.csv"), toCSV(summary));
const md = [];
md.push(`# Experiment 3: can the extractor see the memory it has to change?`);
md.push(``);
md.push(`${cfg.stores} stores per size; each store has one fact for each of the 12 slots plus N unrelated facts with random ages (0-90 days). ` +
  `For every fact, the sentences a user would say to change it ("I've just moved to …", "I stopped going to the gym.", "Please forget …") are run through AURA's real candidate selection ` +
  `(searchMemories(text, ${cfg.related}) + coreMemories(${cfg.recent})). Reachable = the fact to change is among the candidates; 95% Wilson intervals.`);
md.push(``);
md.push(mdTable(["unrelated facts N", "change", "cases", "reachable (AURA)", "found by search", "only via the 8 most recent", "reachable without the 0.25 minimum"],
  summary.map((s) => [s.size, s.kind, s.n, `${fmt(s.reachable)} [${fmt(s.lo)}, ${fmt(s.hi)}]`, fmt(s.viaRelated), fmt(s.viaRecentOnly), `${fmt(s.reachableNoMin)} [${fmt(s.lo2)}, ${fmt(s.hi2)}]`])));
md.push(``);
const big = Math.max(...cfg.sizes);
md.push(`Each fact type is changed with 3 phrasings per kind of change (update / retire / forget); rows in changes.csv.`);
md.push(``);
md.push(`## By fact type (N = ${big})`);
md.push(``);
md.push(mdTable(["slot", "cases", "reachable (AURA)", "without minimum", "median rank of the fact (hybrid score)"],
  SLOTS.map((sl) => {
    const sel = rows.filter((x) => x.size === big && x.slot === sl.key);
    const ranks = sel.map((x) => x.hybridRank).sort((p, q) => p - q);
    return [sl.key, sel.length, fmt(mean(sel.map((x) => x.reachable)), 2), fmt(mean(sel.map((x) => x.reachableNoMin)), 2), ranks[Math.floor(ranks.length / 2)]];
  })));
// candidate-selection modes side by side
md.push(``);
md.push(`## Candidate-selection modes (server/memory.mjs \`selectCandidates\`)`);
md.push(``);
md.push(`default = AURA as shipped; nomin = no minimum score; sentence = also search each sentence separately; adaptive = sentence search, no minimum score, 24 matches when the text sounds like a change. Share of changes whose target is shown (95% Wilson), and the mean number of memories shown.`);
md.push(``);
const modeSummary = [];
for (const size of cfg.sizes) {
  for (const mixed of [0, 1]) for (const kind of ["all", "update", "retire", "forget"]) {
    const sel = allRows.filter((x) => x.size === size && !!x.mixed === !!mixed && (kind === "all" || x.kind === kind));
    const row = { size, turn: mixed ? "mixed (change + 2 unrelated sentences)" : "single sentence", kind, n: sel.length };
    for (const m of MODES) {
      const k = sel.reduce((t, x) => t + (x[`reach_${m}`] ?? 0), 0);
      const [lo, hi] = wilson(k, sel.length);
      Object.assign(row, { [`reach_${m}`]: k / sel.length, [`lo_${m}`]: lo, [`hi_${m}`]: hi, [`cand_${m}`]: mean(sel.map((x) => x[`cand_${m}`] ?? NaN)) });
    }
    modeSummary.push(row);
  }
}
fs.writeFileSync(path.join(out, "summary_modes.csv"), toCSV(modeSummary));
md.push(mdTable(["unrelated facts N", "turn", "change", "cases", ...MODES.map((m) => `${m}: shown [CI] (mean candidates)`)],
  modeSummary.map((r) => [r.size, r.turn, r.kind, r.n, ...MODES.map((m) => `${fmt(r[`reach_${m}`])} [${fmt(r[`lo_${m}`])}, ${fmt(r[`hi_${m}`])}] (${fmt(r[`cand_${m}`], 1)})`)])));
fs.writeFileSync(path.join(out, "summary.md"), md.join("\n") + "\n");
writeJSON(path.join(out, "run-info.json"), { finishedAt: new Date().toISOString(), embeddingModel: "Xenova/all-MiniLM-L6-v2", node: process.version, platform: `${process.platform}-${process.arch}`, lastSessionEmbedStats: embedStats });
console.log(`\nResults: ${out}`);
