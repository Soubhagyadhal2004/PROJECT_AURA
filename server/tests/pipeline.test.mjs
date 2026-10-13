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
process.env.AURA_BATCH_WAIT_MS = "30";

// ---- fakes ---------------------------------------------------------------------------
// speaker "voice" k is encoded as a marker sample at the start of each turn; each voice maps to a fixed random vector
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
let noise = 0.15;
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
    modelStatus: { text: { state: "error" }, speaker: { state: "ready" }, segmentation: { state: "ready" } },
    warmUp: () => {},
    normalize,
    cosine,
    embedText: async () => { throw new Error("no text model in tests"); },
    embedSpeaker: async (samples) => {
      const k = Math.round(samples[0] * 32768);
      const r = seeded(noiseSeed++);
      return normalize(Array.from(voiceVector(k), (x) => x + r() * noise));
    },
    // turns start at each marker sample; the same voice gets the same local index
    speakerTurns: async (samples) => {
      const dur = samples.length / 16000;
      const marks = [];
      for (let i = 0; i < samples.length; i++) if (samples[i] !== 0) marks.push({ at: i / 16000, v: Math.round(samples[i] * 32768) });
      const local = new Map();
      const turns = marks.map((m, i) => {
        if (!local.has(m.v)) local.set(m.v, local.size);
        return { start: i === 0 ? 0 : m.at, end: marks[i + 1]?.at ?? dur, local: local.get(m.v) };
      });
      return turns.length ? turns : [{ start: 0, end: dur, local: 0 }];
    },
  },
});

