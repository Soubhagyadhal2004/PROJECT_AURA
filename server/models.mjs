// Local models run with transformers.js (ONNX Runtime) on this machine.
// Weights are downloaded once from the Hugging Face hub into data/models.
import { MODEL_CACHE_DIR, SEGMENTATION_MODEL, SPEAKER_MODEL, TEXT_EMBED_MODEL } from "./config.mjs";

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
  segmentation: { state: "idle", error: null, model: SEGMENTATION_MODEL },
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
  const { AutoProcessor, AutoModel } = await lib();
  const processor = await AutoProcessor.from_pretrained(SPEAKER_MODEL);
  const model = await AutoModel.from_pretrained(SPEAKER_MODEL, { dtype: "fp32" });
  return { processor, model };
});

const loadSegmentation = lazy("segmentation", async () => {
  const { AutoProcessor, AutoModelForAudioFrameClassification } = await lib();
  const processor = await AutoProcessor.from_pretrained(SEGMENTATION_MODEL);
  const model = await AutoModelForAudioFrameClassification.from_pretrained(SEGMENTATION_MODEL, { dtype: "fp32" });
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

// serialise audio-model calls; ONNX sessions are not meant to be hammered concurrently
let audioQueue = Promise.resolve();
function serial(run) {
  const p = audioQueue.then(run, run);
  audioQueue = p.catch(() => {});
  return p;
}

const SR = 16000;

async function voiceprint(samples) {
  const { processor, model } = await loadSpeaker();
  const inputs = await processor(samples);
  const out = await model(inputs);
  const t = out.embeddings ?? out.embedding ?? Object.values(out)[0];
  return normalize(t.data);
}

/**
 * Speaker embedding ("voiceprint") for 16 kHz float audio.
 * Up to 20 s is embedded in one pass; longer audio is cut into 10 s windows
 * whose embeddings are averaged.
 */
export function embedSpeaker(samples) {
  return serial(async () => {
    if (samples.length <= 20 * SR) return voiceprint(samples);
    let acc = null;
    for (let start = 0; start + 2 * SR < samples.length; start += 10 * SR) {
      const e = await voiceprint(samples.subarray(start, Math.min(samples.length, start + 10 * SR)));
      if (!acc) acc = new Float32Array(e.length);
      for (let i = 0; i < e.length; i++) acc[i] += e[i];
    }
    return normalize(acc);
  });
}

// pyannote segmentation 3.0 classes ("powerset"): which of up to 3 local speakers are talking
const POWERSET = [[], [0], [1], [2], [0, 1], [0, 2], [1, 2]];

/**
 * Turn the model's frame regions into speaker turns that cover the whole clip.
 * regions: [{ id, start, end }] in seconds (id = powerset class)
 * Returns [{ start, end, local }] where `local` is a speaker index local to this clip.
 * Very short turns are absorbed by their neighbours, and cut points sit in the
 * middle of pauses so no audio is lost.
 */
export function regionsToTurns(regions, duration, minTurn = 0.6) {
  // 1) one label per region: single speakers as-is, overlaps go to whoever was already talking
  const labelled = [];
  let prev = null;
  for (const r of regions) {
    const set = POWERSET[r.id] || [];
    if (!set.length) continue; // silence
    const local = set.length === 1 ? set[0] : set.includes(prev) ? prev : set[0];
    labelled.push({ start: r.start, end: r.end, local });
    prev = local;
  }
  if (!labelled.length) return [{ start: 0, end: duration, local: 0 }];

  // 2) join consecutive regions of the same speaker (across pauses)
  let turns = [];
  for (const r of labelled) {
    const last = turns[turns.length - 1];
    if (last && last.local === r.local) last.end = r.end;
    else turns.push({ ...r });
  }

  // 3) absorb turns that are too short to be a real speaker change
  for (let changed = true; changed && turns.length > 1; ) {
    changed = false;
    let iShort = -1;
    for (let i = 0; i < turns.length; i++) {
      const d = turns[i].end - turns[i].start;
      if (d < minTurn && (iShort < 0 || d < turns[iShort].end - turns[iShort].start)) iShort = i;
    }
    if (iShort >= 0) {
      const t = turns[iShort];
      const before = turns[iShort - 1];
      const after = turns[iShort + 1];
      const into = !after || (before && before.end - before.start >= after.end - after.start) ? before : after;
      into.start = Math.min(into.start, t.start);
      into.end = Math.max(into.end, t.end);
      turns.splice(iShort, 1);
      // neighbours may now be the same speaker
      const merged = [];
      for (const x of turns) {
        const last = merged[merged.length - 1];
        if (last && last.local === x.local) last.end = Math.max(last.end, x.end);
        else merged.push(x);
      }
      turns = merged;
      changed = true;
    }
  }

  // 4) cover the clip: cut in the middle of the gap between turns
  const out = turns.map((t) => ({ ...t }));
  out[0].start = 0;
  out[out.length - 1].end = duration;
  for (let i = 1; i < out.length; i++) {
    const mid = (out[i - 1].end + out[i].start) / 2;
    out[i - 1].end = mid;
    out[i].start = mid;
  }
  return out;
}

/**
 * Detect who speaks when inside one clip of 16 kHz float audio (local speaker
 * indices, not identities). Returns turns covering the whole clip.
 */
export function speakerTurns(samples) {
  return serial(async () => {
    const duration = samples.length / SR;
    const { processor, model } = await loadSegmentation();
    const inputs = await processor(samples);
    const { logits } = await model(inputs);
    const regions = processor.post_process_speaker_diarization(logits, samples.length)[0];
    return regionsToTurns(regions, duration);
  });
}

export function warmUp() {
  loadText().catch(() => {});
  loadSpeaker().catch(() => {});
  loadSegmentation().catch(() => {});
}
