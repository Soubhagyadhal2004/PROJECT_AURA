// AURA local server: keeps the Gemini key, stores data in SQLite, runs local models.
// Plain node:http, no framework: the API is small.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PORT, ROOT_DIR, DATA_DIR, TEXT_MODEL, TRANSCRIBE_MODEL } from "./config.mjs";
import { getSettings, saveSettings } from "./db.mjs";
import { createLiveToken, hasKey } from "./gemini.mjs";
import { modelStatus, warmUp } from "./models.mjs";
import * as conv from "./conversations.mjs";
import * as mem from "./memory.mjs";
import * as meet from "./meetings.mjs";

// ---- tiny router ---------------------------------------------------------------------
const routes = [];
const add = (method) => (pattern, ...handlers) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
  routes.push({ method, re, keys, handler: handlers[handlers.length - 1], raw: handlers.length > 1 });
};
const app = { get: add("GET"), post: add("POST"), put: add("PUT"), patch: add("PATCH"), delete: add("DELETE") };
const raw = "raw"; // marker: handler wants the binary body

const MAX_BODY = 50 * 1024 * 1024;
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Request too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data ?? { ok: true });
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

// handler result -> JSON; thrown errors -> {error}
const h = (fn) => fn;
const id = (req, name = "id") => Number(req.params[name]);
const notFound = () => Object.assign(new Error("Not found"), { status: 404 });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// ---- status / settings ---------------------------------------------------------------
app.get("/api/health", h(() => ({
  ok: true,
  hasKey: hasKey(),
  models: modelStatus,
  geminiModels: { text: TEXT_MODEL, transcribe: TRANSCRIBE_MODEL },
  meetingWorker: meet.workerState,
  dataDir: DATA_DIR,
})));
app.get("/api/settings", h(() => getSettings()));
app.put("/api/settings", h((req) => saveSettings(req.body || {})));

// ---- Gemini Live -------------------------------------------------------------------------
app.post("/api/live/token", h(() => createLiveToken()));

app.get("/api/live/setup", h(() => {
  const s = getSettings();
  const memories = mem.coreMemories(30);
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const lines = memories.map((m) => `- ${m.content} (last confirmed ${day(m.updatedAt)})`);
  const systemInstruction = [
    `You are AURA (Adaptive Unified Responsive Assistant), a warm, concise personal assistant.`,
    `Keep spoken answers short and natural unless the user asks for detail.`,
    s.userName ? `The user's name is ${s.userName}.` : ``,
    `Today's date is ${new Date().toDateString()}.`,
    ``,
    `You have a long-term memory that persists between conversations. It is updated automatically in the background from what the user tells you; you do not need to promise to save anything.`,
    memories.length
      ? `What you currently know about the user (most recent first):\n${lines.join("\n")}`
      : `You do not know anything about the user yet.`,
    ``,
    `If the user asks about something personal that is not listed above, call the recall_memories tool before answering.`,
    `Never invent memories. If memories disagree, trust the most recently confirmed one and mention the change if relevant.`,
  ].filter((l) => l !== null).join("\n");
  return { model: s.liveModel, voice: s.voice, systemInstruction, memoryCount: memories.length };
}));

// ---- conversations ----------------------------------------------------------------------
app.get("/api/conversations", h(() => conv.listConversations()));
app.post("/api/conversations", h(() => conv.createConversation()));
app.get("/api/conversations/:id", h((req) => conv.getConversation(id(req)) || (() => { throw notFound(); })()));
app.post("/api/conversations/:id/messages", h((req) => {
  const { role, text, modality } = req.body || {};
  if (!["user", "assistant"].includes(role) || !String(text || "").trim()) throw bad("role and text required");
  if (!conv.getConversation(id(req))) throw notFound();
  const m = conv.addMessage(id(req), { role, text: String(text).trim(), modality });
  if (role === "assistant") mem.scheduleExtraction(id(req));
  return m;
}));
app.post("/api/conversations/:id/end", h((req) => {
  mem.scheduleExtraction(id(req), 0);
  return { ok: true };
}));
app.delete("/api/conversations/:id", h((req) => ({ deleted: conv.deleteConversation(id(req)) })));
app.delete("/api/conversations", h(() => ({ deleted: conv.deleteAllConversations() })));

// ---- memory --------------------------------------------------------------------------------
app.get("/api/memories", h(() => mem.listMemories()));
app.get("/api/memories/search", h((req) => mem.searchMemories(String(req.query.q || ""), Number(req.query.k) || 6)));
app.get("/api/memories/activity", h(() => mem.extractionLog));
app.post("/api/memories", h((req) => {
  const { content, category } = req.body || {};
  if (!String(content || "").trim()) throw bad("content required");
  return mem.addMemory({ content, category, source: "manual" });
}));
app.patch("/api/memories/:id", h(async (req) => (await mem.editMemory(id(req), req.body || {})) || (() => { throw notFound(); })()));
app.delete("/api/memories/:id", h((req) => ({ deleted: mem.deleteMemory(id(req)) })));
app.delete("/api/memories", h(() => ({ deleted: mem.deleteAllMemories() })));
app.post("/api/memories/extract/:id", h((req) => mem.extractFromConversation(id(req))));

