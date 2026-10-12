import { useState } from "react";
import { api, Meeting } from "../lib/api";
import { relativeTime } from "../lib/format";

/**
 * After a meeting: minutes of meeting (on request) and what went into long-term memory.
 * `transcriptBusy`: lines are still being transcribed.
 */
export default function MeetingNotes({
  m,
  transcriptBusy,
  onUpdated,
  onError,
}: {
  m: Meeting;
  transcriptBusy: boolean;
  onUpdated: (m: Meeting) => void;
  onError: (e: string) => void;
}) {
  const [writing, setWriting] = useState(false);
  const [memorizing, setMemorizing] = useState(false);
  const lines = m.segments.filter((s) => s.text?.trim()).length;
  if (!lines) return null;

  const write = async () => {
    setWriting(true);
    try {
      onUpdated(await api.post<Meeting>(`/api/meetings/${m.id}/minutes`));
    } catch (e: any) {
      onError(`Couldn't write the minutes. ${e.message}`);
    } finally {
      setWriting(false);
    }
  };
  const remove = async () => {
    try {
      onUpdated(await api.del<Meeting>(`/api/meetings/${m.id}/minutes`));
    } catch (e: any) {
      onError(e.message);
    }
  };
  const memorize = async () => {
    setMemorizing(true);
    try {
      onUpdated(await api.post<Meeting>(`/api/meetings/${m.id}/memorize`));
    } catch (e: any) {
      onError(`Couldn't update memory. ${e.message}`);
    } finally {
      setMemorizing(false);
    }
  };

  const mi = m.minutes;
  const newer = mi ? lines - mi.lines : 0;

  return (
    <section className="notes" aria-label="Minutes and memory">
      {!mi ? (
        <div className="notes__ask">
          <span className="material-symbols-outlined notes__icon" aria-hidden="true">summarize</span>
          <div className="notes__ask-text">
            <strong>Minutes of meeting</strong>
            <span>{transcriptBusy ? "Available once the transcript is finished." : "A summary, decisions, action items and open questions from this transcript."}</span>
          </div>
          <button className="btn btn--primary btn--small" disabled={writing || transcriptBusy} onClick={write}>
            {writing ? "Writing minutes…" : "Write minutes"}
          </button>
        </div>
      ) : (
        <article className="minutes">
          <header className="minutes__head">
            <h2>Minutes of meeting</h2>
            <span className="muted">Written {m.minutesAt ? relativeTime(m.minutesAt) : ""}</span>
            <span className="minutes__actions">
              <button className="btn btn--ghost btn--small" disabled={writing || transcriptBusy} onClick={write}>
                {writing ? "Rewriting…" : "Rewrite"}
              </button>
              <button className="icon-button" onClick={remove} title="Remove the minutes" aria-label="Remove the minutes">
                <span className="material-symbols-outlined">close</span>
              </button>
            </span>
          </header>
          {newer > 0 && (
            <p className="minutes__stale">
              {newer} line{newer === 1 ? " was" : "s were"} added or fixed since these were written. Rewrite to include {newer === 1 ? "it" : "them"}.
            </p>
          )}
          {mi.summary && <p className="minutes__summary">{mi.summary}</p>}
          <div className="minutes__grid">
            <MinutesList title="Decisions" items={mi.decisions} />
            <MinutesList title="Key points" items={mi.keyPoints} />
            {mi.actionItems.length > 0 && (
              <div className="minutes__block minutes__block--wide">
                <h3>Action items</h3>
                <ul className="minutes__actions-list">
                  {mi.actionItems.map((a, i) => (
                    <li key={i}>
                      <span>{a.task}</span>
                      {(a.owner || a.due) && (
                        <span className="minutes__meta">
                          {a.owner && <span>{a.owner}</span>}
                          {a.due && <span>Due {a.due}</span>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <MinutesList title="Open questions" items={mi.openQuestions} />
          </div>
          <p className="minutes__note">Written by Gemini from the transcript. Speaker names come from voice recognition, so check who owns what.</p>
        </article>
      )}

      {m.refined && (
        <p className="notes__memory">
          <span className="material-symbols-outlined" aria-hidden="true">
            {m.memoryStatus === "error" ? "error" : "neurology"}
          </span>
          <span>
            {m.memoryStatus === "running" || memorizing
              ? "Adding what matters from this meeting to memory…"
              : m.memoryStatus === "done"
                ? m.memoryCount
                  ? `Memory updated from this meeting: ${m.memoryCount} change${m.memoryCount === 1 ? "" : "s"}. You'll find them on the Memory page.`
                  : "Nothing from this meeting needed remembering."
                : m.memoryStatus === "error"
                  ? `Couldn't update memory from this meeting: ${m.memoryError}`
                  : "This meeting isn't in AURA's memory."}
          </span>
          {m.memoryStatus !== "running" && !memorizing && (
            <button className="btn btn--ghost btn--small" onClick={memorize}>
              {m.memoryStatus === "done" ? "Check again" : m.memoryStatus === "error" ? "Try again" : "Add to memory"}
            </button>
          )}
        </p>
      )}
    </section>
  );
}

function MinutesList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="minutes__block">
      <h3>{title}</h3>
      <ul>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
