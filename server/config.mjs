import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// load .env.local then .env (values already in the environment win)
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT_DIR, f);
  if (fs.existsSync(p)) process.loadEnvFile(p);
}

export const DATA_DIR = process.env.AURA_DATA_DIR
  ? path.resolve(process.env.AURA_DATA_DIR)
  : path.join(ROOT_DIR, "data");

export const PORT = Number(process.env.AURA_PORT || 3001);

// The key stays on the server. The browser only ever receives short-lived
// ephemeral tokens for Gemini Live.
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// Gemini models used by the server (text + audio understanding).
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest";
export const TRANSCRIBE_MODEL =
  process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-flash-lite-latest";

// Local models (downloaded once from the Hugging Face hub, then run on this machine).
export const TEXT_EMBED_MODEL =
  process.env.AURA_TEXT_EMBED_MODEL || "Xenova/all-MiniLM-L6-v2";
export const SPEAKER_MODEL =
  process.env.AURA_SPEAKER_MODEL || "Xenova/wavlm-base-plus-sv";
export const MODEL_CACHE_DIR = path.join(DATA_DIR, "models");
