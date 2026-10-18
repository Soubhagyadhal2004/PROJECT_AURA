import { DragEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import cn from "classnames";
import { useLiveAPIContext } from "../contexts/LiveAPIContext";
import { api, Conversation, DocumentInfo, Message } from "../lib/api";
import { dateTime } from "../lib/format";
import Orb from "../components/Orb";
import MemoryReview from "../components/MemoryReview";
import AgentTasks from "../components/AgentTasks";
import { ConversationActions, ConversationTitle } from "../components/ConversationActions";
import { AttachMenu, DocumentCard } from "../components/Documents";
import { AmbientInfo } from "../hooks/use-live-api";

type Props = {
  historyId: number | null;
  onCloseHistory: () => void;
  onHistoryChanged: () => void;
  historyVersion: number;
  memoryReviews: number;
};

export default function AssistantView({ historyId, onCloseHistory, onHistoryChanged, historyVersion, memoryReviews }: Props) {
  if (historyId)
    return <PastConversation id={historyId} onClose={onCloseHistory} onChanged={onHistoryChanged} version={historyVersion} />;
  return <LiveConversation onChanged={onHistoryChanged} version={historyVersion} memoryReviews={memoryReviews} />;
}

/** Name and pin state of a saved conversation (refreshed when the list changes). */
function useConversationMeta(id: number | null, version: number, extra: unknown = null) {
  const [meta, setMeta] = useState<Conversation | null>(null);
  useEffect(() => {
    if (!id) return setMeta(null);
    let stop = false;
    api
      .get<Conversation>(`/api/conversations/${id}`)
      .then((c) => !stop && setMeta(c))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [id, version, extra]);
  return meta;
}

function MessageList({
  messages,
  live,
  documents = [],
  onAsk,
  onRetry,
}: {
  messages: Message[];
  live?: boolean;
  documents?: DocumentInfo[];
  onAsk?: (question: string) => void;
  onRetry?: (id: number) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const docStates = documents.map((d) => d.status).join();
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, docStates]);
  return (
    <div className="messages" aria-live={live ? "polite" : undefined}>
      {messages.map((m, i) =>
        m.modality === "document" && m.document ? (
          <div key={m.id ?? `${i}-${m.createdAt}`} className="msg msg--user msg--document">
            <DocumentCard
              name={m.document.name}
              doc={documents.find((d) => d.id === m.document!.id)}
              onAsk={onAsk}
              onRetry={onRetry ? () => onRetry(m.document!.id) : undefined}
            />
          </div>
        ) : (
        <div
          key={m.id ?? `${i}-${m.createdAt}`}
          className={cn("msg", `msg--${m.role}`, { "msg--pending": m.pending, "msg--ambient": m.modality === "ambient" })}
        >
          <div className="msg__bubble">{m.text}</div>
          {m.role === "assistant" && (m.sources?.length || m.searchQueries?.length) ? <WebSources m={m} /> : null}
          <div className="msg__meta">
            {m.modality === "ambient" ? "Overheard" : m.role === "user" ? "You" : "AURA"}
            {m.modality === "ambient" && (
              <span className="material-symbols-outlined msg__icon" title="Heard in ambient mode, not said to AURA">
                hearing
              </span>
            )}
            {m.modality === "voice" && (
              <span className="material-symbols-outlined msg__icon" title="Spoken">
                mic
              </span>
            )}
            {m.pending && <span className="msg__typing">…</span>}
          </div>
        </div>
        )
      )}
      <div ref={end} />
    </div>
  );
}

const host = (uri: string) => {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return uri;
  }
};

