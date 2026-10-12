import { useEffect, useState } from "react";
import cn from "classnames";
import { useLiveAPIContext } from "../contexts/LiveAPIContext";
import { api, ConversationSummary } from "../lib/api";
import { relativeTime } from "../lib/format";
import Logo from "./Logo";
import { setFaviconState } from "../lib/favicon";

export type View = "assistant" | "memory" | "meeting";

type Props = {
  view: View;
  onView: (v: View) => void;
  historyId: number | null;
  onOpenHistory: (id: number | null) => void;
  historyVersion: number;
  onOpenSettings: () => void;
  memoryReviews: number;
};

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "assistant", label: "Assistant", icon: "graphic_eq" },
  { id: "memory", label: "Memory", icon: "neurology" },
  { id: "meeting", label: "Meeting Mode", icon: "groups" },
];

export default function Sidebar({ view, onView, historyId, onOpenHistory, historyVersion, onOpenSettings, memoryReviews }: Props) {
  const { status, conversationId, messages, micOn, outVolume, micVolume } = useLiveAPIContext();
  const [history, setHistory] = useState<ConversationSummary[]>([]);

  useEffect(() => setFaviconState({ voice: status === "connected" }), [status]);
  const messageCount = messages.filter((m) => !m.pending).length;
  useEffect(() => {
    api
      .get<ConversationSummary[]>("/api/conversations")
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [conversationId, messageCount, historyVersion]);

  const statusLabel =
    status === "connected" ? (micOn ? "Listening" : "Connected, mic off") : status === "connecting" ? "Connecting…" : "Voice offline";

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <Logo size={30} level={status === "connected" ? Math.max(outVolume * 4, micOn ? micVolume * 3 : 0) : 0} live={status === "connected"} />
      </div>

      <nav className="sidebar__nav" aria-label="Main">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={cn("nav-item", { "nav-item--active": view === n.id && !(n.id === "assistant" && historyId) })}
            onClick={() => onView(n.id)}
          >
            <span className="material-symbols-outlined">{n.icon}</span>
            {n.label}
            {n.id === "memory" && memoryReviews > 0 && (
              <span className="nav-item__badge" title={`${memoryReviews} memory change${memoryReviews === 1 ? "" : "s"} to review`}>
                {memoryReviews}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar__history">
        {history.length === 0 && (
          <>
            <h2 className="sidebar__heading">Conversations</h2>
            <p className="sidebar__empty">Past conversations will appear here.</p>
          </>
        )}
        {[
          { label: "Pinned", items: history.filter((c) => c.pinned) },
          { label: "Conversations", items: history.filter((c) => !c.pinned) },
        ]
          .filter((g) => g.items.length)
          .map((g) => (
            <div key={g.label} className="sidebar__group">
              <h2 className="sidebar__heading">{g.label}</h2>
              <ul>
                {g.items.map((c) => (
                  <li key={c.id}>
                    <button
                      className={cn("history-item", {
                        "history-item--active": historyId === c.id,
                        "history-item--live": c.id === conversationId && !historyId,
                      })}
                      onClick={() => onOpenHistory(c.id === conversationId ? null : c.id)}
                      title={c.title}
                    >
                      <span className="history-item__title">{c.title}</span>
                      <span className="history-item__meta">{c.id === conversationId ? "Current" : relativeTime(c.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>

      <div className="sidebar__footer">
        <div className={cn("status-pill", `status-pill--${status}`, { "status-pill--mic": micOn })} aria-live="polite">
          <span className="status-pill__dot" />
          {statusLabel}
        </div>
        <button className="icon-button" onClick={onOpenSettings} aria-label="Settings" title="Settings">
          <span className="material-symbols-outlined">settings</span>
        </button>
      </div>
    </aside>
  );
}
