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
      `SELECT c.id, c.title, c.started_at, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n,
              (SELECT text FROM messages m WHERE m.conversation_id = c.id AND role = 'user' ORDER BY id LIMIT 1) AS first_user
       FROM conversations c ORDER BY c.updated_at DESC`
    )
    .all()
    .filter((c) => c.n > 0)
    .map((c) => ({
      id: c.id,
      title: c.title || (c.first_user ? c.first_user.slice(0, 60) : "Conversation"),
      startedAt: c.started_at,
      updatedAt: c.updated_at,
      messageCount: c.n,
    }));
}

export function getConversation(id) {
  const c = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!c) return null;
  const messages = db
    .prepare("SELECT id, role, modality, text, created_at FROM messages WHERE conversation_id = ? ORDER BY id")
    .all(id)
    .map((m) => ({ id: m.id, role: m.role, modality: m.modality, text: m.text, createdAt: m.created_at }));
  return { id: c.id, title: c.title, startedAt: c.started_at, updatedAt: c.updated_at, messages };
}

export function addMessage(conversationId, { role, text, modality = "text" }) {
  const t = now();
  const id = db
    .prepare("INSERT INTO messages(conversation_id, role, modality, text, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(conversationId, role, modality, String(text), t).lastInsertRowid;
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(t, conversationId);
  return { id: Number(id), role, modality, text, createdAt: t };
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
