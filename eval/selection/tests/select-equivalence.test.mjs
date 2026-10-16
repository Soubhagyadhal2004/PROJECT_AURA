// The four server modes computed in eval/selection/select.mjs give exactly the same candidate ids as
// server/memory.mjs selectCandidates. Needs the embedding model in data/models (no API key).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aura-eq-"));
fs.cpSync(path.join(ROOT, "data", "models", "Xenova"), path.join(scratch, "models", "Xenova"), { recursive: true });
process.env.AURA_DATA_DIR = scratch;
delete process.env.AURA_CANDIDATES;
delete process.env.AURA_EXTRACT_MIN_SCORE;

const mem = await import(pathToFileURL(path.join(ROOT, "server", "memory.mjs")).href);
const { db } = await import(pathToFileURL(path.join(ROOT, "server", "db.mjs")).href);
const { buildPersona } = await import("../testset.mjs");
const { selectFromRankings, splitSentences } = await import("../select.mjs");
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "..", "config.json"), "utf8"));

test("selectFromRankings == server selectCandidates for default, nomin, sentence, adaptive", async () => {
  for (const seed of [1, 2]) {
    const p = buildPersona(seed);
    mem.deleteAllMemories();
    let t = 1;
    const setT = db.prepare("UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?");
    for (const f of p.facts) { const m = await mem.addMemory({ content: f.text, category: f.category }); setT.run(t, t, m.id); t++; }
    for (const N of [0, 60]) {
      while (t - 13 < N) { const m = await mem.addMemory({ content: p.distractors[t - 13].text, category: "other" }); setT.run(t, t, m.id); t++; }
      const recent = mem.coreMemories(8);
      let checked = 0;
      for (const ev of p.events.filter((_, i) => i % 3 === 0)) {
        const cache = new Map();
        for (const q of new Set([ev.text, ...splitSentences(ev.text)])) cache.set(q, await mem.searchMemories(q, 1e9, { minScore: -Infinity }));
        for (const mode of cfg.serverModes) {
          const mine = selectFromRankings(ev.text, cfg.conditions[mode], (q) => cache.get(q), recent).candidates;
          const theirs = (await mem.selectCandidates(ev.text, mode)).map((m) => m.id);
          assert.deepEqual(mine, theirs, `${mode} | N=${N} | ${ev.text}`);
          checked++;
        }
      }
      assert.ok(checked > 50);
    }
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});
