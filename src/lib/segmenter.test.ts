import { Segmenter, type SpeechSegment } from "./segmenter";

const SR = 16000;
function chunk(ms: number, amp: number): ArrayBuffer {
  const n = Math.round((ms / 1000) * SR);
  const a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.round(Math.sin(i / 5) * amp * 32767);
  return a.buffer;
}
function feed(seg: Segmenter, pattern: [number, number][]) {
  for (const [ms, amp] of pattern) for (let t = 0; t < ms; t += 128) seg.push(chunk(Math.min(128, ms - t), amp));
}

test("cuts speech at pauses and reports timing", () => {
  const out: SpeechSegment[] = [];
  const seg = new Segmenter((s) => out.push(s));
  feed(seg, [[1000, 0], [2000, 0.3], [1000, 0], [1500, 0.3], [1000, 0]]);
  seg.flush();
  expect(out.length).toBe(2);
  expect(out[0].startMs).toBeGreaterThan(600);
  expect(out[0].startMs).toBeLessThan(1000);
  expect(out[1].startMs).toBeGreaterThan(3600);
  expect(out[0].endMs - out[0].startMs).toBeGreaterThan(1900);
});

test("splits long monologues and ignores clicks", () => {
  const out: SpeechSegment[] = [];
  const seg = new Segmenter((s) => out.push(s));
  feed(seg, [[500, 0], [130, 0.5], [1500, 0], [32000, 0.3]]);
  seg.flush();
  expect(out.length).toBe(3); // the 130 ms click is dropped, 32 s splits at 15 s
  expect(out.every((s) => s.endMs - s.startMs <= 15500)).toBe(true);
});
