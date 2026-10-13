import { useEffect, useRef, useState } from "react";
import cn from "classnames";
import { DOCUMENT_ACCEPT, DOCUMENT_LIMIT_MB, DocumentInfo } from "../lib/api";

export const fileSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

function docIcon(d: { name: string; kind?: string }) {
  const e = d.name.toLowerCase().split(".").pop();
  if (e === "pdf") return "picture_as_pdf";
  if (e === "pptx") return "slideshow";
  if (e === "xlsx" || e === "csv" || e === "tsv") return "table_chart";
  if (d.kind === "image" || /^(png|jpe?g|webp|hei[cf])$/.test(e || "")) return "image";
  if (e === "docx") return "description";
  return "article";
}

/** A document the user added, shown in the conversation. */
export function DocumentCard({
  name,
  doc,
  onAsk,
  onRetry,
}: {
  name: string;
  doc?: DocumentInfo;
  onAsk?: (question: string) => void;
  onRetry?: () => void;
}) {
  const a = doc?.analysis;
  const meta = doc ? [doc.label, fileSize(doc.size), a?.pages ? `${a.pages} page${a.pages === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") : null;
  return (
    <article className={cn("doc-card", { "doc-card--gone": !doc })}>
      <header className="doc-card__head">
        <span className="material-symbols-outlined doc-card__icon" aria-hidden="true">
          {docIcon({ name, kind: doc?.kind })}
        </span>
        <div className="doc-card__title">
          {doc ? (
            <a href={`/api/documents/${doc.id}/file`} download={doc.name} title="Download the original">
              {name}
            </a>
          ) : (
            <span>{name}</span>
          )}
          <span className="doc-card__meta">{doc ? meta : "Removed from this conversation"}</span>
        </div>
      </header>

      {doc?.status === "analysing" && (
        <p className="doc-card__status">
          <span className="material-symbols-outlined spin" aria-hidden="true">progress_activity</span>
          Reading the document…
        </p>
      )}
      {doc?.status === "error" && (
        <p className="doc-card__status doc-card__status--error">
          <span>Couldn't read it: {doc.error}</span>
          {onRetry && (
            <button className="btn btn--ghost btn--small" onClick={onRetry}>
              Try again
            </button>
          )}
        </p>
      )}
      {doc?.status === "ready" && a && (
        <>
          <p className="doc-card__overview">{a.overview}</p>
          {a.keyPoints.length > 0 && (
            <details className="doc-card__points">
              <summary>Key points</summary>
              <ul>
                {a.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </details>
          )}
          {doc.truncated && <p className="doc-card__note">This document is long, so only its first part is used for answers.</p>}
          {onAsk && a.suggestedQuestions.length > 0 && (
            <div className="doc-card__ask" aria-label="Ask about this document">
              {a.suggestedQuestions.map((q) => (
                <button key={q} className="chip" onClick={() => onAsk(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** Paperclip button that opens a panel above the message box: add, see and remove documents. */
export function AttachMenu({
  documents,
  onAdd,
  onRemove,
}: {
  documents: DocumentInfo[];
  onAdd: (files: File[]) => Promise<{ name: string; error: string }[]>;
  onRemove: (id: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name: string; error: string }[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const add = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setErrors([]);
    try {
      const failed = await onAdd(files);
      setErrors(failed);
      if (!failed.length) setOpen(false);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="attach" ref={wrap}>
      <button
        type="button"
        className={cn("icon-button attach__button", { "is-on": open })}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Add documents"
        aria-label={documents.length ? `Documents (${documents.length})` : "Add documents"}
      >
        <span className="material-symbols-outlined">attach_file</span>
        {documents.length > 0 && <span className="attach__count">{documents.length}</span>}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT}
        hidden
        onChange={(e) => add(Array.from(e.target.files || []))}
      />
      {open && (
        <div className="attach__panel" role="dialog" aria-label="Documents in this conversation">
          <div className="attach__head">
            <strong>Documents in this conversation</strong>
            <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close">
              <span className="material-symbols-outlined">expand_more</span>
            </button>
          </div>
          {documents.length > 0 ? (
            <ul className="attach__list">
              {documents.map((d) => (
                <li key={d.id}>
                  <span className="material-symbols-outlined attach__icon" aria-hidden="true">
                    {docIcon(d)}
                  </span>
                  <span className="attach__name">
                    <span title={d.name}>{d.name}</span>
                    <small>
                      {d.status === "analysing" ? "Reading…" : d.status === "error" ? "Couldn't read it" : `${d.label} · ${fileSize(d.size)}`}
                    </small>
                  </span>
                  <button type="button" className="icon-button" onClick={() => onRemove(d.id)} title="Remove from this conversation" aria-label={`Remove ${d.name}`}>
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="attach__empty">Add a document and ask AURA about it, by voice or by typing.</p>
          )}
          {errors.length > 0 && (
            <ul className="attach__errors" role="alert">
              {errors.map((e) => (
                <li key={e.name}>
                  <strong>{e.name}:</strong> {e.error}
                </li>
              ))}
            </ul>
          )}
          <div className="attach__foot">
            <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => input.current?.click()}>
              <span className="material-symbols-outlined">{busy ? "progress_activity" : "upload_file"}</span>
              {busy ? "Adding…" : "Add files"}
            </button>
            <span className="attach__hint">
              PDF, Word, PowerPoint, Excel, text or images, up to {DOCUMENT_LIMIT_MB.inline} MB. You can also drop files into the chat.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
