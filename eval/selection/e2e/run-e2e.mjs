// End-to-end run with a real extractor: selection condition x policy, oracle reviewer, per-turn logs.
// Run from the repository root on a machine that can reach the Gemini API (key from .env):
//   node --no-warnings eval/selection/e2e/run-e2e.mjs
//   node --no-warnings eval/selection/e2e/run-e2e.mjs --dry --personas 2     (fake model, no API calls)
// Options: --personas 8 --start 0 --N 100 --conditions default,adaptive,nomin_k24,oracle_target --policies gate
//          --rpm 12 (pace requests) --out eval/results/selection/e2e/<name>
// Resumable: finished (persona, condition, policy) runs are listed in done.jsonl and skipped on restart.
// The real database (data/aura.db) is never opened: a scratch data folder is used.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const has = (n) => process.argv.includes(`--${n}`);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8"));
const reachCfg = JSON.parse(fs.readFileSync(path.join(HERE, "..", "config.json"), "utf8"));
const DRY = has("dry");
const nPersonas = Number(arg("personas", cfg.personas));
const start = Number(arg("start", 0));
const N = Number(arg("N", cfg.storeSize));
const RPM = Number(arg("rpm", 0));
const conditions = arg("conditions", cfg.conditions.join(",")).split(",");
const policies = arg("policies", cfg.policies.join(",")).split(",");
const outDir = path.resolve(ROOT, arg("out", `eval/results/selection/e2e/${DRY ? "dry" : "pilot"}`));
fs.mkdirSync(outDir, { recursive: true });

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aura-e2e-"));
fs.cpSync(path.join(ROOT, "data", "models", "Xenova"), path.join(scratch, "models", "Xenova"), { recursive: true });
process.env.AURA_DATA_DIR = scratch;
delete process.env.AURA_CANDIDATES;
delete process.env.AURA_EXTRACT_MIN_SCORE;
delete process.env.AURA_REPROPOSE;

const mem = await import(pathToFileURL(path.join(ROOT, "server", "memory.mjs")).href);
const { db } = await import(pathToFileURL(path.join(ROOT, "server", "db.mjs")).href);
const gem = await import(pathToFileURL(path.join(ROOT, "server", "gemini.mjs")).href);
const { TEXT_MODEL } = await import(pathToFileURL(path.join(ROOT, "server", "config.mjs")).href);
const { buildPersona, rng, FILLERS } = await import("../testset.mjs");
const { selectFromRankings, splitSentences } = await import("../select.mjs");
const { EXTRACT_SYSTEM, makeSchema, buildPrompt, applyOps } = await import("./extract_fork.mjs");
const SCHEMA = makeSchema(mem.CATEGORIES);

if (!DRY && !gem.hasKey()) {
  console.error("GEMINI_API_KEY is not set (.env in the repository root). Use --dry to test without the API.");
  process.exit(1);
}

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const manPath = path.join(outDir, "manifest.json");
const manifest = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, "utf8")) : { runs: [] };
manifest.runs.push({
  startedAt: new Date().toISOString(), dry: DRY, model: DRY ? "fake (rule-based)" : TEXT_MODEL, temperature: 0.1,
  node: process.version, platform: `${process.platform}-${process.arch}`,
  serverMemorySha256: sha(path.join(ROOT, "server", "memory.mjs")), serverGeminiSha256: sha(path.join(ROOT, "server", "gemini.mjs")),
  args: process.argv.slice(2), personas: nPersonas, start, N, conditions, policies, config: cfg,
});
fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));

const donePath = path.join(outDir, "done.jsonl");
const done = new Set(fs.existsSync(donePath) ? fs.readFileSync(donePath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).key) : []);
const turnsOut = fs.createWriteStream(path.join(outDir, "turns.jsonl"), { flags: "a" });
const finalOut = fs.createWriteStream(path.join(outDir, "final_state.jsonl"), { flags: "a" });
const doneOut = fs.createWriteStream(donePath, { flags: "a" });

const NEW_FACTS = ["My favourite colour is teal.", "I have a meeting with the bank on Friday.", "I enjoy listening to old Kishore Kumar songs.",
  "My best friend is called Ishaan.", "I am allergic to cats.", "I prefer tea in the evening."];

