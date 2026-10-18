// Tests of the ambient voice gate (server/voicegate.mjs): only registered voices pass.
// Run: npm run test:server
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideGate, gateConfig, checkVoice } from "../voicegate.mjs";

for (const k of Object.keys(process.env)) if (k.startsWith("AURA_AMBIENT_")) delete process.env[k];
const cfg = (o = {}) => ({ ...gateConfig(), ...o });
const scores = [{ name: "Soubhagya", score: 0.71 }, { name: "Aditya", score: 0.2 }, { name: "Mehal", score: 0.1 }];

test("a registered voice passes and is named", () => {
  const g = decideGate({ scores, seconds: 2.5, cfg: cfg() });
  assert.equal(g.pass, true);
  assert.equal(g.verdict, "match");
  assert.equal(g.name, "Soubhagya");
});

test("a voice nobody registered (a film, a call, AURA itself) is rejected", () => {
  const g = decideGate({ scores: scores.map((s) => ({ ...s, score: 0.3 })), seconds: 3, cfg: cfg() });
  assert.equal(g.pass, false);
  assert.equal(g.verdict, "reject");
});

test("the threshold is the line: just under fails, at it passes", () => {
  const at = (v) => decideGate({ scores: [{ name: "A", score: v }], seconds: 2, cfg: cfg({ threshold: 0.5 }) }).pass;
  assert.equal(at(0.49), false);
  assert.equal(at(0.5), true);
});

test("clips too short to judge pass only on condition that they are addressed to AURA", () => {
  const g = decideGate({ scores, seconds: 0.4, cfg: cfg() });
  assert.equal(g.pass, true);
  assert.equal(g.verdict, "short");
  assert.equal(g.requireAddressed, true);
});

test("with no profiles the gate stays open in auto mode and closed when forced on", () => {
  assert.equal(decideGate({ scores: [], profiles: 0, seconds: 3, cfg: cfg({ mode: "auto" }) }).verdict, "open");
  assert.equal(decideGate({ scores: [], profiles: 0, seconds: 3, cfg: cfg({ mode: "on" }) }).pass, false);
});

test("off lets everything through", () => {
  assert.equal(decideGate({ scores: [], profiles: 0, seconds: 3, cfg: cfg({ mode: "off" }) }).pass, true);
});

test("'only' accepts a single person: another registered voice is rejected", () => {
  const onlyMe = cfg({ only: "soubhagya" });
  assert.equal(decideGate({ scores, seconds: 2, cfg: onlyMe }).pass, true);
  const aditya = [{ name: "Soubhagya", score: 0.1 }, { name: "Aditya", score: 0.8 }];
  assert.equal(decideGate({ scores: aditya, seconds: 2, cfg: onlyMe }).pass, false);
});

test("checkVoice scores the audio against the profiles, and fails open if the speaker model breaks", async () => {
  const pcm = Buffer.alloc(16000 * 2 * 2); // two seconds
  const ok = await checkVoice(pcm, { meetings: { listProfiles: () => [{}], identify: async () => scores } });
  assert.equal(ok.verdict, "match");
  const no = await checkVoice(pcm, { meetings: { listProfiles: () => [{}], identify: async () => [{ name: "X", score: 0.1 }] } });
  assert.equal(no.pass, false);
  const broken = await checkVoice(pcm, { meetings: { listProfiles: () => [{}], identify: async () => { throw new Error("model down"); } } });
  assert.equal(broken.pass, true);
  assert.equal(broken.verdict, "error");
  const none = await checkVoice(pcm, { meetings: { listProfiles: () => [], identify: async () => [] } });
  assert.equal(none.verdict, "open");
});
