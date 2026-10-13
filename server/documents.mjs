// Documents added to an assistant conversation: stored locally, read by Gemini, asked about by the assistant.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.mjs";
import { db, now } from "./db.mjs";
import { generateJSON, hasKey } from "./gemini.mjs";
import { classify, extractText } from "./doc-text.mjs";

export const DOCS_DIR = path.join(DATA_DIR, "documents");
fs.mkdirSync(DOCS_DIR, { recursive: true });

// Gemini takes at most ~20 MB per request including base64 overhead.
export const MAX_INLINE_BYTES = 14 * 1024 * 1024; // PDFs and images
export const MAX_FILE_BYTES = 30 * 1024 * 1024; // Office and text files (only their text is sent)
const MAX_TEXT_CHARS = 300_000; // ~75k tokens: keeps each question well inside the free-tier token limits

const httpError = (status, message) => Object.assign(new Error(message), { status });
const fileOf = (d) => path.join(DOCS_DIR, d.file);
const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

function toDoc(r) {
  if (!r) return null;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    name: r.name,
    kind: r.kind,
    label: r.label,
    size: r.size,
    status: r.status, // analysing | ready | error
    error: r.error || null,
    truncated: !!r.truncated,
    analysis: parse(r.analysis),
    createdAt: r.created_at,
  };
}

export const getDocument = (id) => toDoc(db.prepare("SELECT * FROM documents WHERE id = ?").get(id));
export const listDocuments = (conversationId) =>
  db.prepare("SELECT * FROM documents WHERE conversation_id = ? ORDER BY id").all(conversationId).map(toDoc);

/** Save an uploaded file, add a message for it to the conversation and start reading it. */
export function addDocument(conversationId, { name, body }) {
  const clean = String(name || "").replace(/[\\/]/g, "_").replace(/[\x00-\x1f]/g, "").trim().slice(0, 200);
  if (!clean) throw httpError(400, "The file needs a name.");
  if (!body?.length) throw httpError(400, "The file is empty.");
  const type = classify(clean);
  if (type.error) throw httpError(415, type.error);
  const inline = type.kind === "pdf" || type.kind === "image";
  const max = inline ? MAX_INLINE_BYTES : MAX_FILE_BYTES;
  if (body.length > max) throw httpError(413, `${clean} is ${(body.length / 1048576).toFixed(1)} MB. The limit for this type is ${max / 1048576} MB.`);

  let text = null;
  let truncated = 0;
  if (!inline) {
    try {
      text = extractText(clean, body);
    } catch (e) {
      throw httpError(422, `Couldn't read ${clean}: ${e.message}.`);
    }
    if (!text.trim()) throw httpError(422, `${clean} has no text in it.`);
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
      truncated = 1;
    }
  }

  const t = now();
  const id = Number(
    db
      .prepare(
        `INSERT INTO documents(conversation_id, name, kind, label, mime, size, file, text, truncated, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 'analysing', ?)`
      )
      .run(conversationId, clean, type.kind, type.label, type.mime, body.length, text, truncated, t).lastInsertRowid
  );
  const file = `${id}${path.extname(clean).toLowerCase() || ".bin"}`;
  fs.writeFileSync(path.join(DOCS_DIR, file), body);
  db.prepare("UPDATE documents SET file = ? WHERE id = ?").run(file, id);

  // the attachment shows up in the conversation like a message
  const meta = { document: { id, name: clean } };
  const msgId = db
    .prepare("INSERT INTO messages(conversation_id, role, modality, text, meta, created_at) VALUES (?, 'user', 'document', ?, ?, ?)")
    .run(conversationId, `Added a document: ${clean}`, JSON.stringify(meta), t).lastInsertRowid;
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(t, conversationId);

  queue(id);
  return {
    document: getDocument(id),
    message: { id: Number(msgId), role: "user", modality: "document", text: `Added a document: ${clean}`, createdAt: t, ...meta },
  };
}

/** What Gemini gets for a document: the file itself (PDF, image) or its text. */
function partsFor(row) {
  const header = { text: `Document ${row.id}: "${row.name}" (${row.label})${row.truncated ? " — only the first part of it, it was too long" : ""}` };
  if (row.kind === "pdf" || row.kind === "image") {
    return [header, { inlineData: { mimeType: row.mime, data: fs.readFileSync(fileOf(row)).toString("base64") } }];
  }
  return [header, { text: `<document id="${row.id}">\n${row.text}\n</document>` }];
}

// ---- first read: overview -----------------------------------------------------------------------

const ANALYSE_SYSTEM = `You read documents for a personal assistant and describe them briefly and accurately.
Use only what is in the document. Write in clear English (quote names and terms as written).
For an image, describe what it shows and transcribe any important text.`;

const ANALYSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The document's own title, or a short descriptive one" },
    doc_type: { type: "string", description: "What kind of document it is, e.g. 'rental agreement', 'invoice', 'lecture slides'" },
    overview: { type: "string", description: "2 to 4 sentences: what it is, who it is from or for, what it is about" },
    key_points: { type: "array", items: { type: "string" }, description: "Up to 6 of the most important facts, figures, dates or conclusions" },
    suggested_questions: { type: "array", items: { type: "string" }, description: "3 short questions the user might ask about this document" },
    pages: { type: "integer", description: "Number of pages or slides, if known" },
  },
  required: ["title", "doc_type", "overview", "key_points", "suggested_questions"],
};

const list = (a, n) => (Array.isArray(a) ? a.map((x) => String(x || "").trim()).filter(Boolean).slice(0, n) : []);

