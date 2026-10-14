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
import * as notes from "./meeting-notes.mjs";
import * as docs from "./documents.mjs";
import { ACCEPT } from "./doc-text.mjs";
import * as proactive from "./proactive.mjs";

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
function sendDownload(res, { mime, ext, body, title }) {
  const safe = String(title || "export").replace(/[^\p{L}\p{N}\- ]+/gu, "").trim().replace(/\s+/g, "_").slice(0, 80) || "export";
  res.writeHead(200, {
    "Content-Type": `${mime}; charset=utf-8`,
    "Content-Disposition": `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, "_")}.${ext}"; filename*=UTF-8''${encodeURIComponent(safe)}.${ext}`,
  });
  res.end(body);
}

// ---- status / settings ---------------------------------------------------------------
app.get("/api/health", h(() => ({
  ok: true,
  hasKey: hasKey(),
  models: modelStatus,
  geminiModels: { text: TEXT_MODEL, transcribe: TRANSCRIBE_MODEL },
  meetingWorker: meet.workerState,
  memoryReviews: mem.pendingProposalCount(),
  dataDir: DATA_DIR,
})));
app.get("/api/settings", h(() => getSettings()));
app.put("/api/settings", h((req) => saveSettings(req.body || {})));

// ---- Gemini Live -------------------------------------------------------------------------
app.post("/api/live/token", h(() => createLiveToken()));

app.get("/api/live/setup", h((req) => {
  const s = getSettings();
  const memories = mem.coreMemories(30);
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const lines = memories.map((m) => `- ${m.content} (last confirmed ${day(m.updatedAt)})`);
  const systemInstruction = [
    `You are AURA (Adaptive Unified Responsive Assistant), a warm, concise personal assistant.`,
    `Keep spoken answers short and natural unless the user asks for detail.`,
    s.userName ? `The user's name is ${s.userName}.` : ``,
    `Right now it is ${notes.longDate(Date.now())} (time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    ``,
    `You have a long-term memory that persists between conversations. It is updated automatically in the background from what the user tells you; you do not need to promise to save anything.`,
    memories.length
      ? `What you currently know about the user (most recent first):\n${lines.join("\n")}`
      : `You do not know anything about the user yet.`,
    ``,
    `If the user asks about something personal that is not listed above, call the recall_memories tool before answering.`,
    `Never invent memories. If memories disagree, trust the most recently confirmed one and mention the change if relevant.`,
    ``,
    `The user records meetings with AURA's Meeting Mode. When they ask about a meeting (by date, a weekday like "last Wednesday", "yesterday", a topic or a person), call find_meetings with explicit dates you work out from the current date above, then call get_meeting for the one(s) that fit before answering questions about what was said, decided or assigned.`,
    `Base meeting answers only on what those tools return. If no meeting matches, say so. Speaker names in transcripts come from voice recognition and can be wrong.`,
    ``,
    `The user can add documents (PDF, Word, PowerPoint, Excel, text, images) to the conversation. For any question about a document's contents, call ask_document (with document_id, or without it to look across all of them) and answer from its result; you cannot see the documents yourself. If it says the answer isn't in the document, tell the user so. Mention page or section when the result gives it. Notes in square brackets starting with "[AURA app]" come from the app, not from the user.`,
    ``,
    s.webSearch
      ? `You can search the web with Google Search. Use it for news, current events, prices, scores, weather, schedules and anything else that may have changed recently or that you are unsure about. Mention the source briefly when you use search results. Do not use web search for questions about the user; use memory for those.`
      : `You cannot browse the web in this session. If the user asks about recent news or live information, say that web search is turned off in Settings.`,
  ].filter((l) => l !== null).join("\n");
  const convId = Number(req.query.conversation) || null;
  const earlier = convId ? conv.historyForPrompt(convId) : "";
  const docLines = convId ? docs.documentsForPrompt(convId) : [];
  let full = earlier
    ? `${systemInstruction}\n\nThe user is continuing an earlier conversation. What was said before (oldest first):\n${earlier}\n\nPick up naturally from there; don't repeat or summarise it unless asked.`
    : systemInstruction;
  if (docLines.length) full += `\n\nDocuments the user added to this conversation:\n${docLines.join("\n")}`;
  full += proactive.switches().reminders
    ? `\n\nReminders: when the user asks to be reminded of something (or to set a reminder or alarm), call set_reminder with what it is for and when, in their words (e.g. "tomorrow at 5pm", "in 20 minutes"). Then read back the exact day and time it returns and ask the user to confirm. Only after a clear yes, call confirm_reminder with the reminderId; if they say no or want a different time, call cancel_reminder (and set_reminder again for a new time). Never say a reminder is set unless confirm_reminder succeeded. When it is due, AURA shows the reminder in the app and reads it aloud (the AURA tab must be open); it cannot call the user's phone.`
    : `\n\nYou cannot set reminders, alarms or timers in this app. If asked, say so plainly and do not promise to remind the user.`;
  return {
    model: s.liveModel,
    voice: s.voice,
    systemInstruction: full,
    memoryCount: memories.length,
    webSearch: !!s.webSearch,
    reminders: proactive.switches().reminders, // the browser adds the reminder tools
    languageCodes: ASSISTANT_LANGUAGES[s.assistantLanguage] || [],
  };
}));

