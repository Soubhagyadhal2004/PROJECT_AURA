// End-to-end tests of the server logic with the two external pieces faked:
// Gemini (network) and the local ONNX models (large downloads).
// Run: npm run test:server
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-test-"));
process.env.AURA_DATA_DIR = dataDir;
process.env.GEMINI_API_KEY = "test-key";
process.env.AURA_NO_WARMUP = "1";

// ---- fakes ---------------------------------------------------------------------------
// speaker "voice" k is encoded in the first PCM sample; each voice maps to a fixed random vector
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
}
const voices = new Map();
function voiceVector(k) {
  if (!voices.has(k)) {
    const r = seeded(k * 7919 + 1);
    voices.set(k, Float32Array.from({ length: 64 }, r));
  }
  return voices.get(k);
}
let noiseSeed = 1;
const normalize = (v) => {
  const n = Math.hypot(...v) || 1;
  return Float32Array.from(v, (x) => x / n);
};
const cosine = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return d / Math.sqrt(na * nb);
};
mock.module(new URL("../models.mjs", import.meta.url).href, {
  namedExports: {
    modelStatus: { text: { state: "error" }, speaker: { state: "ready" } },
    warmUp: () => {},
    normalize,
    cosine,
    embedText: async () => { throw new Error("no text model in tests"); },
    embedSpeaker: async (samples) => {
      const k = Math.round(samples[0] * 32768);
      const r = seeded(noiseSeed++);
      return normalize(Array.from(voiceVector(k), (x) => x + r() * 0.15));
    },
  },
});

const geminiCalls = { json: [], transcribe: 0 };
let nextOps = [];
mock.module(new URL("../gemini.mjs", import.meta.url).href, {
  namedExports: {
    hasKey: () => true,
    createLiveToken: async () => ({ token: "auth_tokens/fake", expiresAt: Date.now() + 1000 }),
    generateJSON: async (args) => {
      geminiCalls.json.push(args);
      return { operations: nextOps };
    },
    transcribeSegments: async (bufs) => {
      geminiCalls.transcribe++;
      return bufs.map((b) => `words from voice ${b.readInt16LE(0)}`);
    },
  },
});

const { start, server } = await import("../index.mjs");
const B = "http://127.0.0.1:3911";
const j = async (method, url, body) => {
  const r = await fetch(B + url, {
    method,
    headers: body instanceof Buffer ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" },
    body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, data: t ? JSON.parse(t) : null, text: t };
};
const pcm = (voice, seconds) => {
  const b = Buffer.alloc(seconds * 16000 * 2);
  b.writeInt16LE(voice, 0);
  return b;
};
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

before(async () => { await start(3911); });
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test("conversation messages are stored and listed", async () => {
  const c = (await j("POST", "/api/conversations")).data;
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "user", text: "I work at Infosys as a data engineer.", modality: "voice" });
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "assistant", text: "Got it." });
  const got = (await j("GET", `/api/conversations/${c.id}`)).data;
  assert.equal(got.messages.length, 2);
  assert.equal(got.messages[0].modality, "voice");
  const list = (await j("GET", "/api/conversations")).data;
  assert.ok(list.some((x) => x.id === c.id));
});

test("memory extraction adds, updates (keeping history) and retires facts", async () => {
  const c = (await j("POST", "/api/conversations")).data;
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "user", text: "I work at Infosys and my sister is Priya." });
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "assistant", text: "Noted." });
  nextOps = [
    { action: "add", content: "The user works at Infosys.", category: "work" },
    { action: "add", content: "The user's sister is named Priya.", category: "people" },
  ];
  const r1 = (await j("POST", `/api/memories/extract/${c.id}`)).data;
  assert.equal(r1.length, 2);
  const infosys = r1[0].memory;

  // nothing new -> no Gemini call
  const calls = geminiCalls.json.length;
  assert.deepEqual((await j("POST", `/api/memories/extract/${c.id}`)).data, []);
  assert.equal(geminiCalls.json.length, calls);

  // the job changes: the extractor sees the old fact as a candidate and updates it
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "user", text: "I moved to TCS last month." });
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "assistant", text: "Congrats!" });
  nextOps = [{ action: "update", memory_id: infosys.id, content: "The user works at TCS (since September 2026).", category: "work" }];
  const r2 = (await j("POST", `/api/memories/extract/${c.id}`)).data;
  assert.equal(r2[0].op, "update");
  const prompt = geminiCalls.json.at(-1).prompt;
  assert.match(prompt, new RegExp(`\\[${infosys.id}\\].*Infosys`), "old fact offered to the model");
  assert.match(prompt, /moved to TCS/);
  assert.doesNotMatch(prompt.split("New messages to process:")[1], /my sister is Priya/, "processed messages are not re-sent as new");

  const all = (await j("GET", "/api/memories")).data;
  const old = all.find((m) => m.id === infosys.id);
  assert.equal(old.status, "superseded");
  assert.equal(old.supersededBy, r2[0].memory.id);

  // only current facts are used for answers
  const setup = (await j("GET", "/api/live/setup")).data;
  assert.match(setup.systemInstruction, /TCS/);
  assert.doesNotMatch(setup.systemInstruction, /Infosys/);
  const hits = (await j("GET", "/api/memories/search?q=where%20does%20the%20user%20work")).data;
  assert.ok(hits.some((h) => /TCS/.test(h.content)));
  assert.ok(!hits.some((h) => /Infosys/.test(h.content)));

  // ids the model was not shown are ignored (no blind edits)
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "user", text: "Whatever." });
  nextOps = [{ action: "forget", memory_id: 99999 }];
  assert.deepEqual((await j("POST", `/api/memories/extract/${c.id}`)).data, []);
});

