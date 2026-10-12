// Local models run with transformers.js (ONNX Runtime) on this machine.
// Weights are downloaded once from the Hugging Face hub into data/models.
import { MODEL_CACHE_DIR, SPEAKER_MODEL, TEXT_EMBED_MODEL } from "./config.mjs";

let tjs = null;
async function lib() {
  if (!tjs) {
    tjs = await import("@huggingface/transformers");
    tjs.env.cacheDir = MODEL_CACHE_DIR;
    tjs.env.allowLocalModels = true;
  }
  return tjs;
}

export const modelStatus = {
  text: { state: "idle", error: null, model: TEXT_EMBED_MODEL },
  speaker: { state: "idle", error: null, model: SPEAKER_MODEL },
};

function lazy(kind, loader) {
  let p = null;
  let failedAt = 0;
  return () => {
    // after a failure, wait a minute before trying (and logging) again
    if (!p && failedAt && Date.now() - failedAt < 60000) {
      return Promise.reject(new Error(modelStatus[kind].error));
    }
    if (!p) {
      modelStatus[kind].state = "loading";
      p = loader()
        .then((v) => {
          modelStatus[kind].state = "ready";
          return v;
        })
        .catch((e) => {
          modelStatus[kind].state = "error";
          modelStatus[kind].error = String(e?.message || e);
          console.error(`[models] failed to load ${kind} model:`, e?.message || e);
          p = null; // allow a retry later
          failedAt = Date.now();
          throw e;
        });
    }
    return p;
  };
}

const loadText = lazy("text", async () => {
  const { pipeline } = await lib();
  return pipeline("feature-extraction", TEXT_EMBED_MODEL, { dtype: "q8" });
});

const loadSpeaker = lazy("speaker", async () => {
  const { AutoProcessor, AutoModelForXVector } = await lib();
  const processor = await AutoProcessor.from_pretrained(SPEAKER_MODEL);
  const model = await AutoModelForXVector.from_pretrained(SPEAKER_MODEL, { dtype: "fp32" });
  return { processor, model };
});

export function normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Sentence embedding (384-d, normalised). */
export async function embedText(text) {
  const extractor = await loadText();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Float32Array.from(out.data);
}

// serialise speaker-model calls; ONNX sessions are not meant to be hammered concurrently
let speakerQueue = Promise.resolve();

async function xvector(samples) {
  const { processor, model } = await loadSpeaker();
  const inputs = await processor(samples);
  const out = await model(inputs);
  return normalize(out.embeddings.data);
}

/**
 * Speaker embedding for 16 kHz float audio.
 * Long audio is split into ~3 s windows whose embeddings are averaged.
 */
export function embedSpeaker(samples) {
  const run = async () => {
    const SR = 16000;
    const win = 3 * SR;
    const hop = 1.5 * SR;
    if (samples.length <= win * 1.5) return xvector(samples);
    let acc = null;
    for (let start = 0; start + SR < samples.length; start += hop) {
      const e = await xvector(samples.subarray(start, Math.min(samples.length, start + win)));
      if (!acc) acc = new Float32Array(e.length);
      for (let i = 0; i < e.length; i++) acc[i] += e[i];
    }
    return normalize(acc);
  };
  const p = speakerQueue.then(run, run);
  speakerQueue = p.catch(() => {});
  return p;
}

export function warmUp() {
  loadText().catch(() => {});
  loadSpeaker().catch(() => {});
}
