/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified for AURA: start() now rejects with a readable error when the
 * microphone is unavailable, and raw PCM is emitted alongside base64.
 */

import { audioContext } from "./utils";
import AudioRecordingWorklet from "./worklets/audio-processing";
import VolMeterWorket from "./worklets/vol-meter";

import { createWorketFromSrc } from "./audioworklet-registry";
import EventEmitter from "eventemitter3";

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function micErrorMessage(e: any): string {
  const name = e?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone access was blocked. Allow it in your browser's site settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError")
    return "The microphone is in use by another app. Close it and try again.";
  return e?.message || "Could not start the microphone.";
}

/**
 * Events: "data" (base64 PCM16 16 kHz), "pcm" (ArrayBuffer PCM16 16 kHz), "volume" (number)
 */
export class AudioRecorder extends EventEmitter {
  stream: MediaStream | undefined;
  audioContext: AudioContext | undefined;
  source: MediaStreamAudioSourceNode | undefined;
  recording: boolean = false;
  recordingWorklet: AudioWorkletNode | undefined;
  vuWorklet: AudioWorkletNode | undefined;

  private starting: Promise<void> | null = null;

  constructor(public sampleRate = 16000) {
    super();
  }

  async start() {
    if (this.recording) return;
    if (this.starting) return this.starting;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This browser can't record audio. Use a recent Chrome or Edge on localhost.");
    }

    this.starting = (async () => {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        throw new Error(micErrorMessage(e));
      }
      this.audioContext = await audioContext({ sampleRate: this.sampleRate });
      if (this.audioContext.state === "suspended") await this.audioContext.resume();
      this.source = this.audioContext.createMediaStreamSource(this.stream);

      const workletName = "audio-recorder-worklet";
      await this.audioContext.audioWorklet.addModule(createWorketFromSrc(workletName, AudioRecordingWorklet));
      this.recordingWorklet = new AudioWorkletNode(this.audioContext, workletName);
      this.recordingWorklet.port.onmessage = (ev: MessageEvent) => {
        const arrayBuffer: ArrayBuffer | undefined = ev.data.data.int16arrayBuffer;
        if (arrayBuffer && this.recording) {
          this.emit("pcm", arrayBuffer);
          if (this.listenerCount("data")) this.emit("data", arrayBufferToBase64(arrayBuffer));
        }
      };
      this.source.connect(this.recordingWorklet);

      const vuWorkletName = "vu-meter";
      await this.audioContext.audioWorklet.addModule(createWorketFromSrc(vuWorkletName, VolMeterWorket));
      this.vuWorklet = new AudioWorkletNode(this.audioContext, vuWorkletName);
      this.vuWorklet.port.onmessage = (ev: MessageEvent) => {
        this.emit("volume", ev.data.volume);
      };
      this.source.connect(this.vuWorklet);
      this.recording = true;
    })();

    try {
      await this.starting;
    } catch (e) {
      this.release();
      throw e;
    } finally {
      this.starting = null;
    }
  }

  private release() {
    this.recording = false;
    try {
      this.source?.disconnect();
      this.recordingWorklet?.disconnect();
      this.vuWorklet?.disconnect();
    } catch {}
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.source = undefined;
    this.recordingWorklet = undefined;
    this.vuWorklet = undefined;
    // a fresh context per recording keeps worklet registration simple
    this.audioContext?.close().catch(() => {});
    this.audioContext = undefined;
    this.emit("volume", 0);
  }

  stop() {
    // stop may be called before start completes
    if (this.starting) {
      this.starting.then(() => this.release(), () => {});
      return;
    }
    this.release();
  }
}