// Settings -> language codes for transcribing the user's speech in voice chat ([] = detect automatically)
const ASSISTANT_LANGUAGES = { auto: [], en: ["en-IN"], hi: ["hi-IN"], "en-hi": ["en-IN", "hi-IN"] };

// ---- conversations ----------------------------------------------------------------------
app.get("/api/conversations", h(() => conv.listConversations()));
app.post("/api/conversations", h(() => conv.createConversation()));
app.get("/api/conversations/:id", h((req) => {
  const c = conv.getConversation(id(req));
  if (!c) throw notFound();
  return { ...c, documents: docs.listDocuments(c.id) };
}));
app.post("/api/conversations/:id/messages", h((req) => {
  const { role, text, modality, sources, searchQueries } = req.body || {};
  if (!["user", "assistant"].includes(role) || !String(text || "").trim()) throw bad("role and text required");
  if (!conv.getConversation(id(req))) throw notFound();
  const meta = role === "assistant" ? conv.cleanSearchMeta({ sources, searchQueries }) : null;
  const m = conv.addMessage(id(req), { role, text: String(text).trim(), modality, meta });
  if (role === "assistant") mem.scheduleExtraction(id(req));
  if (role === "user") proactive.onUserMessage(id(req), m.text); // does nothing unless AURA_PROACTIVE_REMINDERS=1
  return m;
}));
app.post("/api/conversations/:id/end", h((req) => {
  mem.scheduleExtraction(id(req), 0);
  return { ok: true };
}));
app.patch("/api/conversations/:id", h((req) => conv.updateConversation(id(req), req.body || {}) || (() => { throw notFound(); })()));
app.get("/api/conversations/:id/export", (req, res) => {
  const out = conv.exportConversation(id(req), String(req.query.format || "md"));
  if (!out) throw notFound();
  sendDownload(res, out);
});
app.delete("/api/conversations/:id", h((req) => {
  const deleted = conv.deleteConversation(id(req));
  docs.cleanUpFiles(); // the conversation's documents went with it
  return { deleted };
}));
app.delete("/api/conversations", h(() => {
  const deleted = conv.deleteAllConversations();
  docs.cleanUpFiles();
  return { deleted };
}));

// ---- documents -----------------------------------------------------------------------------------
app.get("/api/documents/types", h(() => ({ accept: ACCEPT, maxInlineMB: docs.MAX_INLINE_BYTES / 1048576, maxFileMB: docs.MAX_FILE_BYTES / 1048576 })));
app.get("/api/conversations/:id/documents", h((req) => docs.listDocuments(id(req))));
app.post("/api/conversations/:id/documents", raw, h((req) => {
  if (!conv.getConversation(id(req))) throw notFound();
  return docs.addDocument(id(req), { name: req.query.name, body: req.body });
}));
app.post("/api/conversations/:id/documents/ask", h((req) => {
  const { question, documentId } = req.body || {};
  return docs.askDocuments(id(req), { question, documentId });
}));
app.get("/api/documents/:id", h((req) => docs.getDocument(id(req)) || (() => { throw notFound(); })()));
app.post("/api/documents/:id/retry", h((req) => docs.retryDocument(id(req))));
app.delete("/api/documents/:id", h((req) => ({ deleted: docs.deleteDocument(id(req)) })));
app.get("/api/documents/:id/file", (req, res) => {
  const file = docs.documentFile(id(req));
  if (!file) throw notFound();
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  });
  fs.createReadStream(file.path).pipe(res);
});

// ---- memory --------------------------------------------------------------------------------
app.get("/api/memories", h(() => mem.listMemories()));
app.get("/api/memories/search", h((req) => mem.searchMemories(String(req.query.q || ""), Number(req.query.k) || 6)));
app.get("/api/memories/activity", h(() => mem.extractionLog));
app.get("/api/memories/proposals", h(() => mem.listProposals()));
app.post("/api/memories/proposals/:id/accept", h(async (req) => (await mem.acceptProposal(id(req), req.body || {})) || (() => { throw notFound(); })()));
app.post("/api/memories/proposals/:id/reject", h((req) => ({ ok: mem.rejectProposal(id(req)) })));
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
  const replaceId = Number(req.query.replace) || null; // re-recording an existing profile
  return meet.enrollProfile({ name, pcm: req.body, replaceId, consentNote: `Consent confirmed in AURA on ${new Date().toISOString()}` });
}));
app.post("/api/speakers/identify", raw, h((req) => meet.identify(req.body)));
app.patch("/api/speakers/:id", h((req) => meet.renameProfile(id(req), String(req.body?.name || ""))));
app.delete("/api/speakers/:id", h((req) => ({ deleted: meet.deleteProfile(id(req)) })));

