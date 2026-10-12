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
  speakerMatchThreshold: number;
  speakerClusterThreshold: number;
};

export type Health = {
  ok: boolean;
  hasKey: boolean;
  models: Record<"text" | "speaker", { state: string; error: string | null; model: string }>;
  geminiModels: { text: string; transcribe: string };
  meetingWorker: { lastError: string | null; lastErrorAt: number | null };
  dataDir: string;
};

export type Message = {
  id?: number;
  role: "user" | "assistant";
  modality?: "voice" | "text";
  text: string;
  createdAt?: number;
  pending?: boolean;
};

export type ConversationSummary = {
  id: number;
  title: string;
  startedAt: number;
  updatedAt: number;
  messageCount: number;
};

export type Conversation = {
  id: number;
  title: string | null;
  startedAt: number;
  updatedAt: number;
  messages: Message[];
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
  status: "pending" | "done" | "error" | "empty";
  error: string | null;
};

export type Meeting = {
  id: number;
  title: string;
  startedAt: number;
  endedAt: number | null;
  speakers: MeetingSpeaker[];
  segments: Segment[];
};