test("memories can be edited, restored and deleted", async () => {
  const m = (await j("POST", "/api/memories", { content: "The user likes jazz.", category: "preference" })).data;
  const e = (await j("PATCH", `/api/memories/${m.id}`, { content: "The user likes jazz and blues." })).data;
  assert.equal(e.content, "The user likes jazz and blues.");
  await j("PATCH", `/api/memories/${m.id}`, { status: "outdated" });
  assert.equal((await j("GET", "/api/memories")).data.find((x) => x.id === m.id).status, "outdated");
  await j("PATCH", `/api/memories/${m.id}`, { status: "active" });
  assert.equal((await j("DELETE", `/api/memories/${m.id}`)).data.deleted, true);
  assert.ok(!(await j("GET", "/api/memories")).data.some((x) => x.id === m.id));
});

test("enrollment requires consent and enough audio", async () => {
  assert.equal((await j("POST", "/api/speakers?name=Asha", pcm(1, 10))).status, 400);
  assert.equal((await j("POST", "/api/speakers?name=Asha&consent=yes", pcm(1, 3))).status, 400);
  const p = (await j("POST", "/api/speakers?name=Asha&consent=yes", pcm(1, 10))).data;
  assert.equal(p.name, "Asha");
  const id = (await j("POST", "/api/speakers/identify", pcm(1, 3))).data;
  assert.equal(id[0].name, "Asha");
  assert.ok(id[0].score > 0.9);
});

test("meeting: registered voice gets its name, unknown voices get stable Speaker N labels", async () => {
  const m = (await j("POST", "/api/meetings", { title: "Standup" })).data;
  // voice 1 = Asha (enrolled above); voices 2 and 3 are unknown
  const order = [1, 2, 3, 2, 1, 3, 2];
  let t = 0;
  for (const v of order) {
    await j("POST", `/api/meetings/${m.id}/segments?start=${t}&end=${t + 2000}`, pcm(v, 2));
    t += 2500;
  }
  // a very short blip right after voice 2
  await j("POST", `/api/meetings/${m.id}/segments?start=${t}&end=${t + 500}`, pcm(2, 0.5));
  const done = await until(async () => {
    const d = (await j("GET", `/api/meetings/${m.id}`)).data;
    return d.segments.every((s) => s.status !== "pending") && d;
  });
  const label = new Map(done.speakers.map((s) => [s.id, s.label]));
  const labels = done.segments.map((s) => label.get(s.speakerId));
  assert.deepEqual(labels, ["Asha", "Speaker 1", "Speaker 2", "Speaker 1", "Asha", "Speaker 2", "Speaker 1", "Speaker 1"]);
  assert.equal(done.segments.at(-1).speakerUncertain, true, "short segment flagged");
  assert.equal(done.segments[0].text, "words from voice 1");

  // corrections: rename Speaker 1 everywhere, move one line, merge
  const s1 = done.speakers.find((s) => s.label === "Speaker 1");
  const s2 = done.speakers.find((s) => s.label === "Speaker 2");
  await j("PATCH", `/api/meetings/${m.id}/speakers/${s1.id}`, { label: "Ravi" });
  let d = (await j("PATCH", `/api/meetings/${m.id}/segments/${done.segments[2].id}`, { speakerId: s1.id })).data;
  assert.equal(new Map(d.speakers.map((s) => [s.id, s.label])).get(d.segments[2].speakerId), "Ravi");
  await j("POST", `/api/meetings/${m.id}/speakers/${s2.id}/merge`, { into: s1.id });
  d = (await j("GET", `/api/meetings/${m.id}`)).data;
  assert.ok(!d.speakers.some((s) => s.id === s2.id));
  d = (await j("PATCH", `/api/meetings/${m.id}/segments/${done.segments[0].id}`, { text: "Corrected text" })).data;
  assert.equal(d.segments[0].text, "Corrected text");

  // the merged voice keeps landing on the merged speaker
  await j("POST", `/api/meetings/${m.id}/segments?start=28000&end=30000`, pcm(3, 2));
  d = await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return x.segments.every((s) => s.status !== "pending") && x;
  });
  assert.equal(d.segments.at(-1).speakerId, s1.id, "voice 3 now goes to Ravi");

  // a new unknown voice after a rename is still numbered after the existing ones
  await j("POST", `/api/meetings/${m.id}/segments?start=30000&end=32000`, pcm(4, 2));
  d = await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return x.segments.every((s) => s.status !== "pending") && x;
  });
  assert.equal(new Map(d.speakers.map((s) => [s.id, s.label])).get(d.segments.at(-1).speakerId), "Speaker 3", "numbering continues after Speaker 2");

  // export
  const txt = await fetch(`${B}/api/meetings/${m.id}/export?format=txt`);
  assert.match(txt.headers.get("content-disposition"), /Standup\.txt/);
  const body = await txt.text();
  assert.match(body, /\[00:00 - 00:02\] Asha: Corrected text/);
  assert.match(body, /Ravi: words from voice 2/);
  const md = await (await fetch(`${B}/api/meetings/${m.id}/export?format=md`)).text();
  assert.match(md, /^# Standup/);
  const json = JSON.parse(await (await fetch(`${B}/api/meetings/${m.id}/export?format=json`)).text());
  assert.equal(json.segments[0].speaker, "Asha");
});

test("data can be deleted", async () => {
  const r = (await j("DELETE", "/api/data")).data;
  assert.ok(r.memories >= 1 && r.meetings >= 1 && r.profiles >= 1);
  assert.deepEqual((await j("GET", "/api/memories")).data, []);
  assert.deepEqual((await j("GET", "/api/speakers")).data, []);
});
