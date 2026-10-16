// The forked extraction (eval/selection/e2e) sends exactly what server extractFromConversation sends for the
// default selection: same system prompt, prompt text and schema. Run from the repository root:
//   node --experimental-test-module-mocks --no-warnings --test eval/selection/tests/extract-fork.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aura-fork-"));
fs.cpSync(path.join(ROOT, "data", "models", "Xenova"), path.join(scratch, "models", "Xenova"), { recursive: true });
process.env.AURA_DATA_DIR = scratch;
process.env.GEMINI_API_KEY = "test-key-not-used";
delete process.env.AURA_CANDIDATES;

const calls = [];
mock.module(pathToFileURL(path.join(ROOT, "server", "gemini.mjs")).href, {
  namedExports: {
    generateJSON: async (args) => { calls.push(args); return { operations: [] }; },
    hasKey: () => true,
    usage: { calls: 0, promptTokens: 0, outputTokens: 0, latencyMs: 0 },
    createLiveToken: async () => ({}),
    transcribeSegments: async () => ({ texts: [] }),
  },
});

const mem = await import(pathToFileURL(path.join(ROOT, "server", "memory.mjs")).href);
const { db } = await import(pathToFileURL(path.join(ROOT, "server", "db.mjs")).href);
const { EXTRACT_SYSTEM, makeSchema, buildPrompt } = await import("../e2e/extract_fork.mjs");
const { buildPersona } = await import("../testset.mjs");

test("fork prompt, system prompt and schema equal the server's", async () => {
  const p = buildPersona(5);
  for (const f of p.facts) await mem.addMemory({ content: f.text, category: f.category });
  for (const d of p.distractors.slice(0, 40)) await mem.addMemory({ content: d.text, category: "other" });
  const t = Date.now();
  const conv = db.prepare("INSERT INTO conversations(title, started_at, updated_at) VALUES ('t', ?, ?)").run(t, t).lastInsertRowid;
  const add = (role, text) => db.prepare("INSERT INTO messages(conversation_id, role, text, created_at) VALUES (?, ?, ?, ?)").run(conv, role, text, Date.now());
  const history = [];
  for (const ev of p.events.slice(0, 6)) {
    add("user", ev.text);
    calls.length = 0;
    await mem.extractFromConversation(conv);
    assert.equal(calls.length, 1);
    const c = calls[0];
    const cands = await mem.selectCandidates(ev.text, "default");
    assert.equal(c.system, EXTRACT_SYSTEM);
    assert.equal(c.prompt, buildPrompt(cands, [{ role: "user", text: ev.text }], history.slice(-6)));
    assert.deepEqual(c.schema, makeSchema(mem.CATEGORIES));
    history.push({ role: "user", text: ev.text });
  }
  fs.rmSync(scratch, { recursive: true, force: true });
});