const geminiCalls = { json: [], transcribe: 0 };
let nextOps = [];
let nextMeetingOps = []; // what the meeting memory extractor returns
let nextMinutes = null; // what the minutes writer returns
let docFail = false; // make the document reader fail
mock.module(new URL("../gemini.mjs", import.meta.url).href, {
  namedExports: {
    hasKey: () => true,
    createLiveToken: async () => ({ token: "auth_tokens/fake", expiresAt: Date.now() + 1000 }),
    generateJSON: async (args) => {
      geminiCalls.json.push(args);
      if (/You read documents/.test(args.system || "")) {
        if (docFail) throw new Error("model unavailable");
        return { title: "Rental agreement", doc_type: "contract", overview: "A one-year rental agreement for a flat in Pune.", key_points: ["Rent is 25,000 a month"], suggested_questions: ["When does it end?"], pages: 2 };
      }
      if (/You answer questions about the user's documents/.test(args.system || "")) {
        return { answer: "The rent is 25,000 rupees a month.", found: true, quotes: [{ text: "Monthly rent: 25,000", where: "page 1" }] };
      }
      if (args.schema?.properties?.summary) return nextMinutes;
      if (/transcript of a meeting/.test(args.system || "")) return { operations: nextMeetingOps };
      return { operations: nextOps };
    },
    transcribeSegments: async (bufs, opts) => {
      geminiCalls.transcribe++;
      geminiCalls.lastTranscribe = { n: bufs.length, ...opts };
      const texts = bufs.map((b) => `words from voice ${b.readInt16LE(0)}`);
      return { texts, raw: { transcripts: texts }, count: texts.length };
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
  const b = Buffer.alloc(Math.round(seconds * 16000) * 2);
  b.writeInt16LE(voice, 0);
  return b;
};
// one piece of speech with several speakers back to back: [[voice, seconds], ...]
const turnsPcm = (turns) => Buffer.concat(turns.map(([v, s]) => pcm(v, s)));
const settled = (d) => d.segments.every((s) => s.status !== "pending" && s.status !== "queued");
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
  await j("PUT", "/api/settings", { confirmMemoryChanges: false }); // apply changes directly
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

test("changes to existing memories wait for the user's OK", async () => {
  await j("PUT", "/api/settings", { confirmMemoryChanges: true });
  const c = (await j("POST", "/api/conversations")).data;
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "user", text: "I live in Pune and I drive a Swift." });
  nextOps = [
    { action: "add", content: "The user lives in Pune.", category: "personal" },
    { action: "add", content: "The user drives a Maruti Swift.", category: "personal" },
  ];
  const added = (await j("POST", `/api/memories/extract/${c.id}`)).data;
  const pune = added[0].memory;
  const swift = added[1].memory;

  await j("POST", `/api/conversations/${c.id}/messages`, { role: "user", text: "I moved to Bengaluru. Also sold the car." });
  nextOps = [
    { action: "update", memory_id: pune.id, content: "The user lives in Bengaluru.", category: "personal" },
    { action: "retire", memory_id: swift.id },
  ];
  const r = (await j("POST", `/api/memories/extract/${c.id}`)).data;
  assert.deepEqual(r.map((x) => x.op), ["proposed", "proposed"]);
  // nothing changed yet
  let all = (await j("GET", "/api/memories")).data;
  assert.equal(all.find((m) => m.id === pune.id).status, "active");
  assert.equal(all.find((m) => m.id === swift.id).status, "active");
  assert.equal((await j("GET", "/api/health")).data.memoryReviews, 2);

  const props = (await j("GET", "/api/memories/proposals")).data;
  assert.equal(props.length, 2);
  const upd = props.find((p) => p.action === "update");
  assert.equal(upd.current.content, "The user lives in Pune.");
  assert.equal(upd.content, "The user lives in Bengaluru.");

  // accept the update with an edit, keep the car
  await j("POST", `/api/memories/proposals/${upd.id}/accept`, { content: "The user lives in Bengaluru (Koramangala)." });
  await j("POST", `/api/memories/proposals/${props.find((p) => p.action === "retire").id}/reject`);
  all = (await j("GET", "/api/memories")).data;
  assert.equal(all.find((m) => m.id === pune.id).status, "superseded");
  assert.ok(all.some((m) => m.status === "active" && m.content === "The user lives in Bengaluru (Koramangala)."));
  assert.equal(all.find((m) => m.id === swift.id).status, "active");
  assert.equal((await j("GET", "/api/health")).data.memoryReviews, 0);

  // a change the user turned down is not asked again
  await j("POST", `/api/conversations/${c.id}/messages`, { role: "user", text: "No car any more." });
  nextOps = [{ action: "retire", memory_id: swift.id }];
  assert.deepEqual((await j("POST", `/api/memories/extract/${c.id}`)).data, []);
});

test("conversations can be renamed, pinned, exported and continued", async () => {
  const a = (await j("POST", "/api/conversations")).data;
  await j("POST", `/api/conversations/${a.id}/messages`, { role: "user", text: "Plan my Goa trip" });
  await j("POST", `/api/conversations/${a.id}/messages`, { role: "assistant", text: "Sure, when are you going?" });
  const b = (await j("POST", "/api/conversations")).data;
  await j("POST", `/api/conversations/${b.id}/messages`, { role: "user", text: "Newer chat" });

  let got = (await j("PATCH", `/api/conversations/${a.id}`, { title: "Goa trip", pinned: true })).data;
  assert.equal(got.title, "Goa trip");
  assert.equal(got.pinned, true);
  const list = (await j("GET", "/api/conversations")).data;
  assert.equal(list[0].id, a.id, "pinned first even though older");
  // clearing the name goes back to the automatic title
  got = (await j("PATCH", `/api/conversations/${a.id}`, { title: "" })).data;
  assert.equal(got.title, "Plan my Goa trip");
  await j("PATCH", `/api/conversations/${a.id}`, { title: "Goa trip" });

  const md = await fetch(`${B}/api/conversations/${a.id}/export?format=md`);
  assert.match(md.headers.get("content-disposition"), /Goa_trip\.md/);
  const body = await md.text();
  assert.match(body, /^# Goa trip/);
  assert.match(body, /\*\*You\*\*: Plan my Goa trip/);
  const json = JSON.parse(await (await fetch(`${B}/api/conversations/${a.id}/export?format=json`)).text());
  assert.equal(json.messages.length, 2);

  // continuing: the assistant is given the earlier messages
  const setup = (await j("GET", `/api/live/setup?conversation=${a.id}`)).data;
  assert.match(setup.systemInstruction, /continuing an earlier conversation/);
  assert.match(setup.systemInstruction, /User: Plan my Goa trip\nAURA: Sure, when are you going\?/);
  assert.doesNotMatch((await j("GET", "/api/live/setup")).data.systemInstruction, /earlier conversation/);
});

test("meeting: live transcription mode returns turns and takes text from the browser", async () => {
  const m = (await j("POST", "/api/meetings", { title: "Live" })).data;
  const r = (await j("POST", `/api/meetings/${m.id}/segments?start=0&end=5000&live=1`, turnsPcm([[10, 2.5], [11, 2.5]]))).data;
  assert.equal(r.turns.length, 2);
  assert.deepEqual(r.turns.map((t) => [t.startMs, t.endMs]), [[0, 2500], [2500, 5000]]);
  let d = (await j("GET", `/api/meetings/${m.id}`)).data;
  assert.deepEqual(d.segments.map((s) => s.status), ["live", "live"]);
  const before = geminiCalls.transcribe;
  await j("POST", `/api/meetings/${m.id}/segments/${r.turns[0].id}/transcript`, { text: "namaste everyone" });
  // the browser couldn't transcribe the second turn: the server does it the standard way
  await j("POST", `/api/meetings/${m.id}/segments/${r.turns[1].id}/transcript`, { failed: true });
  d = await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return settled(x) && x.segments.every((s) => s.status !== "live") && x;
  });
  assert.equal(d.segments[0].text, "namaste everyone");
  assert.equal(d.segments[1].text, "words from voice 11");
  assert.equal(geminiCalls.transcribe, before + 1);
  assert.equal(new Set(d.segments.map((s) => s.speakerId)).size, 2);
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
    return settled(d) && d;
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
    return settled(x) && x;
  });
  assert.equal(d.segments.at(-1).speakerId, s1.id, "voice 3 now goes to Ravi");

  // a new unknown voice after a rename is still numbered after the existing ones
  await j("POST", `/api/meetings/${m.id}/segments?start=30000&end=32000`, pcm(4, 2));
  d = await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return settled(x) && x;
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

