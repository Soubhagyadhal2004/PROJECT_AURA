// Voice gate for ambient mode: only voices that have a registered profile are listened to.
//
// Audio from a film, a video call or AURA's own speaker belongs to nobody on the list, so it is dropped
// before it is transcribed, scored or stored. The decision is a pure function (decideGate) so it can be tested
// without the speaker model.
//
//   AURA_AMBIENT_VOICE_GATE=auto      auto (default): on when at least one voice profile exists
//                                     on / enrolled: always on (with no profiles, nothing passes)
//                                     off: never
//   AURA_AMBIENT_GATE_THRESHOLD=0.5   similarity to a registered profile needed to pass
//   AURA_AMBIENT_GATE_MIN_SEC=1.0     shorter clips give a weak voiceprint: they pass only if they are
//                                     addressed to AURA (decided by the caller, verdict "short")
//   AURA_AMBIENT_GATE_ONLY=<name>     optional: accept only this registered person (e.g. "Soubhagya")
import { pcmSeconds } from "./audio.mjs";

const num = (k, d) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== "" && process.env[k] != null ? v : d;
};

export function gateConfig() {
  const m = String(process.env.AURA_AMBIENT_VOICE_GATE || "auto").toLowerCase();
  return {
    mode: ["on", "enrolled"].includes(m) ? "on" : m === "off" ? "off" : "auto",
    threshold: num("AURA_AMBIENT_GATE_THRESHOLD", 0.5),
    minSeconds: num("AURA_AMBIENT_GATE_MIN_SEC", 1.0),
    only: String(process.env.AURA_AMBIENT_GATE_ONLY || "").trim().toLowerCase(),
  };
}

/**
 * scores: [{ name, score }] sorted or not. Returns { pass, verdict, name?, score?, requireAddressed? }
 *   verdict: open (gate not active) | match | short (too short to judge) | reject | error
 */
export function decideGate({ scores = [], seconds = 0, profiles = scores.length, cfg = gateConfig() } = {}) {
  if (cfg.mode === "off") return { pass: true, verdict: "open", reason: "voice gate is off" };
  if (cfg.mode === "auto" && profiles === 0) return { pass: true, verdict: "open", reason: "no voice profiles yet" };
  if (profiles === 0) return { pass: false, verdict: "reject", reason: "no registered voices" };
  if (seconds < cfg.minSeconds) {
    return { pass: true, verdict: "short", requireAddressed: true, reason: "too short to recognise the voice" };
  }
  const pool = cfg.only ? scores.filter((s) => String(s.name).toLowerCase() === cfg.only) : scores;
  const best = [...pool].sort((a, b) => b.score - a.score)[0];
  if (best && best.score >= cfg.threshold) {
    return { pass: true, verdict: "match", name: best.name, score: best.score, reason: `voice matches ${best.name}` };
  }
  return {
    pass: false,
    verdict: "reject",
    name: best?.name ?? null,
    score: best?.score ?? null,
    reason: best ? `not a registered voice (best ${best.name} ${best.score.toFixed(2)})` : "not a registered voice",
  };
}

/** Check one utterance (16 kHz PCM16). Any failure of the speaker model lets the audio through. */
export async function checkVoice(pcm, deps = {}) {
  const cfg = gateConfig();
  if (cfg.mode === "off") return decideGate({ cfg });
  try {
    const meetings = deps.meetings || (await import("./meetings.mjs"));
    const profiles = meetings.listProfiles().length;
    if (profiles === 0) return decideGate({ cfg, profiles });
    const seconds = pcmSeconds(pcm);
    if (seconds < cfg.minSeconds) return decideGate({ seconds, profiles, cfg });
    const scores = await meetings.identify(pcm);
    return decideGate({ scores, seconds, profiles, cfg });
  } catch (e) {
    return { pass: true, verdict: "error", reason: `voice check unavailable: ${e.message}` };
  }
}
