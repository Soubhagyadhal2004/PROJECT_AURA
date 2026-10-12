// SQLite storage for AURA. One local file: data/aura.db
// Uses Node's built-in SQLite module, so there is nothing native to compile.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./config.mjs";

fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_PATH = process.env.AURA_DB_PATH || path.join(DATA_DIR, "aura.db");
export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

/** better-sqlite3-style helper: db.transaction(fn)(...args) runs fn atomically. */
db.transaction = (fn) => (...args) => {
  db.exec("BEGIN");
  try {
    const out = fn(...args);
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  extracted_upto INTEGER NOT NULL DEFAULT 0  -- last message id processed by memory extraction
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  modality TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- status: active | superseded (replaced by a newer fact) | outdated (no longer true, no replacement)
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'fact',
  status TEXT NOT NULL DEFAULT 'active',
  superseded_by INTEGER REFERENCES memories(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'conversation',
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  embedding BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- changes to existing memories that wait for the user's OK
-- action: update | retire | forget; status: pending | accepted | rejected
CREATE TABLE IF NOT EXISTS memory_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  content TEXT,
  category TEXT,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS speaker_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  embedding BLOB NOT NULL,
  sample_seconds REAL NOT NULL,
  consent_note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  speaker_seq INTEGER NOT NULL DEFAULT 0  -- last N used for an automatic "Speaker N" label
);

-- one row per distinct voice detected in a meeting (a diarization cluster)
CREATE TABLE IF NOT EXISTS meeting_speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  label TEXT NOT NULL,              -- name shown in the transcript
  profile_id INTEGER REFERENCES speaker_profiles(id) ON DELETE SET NULL,
  match_score REAL,                 -- similarity to the registered profile, when matched
  renamed INTEGER NOT NULL DEFAULT 0,
  merged_into INTEGER,              -- set when the user merged this voice into another speaker
  centroid BLOB,
  n INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_id INTEGER REFERENCES meeting_speakers(id) ON DELETE SET NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT,
  speaker_score REAL,               -- similarity used for the speaker decision
  speaker_uncertain INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | error | empty
  error TEXT,
  audio BLOB                        -- raw 16 kHz PCM, cleared after processing
);
`);

// columns added after the first release
function addColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn("messages", "meta", "TEXT"); // JSON: web sources used for an answer
addColumn("conversations", "pinned", "INTEGER NOT NULL DEFAULT 0");
addColumn("speaker_profiles", "model", "TEXT"); // speaker model that produced the voiceprint
addColumn("segments", "embedding", "BLOB"); // voice embedding, used to refine speakers after a meeting
addColumn("segments", "manual", "INTEGER NOT NULL DEFAULT 0"); // speaker set by the user, never changed automatically
addColumn("meetings", "refined", "INTEGER NOT NULL DEFAULT 0"); // speakers re-checked after the meeting ended
addColumn("meetings", "minutes", "TEXT"); // JSON: minutes of meeting written by Gemini
addColumn("meetings", "minutes_at", "INTEGER");
// memory extraction from the transcript: NULL (not run) | running | done | error | off
addColumn("meetings", "memory_status", "TEXT");
addColumn("meetings", "memory_count", "INTEGER NOT NULL DEFAULT 0");
addColumn("meetings", "memory_error", "TEXT");
addColumn("memories", "meeting_id", "INTEGER REFERENCES meetings(id) ON DELETE SET NULL"); // learned from this meeting
addColumn("memory_proposals", "meeting_id", "INTEGER REFERENCES meetings(id) ON DELETE SET NULL");

export const now = () => Date.now();

export function f32ToBlob(arr) {
  if (!arr) return null;
  const f = arr instanceof Float32Array ? arr : Float32Array.from(arr);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

export function blobToF32(buf) {
  if (!buf) return null;
  const copy = new Uint8Array(buf); // fresh, aligned copy
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

/** BLOB column (Uint8Array) -> Buffer without copying. */
export const asBuffer = (u8) => (u8 ? Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength) : null);

// ---- settings ---------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  liveModel: "gemini-3.1-flash-live-preview",
  voice: "Kore",
  userName: "",
  autoMemory: true,
  // let the assistant use Google Search for current information
  webSearch: true,
  // ask before an existing memory is changed, marked outdated or deleted
  confirmMemoryChanges: true,
  // cosine similarity (WeSpeaker embeddings) needed to attach a registered name to a voice
  voiceMatchThreshold: 0.58,
  // cosine similarity needed to treat a piece of speech as an already-heard voice
  voiceClusterThreshold: 0.55,
  // optional hint for meeting transcription, e.g. "English and Hindi"
  meetingLanguage: "",
  // "live": Gemini 3.5 Transcribe Live (streaming, no daily request cap on the free tier)
  // "standard": batched requests to GEMINI_TRANSCRIBE_MODEL
  meetingTranscriber: "live",
  // after a meeting, store durable facts from its transcript in long-term memory (needs autoMemory too)
  meetingMemory: true,
};

export function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue; // keys from older versions
    try {
      s[r.key] = JSON.parse(r.value);
    } catch {}
  }
  return s;
}

export function saveSettings(patch) {
  const stmt = db.prepare(
    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = db.transaction((p) => {
    for (const [k, v] of Object.entries(p)) {
      if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v));
    }
  });
  tx(patch);
  return getSettings();
}
