// Meeting transcription over the Live API with Gemini 3.5 Transcribe Live.
//
// One streaming session is kept open while a meeting records. Each speaker turn
// is sent as its own "activity" (manual voice-activity mode), so every turn gets
// exactly one transcript back. The session is reopened automatically (Live
// sessions last at most 10 minutes). Turns that can't be transcribed here are
// handed back to the caller, which falls back to the standard transcription.
import { GoogleGenAI, LiveServerMessage, Modality, Session } from "@google/genai";
import { api } from "./api";

export const LIVE_TRANSCRIBE_MODEL = "gemini-3.5-transcribe-live";

type Job = { pcm: Int16Array; resolve: (text: string) => void; reject: (e: Error) => void; tries: number };

const CHUNK = 1600; // 100 ms at 16 kHz
// after the end of a turn, wait this long for more transcript text before calling it final
const SETTLE_MS = 1200;
const TURN_TIMEOUT_MS = 20000;

function toBase64(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class LiveTranscriber {
  private session: Session | null = null;
  private connecting: Promise<Session> | null = null;
  private queue: Job[] = [];
  private busy = false;
  private closed = false;
  // transcript of the turn in flight
  private current: { text: string; finished: boolean; touched: number } | null = null;
  private failures = 0;

  constructor(private opts: { vocabulary?: string[]; onStatus?: (s: "connecting" | "ready" | "error", detail?: string) => void } = {}) {}

  /** Transcribe one turn of 16 kHz PCM16 audio. Rejects if the Live service can't be used. */
  transcribe(pcm: Int16Array): Promise<string> {
    if (this.closed) return Promise.reject(new Error("transcriber closed"));
    return new Promise((resolve, reject) => {
      this.queue.push({ pcm, resolve, reject, tries: 0 });
      this.pump();
    });
  }

  close() {
    this.closed = true;
    for (const j of this.queue.splice(0)) j.reject(new Error("transcriber closed"));
    try {
      this.session?.close();
    } catch {}
    this.session = null;
  }

  private async connect(): Promise<Session> {
    if (this.session) return this.session;
    if (this.connecting) return this.connecting;
    this.opts.onStatus?.("connecting");
    this.connecting = (async () => {
      const { token } = await api.post<{ token: string }>("/api/live/token");
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
      let opened!: () => void;
      const ready = new Promise<void>((r) => (opened = r));
      const s = await ai.live.connect({
        model: LIVE_TRANSCRIBE_MODEL,
        config: {
          responseModalities: [Modality.TEXT],
          inputAudioTranscription: {
            // empty = automatic language detection, including switching languages mid-sentence
            languageCodes: [],
            ...(this.opts.vocabulary?.length ? { customVocabulary: this.opts.vocabulary.slice(0, 100) } : {}),
          },
          realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        },
        callbacks: {
          onopen: () => opened(),
          onmessage: (m: LiveServerMessage) => this.onMessage(m),
          onerror: (e: ErrorEvent) => console.warn("[live transcription] error", e?.message),
          onclose: () => {
            if (this.session === s) this.session = null;
          },
        },
      });
      await Promise.race([ready, new Promise((r) => setTimeout(r, 3000))]);
      this.session = s;
      this.opts.onStatus?.("ready");
      return s;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private onMessage(m: LiveServerMessage) {
    const sc = m.serverContent;
    if (!sc || !this.current) return;
    const t = sc.inputTranscription;
    if (t?.text) {
      this.current.text += (this.current.text && !/^\s/.test(t.text) ? " " : "") + t.text;
      this.current.touched = Date.now();
    }
    if (t?.finished || sc.turnComplete) {
      this.current.finished = true;
      this.current.touched = Date.now();
    }
  }

  private async pump() {
    if (this.busy || this.closed) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    try {
      const s = await this.connect();
      this.current = { text: "", finished: false, touched: Date.now() };
      s.sendRealtimeInput({ activityStart: {} });
      for (let i = 0; i < job.pcm.length; i += CHUNK) {
        s.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data: toBase64(job.pcm.subarray(i, i + CHUNK)) } });
      }
      s.sendRealtimeInput({ activityEnd: {} });
      const sentAt = Date.now();
      // wait for the final transcript: "finished", or text that stopped changing
      for (;;) {
        await new Promise((r) => setTimeout(r, 150));
        const c = this.current!;
        if (!this.session) throw new Error("Live transcription session closed");
        if (c.finished && Date.now() - c.touched > 150) break;
        if (c.text && Date.now() - c.touched > SETTLE_MS) break;
        if (Date.now() - sentAt > TURN_TIMEOUT_MS) {
          if (c.text) break;
          throw new Error("No transcript from Live transcription");
        }
      }
      const text = this.current!.text.replace(/\s+/g, " ").trim();
      this.current = null;
      this.failures = 0;
      job.resolve(text);
    } catch (e: any) {
      this.current = null;
      this.failures++;
      try {
        this.session?.close();
      } catch {}
      this.session = null;
      if (job.tries < 1 && this.failures < 3) {
        job.tries++;
        this.queue.unshift(job); // try once more on a fresh session
      } else {
        this.opts.onStatus?.("error", e?.message);
        job.reject(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      this.busy = false;
      if (this.queue.length) this.pump();
    }
  }
}
