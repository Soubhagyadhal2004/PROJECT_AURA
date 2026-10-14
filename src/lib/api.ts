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
  upload: <T>(url: string, file: Blob) => request<T>("POST", url, undefined, file),
};

/**
 * Downloads a file from the AURA server. Plain <a download> links don't work in dev:
 * the React dev server doesn't forward page-style requests to the API, so they get the app's HTML.
 */
export async function downloadFile(url: string, fallbackName = "export") {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "*/*" } });
  } catch {
    throw new Error("Can't reach the AURA server. Start it with `npm run dev` and try again.");
  }
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const cd = res.headers.get("Content-Disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="([^"]+)"/i.exec(cd);
  const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

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
  assistantLanguage: "auto" | "en" | "hi" | "en-hi";
  meetingLanguage: string;
  meetingTranscriber: "live" | "standard";
  meetingMemory: boolean;
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
  modality?: "voice" | "text" | "document";
  text: string;
  // a document the user added (modality "document")
  document?: { id: number; name: string };
  createdAt?: number;
  pending?: boolean;
  // web search used for an assistant answer
  sources?: WebSource[];
  searchQueries?: string[];
  searchWidget?: string; // Google Search suggestions (HTML), shown only during the live session
};

export type WebSource = { title: string; uri: string };

export type DocumentAnalysis = {
  title: string;
  docType: string | null;
  overview: string;
  keyPoints: string[];
  suggestedQuestions: string[];
  pages: number | null;
};

export type DocumentInfo = {
  id: number;
  conversationId: number;
  name: string;
  kind: "pdf" | "image" | "office" | "text";
  label: string;
  size: number;
  status: "analysing" | "ready" | "error";
  error: string | null;
  truncated: boolean;
  analysis: DocumentAnalysis | null;
  createdAt: number;
};

/** File types AURA can read (same list as the server's). */
export const DOCUMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.pptx,.xlsx,.txt,.md,.markdown,.csv,.tsv,.json,.xml,.html,.htm,.log,.yaml,.yml,.ini,.toml,.srt,.vtt," +
  ".js,.jsx,.ts,.tsx,.py,.java,.c,.h,.cpp,.cs,.go,.rs,.rb,.php,.sql,.sh,.css,.scss";
export const DOCUMENT_LIMIT_MB = { inline: 14, other: 30 };

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
  documents?: DocumentInfo[];
};

export type MemoryProposal = {
  id: number;
  action: "update" | "retire" | "forget";
  memoryId: number;
  content: string | null;
  category: string | null;
  conversationId: number | null;
  meetingId: number | null;
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
  meetingId: number | null;
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

// proactive nudges (server/proactive.mjs); all off unless AURA_PROACTIVE_* is set on the server
export type Nudge = {
  id: number;
  type: "memory_check" | "reminder" | "briefing";
  kind: string | null; // reminder: confirm | due; briefing: daily | on_demand
  text: string;
  dueAt: number;
  status: "pending" | "shown" | "accepted" | "dismissed" | "snoozed";
  payload: {
    memory?: string;
    what?: string;
    at?: number;
    when?: string;
    lines?: string[];
    lowConfidence?: boolean;
    confirmedAt?: number;
  } | null;
};

export type ProactiveState = {
  switches: { memory: boolean; reminders: boolean; briefing: boolean };
  nudges: Nudge[];
  blocked: string | null;
};

export type MeetingSummary = {
  id: number;
  title: string;
  startedAt: number;
  endedAt: number | null;
  hasMinutes: boolean;
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
  minutes: Minutes | null;
  minutesAt: number | null;
  // learning from the transcript: null = not run yet, off = turned off in Settings
  memoryStatus: null | "running" | "done" | "error" | "off";
  memoryCount: number;
  memoryError: string | null;
  speakers: MeetingSpeaker[];
  segments: Segment[];
};

export type Minutes = {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: { task: string; owner: string | null; due: string | null }[];
  openQuestions: string[];
  suggestedTitle: string | null;
  lines: number; // transcript lines the minutes were written from
};