let chain = Promise.resolve();
function queue(id) {
  chain = chain.then(() => analyse(id)).catch(() => {});
  return chain;
}

async function analyse(id) {
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
  if (!row) return;
  try {
    if (!hasKey()) throw new Error("GEMINI_API_KEY is not set");
    const out = await generateJSON({
      system: ANALYSE_SYSTEM,
      parts: [...partsFor(row), { text: "Describe this document." }],
      schema: ANALYSE_SCHEMA,
    });
    const analysis = {
      title: String(out.title || "").trim() || row.name,
      docType: String(out.doc_type || "").trim() || null,
      overview: String(out.overview || "").trim(),
      keyPoints: list(out.key_points, 6),
      suggestedQuestions: list(out.suggested_questions, 3),
      pages: Number.isFinite(out.pages) && out.pages > 0 ? out.pages : null,
    };
    db.prepare("UPDATE documents SET status = 'ready', analysis = ?, error = NULL WHERE id = ?").run(JSON.stringify(analysis), id);
  } catch (e) {
    console.error(`[documents] reading ${row.name} failed:`, e.message);
    db.prepare("UPDATE documents SET status = 'error', error = ? WHERE id = ?").run(String(e.message).slice(0, 300), id);
  }
}

/** The stored original, for downloading. */
export function documentFile(id) {
  const row = db.prepare("SELECT name, file FROM documents WHERE id = ?").get(id);
  if (!row?.file || !fs.existsSync(fileOf(row))) return null;
  return { name: row.name, path: fileOf(row) };
}

export function retryDocument(id) {
  const d = getDocument(id);
  if (!d) throw httpError(404, "Not found");
  db.prepare("UPDATE documents SET status = 'analysing', error = NULL WHERE id = ?").run(id);
  queue(id);
  return getDocument(id);
}

// ---- questions --------------------------------------------------------------------------------

const ASK_SYSTEM = `You answer questions about the user's documents for a voice assistant.
Answer only from the documents provided. If the answer is not in them, say so plainly and set found to false; never guess or fill in from general knowledge.
Be concise and specific: give the actual figures, names, dates and wording. Mention the page, slide, sheet or section when you can.
Quote short exact passages in "quotes" to back the answer.`;

const ASK_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    found: { type: "boolean", description: "false when the documents don't contain the answer" },
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, where: { type: "string", description: "page, slide, sheet or section, if known" } },
        required: ["text"],
      },
    },
  },
  required: ["answer", "found"],
};

/**
 * Answer a question about one document, or about all readable documents in the conversation.
 * Returns what the assistant needs to reply.
 */
export async function askDocuments(conversationId, { question, documentId } = {}) {
  const q = String(question || "").trim();
  if (!q) throw httpError(400, "question required");
  let rows = db.prepare("SELECT * FROM documents WHERE conversation_id = ? AND status != 'error' ORDER BY id").all(conversationId);
  if (documentId) rows = rows.filter((r) => r.id === Number(documentId));
  if (!rows.length) {
    return { found: false, answer: documentId ? `There is no readable document ${documentId} in this conversation.` : "No documents have been added to this conversation." };
  }
  const inlineBytes = rows.filter((r) => r.kind === "pdf" || r.kind === "image").reduce((n, r) => n + r.size, 0);
  if (inlineBytes > MAX_INLINE_BYTES) {
    return {
      found: false,
      answer: "These documents are too large to read together. Ask about one of them at a time (pass its document_id).",
      documents: rows.map((r) => ({ id: r.id, name: r.name })),
    };
  }
  const parts = rows.flatMap(partsFor);
  parts.push({ text: `Question: ${q}` });
  const out = await generateJSON({ system: ASK_SYSTEM, parts, schema: ASK_SCHEMA });
  const quotes = Array.isArray(out.quotes)
    ? out.quotes
        .map((x) => ({ text: String(x?.text || "").trim(), where: String(x?.where || "").trim() || undefined }))
        .filter((x) => x.text)
        .slice(0, 4)
    : [];
  return {
    documents: rows.map((r) => ({ id: r.id, name: r.name })),
    found: out.found !== false,
    answer: String(out.answer || "").trim(),
    quotes,
    ...(rows.some((r) => r.truncated) ? { note: "A document was too long and only its first part was read." } : {}),
  };
}

// ---- deleting -----------------------------------------------------------------------------------

const unlink = (file) => {
  if (!file) return;
  try {
    fs.unlinkSync(path.join(DOCS_DIR, file));
  } catch {}
};

export function deleteDocument(id) {
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
  if (!row) return false;
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  unlink(row.file);
  return true;
}

/** Remove stored files whose document (or conversation) is gone. */
export function cleanUpFiles() {
  const keep = new Set(db.prepare("SELECT file FROM documents").all().map((r) => r.file));
  let n = 0;
  for (const f of fs.readdirSync(DOCS_DIR)) {
    if (!keep.has(f)) {
      unlink(f);
      n++;
    }
  }
  return n;
}

/** Documents interrupted by a restart are read again. */
export function resumeDocuments() {
  cleanUpFiles();
  for (const r of db.prepare("SELECT id FROM documents WHERE status = 'analysing' ORDER BY id").all()) queue(r.id);
}

/** For the assistant's instructions: the documents in this conversation. */
export function documentsForPrompt(conversationId) {
  return listDocuments(conversationId).map((d) => {
    const a = d.analysis;
    const what = a ? `${a.docType ? a.docType + ", " : ""}${a.overview}` : d.status === "error" ? `could not be read (${d.error})` : "still being read";
    return `- document_id ${d.id}: "${d.name}" (${d.label}) — ${what}`;
  });
}