test("meeting: two people in one piece of speech are split into two lines", async () => {
  const m = (await j("POST", "/api/meetings", { title: "Back to back" })).data;
  await j("POST", `/api/meetings/${m.id}/segments?start=1000&end=6000`, turnsPcm([[5, 2.5], [6, 2.5]]));
  const d = await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return x.segments.length === 2 && settled(x) && x;
  });
  const label = new Map(d.speakers.map((s) => [s.id, s.label]));
  assert.deepEqual(d.segments.map((s) => label.get(s.speakerId)), ["Speaker 1", "Speaker 2"]);
  assert.deepEqual(d.segments.map((s) => s.text), ["words from voice 5", "words from voice 6"]);
  assert.equal(d.segments[0].startMs, 1000);
  assert.equal(d.segments[1].startMs, 3500, "second line starts where the second voice starts");
  assert.equal(d.segments[1].endMs, 6000);
});

test("voice chat: the speech language setting becomes transcription language codes", async () => {
  assert.equal((await j("GET", "/api/settings")).data.assistantLanguage, "auto");
  assert.deepEqual((await j("GET", "/api/live/setup")).data.languageCodes, [], "automatic by default");
  const codes = async (assistantLanguage) => {
    await j("PUT", "/api/settings", { assistantLanguage });
    return (await j("GET", "/api/live/setup")).data.languageCodes;
  };
  assert.deepEqual(await codes("en"), ["en-IN"]);
  assert.deepEqual(await codes("hi"), ["hi-IN"]);
  assert.deepEqual(await codes("en-hi"), ["en-IN", "hi-IN"]);
  assert.deepEqual(await codes("klingon"), [], "unknown values fall back to automatic");
  await j("PUT", "/api/settings", { assistantLanguage: "auto" });
});

