import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import cn from "classnames";
import { api, Memory } from "../lib/api";
import { relativeTime, dateTime } from "../lib/format";
import ConfirmButton from "../components/ConfirmButton";

const CATEGORIES = ["preference", "personal", "people", "work", "plan", "other"];
const CATEGORY_LABEL: Record<string, string> = {
  preference: "Preference",
  personal: "Personal",
  people: "People",
  work: "Work",
  plan: "Plan",
  other: "Other",
};

type Activity = { at: number; conversationId: number; applied: { op: string }[] };

export default function MemoryView() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);

  const load = useCallback(() => {
    api.get<Memory[]>("/api/memories").then(setMemories).catch((e) => setError(e.message));
    api.get<Activity[]>("/api/memories/activity").then(setActivity).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000); // pick up memories extracted in the background
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return setResults(null);
    const t = setTimeout(() => {
      api
        .get<Memory[]>(`/api/memories/search?q=${encodeURIComponent(q)}&k=12`)
        .then(setResults)
        .catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const byId = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);
  const active = memories.filter((m) => m.status === "active");
  const history = memories.filter((m) => m.status !== "active");
  const shown = results ?? (tab === "active" ? active : history);

  const save = async (id: number, patch: Partial<Memory>) => {
    try {
      await api.patch(`/api/memories/${id}`, patch);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const remove = async (id: number) => {
    await api.del(`/api/memories/${id}`);
    load();
  };

  const lastUpdate = activity[0];

  return (
    <section className="view memory">
      <header className="view__header">
        <div>
          <h1>Memory</h1>
          <p className="view__sub">
            What AURA has learned about you. Stored only on this computer.
            {lastUpdate && ` Last learned ${relativeTime(lastUpdate.at)}.`}
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setAdding((a) => !a)}>
          <span className="material-symbols-outlined">add</span>
          Add memory
        </button>
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      )}

      {adding && (
        <AddMemory
          onDone={() => {
            setAdding(false);
            load();
          }}
          onError={setError}
        />
      )}

      <div className="memory__toolbar">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={tab === "active" && !results} className={cn({ "is-on": tab === "active" && !results })} onClick={() => { setTab("active"); setQuery(""); }}>
            Current <span className="count">{active.length}</span>
          </button>
          <button role="tab" aria-selected={tab === "history" && !results} className={cn({ "is-on": tab === "history" && !results })} onClick={() => { setTab("history"); setQuery(""); }}>
            Replaced &amp; outdated <span className="count">{history.length}</span>
          </button>
        </div>
        <label className="search">
          <span className="material-symbols-outlined">search</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by meaning, e.g. “where do I work”" />
        </label>
      </div>

      {results && <p className="memory__hint">Closest matches among current memories, ranked by meaning.</p>}

      <ul className="memory__list">
        {shown.length === 0 && (
          <li className="empty">
            {results
              ? "Nothing matches that search."
              : tab === "active"
                ? "No memories yet. Tell AURA something about yourself — your job, a preference, someone important — and it will appear here a few seconds after the reply."
                : "When a fact changes, the old version moves here so you can see what was replaced."}
          </li>
        )}
        {shown.map((m) => (
          <MemoryItem key={m.id} m={m} replacement={m.supersededBy ? byId.get(m.supersededBy) : undefined} onSave={save} onDelete={remove} />
        ))}
      </ul>
    </section>
  );
}

function AddMemory({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("personal");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    try {
      await api.post("/api/memories", { content, category });
      onDone();
    } catch (err: any) {
      onError(err.message);
    }
  };
  return (
    <form className="memory-form" onSubmit={submit}>
      <input autoFocus value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. The user prefers short answers in the morning." />
      <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABEL[c]}
          </option>
        ))}
      </select>
      <button className="btn btn--primary" type="submit" disabled={!content.trim()}>
        Save memory
      </button>
    </form>
  );
}

function MemoryItem({
  m,
  replacement,
  onSave,
  onDelete,
}: {
  m: Memory;
  replacement?: Memory;
  onSave: (id: number, patch: Partial<Memory>) => void;
  onDelete: (id: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.content);
  const [cat, setCat] = useState(m.category);
  useEffect(() => {
    setText(m.content);
    setCat(m.category);
  }, [m.content, m.category]);

  return (
    <li className={cn("memory-item", `memory-item--${m.status}`)}>
      {editing ? (
        <form
          className="memory-item__edit"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(m.id, { content: text, category: cat });
            setEditing(false);
          }}
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus />
          <div className="row">
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <button className="btn btn--primary btn--small" type="submit">
              Save changes
            </button>
            <button className="btn btn--ghost btn--small" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="memory-item__body">
          <p className="memory-item__text">{m.content}</p>
          <div className="memory-item__meta">
            <span className={cn("tag", `tag--${m.category}`)}>{CATEGORY_LABEL[m.category] || m.category}</span>
            <span title={dateTime(m.updatedAt)}>Updated {relativeTime(m.updatedAt)}</span>
            <span>{m.source === "manual" ? "Added by you" : "Learned in conversation"}</span>
            {m.score != null && <span>Match {(m.score * 100).toFixed(0)}%</span>}
            {m.status === "superseded" && <span className="memory-item__why">Replaced by: “{replacement?.content ?? "a newer memory"}”</span>}
            {m.status === "outdated" && <span className="memory-item__why">Marked no longer true</span>}
          </div>
        </div>
      )}
      {!editing && (
        <div className="memory-item__actions">
          {m.status !== "active" && (
            <button className="btn btn--ghost btn--small" onClick={() => onSave(m.id, { status: "active" })}>
              Restore
            </button>
          )}
          <button className="icon-button" onClick={() => setEditing(true)} aria-label="Edit memory" title="Edit">
            <span className="material-symbols-outlined">edit</span>
          </button>
          <ConfirmButton iconOnly small onConfirm={() => onDelete(m.id)} label="Delete memory" confirmLabel="Delete" />
        </div>
      )}
    </li>
  );
}
