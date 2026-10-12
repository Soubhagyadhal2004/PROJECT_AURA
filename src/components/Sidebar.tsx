import { useEffect, useState } from "react";
import cn from "classnames";
import { useLiveAPIContext } from "../contexts/LiveAPIContext";
import { api, ConversationSummary } from "../lib/api";
import { relativeTime } from "../lib/format";
import Orb from "./Orb";

export type View = "assistant" | "memory" | "meeting";

type Props = {
  view: View;
  onView: (v: View) => void;
  historyId: number | null;
  onOpenHistory: (id: number | null) => void;
  historyVersion: number;
  onOpenSettings: () => void;
};

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "assistant", label: "Assistant", icon: "graphic_eq" },
  { id: "memory", label: "Memory", icon: "neurology" },
  { id: "meeting", label: "Meeting Mode", icon: "groups" },
];

export default function Sidebar({ view, onView, historyId, onOpenHistory, historyVersion, onOpenSettings }: Props) {
  const { status, conversationId, messages, micOn, outVolume, micVolume } = useLiveAPIContext();
  const [history, setHistory] = useState<ConversationSummary[]>([]);

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
        <Orb size={28} level={status === "connected" ? Math.max(outVolume * 4, micOn ? micVolume * 3 : 0) : 0} active={status === "connected"} />
        <span className="sidebar__name">AURA</span>
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
          </button>
        ))}
      </nav>

      <div className="sidebar__history">
        <h2 className="sidebar__heading">Conversations</h2>
        {history.length === 0 && <p className="sidebar__empty">Past conversations will appear here.</p>}
        <ul>
          {history.map((c) => (
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
                <span className="history-item__meta">
                  {c.id === conversationId ? "Current" : relativeTime(c.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
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