function WebSources({ m }: { m: Message }) {
  const sources = m.sources || [];
  return (
    <div className="web-sources">
      <div className="web-sources__head">
        <span className="material-symbols-outlined">travel_explore</span>
        {m.searchQueries?.length ? (
          <span>
            Searched the web for <q>{m.searchQueries.join("”, “")}</q>
          </span>
        ) : (
          <span>From the web</span>
        )}
      </div>
      {sources.length > 0 && (
        <ol className="web-sources__list">
          {sources.map((s, i) => (
            <li key={s.uri}>
              <a href={s.uri} target="_blank" rel="noreferrer noopener" title={s.uri}>
                <span className="web-sources__n">{i + 1}</span>
                {/* grounding links are Google redirects, so the title is usually the site name */}
                {s.title && s.title !== s.uri ? s.title : host(s.uri)}
              </a>
            </li>
          ))}
        </ol>
      )}
      {m.searchWidget && (
        <iframe
          className="web-sources__suggest"
          title="Google Search suggestions"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={`<base target="_blank">${m.searchWidget}`}
        />
      )}
    </div>
  );
}

function LiveConversation({ onChanged, version, memoryReviews }: { onChanged: () => void; version: number; memoryReviews: number }) {
  const live = useLiveAPIContext();
  const { status, error, micOn, micVolume, outVolume, messages } = live;
  // refresh the title when the first message or a document arrives
  const firstUserText = messages.find((m) => m.role === "user" && !m.pending && m.modality !== "document")?.text;
  const meta = useConversationMeta(live.conversationId, version, `${firstUserText ?? ""}|${live.documents.length}`);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropErrors, setDropErrors] = useState<{ name: string; error: string }[]>([]);
  const dragDepth = useRef(0);

  const connected = status === "connected";
  const ambient = live.ambient;
  const speaking = connected && outVolume > 0.01;
  const hearing = ambient.on || (connected && micOn);
  const tone = speaking ? "speaking" : hearing ? "listening" : "idle";
  const level = speaking ? outVolume * 6 : hearing ? micVolume * 6 : 0;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = draft.trim();
    if (!t || sending) return;
    setSending(true);
    setDraft("");
    try {
      await live.sendText(t);
    } finally {
      setSending(false);
    }
  };

  const ask = async (q: string) => {
    if (sending) return;
    setSending(true);
    try {
      await live.sendText(q);
    } finally {
      setSending(false);
    }
  };

  // drop files anywhere in the conversation to add them
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };
  const onDrop = async (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    setDropErrors(await live.attachFiles(Array.from(e.dataTransfer.files)));
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const stateText =
    ambient.on && !speaking
      ? ambient.busy
        ? "Ambient: thinking it over…"
        : "Ambient: listening quietly. Say “Aura” to ask."
      : status === "connecting"
      ? "Connecting to Gemini Live…"
      : !connected
        ? "Voice is off"
        : speaking
          ? "AURA is speaking"
          : micOn
            ? "Listening"
            : "Microphone muted — type or unmute to talk";

  return (
    <section
      className="view assistant"
      onDragEnter={onDragEnter}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <span className="material-symbols-outlined">upload_file</span>
          Drop to add to this conversation
        </div>
      )}
      <header className="view__header">
        <div className="view__title">
          {meta ? <ConversationTitle conv={meta} onChanged={onChanged} /> : <h1>Assistant</h1>}
          <p className="view__sub">
            {live.memoryCount != null && connected
              ? `Talking with ${live.memoryCount} remembered ${live.memoryCount === 1 ? "fact" : "facts"} in context`
              : "Talk or type. AURA remembers what matters between sessions."}
          </p>
        </div>
        <div className="view__actions">
          {meta && (
            <ConversationActions
              conv={meta}
              onChanged={onChanged}
              onDeleted={() => {
                live.newConversation();
                onChanged();
              }}
            />
          )}
          <button className="btn btn--ghost" onClick={live.newConversation} disabled={!messages.length && !connected}>
            <span className="material-symbols-outlined">add_comment</span>
            New conversation
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
          <span className="banner__actions">
            {live.canResume && (
              <button className="btn btn--small" onClick={() => live.connect({ resume: true })}>
                Reconnect
              </button>
            )}
            {!live.canResume && status === "disconnected" && (
              <button className="btn btn--small" onClick={() => live.connect()}>
                Try again
              </button>
            )}
            <button className="icon-button" onClick={live.clearError} aria-label="Dismiss">
              <span className="material-symbols-outlined">close</span>
            </button>
          </span>
        </div>
      )}

      {dropErrors.length > 0 && (
        <div className="banner banner--error" role="alert">
          <span className="material-symbols-outlined">error</span>
          <span>
            {dropErrors.map((e) => (
              <span key={e.name} className="banner__line">
                <strong>{e.name}:</strong> {e.error}
              </span>
            ))}
          </span>
          <span className="banner__actions">
            <button className="icon-button" onClick={() => setDropErrors([])} aria-label="Dismiss">
              <span className="material-symbols-outlined">close</span>
            </button>
          </span>
        </div>
      )}

      {live.notice && !error && (
        <div className="banner banner--warn" role="status">
          <span className="material-symbols-outlined">travel_explore</span>
          <span>{live.notice}</span>
          <span className="banner__actions">
            <button className="icon-button" onClick={live.clearNotice} aria-label="Dismiss">
              <span className="material-symbols-outlined">close</span>
            </button>
          </span>
        </div>
      )}

      {ambient.error && (
        <div className="banner banner--error" role="alert">
          <span className="material-symbols-outlined">hearing_disabled</span>
          <span>Ambient mode: {ambient.error}</span>
          <span className="banner__actions">
            {!ambient.on && (
              <button className="btn btn--small" onClick={() => live.setAmbient(true)}>
                Try again
              </button>
            )}
          </span>
        </div>
      )}

      <div className="assistant__body">
        {messages.length === 0 ? (
          <div className="assistant__empty">
            <Orb size={168} level={level} active={connected} tone={tone} logo />
            <h2>{ambient.on ? "I'm here, quietly." : connected ? "I'm listening." : "Hi, I'm AURA."}</h2>
            <p>
              {ambient.on
                ? "Carry on talking. I'll stay silent unless you say “Aura”, or I can clearly help with what you're discussing."
                : connected
                ? "Ask anything, or tell me something worth remembering."
                : "Start a voice session or type a message below. Tell me about yourself and I'll remember it next time."}
            </p>
            <p className="assistant__tip">
              <span className="material-symbols-outlined" aria-hidden="true">attach_file</span>
              Add a document with the paperclip, or drop it here, then ask about it.
            </p>
          </div>
        ) : (
          <MessageList messages={messages} live documents={live.documents} onAsk={ask} onRetry={(id) => live.retryDocument(id)} />
        )}
        {live.lastRecall && (
          <div className="recall-note" title={live.lastRecall.results.map((r) => r.content).join("\n")}>
            <span className="material-symbols-outlined">neurology</span>
            Looked up “{live.lastRecall.query}” in memory — {live.lastRecall.results.length} match
            {live.lastRecall.results.length === 1 ? "" : "es"}
          </div>
        )}
        {live.lastDocumentLookup && (
          <div className="recall-note recall-note--doc" title={live.lastDocumentLookup.question}>
            <span className="material-symbols-outlined">plagiarism</span>
            Looked in {live.lastDocumentLookup.names.length === 1 ? `“${live.lastDocumentLookup.names[0]}”` : `${live.lastDocumentLookup.names.length} documents`}
          </div>
        )}
      </div>

      <AgentTasks conversationId={live.conversationId} />
      <MemoryReview compact signal={memoryReviews} />

      <footer className="composer">
        <div className="composer__voice">
          <button
            className={cn("voice-button", { "voice-button--on": connected })}
            onClick={() => (connected ? live.disconnect() : live.connect())}
            disabled={status === "connecting"}
            aria-label={connected ? "End voice session" : "Start voice session"}
            title={connected ? "End voice session" : "Start voice session"}
          >
            <Orb size={56} level={level} active={connected} tone={tone} />
            <span className="material-symbols-outlined voice-button__icon">
              {status === "connecting" ? "progress_activity" : connected ? "stop" : "graphic_eq"}
            </span>
          </button>
          <button
            className={cn("icon-button mic-toggle", { "mic-toggle--off": !micOn && !ambient.on })}
            onClick={() => live.setMicOn(!micOn)}
            disabled={!connected || ambient.on}
            aria-pressed={micOn}
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
            title={micOn ? "Mute microphone" : "Unmute microphone"}
          >
            <span className="material-symbols-outlined">{micOn || ambient.on ? "mic" : "mic_off"}</span>
          </button>
          <button
            className={cn("icon-button ambient-toggle", { "ambient-toggle--on": ambient.on })}
            onClick={() => live.setAmbient(!ambient.on)}
            disabled={status === "connecting" && !ambient.on}
            aria-pressed={ambient.on}
            aria-label={ambient.on ? "Leave ambient mode" : "Ambient mode: stay quiet in the background"}
            title={ambient.on ? "Leave ambient mode" : "Ambient mode: AURA stays quiet in the background and speaks only when asked or clearly needed"}
          >
            <span className="material-symbols-outlined">{ambient.on ? "hearing" : "hearing_disabled"}</span>
          </button>
          <div className="composer__state">
            <span className={cn("live-dot", { "live-dot--on": hearing })} />
            <span>
              {stateText}
              {ambient.on && <AmbientTrend info={ambient} />}
            </span>
          </div>
        </div>
        <form className="composer__text" onSubmit={submit}>
          <AttachMenu documents={live.documents} onAdd={live.attachFiles} onRemove={live.removeDocument} />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={connected ? "Type a message" : "Type a message — this starts a session"}
            rows={1}
            aria-label="Message"
          />
          <button className="btn btn--primary" type="submit" disabled={!draft.trim() || sending}>
            <span className="material-symbols-outlined">send</span>
            <span className="sr-only">Send</span>
          </button>
        </form>
      </footer>
    </section>
  );
}

