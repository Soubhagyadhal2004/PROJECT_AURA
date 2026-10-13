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
import { FunctionDeclaration, GroundingMetadata, LiveConnectConfig, LiveServerToolCall, Modality, Part, Type } from "@google/genai";
import { GenAILiveClient, LiveStatus } from "../lib/genai-live-client";
import { AudioStreamer } from "../lib/audio-streamer";
import { AudioRecorder } from "../lib/audio-recorder";
import { audioContext } from "../lib/utils";
import VolMeterWorket from "../lib/worklets/vol-meter";
import { api, DOCUMENT_LIMIT_MB, DocumentInfo, Memory, Message, WebSource } from "../lib/api";

const recallDeclaration: FunctionDeclaration = {
  name: "recall_memories",
  description:
    "Search AURA's long-term memory about the user (preferences, people, plans, personal facts) learned in earlier conversations and recorded meetings.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: "What to look for, e.g. 'sister's name' or 'favourite food'." },
    },
    required: ["query"],
  },
};

const findMeetingsDeclaration: FunctionDeclaration = {
  name: "find_meetings",
  description:
    "List meetings the user recorded in Meeting Mode, newest first, with when they happened, who spoke and a short summary. " +
    "Use explicit local dates worked out from the current date (e.g. 'last Wednesday' -> that date). Leave dates out to search all meetings.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      from_date: { type: Type.STRING, description: "First day to include, YYYY-MM-DD (local date)." },
      to_date: { type: Type.STRING, description: "Last day to include, YYYY-MM-DD (local date). Same as from_date for a single day." },
      query: { type: Type.STRING, description: "Optional topic, person or keyword to look for in titles, minutes and transcripts." },
    },
  },
};

const getMeetingDeclaration: FunctionDeclaration = {
  name: "get_meeting",
  description:
    "Get one meeting in full: date, participants, minutes (summary, decisions, action items) if written, memories learned from it, and the transcript. " +
    "Call it before answering questions about what was said or decided.",
  parameters: {
    type: Type.OBJECT,
    properties: { meeting_id: { type: Type.INTEGER, description: "id from find_meetings" } },
    required: ["meeting_id"],
  },
};

const askDocumentDeclaration: FunctionDeclaration = {
  name: "ask_document",
  description:
    "Answer a question from the documents the user added to this conversation (PDF, Word, slides, spreadsheets, text, images). " +
    "Pass document_id to ask about one document, or leave it out to look across all of them. Returns the answer, whether it was found, and short quotes with page or section.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      question: { type: Type.STRING, description: "The question, phrased fully (e.g. 'What is the monthly rent and when is it due?')." },
      document_id: { type: Type.INTEGER, description: "Optional: the document to ask about." },
    },
    required: ["question"],
  },
};

const TOOL_DECLARATIONS = [recallDeclaration, findMeetingsDeclaration, getMeetingDeclaration, askDocumentDeclaration];

type ToolContext = {
  conversationId: number | null;
  onRecall: (query: string, results: Memory[]) => void;
  onDocumentLookup: (question: string, names: string[]) => void;
};

/** YYYY-MM-DD in the browser's time zone -> ms at the start of that day (or the end, with endOfDay). */
function localDay(s: unknown, endOfDay = false): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return undefined;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (endOfDay ? 1 : 0)).getTime();
  return endOfDay ? t - 1 : t;
}

