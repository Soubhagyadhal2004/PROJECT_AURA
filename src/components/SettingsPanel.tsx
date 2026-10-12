import { useEffect, useState } from "react";
import cn from "classnames";
import { api, Health, Settings } from "../lib/api";
import { useLiveAPIContext } from "../contexts/LiveAPIContext";
import ConfirmButton from "./ConfirmButton";

const VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"];
const LIVE_MODELS = ["gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-latest"];

type Props = { open: boolean; onClose: () => void; health: Health | null; onDataChanged: () => void };

export default function SettingsPanel({ open, onClose, health, onDataChanged }: Props) {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useLiveAPIContext();

  useEffect(() => {
    if (open) api.get<Settings>("/api/settings").then(setS).catch((e) => setError(e.message));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const update = (patch: Partial<Settings>) => setS((cur) => (cur ? { ...cur, ...patch } : cur));

  const save = async () => {
    if (!s) return;
    try {
      setS(await api.put<Settings>("/api/settings", s));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const wipe = (url: string) => async () => {
    try {
      await api.del(url);
      if (url.includes("conversations") || url === "/api/data") live.newConversation();
      onDataChanged();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className={cn("scrim", { "is-open": open })} onClick={onClose} />
      <aside className={cn("drawer", { "is-open": open })} aria-hidden={!open} aria-label="Settings">
        <header className="drawer__head">
          <h2>Settings</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        {error && <div className="banner banner--error">{error}</div>}

        {s && (
          <div className="drawer__body">
            <section>
              <h3>Assistant</h3>
              <label className="field">
                <span>Your name</span>
                <input value={s.userName} onChange={(e) => update({ userName: e.target.value })} placeholder="Optional" />
              </label>
              <label className="field">
                <span>Voice</span>
                <select value={s.voice} onChange={(e) => update({ voice: e.target.value })}>
                  {VOICES.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Gemini Live model</span>
                <input list="live-models" value={s.liveModel} onChange={(e) => update({ liveModel: e.target.value })} />
                <datalist id="live-models">
                  {LIVE_MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>
              <label className="check">
                <input type="checkbox" checked={s.autoMemory} onChange={(e) => update({ autoMemory: e.target.checked })} />
                <span>Learn memories from conversations automatically</span>
              </label>
              <p className="muted small">Voice and model changes apply to the next voice session.</p>
            </section>

            <section>
              <h3>Meeting speaker recognition</h3>
              <label className="field">
                <span>
                  Name a registered voice from similarity <strong>{s.speakerMatchThreshold.toFixed(2)}</strong>
                </span>
                <input type="range" min={0.6} max={0.95} step={0.01} value={s.speakerMatchThreshold} onChange={(e) => update({ speakerMatchThreshold: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>
                  Treat as the same unknown speaker from <strong>{s.speakerClusterThreshold.toFixed(2)}</strong>
                </span>
                <input type="range" min={0.5} max={0.95} step={0.01} value={s.speakerClusterThreshold} onChange={(e) => update({ speakerClusterThreshold: Number(e.target.value) })} />
              </label>
              <p className="muted small">Higher values mean fewer wrong names but more people split into extra speakers.</p>
            </section>

            <div className="drawer__save">
              <button className="btn btn--primary" onClick={save}>
                {saved ? "Saved" : "Save settings"}
              </button>
            </div>

            <section>
              <h3>Status</h3>
              <dl className="status-list">
                <dt>Gemini API key</dt>
                <dd className={health?.hasKey ? "ok" : "bad"}>{health ? (health.hasKey ? "Found on the server" : "Missing") : "Server offline"}</dd>
                <dt>Memory search model</dt>
                <dd className={health?.models.text.state === "ready" ? "ok" : health?.models.text.state === "error" ? "bad" : ""}>
                  {health?.models.text.state ?? "–"}
                  {health?.models.text.state === "error" && " (keyword search fallback)"}
                </dd>
                <dt>Speaker model</dt>
                <dd className={health?.models.speaker.state === "ready" ? "ok" : health?.models.speaker.state === "error" ? "bad" : ""}>{health?.models.speaker.state ?? "–"}</dd>
                <dt>Data folder</dt>
                <dd className="mono-break">{health?.dataDir ?? "–"}</dd>
              </dl>
            </section>

            <section>
              <h3>Your data</h3>
              <p className="muted small">Everything lives in the data folder above. Deleting is permanent.</p>
              <div className="danger-list">
                <ConfirmButton small onConfirm={wipe("/api/conversations")} label="Delete all conversations" confirmLabel="Yes, delete conversations" />
                <ConfirmButton small onConfirm={wipe("/api/memories")} label="Delete all memories" confirmLabel="Yes, delete memories" />
                <ConfirmButton small onConfirm={wipe("/api/meetings")} label="Delete all meeting transcripts" confirmLabel="Yes, delete transcripts" />
                <ConfirmButton small onConfirm={wipe("/api/data")} label="Delete everything, including voice profiles" confirmLabel="Yes, delete everything" />
              </div>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
