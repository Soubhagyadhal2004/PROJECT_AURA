// Tiny fetch wrapper for the local AURA server (proxied by the dev server).

async function request<T>(method: string, url: string, body?: unknown, raw?: BodyInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: raw
        ? { "Content-Type": "application/octet-stream" }
        : body !== undefined
          ? { "Content-Type": "application/json" }
          : undefined,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error("Can't reach the AURA server. Start it with `npm run dev` and try again.");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 504 || (res.status === 500 && typeof data === "string" && /proxy/i.test(data))) {
      throw new Error("Can't reach the AURA server. Start it with `npm run dev` and try again.");
    }
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
  postAudio: <T>(url: string, pcm: ArrayBuffer) => request<T>("POST", url, undefined, pcm),
};

// ---- shared types ----------------------------------------------------------------
export type Settings = {
  liveModel: string;
  voice: string;
  userName: string;
  autoMemory: boolean;
  webSearch: boolean;
  confirmMemoryChanges: boolean;
  voiceMatchThreshold: number;
  voiceClusterThreshold: number;
  meetingLanguage: string;
  meetingTranscriber: "live" | "standard";
};

export type Health = {
  ok: boolean;
  hasKey: boolean;
  models: Record<"text" | "speaker" | "segmentation", { state: string; error: string | null; model: string }>;
  geminiModels: { text: string; transcribe: string };
  meetingWorker: { lastError: string | null; lastErrorAt: number | null };
  memoryReviews: number;
  dataDir: string;
};

export type Message = {
  id?: number;
  role: "user" | "assistant";
  modality?: "voice" | "text";
  text: string;
  createdAt?: number;
  pending?: boolean;
  // web search used for an assistant answer
  sources?: WebSource[];
  searchQueries?: string[];
  searchWidget?: string; // Google Search suggestions (HTML), shown only during the live session
};

export type WebSource = { title: string; uri: string };

export type ConversationSummary = {
  id: number;
  title: string;
  startedAt: number;
  updatedAt: number;
  messageCount: number;
  pinned: boolean;
  renamed: boolean;
};

export type Conversation = {
  id: number;
  title: string;
  renamed: boolean;
  pinned: boolean;
  startedAt: number;
  updatedAt: number;
  messages: Message[];
};

export type MemoryProposal = {
  id: number;
  action: "update" | "retire" | "forget";
  memoryId: number;
  content: string | null;
  category: string | null;
  conversationId: number | null;
  createdAt: number;
  current: Memory | null;
};

export type Memory = {
  id: number;
  content: string;
  category: string;
  status: "active" | "superseded" | "outdated";
  supersededBy: number | null;
  source: string;
  conversationId: number | null;
  createdAt: number;
  updatedAt: number;
  score?: number;
};

export type SpeakerProfile = {
  id: number;
  name: string;
  sampleSeconds: number;
  consentNote: string;
  createdAt: number;
  outdated: boolean;
};

export type MeetingSummary = {
  id: number;
  title: string;
  startedAt: number;
  endedAt: number | null;
  segmentCount: number;
  durationMs: number;
};

export type MeetingSpeaker = {
  id: number;
  label: string;
  profileId: number | null;
  matchScore: number | null;
  renamed: boolean;
  segments: number;
};

export type Segment = {
  id: number;
  speakerId: number | null;
  startMs: number;
  endMs: number;
  text: string | null;
  speakerScore: number | null;
  speakerUncertain: boolean;
  // pending/analysing: finding the speaker; live: being transcribed in the browser; queued: waiting for transcription
  status: "pending" | "analysing" | "live" | "queued" | "done" | "error" | "empty";
  error: string | null;
  retryable: boolean;
};

export type Meeting = {
  id: number;
  title: string;
  startedAt: number;
  endedAt: number | null;
  refined: boolean;
  speakers: MeetingSpeaker[];
  segments: Segment[];
};