// ---- meetings ----------------------------------------------------------------------------------
app.get("/api/meetings", h(() => meet.listMeetings()));
app.post("/api/meetings", h((req) => meet.createMeeting(req.body?.title)));
app.delete("/api/meetings", h(() => ({ deleted: meet.deleteAllMeetings() })));
// before "/api/meetings/:id": date / topic lookup used by the assistant
app.get("/api/meetings/find", h((req) => {
  const num = (v) => (v == null || v === "" ? undefined : Number(v));
  return notes.findMeetings({ from: num(req.query.from), to: num(req.query.to), q: req.query.q, limit: Math.min(20, Number(req.query.limit) || 10) });
}));
app.get("/api/meetings/:id", h((req) => meet.getMeeting(id(req)) || (() => { throw notFound(); })()));
app.get("/api/meetings/:id/brief", h((req) => notes.meetingBrief(id(req)) || (() => { throw notFound(); })()));
app.post("/api/meetings/:id/minutes", h(async (req) => {
  const m = await notes.writeMinutes(id(req));
  proactive.onMinutes(m); // does nothing unless AURA_PROACTIVE_REMINDERS=1
  return m;
}));
app.delete("/api/meetings/:id/minutes", h((req) => notes.deleteMinutes(id(req))));
app.post("/api/meetings/:id/memorize", h(async (req) => {
  await notes.memorizeMeeting(id(req));
  return meet.getMeeting(id(req));
}));
app.patch("/api/meetings/:id", h((req) => meet.updateMeeting(id(req), req.body || {})));
app.delete("/api/meetings/:id", h((req) => ({ deleted: meet.deleteMeeting(id(req)) })));
app.post("/api/meetings/:id/segments", raw, h(async (req) => {
  if (!meet.getMeeting(id(req))) throw notFound();
  if (!req.body?.length) throw bad("audio body required");
  const piece = { startMs: Number(req.query.start) || 0, endMs: Number(req.query.end) || 0, pcm: req.body };
  if (req.query.live === "1") return { turns: await meet.addSegmentLive(id(req), piece) };
  return { id: meet.addSegment(id(req), piece) };
}));
app.post("/api/meetings/:id/segments/:segId/transcript", h((req) => {
  const { text, failed } = req.body || {};
  return { ok: meet.setLiveTranscript(id(req), id(req, "segId"), { text, failed: !!failed }) };
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
  sendDownload(res, { ...out, title: meet.getMeeting(id(req)).title || "meeting" });
});

// ---- proactive nudges (all off unless AURA_PROACTIVE_* is set; see server/proactive.mjs) -------------------
app.get("/api/proactive", h(() => {
  if (!proactive.anyOn()) return { switches: proactive.switches(), nudges: [], blocked: null };
  proactive.surface();
  return { switches: proactive.switches(), nudges: proactive.openNudges(), blocked: proactive.blockedReason() };
}));
app.post("/api/proactive/presence", h((req) => {
  proactive.setPresence({ voice: !!req.body?.voice });
  return { ok: true };
}));
app.post("/api/proactive/briefing", h(() => proactive.briefingNow()));
app.get("/api/proactive/stats", h(() => proactive.stats()));
// the voice assistant's reminder tools
app.post("/api/proactive/reminders", h((req) => proactive.requestReminder({ what: req.body?.what, when: req.body?.when, conversationId: Number(req.body?.conversationId) || null })));
app.post("/api/proactive/reminders/:id/confirm", h((req) => proactive.confirmReminder(id(req))));
app.post("/api/proactive/reminders/:id/cancel", h((req) => proactive.cancelReminder(id(req))));
app.post("/api/nudges/:id/decide", h((req) => proactive.decide(id(req), req.body || {})));

// ---- wipe everything -----------------------------------------------------------------------------
app.delete("/api/data", h(() => ({
  memories: mem.deleteAllMemories(),
  conversations: conv.deleteAllConversations(),
  meetings: meet.deleteAllMeetings(),
  profiles: meet.listProfiles().map((p) => meet.deleteProfile(p.id)).length,
  documents: docs.cleanUpFiles(),
  nudges: proactive.deleteAllNudges(),
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
      docs.resumeDocuments();
      proactive.startScheduler(); // only when an AURA_PROACTIVE_* switch is on
      if (process.env.AURA_NO_WARMUP !== "1") warmUp();
      resolve(server);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  start();
}
export { server };
