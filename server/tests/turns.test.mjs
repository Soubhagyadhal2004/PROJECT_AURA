// Unit tests for turning pyannote frame regions into speaker turns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { regionsToTurns } from "../models.mjs";

// powerset ids: 0 silence, 1-3 one speaker, 4 = speakers 0+1, 5 = 0+2, 6 = 1+2
const r = (id, start, end) => ({ id, start, end });

test("one speaker covers the whole clip", () => {
  assert.deepEqual(regionsToTurns([r(0, 0, 0.3), r(1, 0.3, 4.5), r(0, 4.5, 5)], 5), [{ start: 0, end: 5, local: 0 }]);
});

test("a speaker change is cut in the middle of the pause", () => {
  const t = regionsToTurns([r(1, 0, 2), r(0, 2, 2.4), r(2, 2.4, 5)], 5);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((x) => x.local), [0, 1]);
  assert.ok(Math.abs(t[0].end - 2.2) < 1e-9 && t[1].start === t[0].end && t[1].end === 5);
});

test("short blips and overlaps don't create extra turns", () => {
  // 0.2 s of speaker 2 inside speaker 1, then an overlap that continues speaker 1
  const t = regionsToTurns([r(1, 0, 2), r(2, 2, 2.2), r(1, 2.2, 3), r(4, 3, 3.5), r(1, 3.5, 4)], 4);
  assert.deepEqual(t, [{ start: 0, end: 4, local: 0 }]);
});

test("the same speaker coming back keeps the same local index", () => {
  const t = regionsToTurns([r(1, 0, 1.5), r(2, 1.5, 3), r(1, 3, 4.5)], 4.5);
  assert.deepEqual(t.map((x) => x.local), [0, 1, 0]);
});

test("silence only falls back to one turn", () => {
  assert.deepEqual(regionsToTurns([r(0, 0, 3)], 3), [{ start: 0, end: 3, local: 0 }]);
});
