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
 * Modified for AURA: connects with short-lived tokens issued by the local
 * server (the API key never reaches the browser), surfaces audio
 * transcriptions, session resumption and go-away notices.
 */

import {
  GoogleGenAI,
  GroundingMetadata,
  LiveCallbacks,
  LiveClientToolResponse,
  LiveConnectConfig,
  LiveServerMessage,
  LiveServerToolCall,
  Part,
  Session,
} from "@google/genai";

import { EventEmitter } from "eventemitter3";
import { base64ToArrayBuffer } from "./utils";
import { api } from "./api";

export interface LiveClientEventTypes {
  audio: (data: ArrayBuffer) => void;
  close: (event: CloseEvent) => void;
  error: (message: string) => void;
  interrupted: () => void;
  open: () => void;
  setupcomplete: () => void;
  toolcall: (toolCall: LiveServerToolCall) => void;
  turncomplete: () => void;
  /** chunk of the transcription of what the user said */
  inputtranscription: (text: string) => void;
  /** chunk of the transcription of what the model said */
  outputtranscription: (text: string) => void;
  /** non-audio text returned by the model (rare in audio mode) */
  text: (text: string) => void;
  /** the server will close the connection soon */
  goaway: (timeLeft?: string) => void;
  /** Google Search results used for the current answer */
  grounding: (metadata: GroundingMetadata) => void;
}

export type LiveStatus = "disconnected" | "connecting" | "connected";

export class GenAILiveClient extends EventEmitter<LiveClientEventTypes> {
  private _status: LiveStatus = "disconnected";
  public get status() {
    return this._status;
  }

  private _session: Session | null = null;
  public get session() {
    return this._session;
  }

  /** handle that lets a dropped session continue with its context */
  public resumptionHandle: string | null = null;

  constructor() {
    super();
    this.send = this.send.bind(this);
    this.onopen = this.onopen.bind(this);
    this.onerror = this.onerror.bind(this);
    this.onclose = this.onclose.bind(this);
    this.onmessage = this.onmessage.bind(this);
  }

  async connect(model: string, config: LiveConnectConfig): Promise<boolean> {
    if (this._status !== "disconnected") return false;
    this._status = "connecting";

    const callbacks: LiveCallbacks = {
      onopen: this.onopen,
      onmessage: this.onmessage,
      onerror: this.onerror,
      onclose: this.onclose,
    };

    try {
      const { token } = await api.post<{ token: string }>("/api/live/token");
      const ai = new GoogleGenAI({
        apiKey: token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      this._session = await ai.live.connect({ model, config, callbacks });
    } catch (e: any) {
      this._status = "disconnected";
      this._session = null;
      throw new Error(e?.message || "Could not connect to Gemini Live");
    }
    this._status = "connected";
    return true;
  }

  public disconnect() {
    const s = this._session;
    this._session = null;
    this._status = "disconnected";
    if (!s) return false;
    try {
      s.close();
    } catch {}
    return true;
  }

  protected onopen() {
    this.emit("open");
  }

  protected onerror(e: ErrorEvent) {
    this.emit("error", e?.message || "Connection error");
  }

  protected onclose(e: CloseEvent) {
    this._session = null;
    this._status = "disconnected";
    this.emit("close", e);
  }

  protected async onmessage(message: LiveServerMessage) {
    if (message.setupComplete) {
      this.emit("setupcomplete");
    }
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      this.resumptionHandle = message.sessionResumptionUpdate.newHandle;
    }
    if (message.goAway) {
      this.emit("goaway", message.goAway.timeLeft);
    }
    if (message.toolCall) {
      this.emit("toolcall", message.toolCall);
    }

    const sc = message.serverContent;
    if (!sc) return;

    if (sc.interrupted) {
      this.emit("interrupted");
    }
    if (sc.inputTranscription?.text) {
      this.emit("inputtranscription", sc.inputTranscription.text);
    }
    if (sc.outputTranscription?.text) {
      this.emit("outputtranscription", sc.outputTranscription.text);
    }
    if (sc.groundingMetadata) {
      this.emit("grounding", sc.groundingMetadata);
    }
    const parts: Part[] = sc.modelTurn?.parts || [];
    for (const p of parts) {
      if (p.inlineData?.mimeType?.startsWith("audio/pcm") && p.inlineData.data) {
        this.emit("audio", base64ToArrayBuffer(p.inlineData.data));
      } else if (p.text && !p.thought) {
        this.emit("text", p.text);
      }
    }
    if (sc.turnComplete) {
      this.emit("turncomplete");
    }
  }

  /** stream realtime audio (base64 PCM16 @16 kHz) */
  sendAudio(base64: string) {
    this._session?.sendRealtimeInput({
      audio: { mimeType: "audio/pcm;rate=16000", data: base64 },
    });
  }

  sendToolResponse(toolResponse: LiveClientToolResponse) {
    if (toolResponse.functionResponses?.length) {
      this._session?.sendToolResponse({
        functionResponses: toolResponse.functionResponses,
      });
    }
  }

  /** send a typed turn */
  send(parts: Part | Part[], turnComplete: boolean = true) {
    this._session?.sendClientContent({ turns: parts, turnComplete });
  }
}
