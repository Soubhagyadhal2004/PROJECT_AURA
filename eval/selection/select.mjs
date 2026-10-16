// Candidate-selection variants computed from the server's own search (server/memory.mjs is not modified).
// For the four modes that exist in the server, tests/select-equivalence.test.mjs checks that the ids
// returned here equal server selectCandidates(text, mode).
import { CHANGE_CUE } from "./testset.mjs";

// Same sentence splitter as server/memory.mjs (splitSentences). Checked by a test.
export const splitSentences = (text) =>
  String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);

/**
 * rankFor(q): ALL active memories for query q with scores, sorted by score descending (server searchMemories
 * with no floor). recent: server coreMemories(8). cfg: { sentences, floor, k, kCue }.
 * Returns { candidates, searchIds } in the server's order.
 */
export function selectFromRankings(text, cfg, rankFor, recent) {
  const cue = CHANGE_CUE.test(text);
  const k = cue ? cfg.kCue : cfg.k;
  const top = (q) => rankFor(q).filter((m) => m.score >= cfg.floor).slice(0, k);
  let related;
  if (cfg.sentences) {
    const best = new Map();
    for (const q of new Set([text, ...splitSentences(text)])) {
      for (const m of top(q)) {
        const prev = best.get(m.id);
        if (!prev || m.score > prev.score) best.set(m.id, m);
      }
    }
    related = [...best.values()].sort((a, b) => b.score - a.score).slice(0, k);
  } else {
    related = top(text);
  }
  const all = [...new Map([...related, ...recent].map((m) => [m.id, m])).values()];
  return { candidates: all.map((m) => m.id), searchIds: related.map((m) => m.id), cue, k };
}
