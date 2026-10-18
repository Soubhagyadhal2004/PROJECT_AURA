import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { TASKS_REFRESH } from "../hooks/use-live-api";

type Step = { id: number; pos: number; tool: string; why: string | null; risk: string; status: string; error: string | null; undoable: boolean };
type Task = { id: number; conversationId: number | null; goal: string; status: string; summary: string | null; error: string | null; steps: Step[]; updatedAt: number };

const OPEN = ["planning", "running", "awaiting_approval"];
const label = (tool: string) => tool.replace(/_/g, " ");

/**
 * Multi-step tasks AURA runs for this conversation (server/agent.mjs): what it is doing, what waits for your OK,
 * and buttons to approve, refuse, stop or undo. Shows open tasks and the newest finished one that can be undone.
 */
export default function AgentTasks({ conversationId }: { conversationId: number | null }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Task[]>("/api/agent/tasks").then(setTasks).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(TASKS_REFRESH, load);
    return () => window.removeEventListener(TASKS_REFRESH, load);
  }, [load, conversationId]);
  // poll only while something is still running
  const mine = tasks.filter((t) => conversationId != null && t.conversationId === conversationId);
  const running = mine.some((t) => t.status === "running" || t.status === "planning");
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(load, 1500);
    return () => clearInterval(iv);
  }, [running, load]);

  const act = async (t: Task, what: "approve" | "reject" | "cancel" | "undo") => {
    setBusy(t.id);
    setError(null);
    try {
      await api.post(`/api/agent/tasks/${t.id}/${what}`);
      load();
      window.dispatchEvent(new Event("aura:nudges-refresh"));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const open = mine.filter((t) => OPEN.includes(t.status));
  const lastUndoable = mine.find((t) => !OPEN.includes(t.status) && t.steps.some((s) => s.undoable));
  const shown = [...open, ...(lastUndoable ? [lastUndoable] : [])].slice(0, 3);
  if (!shown.length) return null;

  return (
    <section className="review review--compact tasks" aria-label="Tasks AURA is working on">
      {error && <p className="review__error">{error}</p>}
      {shown.map((t) => {
        const waiting = t.steps.find((s) => s.status === "awaiting_approval");
        return (
          <article key={t.id} className="review__card">
            <span className="material-symbols-outlined review__icon" aria-hidden="true">
              {waiting ? "front_hand" : OPEN.includes(t.status) ? "progress_activity" : "task_alt"}
            </span>
            <div className="review__body">
              <p className="review__q">{t.goal}</p>
              <ol className="tasks__steps">
                {t.steps.map((s) => (
                  <li key={s.id} className={`tasks__step tasks__step--${s.status}`} title={s.error || s.why || ""}>
                    {label(s.tool)} <span className="muted">· {s.status.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ol>
              {(t.summary || t.error) && <p className="review__new">{t.summary || t.error}</p>}
              <div className="review__actions">
                {waiting && (
                  <>
                    <button className="btn btn--primary btn--small" disabled={busy === t.id} onClick={() => act(t, "approve")}>
                      Yes, {label(waiting.tool)}
                    </button>
                    <button className="btn btn--ghost btn--small" disabled={busy === t.id} onClick={() => act(t, "reject")}>
                      No
                    </button>
                  </>
                )}
                {t.status === "running" && (
                  <button className="btn btn--ghost btn--small" disabled={busy === t.id} onClick={() => act(t, "cancel")}>
                    Stop
                  </button>
                )}
                {!OPEN.includes(t.status) && t.steps.some((s) => s.undoable) && (
                  <button className="btn btn--ghost btn--small" disabled={busy === t.id} onClick={() => act(t, "undo")}>
                    Undo changes
                  </button>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