const TREND_ICON = { rising: "trending_up", flat: "trending_flat", falling: "trending_down", unknown: "more_horiz" } as const;
const ACTION_TEXT: Record<string, string> = {
  speak: "chipping in",
  wait: "need building",
  defer: "steady: holding",
  suppress: "passing: holding back",
  answer: "answering you",
  ignore: "",
};

/** How much AURA's help is needed right now, its direction, and what ambient mode decided. */
function AmbientTrend({ info }: { info: AmbientInfo }) {
  const d = info.last;
  if (!d || d.level == null) return null;
  const dir = d.direction || "unknown";
  return (
    <span className={cn("ambient-trend", `ambient-trend--${dir}`)} title={`${d.reason}${d.topic ? ` · topic: ${d.topic}` : ""}`}>
      <span className="material-symbols-outlined">{TREND_ICON[dir]}</span>
      <span className="ambient-trend__meter" aria-hidden="true">
        <span style={{ width: `${Math.round((d.level ?? 0) * 100)}%` }} />
        {d.threshold != null && <i style={{ left: `${Math.round(d.threshold * 100)}%` }} />}
      </span>
      {ACTION_TEXT[d.action] || d.action}
    </span>
  );
}

function PastConversation({ id, onClose, onChanged, version }: { id: number; onClose: () => void; onChanged: () => void; version: number }) {
  const live = useLiveAPIContext();
  const [error, setError] = useState<string | null>(null);
  const conv = useConversationMeta(id, version);

  const resume = async () => {
    try {
      await live.continueConversation(id);
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <section className="view assistant">
      <header className="view__header">
        <div className="view__title">
          <button className="link-button" onClick={onClose}>
            <span className="material-symbols-outlined">arrow_back</span>
            Current conversation
          </button>
          {conv ? <ConversationTitle conv={conv} onChanged={onChanged} /> : <h1>Conversation</h1>}
          {conv && <p className="view__sub">From {dateTime(conv.startedAt)}</p>}
        </div>
        <div className="view__actions">
          {conv && (
            <ConversationActions
              conv={conv}
              onChanged={onChanged}
              onDeleted={() => {
                onChanged();
                onClose();
              }}
            />
          )}
          <button className="btn btn--primary" onClick={resume} disabled={!conv}>
            <span className="material-symbols-outlined">play_arrow</span>
            Continue this conversation
          </button>
        </div>
      </header>
      {error && <div className="banner banner--error">{error}</div>}
      <div className="assistant__body">{conv && <MessageList messages={conv.messages} documents={conv.documents} />}</div>
    </section>
  );
}