/** One change per slot (forms and contexts balanced), plus no-op and new-fact turns; same order for every condition. */
function schedule(persona) {
  const r = rng(persona.seed * 31 + 7);
  const turns = [];
  persona.facts.forEach((f, i) => {
    const evs = persona.events.filter((e) => e.slot === f.slot);
    const kinds = [...new Set(evs.map((e) => e.kind))];
    const kind = kinds[Math.floor(r() * kinds.length)];
    const form = (i + persona.seed) % 2 ? "cue" : "free";
    const context = Math.floor((i + persona.seed) / 2) % 2 ? "mixed" : "single";
    turns.push({ type: "change", ev: evs.find((e) => e.kind === kind && e.form === form && e.context === context) });
  });
  for (let i = 0; i < cfg.noopTurns; i++) {
    const a = FILLERS[Math.floor(r() * FILLERS.length)];
    let b = FILLERS[Math.floor(r() * FILLERS.length)];
    while (b === a) b = FILLERS[Math.floor(r() * FILLERS.length)];
    turns.push({ type: "noop", text: `${a} ${b}` });
  }
  for (let i = 0; i < cfg.newFactTurns; i++) turns.push({ type: "newfact", text: NEW_FACTS[(persona.seed + i) % NEW_FACTS.length] });
  for (let i = turns.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [turns[i], turns[j]] = [turns[j], turns[i]];
  }
  return turns;
}