/** Run one of AURA's own tools for the Live model. */
async function runTool(name: string | undefined, args: any, ctx: ToolContext): Promise<Record<string, unknown>> {
  if (name === "recall_memories") {
    const query = String(args?.query || "");
    const results = await api.get<Memory[]>(`/api/memories/search?q=${encodeURIComponent(query)}&k=6`);
    ctx.onRecall(query, results);
    return {
      memories: results.map((r) => ({
        fact: r.content,
        lastConfirmed: new Date(r.updatedAt).toISOString().slice(0, 10),
        ...(r.meetingId ? { fromMeetingId: r.meetingId } : {}),
      })),
    };
  }
  if (name === "find_meetings") {
    const from = localDay(args?.from_date);
    const to = localDay(args?.to_date || args?.from_date, true);
    const q = new URLSearchParams();
    if (from != null) q.set("from", String(from));
    if (to != null) q.set("to", String(to));
    if (args?.query) q.set("q", String(args.query));
    const r = await api.get<{ matchedQuery: boolean; meetings: unknown[] }>(`/api/meetings/find?${q}`);
    return {
      ...r,
      note: r.meetings.length
        ? args?.query && !r.matchedQuery
          ? "No meeting mentions that topic; these are all meetings in the date range."
          : undefined
        : "No meetings were recorded in that period.",
    };
  }
  if (name === "ask_document") {
    if (!ctx.conversationId) return { found: false, answer: "No documents have been added to this conversation." };
    const question = String(args?.question || "");
    const r = await api.post<Record<string, unknown> & { documents?: { name: string }[] }>(
      `/api/conversations/${ctx.conversationId}/documents/ask`,
      { question, documentId: args?.document_id ?? undefined }
    );
    ctx.onDocumentLookup(question, (r.documents || []).map((d) => d.name));
    return r;
  }
  if (name === "get_meeting") {
    return api.get<Record<string, unknown>>(`/api/meetings/${Number(args?.meeting_id)}/brief`);
  }
  return { error: "unknown function" };
}

export type UseLiveAPIResults = {
  status: LiveStatus;
  error: string | null;
  clearError: () => void;
  /** a non-error heads-up, e.g. web search was switched off for this session */
  notice: string | null;
  clearNotice: () => void;
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
  /** load a saved conversation and keep talking in it */
  continueConversation: (id: number) => Promise<void>;
  memoryCount: number | null;
  lastRecall: { query: string; results: Memory[] } | null;
  /** documents added to the current conversation */
  documents: DocumentInfo[];
  /** add files; resolves with an error per file that couldn't be added */
  attachFiles: (files: File[]) => Promise<{ name: string; error: string }[]>;
  removeDocument: (id: number) => Promise<void>;
  retryDocument: (id: number) => Promise<void>;
  lastDocumentLookup: { question: string; names: string[] } | null;
};

const QUOTA_RE = /quota|exceeded|resource.?exhausted|rate.?limit/i;
// how a Live model says it doesn't take the transcription language (wording varies between models)
const LANGUAGE_RE = /language.?code|languageCodes|input_?audio_?transcription|inputAudioTranscription|unsupported language|invalid.*language/i;
const SEARCH_OFF_NOTICE =
  "Web search was rejected for this model (its search quota is used up or not available on your plan), so AURA switched it off and reconnected. Voice still works. For search, pick a different Live model in Settings, such as gemini-2.5-flash-native-audio-preview-12-2025, then reload the page.";

const LANGUAGE_OFF_NOTICE =
  "This Live model didn't accept the speech language set in Settings, so AURA reconnected with automatic language detection. Voice still works. To use the setting, try a different Live model in Settings.";

type SetupResponse = {
  model: string;
  voice: string;
  systemInstruction: string;
  memoryCount: number;
  webSearch: boolean;
  /** languages for transcribing the user's speech ([] or missing = detect automatically) */
  languageCodes?: string[];
};

type TurnSearch = { sources: WebSource[]; searchQueries: string[]; searchWidget?: string };

