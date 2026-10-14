// Opens AURA's real server modules on a throw-away database in a temporary folder.
// Your own data/aura.db is never opened: the run refuses to start unless the database path is inside
// the new temporary folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(EVAL_DIR, "..");
const TEXT_MODEL_REL = path.join("models", "Xenova", "all-MiniLM-L6-v2");

/**
 * clock: "fake" (default) makes Date.now() tick 1 ms per call from a fixed start, so runs are exactly
 * repeatable (AURA orders memories by millisecond timestamps, and ties would otherwise depend on timing).
 * Real-model runs use clock: "real" (request pacing and latency need real time).
 */
export async function openIsolated({ clock = "fake" } = {}) {
  if (clock === "fake") {
    let t = Date.UTC(2026, 9, 13, 0, 0, 0);
    Date.now = () => ++t;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-eval-"));
  // the local embedding model is copied from the project's model cache (no download)
  const src = path.join(process.env.AURA_EVAL_MODEL_DIR || path.join(ROOT, "data"), TEXT_MODEL_REL);
  if (!fs.existsSync(path.join(src, "onnx"))) {
    throw new Error(`The local embedding model was not found at ${src}. Start AURA once so it downloads its models.`);
  }
  fs.cpSync(src, path.join(dir, TEXT_MODEL_REL), { recursive: true });

  process.env.AURA_DATA_DIR = dir;
  process.env.AURA_NO_WARMUP = "1";
  delete process.env.AURA_DB_PATH;

  // the app logs every extraction; keep the evaluation's own output readable
  if (!process.env.AURA_EVAL_VERBOSE) {
    const log = console.log;
    console.log = (...x) => {
      if (typeof x[0] === "string" && x[0].startsWith("[memory]")) return;
      log(...x);
    };
  }

  const config = await import("../../server/config.mjs");
  const dbm = await import("../../server/db.mjs");
  const inside = (p) => path.resolve(p).startsWith(path.resolve(dir) + path.sep);
  if (path.resolve(config.DATA_DIR) !== path.resolve(dir) || !inside(dbm.DB_PATH)) {
    throw new Error(`Refusing to run: the database (${dbm.DB_PATH}) is not inside the temporary folder ${dir}.`);
  }
  // throw-away database: skip waiting for the disk on every write (results are unaffected)
  dbm.db.exec("PRAGMA synchronous = OFF; PRAGMA journal_mode = MEMORY;");
  const mem = await import("../../server/memory.mjs");
  const models = await import("./cached-models.mjs");
  const gem = await import("./proxy-gemini.mjs");

  return {
    dir,
    config,
    db: dbm.db,
    f32ToBlob: dbm.f32ToBlob,
    saveSettings: dbm.saveSettings,
    mem,
    models,
    gem,
    reset() {
      dbm.db.exec("DELETE FROM memory_proposals; DELETE FROM memories; DELETE FROM messages; DELETE FROM conversations; DELETE FROM settings;");
    },
    cleanup() {
      try {
        dbm.db.close();
      } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
