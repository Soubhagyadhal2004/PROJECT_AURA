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
 * Extended for AURA: connection status and errors, microphone handling,
 * transcript capture, conversation persistence and memory recall tool.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FunctionDeclaration, LiveConnectConfig, LiveServerToolCall, Modality, Part, Type } from "@google/genai";
import { GenAILiveClient, LiveStatus } from "../lib/genai-live-client";
import { AudioStreamer } from "../lib/audio-streamer";
import { AudioRecorder } from "../lib/audio-recorder";
import { audioContext } from "../lib/utils";
import VolMeterWorket from "../lib/worklets/vol-meter";
import { api, Memory, Message } from "../lib/api";

const recallDeclaration: FunctionDeclaration = {
  name: "recall_memories",
  description:
    "Search AURA's long-term memory about the user (preferences, people, plans, personal facts) saved in earlier conversations.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "What to look for, e.g. 'sister's name' or 'favourite food'." },
    },
    required: ["query"],
  },
};

export type UseLiveAPIResults = {
  status: LiveStatus;
  error: string | null;
  clearError: () => void;
  canResume: boolean;
  connect: (opts?: { resume?: boolean; withMic?: boolean }) => Promise<boolean>;
  disconnect: () => void;
  micOn: boolean;
  setMicOn: (on: boolean) => void;
  micVolume: number;
  outVolume: number;
  messages: Message[];
  conversationId: number | null;
  sendText: (text: string) => Promise<void>;
  newConversation: () => void;
  memoryCount: number | null;
  lastRecall: { query: string; results: Memory[] } | null;
};

type SetupResponse = { model: string; voice: string; systemInstruction: string; memoryCount: number };

