// Invariants of the selection test set. Run from the repository root: node --test eval/selection/tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPersona, buildTestset, CHANGE_CUE, FILLERS, SLOTS } from "../testset.mjs";
import { splitSentences } from "../select.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..", "..");
const src = fs.readFileSync(path.join(ROOT, "server", "memory.mjs"), "utf8");

test("CHANGE_CUE is an exact copy of the server's regex", () => {
  const m = src.match(/const CHANGE_CUE = \/(.*)\/([a-z]*);/);
  assert.ok(m, "regex found in server/memory.mjs");
  assert.equal(CHANGE_CUE.source, m[1]);
  assert.equal(CHANGE_CUE.flags, m[2]);
});

test("splitSentences is an exact copy of the server's splitter", () => {
  const m = src.match(/const splitSentences = \(text\) =>([\s\S]*?);\n/);
  const mine = fs.readFileSync(path.join(HERE, "..", "select.mjs"), "utf8").match(/export const splitSentences = \(text\) =>([\s\S]*?);\n/);
  assert.equal(mine[1].replace(/\s+/g, " "), m[1].replace(/\s+/g, " "));
});

test("build is deterministic", () => {
  assert.deepEqual(buildPersona(3), buildPersona(3));
  assert.notDeepEqual(buildPersona(3).events, buildPersona(4).events);
});

test("cue-free events and fillers contain no change-cue word; cue events do", () => {
  for (const f of FILLERS) assert.ok(!CHANGE_CUE.test(f), f);
  for (const p of buildTestset({ personas: 40 }).personas)
    for (const e of p.events) assert.equal(e.cue, e.form === "cue", e.text);
});

test("80 eligible events and 350 unique distractors per persona, no distractor names the persona's values", () => {
  for (const p of buildTestset({ personas: 40 }).personas) {
    assert.equal(p.events.length, 80);
    assert.equal(p.distractors.length, 350);
    assert.equal(new Set(p.distractors.map((d) => d.text)).size, 350);
    const vals = p.facts.flatMap((f) => [f.value, f.newValue]);
    for (const d of p.distractors) for (const v of vals) assert.ok(!new RegExp(`\\b${v}\\b`, "i").test(d.text), `${v} in ${d.text}`);
    assert.equal(p.facts.length, SLOTS.length);
    for (const e of p.events) {
      if (e.kind === "update") assert.ok(e.text.includes(e.newValue), e.text);
      if (e.context === "mixed") assert.equal(splitSentences(e.text).length, 3, e.text);
    }
  }
});
