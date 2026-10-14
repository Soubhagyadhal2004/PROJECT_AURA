// Server-side Gemini API access: ephemeral Live tokens, JSON generation, transcription.
import { GEMINI_API_KEY, TEXT_MODEL, TRANSCRIBE_MODEL } from "./config.mjs";
import { pcmToWav } from "./audio.mjs";

let sdk = null;
async function genai() {
  if (!sdk) sdk = await import("@google/genai");
  return sdk;
}

let ai = null;
async function client() {
  if (!GEMINI_API_KEY) {
    const err = new Error(
      "GEMINI_API_KEY is not set. Add it to the .env file in the project root and restart."
    );
    err.status = 503;
    throw err;
  }
  if (!ai) {
    const { GoogleGenAI } = await genai();
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return ai;
}

export const hasKey = () => Boolean(GEMINI_API_KEY);

// Running totals for generateJSON calls (read by the evaluation harness; the app ignores them).
export const usage = { calls: 0, promptTokens: 0, outputTokens: 0, latencyMs: 0 };

/** Short-lived, single-use token the browser uses to open a Gemini Live session. */
export async function createLiveToken() {
  await client(); // throws a helpful error when the key is missing
  const { GoogleGenAI } = await genai();
  const c = new GoogleGenAI({ apiKey: GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } });
  const t = Date.now();
  const token = await c.authTokens.create({
    config: {
      uses: 1,
      // the session itself may last up to 3 hours, a new one must start within 2 minutes
      expireTime: new Date(t + 3 * 60 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(t + 2 * 60 * 1000).toISOString(),
      httpOptions: { apiVersion: "v1alpha" },
    },
  });
  return { token: token.name, expiresAt: t + 2 * 60 * 1000 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(e) {
  const s = e?.status ?? e?.code;
  return s === 429 || s === 500 || s === 503 || s === 504 || /fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(e?.message));
}

async function withRetry(fn, tries = 4) {
  let delay = 2000;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1 || !isRetryable(e)) throw e;
      // honour "retry in Xs" hints from 429 responses when present
      const m = /retry in ([\d.]+)s/i.exec(String(e?.message));
      await sleep(m ? Math.min(60000, Number(m[1]) * 1000 + 250) : delay);
      delay *= 2;
    }
  }
}

/** Generate JSON that follows `schema` (a JSON Schema object). */
export async function generateJSON({ system, prompt, schema, model = TEXT_MODEL, parts }) {
  const c = await client();
  const t0 = Date.now();
  const res = await withRetry(() =>
    c.models.generateContent({
      model,
      contents: [{ role: "user", parts: parts || [{ text: prompt }] }],
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        temperature: 0.1,
      },
    })
  );
  const um = res.usageMetadata || {};
  usage.calls++;
  usage.promptTokens += um.promptTokenCount || 0;
  usage.outputTokens += um.candidatesTokenCount || 0;
  usage.latencyMs += Date.now() - t0;
  const text = res.text || "";
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Model did not return valid JSON");
  }
}

/**
 * Transcribe several short PCM16 (16 kHz mono) clips in one request.
 * `context` is the most recent transcript (plain text) to help with names and terms.
 * Returns { texts, raw }: one string per clip, in order ("" when no intelligible speech).
 */
export async function transcribeSegments(pcmBuffers, { context = "", language = "" } = {}) {
  const n = pcmBuffers.length;
  const parts = [];
  if (context) {
    parts.push({ text: `Transcript so far (for context only, do not repeat it):\n${context}` });
  }
  pcmBuffers.forEach((pcm, i) => {
    parts.push({ text: `Clip ${i + 1} of ${n}:` });
    parts.push({ inlineData: { mimeType: "audio/wav", data: pcmToWav(pcm).toString("base64") } });
  });
  parts.push({
    text:
      `Transcribe each of the ${n} audio clips above, word for word. ` +
      `Return "transcripts" as an array of exactly ${n} strings: the first string is clip 1, the second is clip 2, and so on. ` +
      (language
        ? `The speakers mostly use: ${language}. `
        : `Write each clip in the language it is spoken in. `) +
      `If speakers mix languages (for example Hindi and English), keep the words as spoken; do not translate. ` +
      `Use normal punctuation. Leave out filler sounds like "um". ` +
      `Use an empty string only when a clip has no intelligible speech at all. ` +
      `Do not add speaker names, timestamps, descriptions or comments.`,
  });
  const out = await generateJSON({
    model: TRANSCRIBE_MODEL,
    system: "You are an accurate meeting transcriber. You only write down what is said in the audio.",
    parts,
    schema: {
      type: "object",
      properties: {
        transcripts: { type: "array", items: { type: "string" }, minItems: n, maxItems: n },
      },
      required: ["transcripts"],
    },
  });
  const list = Array.isArray(out?.transcripts) ? out.transcripts : Array.isArray(out) ? out : [];
  const texts = new Array(n).fill("");
  for (let i = 0; i < n && i < list.length; i++) {
    const v = list[i];
    texts[i] = String(typeof v === "string" ? v : v?.text ?? "").trim();
  }
  return { texts, raw: out, count: list.length };
}