// ---- voice profiles ------------------------------------------------------------------------
app.get("/api/speakers", h(() => meet.listProfiles()));
app.post("/api/speakers", raw, h((req) => {
  const name = String(req.query.name || "").trim();
  const consent = String(req.query.consent || "");
  if (!name) throw bad("name required");
  if (consent !== "yes") throw bad("The speaker must agree to voice enrollment.");
  return meet.enrollProfile({ name, pcm: req.body, consentNote: `Consent confirmed in AURA on ${new Date().toISOString()}` });
}));
app.post("/api/speakers/identify", raw, h((req) => meet.identify(req.body)));
app.patch("/api/speakers/:id", h((req) => meet.renameProfile(id(req), String(req.body?.name || ""))));
app.delete("/api/speakers/:id", h((req) => ({ deleted: meet.deleteProfile(id(req)) })));

// ---- meetings ----------------------------------------------------------------------------------
app.get("/api/meetings", h(() => meet.listMeetings()));
app.post("/api/meetings", h((req) => meet.createMeeting(req.body?.title)));
app.delete("/api/meetings", h(() => ({ deleted: meet.deleteAllMeetings() })));
app.get("/api/meetings/:id", h((req) => meet.getMeeting(id(req)) || (() => { throw notFound(); })()));
app.patch("/api/meetings/:id", h((req) => meet.updateMeeting(id(req), req.body || {})));
app.delete("/api/meetings/:id", h((req) => ({ deleted: meet.deleteMeeting(id(req)) })));
app.post("/api/meetings/:id/segments", raw, h((req) => {
  if (!meet.getMeeting(id(req))) throw notFound();
  if (!req.body?.length) throw bad("audio body required");
  return { id: meet.addSegment(id(req), { startMs: Number(req.query.start) || 0, endMs: Number(req.query.end) || 0, pcm: req.body }) };
}));
app.post("/api/meetings/:id/retry", h((req) => ({ requeued: meet.retryFailed(id(req)) })));
app.patch("/api/meetings/:id/speakers/:sid", h((req) => meet.renameSpeaker(id(req), id(req, "sid"), String(req.body?.label || ""))));
app.post("/api/meetings/:id/speakers/:sid/merge", h((req) => meet.mergeSpeakers(id(req), id(req, "sid"), Number(req.body?.into))));
app.patch("/api/meetings/:id/segments/:segId", h((req) => {
  const b = req.body || {};
  if (typeof b.text === "string") meet.editSegmentText(id(req), id(req, "segId"), b.text);
  if (b.speakerId || b.newLabel) meet.reassignSegment(id(req), id(req, "segId"), { speakerId: b.speakerId ? Number(b.speakerId) : null, newLabel: b.newLabel });
  return meet.getMeeting(id(req));
}));
app.get("/api/meetings/:id/export", (req, res) => {
  const out = meet.exportMeeting(id(req), String(req.query.format || "txt"));
  if (!out) throw notFound();
  const safe = (meet.getMeeting(id(req)).title || "meeting").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "meeting";
  res.writeHead(200, {
    "Content-Type": `${out.mime}; charset=utf-8`,
    "Content-Disposition": `attachment; filename="${safe}.${out.ext}"`,
  });
  res.end(out.body);
});

// ---- wipe everything -----------------------------------------------------------------------------
app.delete("/api/data", h(() => ({
  memories: mem.deleteAllMemories(),
  conversations: conv.deleteAllConversations(),
  meetings: meet.deleteAllMeetings(),
  profiles: meet.listProfiles().map((p) => meet.deleteProfile(p.id)).length,
})));

// ---- static production build (npm run build && npm run serve) -------------------------------------
const BUILD = path.join(ROOT_DIR, "build");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".map": "application/json" };
function serveStatic(req, res, pathname) {
  if (!fs.existsSync(path.join(BUILD, "index.html"))) return false;
  let file = path.normalize(path.join(BUILD, decodeURIComponent(pathname)));
  if (!file.startsWith(BUILD) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(BUILD, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
  return true;
}

// ---- server ------------------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  req.query = Object.fromEntries(url.searchParams);
  try {
    if (!url.pathname.startsWith("/api/")) {
      if (req.method === "GET" && serveStatic(req, res, url.pathname)) return;
      throw notFound();
    }
    let route = null;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (m) {
        route = r;
        req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        break;
      }
    }
    if (!route) throw Object.assign(new Error("Unknown endpoint"), { status: 404 });
    const body = await readBody(req);
    if (route.raw) req.body = body;
    else if (body.length) {
      try {
        req.body = JSON.parse(body.toString("utf8"));
      } catch {
        throw bad("Invalid JSON body");
      }
    } else req.body = {};
    const out = await route.handler(req, res);
    if (!res.headersSent) sendJSON(res, 200, out);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(`[api] ${req.method} ${url.pathname}:`, e.message);
    if (!res.headersSent) sendJSON(res, e.status || 500, { error: e.message || "Server error" });
  }
});

export function start(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`[aura] server on http://localhost:${port}  (data: ${DATA_DIR})`);
      if (!hasKey()) console.warn("[aura] GEMINI_API_KEY is missing - add it to .env (see README).");
      if (process.env.REACT_APP_GEMINI_API_KEY)
        console.warn("[aura] REACT_APP_GEMINI_API_KEY is set: rename it to GEMINI_API_KEY so the key is never bundled into the web app.");
      meet.resumePending();
      if (process.env.AURA_NO_WARMUP !== "1") warmUp();
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start();
}
export { server };
