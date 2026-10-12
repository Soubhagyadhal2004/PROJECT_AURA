// Energy-based voice-activity segmentation of 16 kHz PCM16 audio.
// Cuts the stream into utterances at pauses so each piece can be
// attributed to one speaker and transcribed.

export type SpeechSegment = { startMs: number; endMs: number; pcm: ArrayBuffer };

const SR = 16000;

export class Segmenter {
  private samplesSeen = 0;
  private noiseFloor = 0.004;
  private inSpeech = false;
  private chunks: Int16Array[] = [];
  private segStart = 0;
  private silenceMs = 0;
  private voicedMs = 0;
  private preRoll: Int16Array[] = [];

  constructor(
    private onSegment: (s: SpeechSegment) => void,
    private opts = { pauseMs: 700, maxMs: 10000, minVoicedMs: 400, preRollMs: 300 }
  ) {}

  push(buf: ArrayBuffer) {
    const pcm = new Int16Array(buf);
    if (!pcm.length) return;
    const chunkMs = (pcm.length / SR) * 1000;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i] / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / pcm.length);
    const threshold = Math.max(0.012, this.noiseFloor * 3);
    const voiced = rms > threshold;
    // track background level slowly while nobody is speaking
    if (!voiced) this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;

    const startOfChunk = this.samplesSeen;
    this.samplesSeen += pcm.length;

    if (!this.inSpeech) {
      this.preRoll.push(pcm);
      let preMs = this.preRoll.reduce((a, c) => a + c.length, 0) / SR * 1000;
      while (preMs - (this.preRoll[0].length / SR) * 1000 > this.opts.preRollMs) {
        preMs -= (this.preRoll.shift()!.length / SR) * 1000;
      }
      if (voiced) {
        this.inSpeech = true;
        this.chunks = this.preRoll.slice();
        const preSamples = this.chunks.reduce((a, c) => a + c.length, 0) - pcm.length;
        this.segStart = startOfChunk - preSamples;
        this.preRoll = [];
        this.silenceMs = 0;
        this.voicedMs = chunkMs;
      }
      return;
    }

    this.chunks.push(pcm);
    if (voiced) {
      this.voicedMs += chunkMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += chunkMs;
    }
    const lenMs = ((this.samplesSeen - this.segStart) / SR) * 1000;
    if (this.silenceMs >= this.opts.pauseMs || lenMs >= this.opts.maxMs) this.cut();
  }

  /** emit whatever is buffered (call when recording stops) */
  flush() {
    if (this.inSpeech) this.cut();
  }

  private cut() {
    // drop most of the trailing silence
    const keepTailMs = Math.min(this.silenceMs, 250);
    const dropSamples = Math.floor(((this.silenceMs - keepTailMs) / 1000) * SR);
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    const len = Math.max(0, total - dropSamples);
    const out = new Int16Array(len);
    let off = 0;
    for (const c of this.chunks) {
      if (off >= len) break;
      const take = Math.min(c.length, len - off);
      out.set(c.subarray(0, take), off);
      off += take;
    }
    const voicedMs = this.voicedMs;
    const startMs = (this.segStart / SR) * 1000;
    this.inSpeech = false;
    this.chunks = [];
    this.silenceMs = 0;
    this.voicedMs = 0;
    if (voicedMs >= this.opts.minVoicedMs) {
      this.onSegment({ startMs, endMs: startMs + (len / SR) * 1000, pcm: out.buffer });
    }
  }

  get elapsedMs() {
    return (this.samplesSeen / SR) * 1000;
  }
}
