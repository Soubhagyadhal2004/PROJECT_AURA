import { useEffect, useRef, useState } from "react";
import cn from "classnames";
import { api, downloadFile } from "../lib/api";
import ConfirmButton from "./ConfirmButton";

type Conv = { id: number; title: string; pinned: boolean };

/** Editable title plus pin, export and delete for one conversation. */
export function ConversationTitle({ conv, onChanged }: { conv: Conv; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(conv.title);
  useEffect(() => setValue(conv.title), [conv.title]);

  const save = async () => {
    setEditing(false);
    const t = value.trim();
    if (t === conv.title) return;
    await api.patch(`/api/conversations/${conv.id}`, { title: t }).catch(() => {});
    onChanged();
  };

  if (editing) {
    return (
      <input
        className="title-input conv-title__input"
        value={value}
        autoFocus
        maxLength={120}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(conv.title);
            setEditing(false);
          }
        }}
        aria-label="Conversation name"
      />
    );
  }
  return (
    <h1 className="conv-title">
      <button className="conv-title__btn" onClick={() => setEditing(true)} title="Rename">
        <span className="conv-title__text">{conv.title}</span>
        <span className="material-symbols-outlined conv-title__icon">edit</span>
      </button>
    </h1>
  );
}

export function ConversationActions({
  conv,
  onChanged,
  onDeleted,
  canDelete = true,
}: {
  conv: Conv;
  onChanged: () => void;
  onDeleted?: () => void;
  canDelete?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const togglePin = async () => {
    await api.patch(`/api/conversations/${conv.id}`, { pinned: !conv.pinned }).catch(() => {});
    onChanged();
  };

  return (
    <div className="conv-actions">
      <button
        className={cn("icon-button", { "is-on": conv.pinned })}
        onClick={togglePin}
        aria-pressed={conv.pinned}
        title={conv.pinned ? "Unpin" : "Pin to the top of the list"}
        aria-label={conv.pinned ? "Unpin conversation" : "Pin conversation"}
      >
        <span className="material-symbols-outlined">keep</span>
      </button>
      <div className="menu-wrap" ref={ref}>
        <button className="icon-button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" title="Export" aria-label="Export conversation">
          <span className="material-symbols-outlined">download</span>
        </button>
        {menu && (
          <div className="menu" role="menu">
            {(
              [
                ["md", "Markdown (.md)"],
                ["txt", "Plain text (.txt)"],
                ["json", "JSON (.json)"],
              ] as const
            ).map(([fmt, label]) => (
              <button
                key={fmt}
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  downloadFile(`/api/conversations/${conv.id}/export?format=${fmt}`, `conversation.${fmt}`).catch((e) => alert(e.message));
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {canDelete && onDeleted && (
        <ConfirmButton
          small
          iconOnly
          onConfirm={async () => {
            await api.del(`/api/conversations/${conv.id}`);
            onDeleted();
          }}
          label="Delete conversation"
          confirmLabel="Delete for good"
        />
      )}
    </div>
  );
}
