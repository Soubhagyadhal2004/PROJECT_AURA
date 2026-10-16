// Selection study (no API calls): which memories reach the extractor's prompt under each selection condition.
// Run from the repository root:
//   node --no-warnings eval/selection/run-reach.mjs                     (all 40 personas)
//   node --no-warnings eval/selection/run-reach.mjs --start 0 --count 18 (resumable chunks; appends)
// Needs only the local embedding model in data/models (copied to a scratch folder; data/aura.db is never opened).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8"));
const nPersonas = Number(arg("personas", cfg.personas));
const start = Number(arg("start", 0));
const count = Number(arg("count", nPersonas - start));
const append = start > 0;
const outDir = path.resolve(ROOT, arg("out", "eval/results/selection/raw"));
fs.mkdirSync(outDir, { recursive: true });

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aura-sel-"));
fs.cpSync(path.join(ROOT, "data", "models", "Xenova"), path.join(scratch, "models", "Xenova"), { recursive: true });
process.env.AURA_DATA_DIR = scratch;
delete process.env.AURA_CANDIDATES;
delete process.env.AURA_EXTRACT_MIN_SCORE;

const mem = await import(path.join(ROOT, "server", "memory.mjs"));
const { db } = await import(path.join(ROOT, "server", "db.mjs"));
const { buildPersona } = await import("./testset.mjs");
const { selectFromRankings, splitSentences } = await import("./select.mjs");

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const manPath = path.join(outDir, "manifest.json");
const manifest = append && fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, "utf8")) : {
  serverMemorySha256: sha(path.join(ROOT, "server", "memory.mjs")),
  embedModel: `${process.env.AURA_TEXT_EMBED_MODEL || "Xenova/all-MiniLM-L6-v2"} (q8)`,
  config: cfg,
  chunks: [],
};
if (manifest.serverMemorySha256 !== sha(path.join(ROOT, "server", "memory.mjs"))) throw new Error("server/memory.mjs changed between chunks");
manifest.chunks.push({ start, count, startedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}` });
fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));

const setTime = db.prepare("UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?");
const condNames = Object.keys(cfg.conditions);
const eventsOut = fs.createWriteStream(path.join(outDir, "events.jsonl"), { flags: append ? "a" : "w" });
const storesOut = fs.createWriteStream(path.join(outDir, "stores.jsonl"), { flags: append ? "a" : "w" });
const tStart = Date.now();

for (let p = start; p < Math.min(nPersonas, start + count); p++) {
  const persona = buildPersona(cfg.personaSeedStart + p, { maxDistractors: Math.max(...cfg.storeSizes), similarShare: cfg.similarDistractorShare });
  mem.deleteAllMemories();
  db.prepare("DELETE FROM memory_proposals").run();
  const ts = new Map();
  let clock = 1;
  const addAt = async (text, category) => {
    const m = await mem.addMemory({ content: text, category, source: "conversation" });
    if (ts.has(m.id)) {
      setTime.run(ts.get(m.id), ts.get(m.id), m.id); // merged into an existing row (AURA's duplicate check): undo the timestamp bump
      return { id: m.id, merged: true };
    }
    const t = clock++;
    ts.set(m.id, t);
    setTime.run(t, t, m.id);
    return { id: m.id, merged: false };
  };
  // persona facts first (seeded order), then distractors: the facts are older than every distractor
  const order = persona.facts.map((f, i) => i).sort((a, b) => ((a * 7 + persona.seed) % 12) - ((b * 7 + persona.seed) % 12));
  const target = {};
  for (const i of order) {
    const f = persona.facts[i];
    target[f.slot] = (await addAt(f.text, f.category)).id;
  }
  let added = 0;
  let merged = 0;
  for (const N of cfg.storeSizes) {
    while (added < N) {
      const d = persona.distractors[added++];
      const r = await addAt(d.text, "other");
      if (r.merged) merged++;
      if (Object.values(target).includes(r.id)) throw new Error(`distractor merged into a persona fact: ${d.text}`);
    }
    const active = db.prepare("SELECT COUNT(*) AS n FROM memories WHERE status = 'active'").get().n;
    storesOut.write(JSON.stringify({ persona: persona.id, N, active, merged }) + "\n");
    const recent = mem.coreMemories(cfg.recent);
    const recentIds = new Set(recent.map((m) => m.id));
    const cache = new Map();
    const rankFor = (q) => cache.get(q);
    for (const ev of persona.events) {
      for (const q of new Set([ev.text, ...splitSentences(ev.text)])) {
        if (!cache.has(q)) cache.set(q, await mem.searchMemories(q, 1e9, { minScore: -Infinity }));
      }
      const tid = target[ev.slot];
      const whole = rankFor(ev.text);
      const wRank = whole.findIndex((m) => m.id === tid) + 1;
      let sRank = Infinity;
      let sScore = -Infinity;
      for (const q of splitSentences(ev.text)) {
        const rk = rankFor(q);
        const i = rk.findIndex((m) => m.id === tid);
        if (i + 1 < sRank) sRank = i + 1;
        if (rk[i].score > sScore) sScore = rk[i].score;
      }
      const conds = {};
      for (const c of condNames) {
        const sel = selectFromRankings(ev.text, cfg.conditions[c], rankFor, recent);
        conds[c] = { final: sel.candidates.includes(tid) ? 1 : 0, search: sel.searchIds.includes(tid) ? 1 : 0, n: sel.candidates.length };
      }
      eventsOut.write(
        JSON.stringify({
          event: ev.id, persona: ev.persona, N, active, slot: ev.slot, kind: ev.kind, form: ev.form, context: ev.context,
          position: ev.position, cue: ev.cue, targetId: tid, targetRecent: recentIds.has(tid) ? 1 : 0,
          wholeRank: wRank, wholeScore: whole[wRank - 1].score, bestSentRank: sRank, bestSentScore: sScore, conds,
        }) + "\n"
      );
    }
  }
  console.log(`${persona.id} done (${((Date.now() - tStart) / 1000).toFixed(0)} s)`);
}
await new Promise((r) => eventsOut.end(r));
await new Promise((r) => storesOut.end(r));
manifest.chunks[manifest.chunks.length - 1].finishedAt = new Date().toISOString();
fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));
fs.rmSync(scratch, { recursive: true, force: true });
console.log("done");
