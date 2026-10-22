import { useCallback, useEffect, useState } from "react";
import cn from "classnames";
import { api, MemoryProposal } from "../lib/api";

/**
 * Changes AURA wants to make to memories you already have. Nothing changes until you decide.
 * `signal` is any value that changes when there may be new proposals (e.g. the pending count).
 */
export default function MemoryReview({
  signal,
  compact,
  onChanged,
}: {
  signal?: unknown;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<MemoryProposal[]>([]);
  const [editing, setEditing] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<MemoryProposal[]>("/api/memories/proposals")
      .then(setItems)
      .catch(() => {});
  }, []);
  useEffect(load, [load, signal]);
  useEffect(() => {
    window.addEventListener("aura:memory-reviews-refresh", load);
    return () => window.removeEventListener("aura:memory-reviews-refresh", load);
  }, [load]);

  const decide = async (p: MemoryProposal, accept: boolean) => {
    setBusy(p.id);
    setError(null);
    try {
      if (accept) await api.post(`/api/memories/proposals/${p.id}/accept`, editing[p.id] != null ? { content: editing[p.id] } : {});
      else await api.post(`/api/memories/proposals/${p.id}/reject`);
      setEditing(({ [p.id]: _, ...rest }) => rest);
      load();
      onChanged?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const shown = compact ? items.slice(0, 1) : items;
  if (!items.length) return null;

  return (
    <section className={cn("review", { "review--compact": compact })} aria-label="Memory changes to review">
      {!compact && (
        <h2 className="review__title">
          Needs your OK <span className="review__count">{items.length}</span>
        </h2>
      )}
      {error && <p className="review__error">{error}</p>}
      {shown.map((p) => {
        const old = p.current?.content ?? "";
        const isEditing = editing[p.id] != null;
        return (
          <article key={p.id} className="review__card">
            <span className="material-symbols-outlined review__icon" aria-hidden="true">
              {p.action === "update" ? "published_with_changes" : p.action === "retire" ? "history" : "delete"}
            </span>
            <div className="review__body">
              <p className="review__q">
                {p.action === "update"
                  ? "Update this memory?"
                  : p.action === "retire"
                    ? "Is this no longer true?"
                    : "You asked AURA to forget this. Delete it?"}
                {compact && items.length > 1 && <span className="muted"> ({items.length - 1} more on the Memory page)</span>}
              </p>
              <p className={cn("review__old", { "review__old--struck": p.action === "update" && !isEditing })}>{old}</p>
              {p.action === "update" &&
                (isEditing ? (
                  <textarea
                    className="review__edit"
                    value={editing[p.id]}
                    onChange={(e) => setEditing((x) => ({ ...x, [p.id]: e.target.value }))}
                    rows={2}
                    autoFocus
                    aria-label="New wording"
                  />
                ) : (
                  <p className="review__new">{p.content}</p>
                ))}
              <div className="review__actions">
                <button className="btn btn--primary btn--small" disabled={busy === p.id} onClick={() => decide(p, true)}>
                  {p.action === "update" ? "Update" : p.action === "retire" ? "Mark outdated" : "Delete"}
                </button>
                {p.action === "update" && !isEditing && (
                  <button className="btn btn--ghost btn--small" disabled={busy === p.id} onClick={() => setEditing((x) => ({ ...x, [p.id]: p.content || "" }))}>
                    Edit first
                  </button>
                )}
                <button className="btn btn--ghost btn--small" disabled={busy === p.id} onClick={() => decide(p, false)}>
                  Keep as is
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