test("meeting: transcription gets earlier lines as context and the language hint", async () => {
  await j("PUT", "/api/settings", { meetingLanguage: "English and Hindi" });
  const m = (await j("POST", "/api/meetings", { title: "Context" })).data;
  await j("POST", `/api/meetings/${m.id}/segments?start=0&end=2000`, pcm(7, 2));
  await until(async () => settled((await j("GET", `/api/meetings/${m.id}`)).data));
  await j("POST", `/api/meetings/${m.id}/segments?start=3000&end=5000`, pcm(7, 2));
  await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return x.segments.length === 2 && settled(x);
  });
  assert.equal(geminiCalls.lastTranscribe.language, "English and Hindi");
  assert.match(geminiCalls.lastTranscribe.context, /Speaker 1: words from voice 7/);
  await j("PUT", "/api/settings", { meetingLanguage: "" });
});

test("meeting: after it ends, one voice split in two is merged back", async () => {
  // very strict matching during the meeting: the same voice gets split into several speakers
  await j("PUT", "/api/settings", { voiceClusterThreshold: 0.995 });
  noise = 0.25;
  const m = (await j("POST", "/api/meetings", { title: "Refine" })).data;
  for (let i = 0; i < 4; i++) await j("POST", `/api/meetings/${m.id}/segments?start=${i * 3000}&end=${i * 3000 + 2000}`, pcm(8, 2));
  let d = await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return x.segments.length === 4 && settled(x) && x;
  });
  assert.ok(d.speakers.length > 1, "split during the meeting");
  await j("PUT", "/api/settings", { voiceClusterThreshold: 0.55 });
  noise = 0.15;
  await j("PATCH", `/api/meetings/${m.id}`, { ended: true });
  d = await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return x.refined && x;
  });
  assert.equal(d.speakers.length, 1, "merged after the meeting");
  assert.equal(new Set(d.segments.map((s) => s.speakerId)).size, 1);
  assert.equal(d.speakers[0].segments, 4);
});

test("voice profiles from an older model are flagged and not used", async () => {
  const p = (await j("POST", "/api/speakers?name=Old&consent=yes", pcm(9, 10))).data;
  assert.equal(p.outdated, false);
  const { db } = await import("../db.mjs");
  db.prepare("UPDATE speaker_profiles SET model = 'old-model' WHERE id = ?").run(p.id);
  assert.equal((await j("GET", "/api/speakers")).data.find((x) => x.id === p.id).outdated, true);
  assert.ok(!(await j("POST", "/api/speakers/identify", pcm(9, 3))).data.some((x) => x.name === "Old"));
  // re-recording replaces the voiceprint in place
  const r = (await j("POST", `/api/speakers?name=Old&consent=yes&replace=${p.id}`, pcm(9, 10))).data;
  assert.equal(r.id, p.id);
  assert.equal(r.outdated, false);
});

test("web search sources are stored with assistant messages", async () => {
  const c = (await j("POST", "/api/conversations")).data;
  await j("POST", `/api/conversations/${c.id}/messages`, {
    role: "assistant",
    text: "India won by 5 wickets.",
    sources: [{ title: "espncricinfo.com", uri: "https://example.com/r/1" }, { title: "bad", uri: "javascript:alert(1)" }],
    searchQueries: ["india match result"],
  });
  const got = (await j("GET", `/api/conversations/${c.id}`)).data;
  assert.deepEqual(got.messages[0].sources, [{ title: "espncricinfo.com", uri: "https://example.com/r/1" }]);
  assert.deepEqual(got.messages[0].searchQueries, ["india match result"]);
  const setup = (await j("GET", "/api/live/setup")).data;
  assert.equal(setup.webSearch, true);
  assert.match(setup.systemInstruction, /Google Search/);
});

