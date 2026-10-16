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
  const floor = cfg.floor ?? -Infinity; // null = no floor (BM25 and fused rankings)
  const top = (q) => rankFor(q, cfg.rank || "aura").filter((m) => m.score >= floor).slice(0, k);
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

// ---- lexical and fused rankings (baselines; not part of AURA) -------------------------------------------
const STOP = new Set(
  "the a an and or but of to in on at for with is are was were be been am i me my mine you your it its this that these those what who whom which do does did have has had will would can could should about from as by not no yes so if then than there their they them he she his her we our us just also very really like".split(" ")
);
function stem(w) {
  if (w.length > 5 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
// same tokenizer as AURA's lexical score (server/memory.mjs tokens())
export const tokenize = (s) =>
  String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);

/** BM25 index over memories [{id, content}] (k1 = 1.2, b = 0.75). rank(q) -> memories sharing a term with q, by score.
 * (Zero-score memories are left out: keeping them would order them by insertion and favour the oldest records.) */
export function bm25Index(memories, { k1 = 1.2, b = 0.75 } = {}) {
  const docs = memories.map((m) => ({ m, toks: tokenize(m.content) }));
  const N = docs.length;
  const avg = docs.reduce((a, d) => a + d.toks.length, 0) / Math.max(1, N);
  const df = new Map();
  for (const d of docs) for (const t of new Set(d.toks)) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  return (q) => {
    const qt = [...new Set(tokenize(q))];
    return docs
      .map((d) => {
        let s = 0;
        for (const t of qt) {
          const f = d.toks.filter((x) => x === t).length;
          if (f) s += idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.toks.length) / avg)));
        }
        return { ...d.m, score: s };
      })
      .filter((m) => m.score > 0) // a keyword search returns only memories that share a term with the query
      .sort((a, c) => c.score - a.score);
  };
}

/** Reciprocal-rank fusion of two full rankings (c = 60). */
export function rrf(rankA, rankB, c = 60) {
  const s = new Map();
  const byId = new Map();
  rankA.forEach((m, i) => { s.set(m.id, (s.get(m.id) || 0) + 1 / (c + i + 1)); byId.set(m.id, m); });
  rankB.forEach((m, i) => { s.set(m.id, (s.get(m.id) || 0) + 1 / (c + i + 1)); byId.set(m.id, m); });
  return [...s.entries()].map(([id, score]) => ({ ...byId.get(id), score })).sort((a, b) => b.score - a.score);
}
