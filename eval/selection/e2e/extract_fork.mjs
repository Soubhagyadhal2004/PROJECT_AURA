// A copy of the conversation extraction step of server/memory.mjs with two hooks for the experiment:
//   1. the candidate list is passed in (selection variants and an oracle-target condition);
//   2. the policy (gate | auto) is passed in instead of read from settings.
// The system prompt is read from server/memory.mjs at runtime, so it cannot drift.
// tests/extract-fork.test.mjs checks that, for the default selection, the system prompt, the prompt text and
// the schema sent to the model are identical to those of the server's extractFromConversation.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = fs.readFileSync(path.join(ROOT, "server", "memory.mjs"), "utf8");

export const EXTRACT_SYSTEM = (() => {
  const m = SRC.match(/const EXTRACT_SYSTEM = `([\s\S]*?)`;/);
  if (!m) throw new Error("EXTRACT_SYSTEM not found in server/memory.mjs");
  return m[1];
})();

export function makeSchema(CATEGORIES) {
  // Same object as EXTRACT_SCHEMA in server/memory.mjs (checked by the test).
  return {
    type: "object",
    properties: {
      operations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add", "update", "retire", "forget"] },
            memory_id: { type: "integer" },
            content: { type: "string" },
            category: { type: "string", enum: CATEGORIES },
          },
          required: ["action"],
        },
      },
    },
    required: ["operations"],
  };
}

/** Same layout as extractFromConversation. fresh/before: [{role, text}]. */
export function buildPrompt(candidates, fresh, before, today = new Date().toISOString().slice(0, 10)) {
  const fmt = (m) => `${m.role === "user" ? "User" : "AURA"}: ${m.text}`;
  return [
    `Today's date: ${today}`,
    "",
    "Existing related memories:",
    candidates.length ? candidates.map((m) => `[${m.id}] (${m.category}) ${m.content}`).join("\n") : "(none)",
    "",
    before.length ? "Earlier context (already processed):\n" + before.map(fmt).join("\n") + "\n" : "",
    "New messages to process:",
    fresh.map(fmt).join("\n"),
  ].join("\n");
}

/**
 * Apply operations with the rules of applyOperations in server/memory.mjs:
 *  - update/retire/forget only for shown ids; with the gate they become proposals.
 *  - auto: applied at once through the server's own proposal path with explicit=true
 *    (propose -> acceptProposal), which runs the same supersede / retire / delete code.
 */
export async function applyOps(mem, operations, candidates, policy, origin) {
  const known = new Set(candidates.map((c) => c.id));
  const out = [];
  for (const op of operations || []) {
    const content = String(op.content || "").trim();
    const rec = { action: op.action, memoryId: op.memory_id ?? null, content, category: op.category ?? null, result: "ignored" };
    try {
      if (["update", "retire", "forget"].includes(op.action)) {
        if (!known.has(op.memory_id)) { rec.result = "dropped_unknown_id"; out.push(rec); continue; }
        if (op.action === "update" && !content) { rec.result = "dropped_empty"; out.push(rec); continue; }
        if (policy === "gate") {
          const p = mem.propose({ action: op.action, memoryId: op.memory_id, content, category: op.category, ...origin });
          rec.result = p ? "proposed" : "no_proposal";
          rec.proposalId = p?.id ?? null;
        } else if (op.action === "update" && mem.getMemory(op.memory_id)?.status !== "active") {
          const m = await mem.addMemory({ content, category: op.category, ...origin }); // server supersede(): target inactive -> add
          rec.result = "added_target_inactive";
          rec.newId = m.id;
        } else {
          const p = mem.propose({ action: op.action, memoryId: op.memory_id, content, category: op.category, ...origin, explicit: true });
          if (p) { await mem.acceptProposal(p.id); rec.result = "applied"; } else rec.result = "no_change";
        }
      } else if (op.action === "add" && content) {
        const m = await mem.addMemory({ content, category: op.category, ...origin });
        rec.result = "added";
        rec.newId = m.id;
      }
    } catch (e) {
      rec.result = "error";
      rec.error = String(e.message || e);
    }
    out.push(rec);
  }
  return out;
}
