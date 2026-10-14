// Module-resolution hooks for the evaluation harness (registered by register.mjs).
//  - "sharp" (an image library transformers.js loads at start) is replaced by a stub: the evaluation only
//    embeds text, and on Linux the Windows-installed binary of sharp cannot load.
//  - server/gemini.mjs is routed through proxy-gemini.mjs, so a run can either call the real model or a
//    simulated extractor with known error rates.
//  - server/models.mjs is routed through cached-models.mjs, which memoises text embeddings (same model,
//    same vectors; repeated sentences are only embedded once).
const here = (f) => new URL(f, import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "sharp") return { url: here("./sharp-stub.mjs"), shortCircuit: true };
  const r = await next(specifier, context);
  const parent = context.parentURL || "";
  if (r.url.endsWith("/server/gemini.mjs") && !parent.endsWith("/eval/lib/proxy-gemini.mjs")) {
    return { ...r, url: here("./proxy-gemini.mjs") };
  }
  if (r.url.endsWith("/server/models.mjs") && !parent.endsWith("/eval/lib/cached-models.mjs")) {
    return { ...r, url: here("./cached-models.mjs") };
  }
  return r;
}
