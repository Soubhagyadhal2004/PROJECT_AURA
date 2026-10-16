// Reranker baseline for the selection study (needs a one-time download of a cross-encoder from Hugging Face,
// so it is run on a machine with internet access; it makes no Gemini calls).
// For every change event at the main store size (N = 350): take the 50 best whole-message matches of AURA's
// search without a minimum score, rerank them with a cross-encoder, show the top 24 (+ the 8 recent memories),
// and record whether the target is among them. Same personas, stores and events as run-reach.mjs.
//   node --no-warnings eval/selection/run-rerank.mjs --smoke      (1 persona, to check that it works)
//   node --no-warnings eval/selection/run-rerank.mjs              (all personas; resumable with --start/--count)
// Output: eval/results/selection/rerank/events.jsonl (+ manifest.json). Then: python3 eval/selection/analyze_rerank.py
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const has = (n) => process.argv.includes(`--${n}`);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8"));
const RERANKER = arg("model", "Xenova/ms-marco-MiniLM-L-6-v2");
const POOL = Number(arg("pool", 50));
const K = Number(arg("k", 24));
const N = Number(arg("N", cfg.mainStoreSize));
const nPersonas = has("smoke") ? 1 : Number(arg("personas", cfg.personas));
const start = Number(arg("start", 0));
const count = Number(arg("count", nPersonas - start));
const outDir = path.resolve(ROOT, arg("out", has("smoke") ? "eval/results/selection/rerank-smoke" : "eval/results/selection/rerank"));
fs.mkdirSync(outDir, { recursive: true });

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aura-rerank-"));
fs.cpSync(path.join(ROOT, "data", "models", "Xenova"), path.join(scratch, "models", "Xenova"), { recursive: true });
process.env.AURA_DATA_DIR = scratch;
delete process.env.AURA_CANDIDATES;
delete process.env.AURA_EXTRACT_MIN_SCORE;

const url = (p) => pathToFileURL(p).href;
const mem = await import(url(path.join(ROOT, "server", "memory.mjs")));
const { db } = await import(url(path.join(ROOT, "server", "db.mjs")));
const { buildPersona } = await import("./testset.mjs");

// cross-encoder (downloaded once into data/models, like AURA's other local models)
const tjs = await import("@huggingface/transformers");
tjs.env.cacheDir = path.join(ROOT, "data", "models");
tjs.env.allowLocalModels = true;
const tokenizer = await tjs.AutoTokenizer.from_pretrained(RERANKER);
const model = await tjs.AutoModelForSequenceClassification.from_pretrained(RERANKER, { dtype: "q8" });
async function rerank(query, items) {
  const inputs = tokenizer(new Array(items.length).fill(query), { text_pair: items.map((m) => m.content), padding: true, truncation: true });
  const { logits } = await model(inputs);
  const s = Array.from(logits.data);
  return items.map((m, i) => ({ ...m, rr: s[i] })).sort((a, b) => b.rr - a.rr);
}

const manPath = path.join(outDir, "manifest.json");
const manifest = fs.existsSync(manPath) && start > 0 ? JSON.parse(fs.readFileSync(manPath, "utf8")) : { reranker: RERANKER, pool: POOL, k: K, N, chunks: [] };
manifest.chunks.push({ start, count, startedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}` });
fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));
const out = path.join(outDir, "events.jsonl");
if (start === 0 && fs.existsSync(out)) fs.rmSync(out);

const setTime = db.prepare("UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?");
const t0 = Date.now();
for (let p = start; p < Math.min(nPersonas, start + count); p++) {
  const persona = buildPersona(cfg.personaSeedStart + p, { maxDistractors: Math.max(...cfg.storeSizes), similarShare: cfg.similarDistractorShare });
  mem.deleteAllMemories();
  const ts = new Map();
  let clock = 1;
  const addAt = async (text, category) => {
    const m = await mem.addMemory({ content: text, category, source: "conversation" });
    if (ts.has(m.id)) { setTime.run(ts.get(m.id), ts.get(m.id), m.id); return m.id; }
    ts.set(m.id, clock);
    setTime.run(clock, clock, m.id);
    clock++;
    return m.id;
  };
  // same construction order as run-reach.mjs, so ids and timestamps match
  const order = persona.facts.map((f, i) => i).sort((a, b) => ((a * 7 + persona.seed) % 12) - ((b * 7 + persona.seed) % 12));
  const target = {};
  for (const i of order) target[persona.facts[i].slot] = await addAt(persona.facts[i].text, persona.facts[i].category);
  for (let i = 0; i < N; i++) await addAt(persona.distractors[i].text, "other");
  const recent = mem.coreMemories(cfg.recent);
  const lines = [];
  for (const ev of persona.events) {
    const pool = (await mem.searchMemories(ev.text, POOL, { minScore: -Infinity })).slice(0, POOL);
    const ranked = await rerank(ev.text, pool);
    const ids = [...new Set([...ranked.slice(0, K).map((m) => m.id), ...recent.map((m) => m.id)])];
    const tid = target[ev.slot];
    lines.push(JSON.stringify({ event: ev.id, persona: persona.id, N, slot: ev.slot, kind: ev.kind, context: ev.context, cue: ev.cue,
      inPool: pool.some((m) => m.id === tid) ? 1 : 0, final: ids.includes(tid) ? 1 : 0, n: ids.length,
      rerankRank: ranked.findIndex((m) => m.id === tid) + 1 || null }));
  }
  fs.appendFileSync(out, lines.join("\n") + "\n");
  console.log(`${persona.id} done (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
manifest.chunks[manifest.chunks.length - 1].finishedAt = new Date().toISOString();
fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));
fs.rmSync(scratch, { recursive: true, force: true });
console.log("done");