// a finished, transcribed two-person meeting that started at `startedAt`
async function finishedMeeting(title, startedAt) {
  const m = (await j("POST", "/api/meetings", { title })).data;
  await j("POST", `/api/meetings/${m.id}/segments?start=0&end=5000`, turnsPcm([[21, 2.5], [22, 2.5]]));
  await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return x.segments.length === 2 && settled(x);
  });
  if (startedAt) {
    const { db } = await import("../db.mjs");
    db.prepare("UPDATE meetings SET started_at = ? WHERE id = ?").run(startedAt, m.id);
  }
  return m;
}

test("meeting: when it ends, durable facts go to memory, linked to the meeting", async () => {
  await j("PUT", "/api/settings", { confirmMemoryChanges: false, userName: "Soubh" });
  nextMeetingOps = [{ action: "add", content: "In the meeting on 7 Oct 2026, Speaker 2 agreed to send the budget by Friday.", category: "work" }];
  const m = await finishedMeeting("Budget sync");
  await j("PATCH", `/api/meetings/${m.id}`, { ended: true });
  const d = await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return x.memoryStatus === "done" && x;
  });
  assert.equal(d.memoryCount, 1);
  const call = geminiCalls.json.findLast((c) => /transcript of a meeting/.test(c.system));
  assert.match(call.prompt, /Speaker 1: words from voice 21/);
  assert.match(call.prompt, /Speaker 2: words from voice 22/);
  assert.match(call.prompt, /The user's name is Soubh/);
  assert.match(call.prompt, /Meeting date:/);
  const memo = (await j("GET", "/api/memories")).data.find((x) => /send the budget/.test(x.content));
  assert.equal(memo.meetingId, m.id);
  assert.equal(memo.source, "meeting");
  // the assistant's brief for this meeting lists it
  const brief = (await j("GET", `/api/meetings/${m.id}/brief`)).data;
  assert.deepEqual(brief.memoriesFromThisMeeting, [memo.content]);
  assert.match(brief.transcript, /Speaker 2: words from voice 22/);
  nextMeetingOps = [];
});

test("meeting: memory from meetings can be switched off and run by hand", async () => {
  await j("PUT", "/api/settings", { meetingMemory: false });
  const calls = geminiCalls.json.length;
  const m = await finishedMeeting("Quiet one");
  await j("PATCH", `/api/meetings/${m.id}`, { ended: true });
  const d = await until(async () => {
    const x = (await j("GET", `/api/meetings/${m.id}`)).data;
    return x.refined && x.memoryStatus && x;
  });
  assert.equal(d.memoryStatus, "off");
  assert.equal(geminiCalls.json.length, calls, "nothing sent to Gemini");
  nextMeetingOps = [{ action: "add", content: "In the meeting on 7 Oct 2026, the team chose Goa for the offsite.", category: "plan" }];
  const after = (await j("POST", `/api/meetings/${m.id}/memorize`)).data;
  assert.equal(after.memoryStatus, "done");
  assert.equal(after.memoryCount, 1);
  nextMeetingOps = [{ action: "forget", memory_id: 1 }];
  const again = (await j("POST", `/api/meetings/${m.id}/memorize`)).data;
  assert.equal(again.memoryCount, 0, "meetings never delete memories");
  nextMeetingOps = [];
  await j("PUT", "/api/settings", { meetingMemory: true });
});

