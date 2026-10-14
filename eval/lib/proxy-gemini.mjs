// Stands in for server/gemini.mjs during evaluation.
// Without a handler every call goes to the real Gemini code. With a handler (simulation runs, or a
// policy wrapper around the real model) the handler decides what the memory extractor "returns".
import * as real from "../../server/gemini.mjs";

export const usage = real.usage; // token/latency totals of real calls
export const createLiveToken = real.createLiveToken;
export const transcribeSegments = real.transcribeSegments;

export const sim = { calls: 0 };
let handler = null;

/** handler(args, realGenerateJSON) -> parsed JSON. Pass null to go back to the real model. */
export function setHandler(fn) {
  handler = fn;
}

export const hasKey = () => (handler ? true : real.hasKey());

export async function generateJSON(args) {
  if (!handler) return real.generateJSON(args);
  sim.calls++;
  return handler(args, real.generateJSON);
}
