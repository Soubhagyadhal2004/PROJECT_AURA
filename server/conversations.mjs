// Conversation history (assistant chats) stored in SQLite.
import { db, now } from "./db.mjs";

export function createConversation() {
  const t = now();
  const id = db.prepare("INSERT INTO conversations(started_at, updated_at) VALUES (?, ?)").run(t, t).lastInsertRowid;
  return getConversation(id);
}

export function listConversations() {
  return db
    .prepare(
      `SELECT c.id, c.title, c.started_at, c.updated_at, c.pinned,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n,
              (SELECT text FROM messages m WHERE m.conversation_id = c.id AND role = 'user' AND modality != 'document' ORDER BY id LIMIT 1) AS first_user,
              (SELECT name FROM documents d WHERE d.conversation_id = c.id ORDER BY id LIMIT 1) AS first_doc
       FROM conversations c ORDER BY c.pinned DESC, c.updated_at DESC`
    )
    .all()
    .filter((c) => c.n > 0)
    .map((c) => ({
      id: c.id,
      title: c.title || (c.first_user || c.first_doc || "Conversation").slice(0, 60),
      startedAt: c.started_at,
      updatedAt: c.updated_at,
      messageCount: c.n,
      pinned: !!c.pinned,
      renamed: !!c.title,
    }));
}

export function getConversation(id) {
  const c = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!c) return null;
  const messages = db
    .prepare("SELECT id, role, modality, text, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY id")
    .all(id)
    .map((m) => ({ id: m.id, role: m.role, modality: m.modality, text: m.text, createdAt: m.created_at, ...parseMeta(m.meta) }));
  const firstUser = messages.find((m) => m.role === "user" && m.modality !== "document")?.text;
  const firstDoc = messages.find((m) => m.modality === "document")?.document?.name;
  return {
    id: c.id,
    title: c.title || (firstUser || firstDoc || "Conversation").slice(0, 60),
    renamed: !!c.title,
    pinned: !!c.pinned,
    startedAt: c.started_at,
    updatedAt: c.updated_at,
    messages,
  };
}

function parseMeta(meta) {
  if (!meta) return {};
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
}

/** Keep only the web-search details we show: source links and the queries used. */
export function cleanSearchMeta(input) {
  if (!input || typeof input !== "object") return null;
  const sources = Array.isArray(input.sources)
    ? input.sources
        .filter((s) => s && /^https?:\/\//.test(String(s.uri || "")))
        .slice(0, 12)
        .map((s) => ({ title: String(s.title || s.uri).slice(0, 200), uri: String(s.uri).slice(0, 2000) }))
    : [];
  const searchQueries = Array.isArray(input.searchQueries) ? input.searchQueries.slice(0, 8).map((q) => String(q).slice(0, 300)) : [];
  if (!sources.length && !searchQueries.length) return null;
  return { sources, searchQueries };
}

export function addMessage(conversationId, { role, text, modality = "text", meta = null }) {
  const t = now();
  const id = db
    .prepare("INSERT INTO messages(conversation_id, role, modality, text, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(conversationId, role, modality, String(text), meta ? JSON.stringify(meta) : null, t).lastInsertRowid;
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(t, conversationId);
  return { id: Number(id), role, modality, text, createdAt: t, ...(meta || {}) };
}

export function recentMessages(conversationId, limit = 20) {
  return db
    .prepare("SELECT role, text FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?")
    .all(conversationId, limit)
    .reverse();
}

export function deleteConversation(id) {
  return db.prepare("DELETE FROM conversations WHERE id = ?").run(id).changes > 0;
}

export function deleteAllConversations() {
  return db.prepare("DELETE FROM conversations").run().changes;
}

export function updateConversation(id, { title, pinned }) {
  if (title !== undefined) {
    const t = String(title ?? "").trim().slice(0, 120);
    db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(t || null, id); // empty = automatic title
  }
  if (pinned !== undefined) db.prepare("UPDATE conversations SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
  return getConversation(id);
}

/** Earlier messages, formatted for the assistant when a conversation is continued. */
export function historyForPrompt(id, maxChars = 8000) {
  const rows = db.prepare("SELECT role, text FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 60").all(id);
  const lines = [];
  let used = 0;
  for (const r of rows) {
    const line = `${r.role === "user" ? "User" : "AURA"}: ${r.text}`;
    if (used + line.length > maxChars) break;
    lines.unshift(line);
    used += line.length;
  }
  return lines.join("\n");
}

export function exportConversation(id, format) {
  const c = getConversation(id);
  if (!c) return null;
  const who = (m) => (m.role === "user" ? "You" : "AURA");
  const when = (t) => new Date(t).toLocaleString();
  if (format === "json") {
    return {
      mime: "application/json",
      ext: "json",
      title: c.title,
      body: JSON.stringify(
        {
          title: c.title,
          startedAt: new Date(c.startedAt).toISOString(),
          messages: c.messages.map((m) => ({
            role: m.role,
            modality: m.modality,
            text: m.text,
            at: new Date(m.createdAt).toISOString(),
            ...(m.sources ? { sources: m.sources } : {}),
          })),
        },
        null,
        2
      ),
    };
  }
  if (format === "md") {
    const body = [
      `# ${c.title}`,
      "",
      `_${when(c.startedAt)}_`,
      "",
      ...c.messages.map((m) => {
        const src = m.sources?.length ? "\n\n" + m.sources.map((s, i) => `${i + 1}. [${s.title}](${s.uri})`).join("\n") : "";
        return `**${who(m)}**: ${m.text}${src}\n`;
      }),
    ].join("\n");
    return { mime: "text/markdown", ext: "md", title: c.title, body };
  }
  const body = [c.title, when(c.startedAt), "", ...c.messages.map((m) => `[${new Date(m.createdAt).toLocaleTimeString()}] ${who(m)}: ${m.text}`)].join("\n");
  return { mime: "text/plain", ext: "txt", title: c.title, body };
}