export function useLiveAPI(): UseLiveAPIResults {
  const client = useMemo(() => new GenAILiveClient(), []);
  const audioStreamerRef = useRef<AudioStreamer | null>(null);
  const recorder = useMemo(() => new AudioRecorder(), []);

  const [status, setStatus] = useState<LiveStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOnState] = useState(false);
  const [micVolume, setMicVolume] = useState(0);
  const [outVolume, setOutVolume] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [lastRecall, setLastRecall] = useState<UseLiveAPIResults["lastRecall"]>(null);
  const [canResume, setCanResume] = useState(false);

  const convIdRef = useRef<number | null>(null);
  const userClosing = useRef(false);
  const pendingUser = useRef<Message | null>(null);
  const pendingAssistant = useRef<Message | null>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  // ---- audio out -------------------------------------------------------------------------
  useEffect(() => {
    if (!audioStreamerRef.current) {
      audioContext({ id: "audio-out" }).then((ctx) => {
        audioStreamerRef.current = new AudioStreamer(ctx);
        audioStreamerRef.current.addWorklet<any>("vumeter-out", VolMeterWorket, (ev: any) => setOutVolume(ev.data.volume));
      });
    }
  }, []);

  // ---- persistence -------------------------------------------------------------------------
  const ensureConversation = useCallback(async () => {
    if (convIdRef.current) return convIdRef.current;
    const c = await api.post<{ id: number }>("/api/conversations");
    convIdRef.current = c.id;
    setConversationId(c.id);
    return c.id;
  }, []);

  const persist = useCallback(
    (m: Message) => {
      // keep messages in order
      saveChain.current = saveChain.current
        .then(async () => {
          const id = await ensureConversation();
          await api.post(`/api/conversations/${id}/messages`, { role: m.role, text: m.text, modality: m.modality });
        })
        .catch((e) => console.warn("could not save message", e));
    },
    [ensureConversation]
  );

  // messagesRef is the source of truth; state is a snapshot for rendering
  const messagesRef = useRef<Message[]>([]);
  const publish = useCallback(() => setMessages(messagesRef.current.slice()), []);

  const upsert = useCallback(
    (m: Message) => {
      messagesRef.current.push(m);
      publish();
    },
    [publish]
  );

  const finalize = useCallback(
    (ref: React.MutableRefObject<Message | null>, suffix = "") => {
      const m = ref.current;
      ref.current = null;
      if (!m) return;
      const text = (m.text + suffix).replace(/\s+/g, " ").trim();
      const list = messagesRef.current;
      const i = list.indexOf(m);
      if (!text) {
        if (i >= 0) list.splice(i, 1);
      } else {
        const done: Message = { ...m, text, pending: false };
        if (i >= 0) list[i] = done;
        else list.push(done);
        persist(done);
      }
      publish();
    },
    [persist, publish]
  );

  const appendTo = useCallback(
    (ref: React.MutableRefObject<Message | null>, role: "user" | "assistant", chunk: string, modality: "voice" | "text") => {
      const list = messagesRef.current;
      const cur = ref.current;
      if (cur) {
        const next: Message = { ...cur, text: cur.text + chunk };
        const i = list.indexOf(cur);
        if (i >= 0) list[i] = next;
        else list.push(next);
        ref.current = next;
      } else {
        const m: Message = { role, text: chunk, modality, pending: true, createdAt: Date.now() };
        list.push(m);
        ref.current = m;
      }
      publish();
    },
    [publish]
  );

  // ---- client events -------------------------------------------------------------------------
  useEffect(() => {
    const onOpen = () => setStatus("connected");
    const onClose = (e: CloseEvent) => {
      setStatus("disconnected");
      setMicOnState(false);
      finalize(pendingUser);
      finalize(pendingAssistant);
      if (!userClosing.current) {
        const reason = e?.reason ? `: ${e.reason}` : "";
        setError(`The voice session ended unexpectedly${reason}.`);
        setCanResume(Boolean(client.resumptionHandle));
      }
      userClosing.current = false;
      if (convIdRef.current) api.post(`/api/conversations/${convIdRef.current}/end`).catch(() => {});
    };
    const onError = (msg: string) => setError(msg);
    const onInterrupted = () => {
      audioStreamerRef.current?.stop();
      finalize(pendingAssistant, " …");
    };
    const onAudio = (data: ArrayBuffer) => audioStreamerRef.current?.addPCM16(new Uint8Array(data));
    const onInput = (t: string) => appendTo(pendingUser, "user", t, "voice");
    const onOutput = (t: string) => {
      if (pendingUser.current) finalize(pendingUser);
      appendTo(pendingAssistant, "assistant", t, "voice");
    };
    const onTurnComplete = () => {
      finalize(pendingUser);
      finalize(pendingAssistant);
    };
    const onToolCall = async (tc: LiveServerToolCall) => {
      const responses = await Promise.all(
        (tc.functionCalls || []).map(async (fc) => {
          if (fc.name !== "recall_memories") {
            return { id: fc.id, name: fc.name, response: { error: "unknown function" } };
          }
          const query = String((fc.args as any)?.query || "");
          try {
            const results = await api.get<Memory[]>(`/api/memories/search?q=${encodeURIComponent(query)}&k=6`);
            setLastRecall({ query, results });
            return {
              id: fc.id,
              name: fc.name,
              response: {
                memories: results.map((r) => ({
                  fact: r.content,
                  lastConfirmed: new Date(r.updatedAt).toISOString().slice(0, 10),
                })),
              },
            };
          } catch (e: any) {
            return { id: fc.id, name: fc.name, response: { error: e.message } };
          }
        })
      );
      client.sendToolResponse({ functionResponses: responses });
    };
    const onGoAway = () => {
      // server is about to recycle the connection: hop to a fresh one, keeping context
      if (client.resumptionHandle) {
        userClosing.current = true;
        const mic = recorder.recording;
        client.disconnect();
        connectRef.current?.({ resume: true, withMic: mic });
      }
    };

    client
      .on("open", onOpen)
      .on("close", onClose)
      .on("error", onError)
      .on("interrupted", onInterrupted)
      .on("audio", onAudio)
      .on("inputtranscription", onInput)
      .on("outputtranscription", onOutput)
      .on("text", onOutput)
      .on("turncomplete", onTurnComplete)
      .on("toolcall", onToolCall)
      .on("goaway", onGoAway);
    return () => {
      client.removeAllListeners();
      client.disconnect();
    };
  }, [client, recorder, appendTo, finalize]);

  // ---- microphone ------------------------------------------------------------------------------
  useEffect(() => {
    const onData = (b64: string) => client.sendAudio(b64);
    if (status === "connected" && micOn) {
      recorder.on("data", onData).on("volume", setMicVolume);
      recorder.start().catch((e) => {
        setError(e.message);
        setMicOnState(false);
      });
    } else {
      recorder.stop();
    }
    return () => {
      recorder.off("data", onData).off("volume", setMicVolume);
    };
  }, [status, micOn, client, recorder]);

  // ---- actions -------------------------------------------------------------------------------------
  const connect = useCallback(
    async ({ resume = false, withMic = true }: { resume?: boolean; withMic?: boolean } = {}) => {
      if (client.status !== "disconnected") return true;
      setError(null);
      setCanResume(false);
      setStatus("connecting");
      try {
        const setup = await api.get<SetupResponse>("/api/live/setup");
        setMemoryCount(setup.memoryCount);
        const handle = resume ? client.resumptionHandle : null;
        if (!resume) client.resumptionHandle = null;
        const config: LiveConnectConfig = {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setup.voice } } },
          systemInstruction: { parts: [{ text: setup.systemInstruction }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{ functionDeclarations: [recallDeclaration] }],
          sessionResumption: handle ? { handle } : {},
          contextWindowCompression: { slidingWindow: {} },
        };
        await client.connect(setup.model, config);
        setStatus("connected");
        if (withMic) setMicOnState(true);
        return true;
      } catch (e: any) {
        setStatus("disconnected");
        setError(`Couldn't start the voice session. ${e.message}`);
        return false;
      }
    },
    [client]
  );
  const connectRef = useRef(connect);
  connectRef.current = connect;

  const disconnect = useCallback(() => {
    userClosing.current = true;
    setMicOnState(false);
    audioStreamerRef.current?.stop();
    finalize(pendingUser);
    finalize(pendingAssistant);
    if (!client.disconnect()) userClosing.current = false;
    setStatus("disconnected");
    if (convIdRef.current) api.post(`/api/conversations/${convIdRef.current}/end`).catch(() => {});
  }, [client, finalize]);

  const sendText = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      if (client.status === "disconnected") {
        const ok = await connect({ withMic: false });
        if (!ok) return;
      }
      finalize(pendingUser);
      finalize(pendingAssistant);
      const m: Message = { role: "user", text: t, modality: "text", createdAt: Date.now() };
      upsert(m);
      persist(m);
      const parts: Part[] = [];
      try {
        const hits = (await api.get<Memory[]>(`/api/memories/search?q=${encodeURIComponent(t)}&k=4`)).filter(
          (h) => (h.score ?? 0) >= 0.35
        );
        if (hits.length) {
          parts.push({
            text:
              "[Context from AURA's long-term memory, possibly relevant — use only if it helps]\n" +
              hits.map((h) => `- ${h.content}`).join("\n"),
          });
        }
      } catch {}
      parts.push({ text: t });
      client.send(parts, true);
    },
    [client, connect, finalize, persist, upsert]
  );

  const newConversation = useCallback(() => {
    if (client.status !== "disconnected") disconnect();
    client.resumptionHandle = null;
    convIdRef.current = null;
    setConversationId(null);
    messagesRef.current = [];
    publish();
    setCanResume(false);
    setError(null);
    setLastRecall(null);
  }, [client, disconnect, publish]);

  const setMicOn = useCallback((on: boolean) => setMicOnState(on), []);
  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    error,
    clearError,
    canResume,
    connect,
    disconnect,
    micOn,
    setMicOn,
    micVolume,
    outVolume,
    messages,
    conversationId,
    sendText,
    newConversation,
    memoryCount,
    lastRecall,
  };
}