test("meeting: minutes are written, stored, exported and name an untitled meeting", async () => {
  const m = await finishedMeeting(""); // automatic "Meeting <date>" title
  assert.match(m.title, /^Meeting \d/);
  nextMinutes = {
    suggested_title: "Offsite planning",
    summary: "The team planned the offsite.",
    key_points: ["Goa is preferred"],
    decisions: ["Offsite in Goa"],
    action_items: [{ task: "Book flights", owner: "Speaker 2", due: "2026-10-20" }, { task: "" }],
    open_questions: [],
  };
  const d = (await j("POST", `/api/meetings/${m.id}/minutes`)).data;
  assert.equal(d.title, "Offsite planning");
  assert.equal(d.minutes.summary, "The team planned the offsite.");
  assert.deepEqual(d.minutes.actionItems, [{ task: "Book flights", owner: "Speaker 2", due: "2026-10-20" }]);
  assert.ok(d.minutesAt);
  const call = geminiCalls.json.at(-1);
  assert.match(call.prompt, /\[00:00\] Speaker \d: words from voice 21/);
  const md = await fetch(`${B}/api/meetings/${m.id}/export?format=md`).then((r) => r.text());
  assert.match(md, /## Minutes of meeting/);
  assert.match(md, /Book flights \| owner: Speaker 2 \| due: 2026-10-20/);
  assert.match(md, /## Transcript/);
  // a title the user chose is kept
  await j("PATCH", `/api/meetings/${m.id}`, { title: "My name" });
  nextMinutes = { ...nextMinutes, suggested_title: "Something else" };
  assert.equal((await j("POST", `/api/meetings/${m.id}/minutes`)).data.title, "My name");
  assert.equal((await j("DELETE", `/api/meetings/${m.id}/minutes`)).data.minutes, null);
  // nothing to summarise
  const empty = (await j("POST", "/api/meetings", { title: "Empty" })).data;
  assert.equal((await j("POST", `/api/meetings/${empty.id}/minutes`)).status, 400);
});

test("meetings can be found by date range and topic", async () => {
  const day = (y, mo, d, h = 10) => new Date(y, mo - 1, d, h).getTime();
  const wed = await finishedMeeting("Design review", day(2026, 10, 7));
  const thu = await finishedMeeting("Hiring chat", day(2026, 10, 8));
  const range = (a, b) => `/api/meetings/find?from=${a}&to=${b}`;
  // "last Wednesday" = 7 Oct 2026, local day
  let r = (await j("GET", range(day(2026, 10, 7, 0), day(2026, 10, 8, 0) - 1))).data;
  assert.deepEqual(r.meetings.map((x) => x.id), [wed.id]);
  assert.match(r.meetings[0].when, /Wednesday,? 7 October 2026/);
  assert.deepEqual(r.meetings[0].participants.sort(), ["Speaker 1", "Speaker 2"]);
  assert.match(r.meetings[0].preview, /words from voice/);
  r = (await j("GET", range(day(2026, 10, 7, 0), day(2026, 10, 9, 0)))).data;
  assert.deepEqual(r.meetings.map((x) => x.id), [thu.id, wed.id], "newest first");
  // topic inside the range
  r = (await j("GET", range(day(2026, 10, 7, 0), day(2026, 10, 9, 0)) + "&q=hiring")).data;
  assert.equal(r.matchedQuery, true);
  assert.deepEqual(r.meetings.map((x) => x.id), [thu.id]);
  // unknown topic: falls back to the date range
  r = (await j("GET", range(day(2026, 10, 7, 0), day(2026, 10, 9, 0)) + "&q=zebra")).data;
  assert.equal(r.matchedQuery, false);
  assert.equal(r.meetings.length, 2);
  // a day without meetings
  assert.deepEqual((await j("GET", range(day(2026, 10, 1, 0), day(2026, 10, 2, 0)))).data.meetings, []);
  // the assistant is told the current date and how to look meetings up
  const setup = (await j("GET", "/api/live/setup")).data;
  assert.match(setup.systemInstruction, /Right now it is \w+day,? \d+ \w+ \d{4}/);
  assert.match(setup.systemInstruction, /find_meetings/);
});


// ---- documents ------------------------------------------------------------------------------
// a tiny ZIP writer (deflate) so the tests can build real .docx/.pptx/.xlsx files
const zlib = await import("node:zlib");
function makeZip(files) {
  const locals = [], centrals = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, comp);
    centrals.push(ch, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test("documents: text comes out of Word, PowerPoint, Excel and CSV files", async () => {
  const { extractText, classify } = await import("../doc-text.mjs");
  const docx = makeZip({ "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>Monthly rent:</w:t></w:r><w:r><w:tab/><w:t>25,000 &amp; deposit</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:t>Start</w:t></w:p></w:tc><w:tc><w:p><w:t>1 Nov</w:t></w:p></w:tc></w:tr></w:tbl></w:body></w:document>` });
  const t = extractText("lease.docx", docx);
  assert.match(t, /Monthly rent:\t25,000 & deposit/);
  assert.match(t, /Start/);
  assert.match(t, /1 Nov/);

  const pptx = makeZip({
    "ppt/slides/slide2.xml": `<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>`,
    "ppt/slides/slide10.xml": `<p:sld><a:p><a:t>Tenth</a:t></a:p></p:sld>`,
    "ppt/slides/slide1.xml": `<p:sld><a:p><a:t>Title slide</a:t></a:p><a:p><a:t>Q3 results</a:t></a:p></p:sld>`,
  });
  const p = extractText("deck.pptx", pptx);
  assert.ok(p.indexOf("Title slide") < p.indexOf("Second slide") && p.indexOf("Second slide") < p.indexOf("Tenth"), "slides in numeric order");
  assert.match(p, /--- Slide 1 ---\nTitle slide\nQ3 results/);

  const xlsx = makeZip({
    "xl/workbook.xml": `<workbook><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>Item</t></si><si><t>Cost</t></si><si><r><t>Ren</t></r><r><t>t</t></r></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>25000</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Food</t></is></c><c r="B3"/></row></sheetData></worksheet>`,
  });
  const x = extractText("budget.xlsx", xlsx);
  assert.match(x, /--- Sheet: Budget ---\nItem\tCost\nRent\t\t25000\nFood/);

  assert.equal(extractText("a.csv", Buffer.from("﻿name,age\nA,3\n")), "name,age\nA,3");
  assert.equal(classify("x.pdf").kind, "pdf");
  assert.equal(classify("x.JPG").kind, "image");
  assert.match(classify("old.doc").error, /\.docx/);
  assert.match(classify("thing.exe").error, /aren't supported/);
  const { unzip } = await import("../doc-text.mjs");
  assert.throws(() => unzip(Buffer.from("not a zip at all, definitely not")), /not a valid Office file/);
});

test("documents: added to a conversation, read once, asked about, removed with it", async () => {
  const conv = (await j("POST", "/api/conversations")).data;
  const before = geminiCalls.json.length;
  const pdf = Buffer.from("%PDF-1.4 fake rental agreement");
  const up = await j("POST", `/api/conversations/${conv.id}/documents?name=${encodeURIComponent("Lease 2026.pdf")}`, pdf);
  assert.equal(up.status, 200, up.text);
  const docId = up.data.document.id;
  assert.equal(up.data.document.status, "analysing");
  assert.equal(up.data.message.modality, "document");
  assert.deepEqual(up.data.message.document, { id: docId, name: "Lease 2026.pdf" });

  const ready = await until(async () => {
    const d = (await j("GET", `/api/documents/${docId}`)).data;
    return d.status === "ready" && d;
  });
  assert.equal(ready.analysis.docType, "contract");
  assert.deepEqual(ready.analysis.suggestedQuestions, ["When does it end?"]);
  assert.equal(ready.analysis.pages, 2);
  const readCall = geminiCalls.json.slice(before).find((c) => /You read documents/.test(c.system));
  const inline = readCall.parts.find((p) => p.inlineData);
  assert.equal(inline.inlineData.mimeType, "application/pdf");
  assert.equal(Buffer.from(inline.inlineData.data, "base64").toString(), pdf.toString(), "the PDF itself goes to Gemini");

  // the attachment is part of the conversation
  const c = (await j("GET", `/api/conversations/${conv.id}`)).data;
  assert.equal(c.messages.at(-1).document.id, docId);

  // a text document: its text goes to Gemini, not the file
  const md = await j("POST", `/api/conversations/${conv.id}/documents?name=notes.md`, Buffer.from("# Notes\nThe deposit is two months of rent."));
  assert.equal(md.status, 200);
  await until(async () => (await j("GET", `/api/documents/${md.data.document.id}`)).data.status === "ready");

  // asking: one document, or all of them
  const one = await j("POST", `/api/conversations/${conv.id}/documents/ask`, { question: "How much is the rent?", documentId: docId });
  assert.equal(one.status, 200, one.text);
  assert.equal(one.data.found, true);
  assert.match(one.data.answer, /25,000/);
  assert.equal(one.data.quotes[0].where, "page 1");
  let ask = geminiCalls.json.at(-1);
  assert.match(ask.parts.at(-1).text, /How much is the rent/);
  assert.equal(ask.parts.filter((p) => p.inlineData).length, 1);
  assert.ok(!ask.parts.some((p) => /deposit is two months/.test(p.text || "")), "only the chosen document");
  await j("POST", `/api/conversations/${conv.id}/documents/ask`, { question: "What is the deposit?" });
  ask = geminiCalls.json.at(-1);
  assert.ok(ask.parts.some((p) => /deposit is two months/.test(p.text || "")) && ask.parts.some((p) => p.inlineData), "all documents");

  // the assistant is told about them
  const setup = (await j("GET", `/api/live/setup?conversation=${conv.id}`)).data;
  assert.match(setup.systemInstruction, new RegExp(`document_id ${docId}: "Lease 2026.pdf" \\(PDF\\) — contract, A one-year rental agreement`));
  assert.match(setup.systemInstruction, /call ask_document/);

  // files that can't be used are refused with a clear reason
  const bad = await j("POST", `/api/conversations/${conv.id}/documents?name=old.doc`, Buffer.from("x"));
  assert.equal(bad.status, 415);
  assert.match(bad.data.error, /Save it as \.docx/);
  const big = await j("POST", `/api/conversations/${conv.id}/documents?name=scan.png`, Buffer.alloc(15 * 1024 * 1024, 1));
  assert.equal(big.status, 413);
  assert.match(big.data.error, /limit for this type is 14 MB/);
  const empty = await j("POST", `/api/conversations/${conv.id}/documents?name=empty.txt`, Buffer.from("   \n  "));
  assert.equal(empty.status, 422);

  // a failed read can be retried
  docFail = true;
  const f = await j("POST", `/api/conversations/${conv.id}/documents?name=photo.jpg`, Buffer.from([0xff, 0xd8, 0xff, 1, 2]));
  const failed = await until(async () => {
    const d = (await j("GET", `/api/documents/${f.data.document.id}`)).data;
    return d.status === "error" && d;
  });
  assert.match(failed.error, /model unavailable/);
  docFail = false;
  await j("POST", `/api/documents/${f.data.document.id}/retry`);
  await until(async () => (await j("GET", `/api/documents/${f.data.document.id}`)).data.status === "ready");

  // the original can be downloaded
  const file = await fetch(`${B}/api/documents/${docId}/file`);
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), pdf.toString());
  assert.match(file.headers.get("content-disposition"), /Lease%202026\.pdf/);

  // removing one document, then the whole conversation, removes the stored files
  const docsDir = path.join(dataDir, "documents");
  const n = fs.readdirSync(docsDir).length;
  assert.equal((await j("DELETE", `/api/documents/${md.data.document.id}`)).data.deleted, true);
  assert.equal(fs.readdirSync(docsDir).length, n - 1);
  await j("DELETE", `/api/conversations/${conv.id}`);
  assert.equal(fs.readdirSync(docsDir).length, 0);
  assert.equal((await j("GET", `/api/documents/${docId}`)).status, 404);
});

test("data can be deleted", async () => {
  const r = (await j("DELETE", "/api/data")).data;
  assert.ok(r.memories >= 1 && r.meetings >= 1 && r.profiles >= 1);
  assert.deepEqual((await j("GET", "/api/memories")).data, []);
  assert.deepEqual((await j("GET", "/api/speakers")).data, []);
});
