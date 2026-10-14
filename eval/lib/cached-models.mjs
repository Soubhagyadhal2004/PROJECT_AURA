// Stands in for server/models.mjs during evaluation: the real local models, with text embeddings memoised.
import * as real from "../../server/models.mjs";
export * from "../../server/models.mjs"; // everything else unchanged (embedText below takes precedence)

const cache = new Map();
export const embedStats = { hits: 0, misses: 0, ms: 0 };

export async function embedText(text) {
  const key = String(text);
  const hit = cache.get(key);
  if (hit) {
    embedStats.hits++;
    return hit;
  }
  const t0 = performance.now();
  const v = await real.embedText(key);
  embedStats.ms += Math.round(performance.now() - t0);
  embedStats.misses++;
  cache.set(key, v);
  return v;
}