/** Rule-based stand-in for the model, used only with --dry to test the harness. */
function fakeGenerate(prompt, turn, targetId, persona, r) {
  if (turn.type !== "change") return { operations: turn.type === "newfact" && r() < 0.8 ? [{ action: "add", content: "The user said: " + turn.text, category: "other" }] : [] };
  const ev = turn.ev;
  const shown = prompt.includes(`[${targetId}] `);
  const ops = [];
  const slotFact = persona.facts.find((f) => f.slot === ev.slot);
  if (shown) {
    if (ev.kind === "update") ops.push({ action: "update", memory_id: targetId, content: slotFact.text.replace(ev.oldValue, ev.newValue), category: slotFact.category });
    else ops.push({ action: ev.kind, memory_id: targetId });
  } else if (ev.kind === "update") ops.push({ action: "add", content: slotFact.text.replace(ev.oldValue, ev.newValue), category: slotFact.category });
  if (r() < 0.15) {
    const ids = [...prompt.matchAll(/^\[(\d+)\] /gm)].map((m) => Number(m[1])).filter((id) => id !== targetId);
    if (ids.length) ops.push({ action: "retire", memory_id: ids[Math.floor(r() * ids.length)] });
  }
  return { operations: ops };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
const setTime = db.prepare("UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?");
const statusOf = () => new Map(db.prepare("SELECT id, status FROM memories").all().map((x) => [x.id, x.status]));
const rowsNow = () => db.prepare("SELECT id, content, status, superseded_by FROM memories ORDER BY id").all();
const mentions = (text, v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);

async function runOne(persona, cond, policy) {
  const buf = []; // turn records are written only if the whole run had no error (see the main loop)
  mem.deleteAllMemories();
  db.prepare("DELETE FROM memory_proposals").run();
  let clock = 1;
  const slotRow = {};
  const factRowIds = new Set();
  const order = persona.facts.map((f, i) => i).sort((a, b) => ((a * 7 + persona.seed) % 12) - ((b * 7 + persona.seed) % 12));
  for (const i of order) {
    const f = persona.facts[i];
    const m = await mem.addMemory({ content: f.text, category: f.category, source: "conversation" });
    setTime.run(clock, clock, m.id);
    clock++;
    slotRow[f.slot] = m.id;
    factRowIds.add(m.id);
  }
  const seen = new Set(Object.values(slotRow));
  for (let i = 0; i < N; i++) {
    const m = await mem.addMemory({ content: persona.distractors[i].text, category: "other", source: "conversation" });
    if (!seen.has(m.id)) { setTime.run(clock, clock, m.id); clock++; seen.add(m.id); }
  }
  const truth = Object.fromEntries(persona.facts.map((f) => [f.slot, { state: "value", value: f.value, old: [] }]));
  const changedSlots = new Set();
  const r = rng(persona.seed * 101 + conditions.indexOf(cond) * 7 + policies.indexOf(policy));
  const history = [];
  const turns = schedule(persona);
  for (let t = 0; t < turns.length; t++) {
    const turn = turns[t];
    const text = turn.type === "change" ? turn.ev.text : turn.text;
    const targetId = turn.type === "change" ? slotRow[turn.ev.slot] : null;
    const rec = { persona: persona.id, cond, policy, turn: t, type: turn.type, text, targetId };
    if (turn.type === "change") Object.assign(rec, { event: turn.ev.id, slot: turn.ev.slot, kind: turn.ev.kind, form: turn.ev.form, context: turn.ev.context, cue: turn.ev.cue, newValue: turn.ev.newValue, oldValue: turn.ev.oldValue });
    try {
      let cands;
      if (cond === "default" || cond === "adaptive") cands = await mem.selectCandidates(text, cond);
      else if (cond === "oracle_target") {
        cands = await mem.selectCandidates(text, "default");
        const tgt = targetId && mem.getMemory(targetId);
        if (tgt && tgt.status === "active" && !cands.some((c) => c.id === targetId)) cands = [...cands, tgt];
      } else {
        const cache = new Map();
        for (const q of new Set([text, ...splitSentences(text)])) cache.set(q, await mem.searchMemories(q, 1e9, { minScore: -Infinity }));
        const recent = mem.coreMemories(8);
        const sel = selectFromRankings(text, reachCfg.conditions[cond], (q) => cache.get(q), recent);
        const byId = new Map([...cache.values()].flat().map((m) => [m.id, m]));
        for (const m of recent) byId.set(m.id, m);
        cands = sel.candidates.map((id) => byId.get(id));
      }
      rec.candidateIds = cands.map((c) => c.id);
      rec.nCand = cands.length;
      rec.reach = targetId ? (rec.candidateIds.includes(targetId) ? 1 : 0) : null;
      const prompt = buildPrompt(cands, [{ role: "user", text }], history.slice(-6));
      if (RPM && !DRY) {
        const wait = lastCall + 60000 / RPM - Date.now();
        if (wait > 0) await sleep(wait);
        lastCall = Date.now();
      }
      const u0 = { ...gem.usage };
      const t0 = Date.now();
      const out = DRY ? fakeGenerate(prompt, turn, targetId, persona, r) : await gem.generateJSON({ system: EXTRACT_SYSTEM, prompt, schema: SCHEMA });
      rec.latencyMs = Date.now() - t0;
      rec.promptTokens = gem.usage.promptTokens - u0.promptTokens;
      rec.outputTokens = gem.usage.outputTokens - u0.outputTokens;
      rec.promptChars = prompt.length + EXTRACT_SYSTEM.length;
      rec.rawOps = out.operations || [];
      const before0 = statusOf();
      rec.applied = await applyOps(mem, out.operations, cands, policy, { source: "conversation", conversationId: null, meetingId: null });
      rec.decisions = [];
      if (policy === "gate") {
        for (const p of mem.listProposals()) {
          let ok = false;
          if (turn.type === "change" && p.memoryId === targetId && p.action === turn.ev.kind) ok = p.action !== "update" || mentions(p.content || "", turn.ev.newValue);
          if (ok) await mem.acceptProposal(p.id);
          else mem.rejectProposal(p.id);
          rec.decisions.push({ proposalId: p.id, memoryId: p.memoryId, action: p.action, content: p.content, decision: ok ? "accepted" : "rejected" });
        }
      }
      const after = statusOf();
      const changed = [];
      for (const [id, st] of before0) if (after.get(id) !== st) changed.push({ id, from: st, to: after.get(id) ?? "deleted" });
      rec.changedRows = changed;
      rec.collateral = changed.filter((c) => c.id !== targetId).map((c) => ({ ...c, personaFact: factRowIds.has(c.id) }));
      rec.added = [...after.keys()].filter((id) => !before0.has(id));
      if (turn.type === "change") {
        const ts = after.get(targetId) ?? "deleted";
        rec.targetAfter = ts;
        const active = rowsNow().filter((x) => x.status === "active");
        if (turn.ev.kind === "update") {
          rec.newValueActive = active.some((x) => mentions(x.content, turn.ev.newValue)) ? 1 : 0;
          rec.success = ts !== "active" && rec.newValueActive ? 1 : 0;
          rec.conflict = ts === "active" && rec.newValueActive ? 1 : 0;
        } else if (turn.ev.kind === "retire") rec.success = ts !== "active" ? 1 : 0;
        else rec.success = ts === "deleted" ? 1 : 0;
        rec.missed = ts === "active" ? 1 : 0;
        if (turn.ev.kind === "update" && ts === "superseded") {
          const row = db.prepare("SELECT superseded_by FROM memories WHERE id = ?").get(targetId);
          if (row?.superseded_by) slotRow[turn.ev.slot] = row.superseded_by;
        }
        const tr = truth[turn.ev.slot];
        tr.old.push(tr.value);
        if (turn.ev.kind === "update") tr.value = turn.ev.newValue;
        else { tr.state = turn.ev.kind === "retire" ? "retired" : "forgotten"; tr.value = null; }
        changedSlots.add(turn.ev.slot);
      }
    } catch (e) {
      rec.error = String(e?.message || e);
    }
    history.push({ role: "user", text });
    buf.push(rec);
  }
  const rows = rowsNow();
  const active = rows.filter((x) => x.status === "active");
  const slots = {};
  for (const f of persona.facts) {
    const tr = truth[f.slot];
    const stale = active.some((x) => tr.old.some((v) => mentions(x.content, v)) && !(tr.value && mentions(x.content, tr.value)));
    const hasTrue = tr.value ? active.some((x) => mentions(x.content, tr.value)) : null;
    slots[f.slot] = { state: tr.state, value: tr.value, stale: stale ? 1 : 0, hasTrue: hasTrue == null ? null : hasTrue ? 1 : 0, changed: changedSlots.has(f.slot) };
  }
  const errors = buf.filter((r) => r.error).length;
  if (errors === 0) {
    for (const r of buf) turnsOut.write(JSON.stringify(r) + "\n");
    finalOut.write(JSON.stringify({ persona: persona.id, cond, policy, slots, rows }) + "\n");
  } else {
    fs.appendFileSync(path.join(outDir, "failed_turns.jsonl"), buf.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return { errors, firstError: buf.find((r) => r.error)?.error };
}

const tStart = Date.now();
for (let p = start; p < start + nPersonas; p++) {
  // same generator settings as the selection study, so events are identical; the first N distractors are used
  const persona = buildPersona(reachCfg.personaSeedStart + p, { maxDistractors: Math.max(...reachCfg.storeSizes), similarShare: reachCfg.similarDistractorShare });
  outer: for (const cond of conditions)
    for (const policy of policies) {
      const key = `${persona.id}|${cond}|${policy}|N${N}`;
      if (done.has(key)) continue;
      const res = await runOne(persona, cond, policy);
      if (res.errors > 0) {
        console.log(`${key} FAILED: ${res.errors} turn(s) with an error (${String(res.firstError).slice(0, 120)}). Not saved, not marked done. Stopping; wait for the quota to reset and run the same command again.`);
        process.exitCode = 2;
        break outer;
      }
      doneOut.write(JSON.stringify({ key, at: new Date().toISOString() }) + "\n");
      console.log(`${key} done (${((Date.now() - tStart) / 1000).toFixed(0)} s, ${gem.usage.calls} model calls, ${gem.usage.promptTokens} prompt tokens)`);
    }
}
await Promise.all([turnsOut, finalOut, doneOut].map((s) => new Promise((r) => s.end(r))));
const last = manifest.runs[manifest.runs.length - 1];
Object.assign(last, { finishedAt: new Date().toISOString(), modelCalls: gem.usage.calls, promptTokens: gem.usage.promptTokens, outputTokens: gem.usage.outputTokens });
fs.writeFileSync(manPath, JSON.stringify(manifest, null, 2));
try { db.close(); } catch {}
try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { console.log(`note: could not remove the temporary folder ${scratch} (Windows keeps the database file open); results are complete`); }
console.log("done");