function mergeSearch(prev: TurnSearch | null, g: GroundingMetadata): TurnSearch {
  const out: TurnSearch = prev ? { ...prev, sources: prev.sources.slice(), searchQueries: prev.searchQueries.slice() } : { sources: [], searchQueries: [] };
  for (const c of g.groundingChunks || []) {
    const uri = c.web?.uri;
    if (uri && !out.sources.some((s) => s.uri === uri)) out.sources.push({ title: c.web?.title || c.web?.domain || uri, uri });
  }
  for (const q of g.webSearchQueries || []) if (q && !out.searchQueries.includes(q)) out.searchQueries.push(q);
  if (g.searchEntryPoint?.renderedContent) out.searchWidget = g.searchEntryPoint.renderedContent;
  return out;
}

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
  const [notice, setNotice] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [lastDocumentLookup, setLastDocumentLookup] = useState<UseLiveAPIResults["lastDocumentLookup"]>(null);
  // documents to tell the running session about once they have been read
  const announce = useRef(new Set<number>());
  const documentsRef = useRef<DocumentInfo[]>([]);
  documentsRef.current = documents;
  /** whether the running session was started with Google Search */
  const searchOn = useRef(false);
  /** set once Google rejected search for quota reasons; search stays off until the page is reloaded */
  const searchBlocked = useRef(false);
  /** whether the running session was started with a speech language from Settings */
  const languageOn = useRef(false);
  /** set once the model refused that language; it stays off until the page is reloaded */
  const languageBlocked = useRef(false);

  const convIdRef = useRef<number | null>(null);
  const userClosing = useRef(false);
  const pendingUser = useRef<Message | null>(null);
  const pendingAssistant = useRef<Message | null>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  // web search results for the assistant turn in progress
  const turnSearch = useRef<TurnSearch | null>(null);

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
  // one conversation is created even when a message and a document need it at the same time
  const creating = useRef<Promise<number> | null>(null);
  const ensureConversation = useCallback(async () => {
    if (convIdRef.current) return convIdRef.current;
    if (!creating.current) {
      creating.current = api
        .post<{ id: number }>("/api/conversations")
        .then((c) => {
          convIdRef.current = c.id;
          setConversationId(c.id);
          return c.id;
        })
        .finally(() => {
          creating.current = null;
        });
    }
    return creating.current;
  }, []);

  const persist = useCallback(
    (m: Message) => {
      // keep messages in order
      saveChain.current = saveChain.current
        .then(async () => {
          const id = await ensureConversation();
          await api.post(`/api/conversations/${id}/messages`, {
            role: m.role,
            text: m.text,
            modality: m.modality,
            sources: m.sources,
            searchQueries: m.searchQueries,
          });
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
        let done: Message = { ...m, text, pending: false };
        if (m.role === "assistant" && turnSearch.current) {
          done = { ...done, ...turnSearch.current };
          turnSearch.current = null;
        }
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
        const m: Message = {
          role,
          text: chunk,
          modality,
          pending: true,
          createdAt: Date.now(),
          ...(role === "assistant" && turnSearch.current ? turnSearch.current : {}),
        };
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
      const mic = recorder.recording;
      setStatus("disconnected");
      setMicOnState(false);
      finalize(pendingUser);
      finalize(pendingAssistant);
      if (!userClosing.current && searchOn.current && !searchBlocked.current && QUOTA_RE.test(e?.reason || "")) {
        // Google refused search (e.g. no free-tier search quota for this model): carry on without it
        searchBlocked.current = true;
        searchOn.current = false;
        setNotice(SEARCH_OFF_NOTICE);
        const handle = Boolean(client.resumptionHandle);
        setTimeout(() => connectRef.current?.({ resume: handle, withMic: mic }), 0);
        return;
      }
      if (!userClosing.current && languageOn.current && !languageBlocked.current && LANGUAGE_RE.test(e?.reason || "")) {
        // the model refused the speech language from Settings: carry on with automatic detection
        languageBlocked.current = true;
        languageOn.current = false;
        setNotice(LANGUAGE_OFF_NOTICE);
        const handle = Boolean(client.resumptionHandle);
        setTimeout(() => connectRef.current?.({ resume: handle, withMic: mic }), 0);
        return;
      }
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
      turnSearch.current = null;
    };
    const onGrounding = (g: GroundingMetadata) => {
      turnSearch.current = mergeSearch(turnSearch.current, g);
      // show the sources on the answer while it is still streaming
      const cur = pendingAssistant.current;
      if (cur) {
        const next: Message = { ...cur, ...turnSearch.current };
        const list = messagesRef.current;
        const i = list.indexOf(cur);
        if (i >= 0) list[i] = next;
        pendingAssistant.current = next;
        publish();
      }
    };
    const onToolCall = async (tc: LiveServerToolCall) => {
      const responses = await Promise.all(
        (tc.functionCalls || []).map(async (fc) => {
          try {
            const response = await runTool(fc.name, fc.args, {
              conversationId: convIdRef.current,
              onRecall: (query, results) => setLastRecall({ query, results }),
              onDocumentLookup: (question, names) => setLastDocumentLookup({ question, names }),
            });
            return { id: fc.id, name: fc.name, response };
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
      .on("grounding", onGrounding)
      .on("toolcall", onToolCall)
      .on("goaway", onGoAway);
    return () => {
      client.removeAllListeners();
      client.disconnect();
    };
  }, [client, recorder, appendTo, finalize, publish]);

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
    async ({ resume = false, withMic = true }: { resume?: boolean; withMic?: boolean } = {}): Promise<boolean> => {
      if (client.status !== "disconnected") return true;
      setError(null);
      setCanResume(false);
      setStatus("connecting");
      try {
        // a continued conversation gives the assistant its earlier messages
        const setup = await api.get<SetupResponse>(
          `/api/live/setup${!resume && convIdRef.current ? `?conversation=${convIdRef.current}` : ""}`
        );
        setMemoryCount(setup.memoryCount);
        const handle = resume ? client.resumptionHandle : null;
        if (!resume) client.resumptionHandle = null;
        const useSearch = setup.webSearch && !searchBlocked.current;
        searchOn.current = useSearch;
        const languageCodes = languageBlocked.current ? [] : setup.languageCodes || [];
        languageOn.current = languageCodes.length > 0;
        const config: LiveConnectConfig = {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setup.voice } } },
          systemInstruction: { parts: [{ text: setup.systemInstruction }] },
          // transcript of what the user says; a language from Settings stops English being written in Hindi script
          inputAudioTranscription: languageOn.current ? { languageCodes } : {},
          outputAudioTranscription: {},
          tools: useSearch
            ? [{ googleSearch: {} }, { functionDeclarations: TOOL_DECLARATIONS }]
            : [{ functionDeclarations: TOOL_DECLARATIONS }],
          sessionResumption: handle ? { handle } : {},
          contextWindowCompression: { slidingWindow: {} },
        };
        await client.connect(setup.model, config);
        // the new session's instructions already describe documents that have been read
        if (!resume) for (const d of documentsRef.current) if (d.status !== "analysing") announce.current.delete(d.id);
        setStatus("connected");
        if (withMic) setMicOnState(true);
        return true;
      } catch (e: any) {
        setStatus("disconnected");
        if (searchOn.current && !searchBlocked.current && QUOTA_RE.test(String(e?.message || ""))) {
          searchBlocked.current = true;
          searchOn.current = false;
          setNotice(SEARCH_OFF_NOTICE);
          return connectRef.current ? connectRef.current({ resume, withMic }) : false;
        }
        if (languageOn.current && !languageBlocked.current && LANGUAGE_RE.test(String(e?.message || ""))) {
          languageBlocked.current = true;
          languageOn.current = false;
          setNotice(LANGUAGE_OFF_NOTICE);
          return connectRef.current ? connectRef.current({ resume, withMic }) : false;
        }
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
    setDocuments([]);
    setLastDocumentLookup(null);
    announce.current.clear();
  }, [client, disconnect, publish]);

  const continueConversation = useCallback(
    async (id: number) => {
      const c = await api.get<{ id: number; messages: Message[]; documents?: DocumentInfo[] }>(`/api/conversations/${id}`);
      if (client.status !== "disconnected") disconnect();
      client.resumptionHandle = null;
      convIdRef.current = c.id;
      setConversationId(c.id);
      messagesRef.current = c.messages.map((m) => ({ ...m, pending: false }));
      publish();
      setCanResume(false);
      setError(null);
      setLastRecall(null);
      setDocuments(c.documents || []);
      setLastDocumentLookup(null);
      announce.current.clear();
    },
    [client, disconnect, publish]
  );

  // ---- documents ---------------------------------------------------------------------------------
  const attachFiles = useCallback(
    async (files: File[]) => {
      const failed: { name: string; error: string }[] = [];
      if (!files.length) return failed;
      let convId: number;
      try {
        convId = await ensureConversation();
      } catch (e: any) {
        return files.map((f) => ({ name: f.name, error: e.message }));
      }
      for (const f of files) {
        const inline = /\.(pdf|png|jpe?g|webp|hei[cf])$/i.test(f.name);
        const limit = inline ? DOCUMENT_LIMIT_MB.inline : DOCUMENT_LIMIT_MB.other;
        if (f.size > limit * 1048576) {
          failed.push({ name: f.name, error: `It's ${(f.size / 1048576).toFixed(1)} MB; the limit for this type is ${limit} MB.` });
          continue;
        }
        try {
          const r = await api.upload<{ document: DocumentInfo; message: Message }>(
            `/api/conversations/${convId}/documents?name=${encodeURIComponent(f.name)}`,
            f
          );
          finalize(pendingUser);
          finalize(pendingAssistant);
          upsert(r.message);
          setDocuments((d) => [...d, r.document]);
          announce.current.add(r.document.id);
        } catch (e: any) {
          failed.push({ name: f.name, error: e.message });
        }
      }
      return failed;
    },
    [ensureConversation, finalize, upsert]
  );

  const removeDocument = useCallback(
    async (id: number) => {
      const doc = documents.find((d) => d.id === id);
      await api.del(`/api/documents/${id}`);
      setDocuments((d) => d.filter((x) => x.id !== id));
      announce.current.delete(id);
      if (doc && client.status === "connected") {
        client.send([{ text: `[AURA app] The user removed document_id ${id} ("${doc.name}"); it is no longer available.` }], false);
      }
    },
    [client, documents]
  );

  const retryDocument = useCallback(async (id: number) => {
    const d = await api.post<DocumentInfo>(`/api/documents/${id}/retry`);
    setDocuments((list) => list.map((x) => (x.id === id ? d : x)));
    announce.current.add(id);
  }, []);

  // follow documents that are still being read
  const reading = documents.filter((d) => d.status === "analysing").map((d) => d.id).join(",");
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(async () => {
      for (const id of reading.split(",").map(Number)) {
        try {
          const d = await api.get<DocumentInfo>(`/api/documents/${id}`);
          if (d.status !== "analysing") setDocuments((list) => list.map((x) => (x.id === id ? d : x)));
        } catch {}
      }
    }, 1500);
    return () => clearInterval(t);
  }, [reading]);

  // tell a running session about a document once it has been read, so it can give an overview
  useEffect(() => {
    if (status !== "connected") return;
    for (const d of documents) {
      if (!announce.current.has(d.id) || d.status === "analysing") continue;
      announce.current.delete(d.id);
      if (d.status !== "ready" || !d.analysis) continue;
      const a = d.analysis;
      client.send(
        [
          {
            text:
              `[AURA app] The user added a document: document_id ${d.id}, "${d.name}" (${d.label}${a.pages ? `, ${a.pages} pages` : ""}). ` +
              `Overview: ${a.docType ? a.docType + ". " : ""}${a.overview}` +
              (d.truncated ? " (It is long, so only its first part can be read.)" : "") +
              ` Say in one or two short sentences what it is and ask what they'd like to know. Use ask_document for questions about it.`,
          },
        ],
        true
      );
    }
  }, [documents, status, client]);

  const setMicOn = useCallback((on: boolean) => setMicOnState(on), []);
  const clearError = useCallback(() => setError(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    status,
    error,
    clearError,
    notice,
    clearNotice,
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
    continueConversation,
    memoryCount,
    lastRecall,
    documents,
    attachFiles,
    removeDocument,
    retryDocument,
    lastDocumentLookup,
  };
}
