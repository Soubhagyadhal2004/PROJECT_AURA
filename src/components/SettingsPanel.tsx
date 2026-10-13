import { useEffect, useState } from "react";
import cn from "classnames";
import { api, Health, Settings } from "../lib/api";
import { useLiveAPIContext } from "../contexts/LiveAPIContext";
import ConfirmButton from "./ConfirmButton";

const VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"];
// Live API models (free tier: no daily request cap). Web search on the free tier may need a 2.5 model.
const LIVE_MODELS = [
  { id: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live (default, no web search on free tier)" },
  { id: "gemini-2.5-flash-native-audio-preview-12-2025", label: "Gemini 2.5 Flash native audio (web search works on free tier)" },
  { id: "gemini-3.8-live", label: "Gemini 3.8 Live" },
];

// language of the user's speech in voice chat (the server turns these into language codes)
const SPEECH_LANGUAGES: { id: Settings["assistantLanguage"]; label: string }[] = [
  { id: "auto", label: "Detect automatically" },
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "en-hi", label: "English and Hindi" },
];

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
                <select value={s.liveModel} onChange={(e) => update({ liveModel: e.target.value })}>
                  {LIVE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {!LIVE_MODELS.some((m) => m.id === s.liveModel) && <option value={s.liveModel}>{s.liveModel} (custom)</option>}
                </select>
                <small className="muted">Applies to the next voice session. Web search on a Gemini 3 model needs paid search quota; pick the 2.5 model to use it for free.</small>
              </label>
              <label className="field">
                <span>Language you speak (for transcripts)</span>
                <select
                  value={s.assistantLanguage}
                  onChange={(e) => update({ assistantLanguage: e.target.value as Settings["assistantLanguage"] })}
                >
                  {SPEECH_LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <small className="muted">
                  How AURA writes down what you say in voice chat. Choose English if your English shows up in Hindi script. AURA's
                  understanding and replies don't depend on it. Some Live models may ignore it.
                </small>
              </label>
              <label className="check">
                <input type="checkbox" checked={s.autoMemory} onChange={(e) => update({ autoMemory: e.target.checked })} />
                <span>Learn memories from conversations automatically</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={s.confirmMemoryChanges} onChange={(e) => update({ confirmMemoryChanges: e.target.checked })} />
                <span>Ask me before changing or removing a memory I already have</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={s.webSearch} onChange={(e) => update({ webSearch: e.target.checked })} />
                <span>Let AURA search the web (Google Search) for news and current information</span>
              </label>
              <p className="muted small">Voice, model, language and search changes apply to the next voice session.</p>
            </section>

            <section>
              <h3>Meeting Mode</h3>
              <fieldset className="field">
                <legend>Transcription</legend>
                <label className="check">
                  <input type="radio" name="transcriber" checked={s.meetingTranscriber === "live"} onChange={() => update({ meetingTranscriber: "live" })} />
                  <span>
                    Live: Gemini 3.5 Transcribe Live, streamed while you talk. No daily request limit on the free tier. Picks up languages automatically.
                  </span>
                </label>
                <label className="check">
                  <input type="radio" name="transcriber" checked={s.meetingTranscriber === "standard"} onChange={() => update({ meetingTranscriber: "standard" })} />
                  <span>Standard: a few seconds of speech per request to {health?.geminiModels.transcribe || "Gemini Flash-Lite"}. Uses the daily request quota.</span>
                </label>
              </fieldset>
              <label className="field">
                <span>Languages spoken in meetings (optional)</span>
                <input
                  value={s.meetingLanguage}
                  onChange={(e) => update({ meetingLanguage: e.target.value })}
                  placeholder="e.g. English and Hindi, Hindi words in Latin script"
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.meetingMemory}
                  disabled={!s.autoMemory}
                  onChange={(e) => update({ meetingMemory: e.target.checked })}
                />
                <span>
                  After a meeting, add decisions, plans and facts from it to memory (one {health?.geminiModels.text || "Gemini Flash-Lite"} request per meeting)
                  {!s.autoMemory && " — needs automatic memories turned on"}
                </span>
              </label>
              <label className="field">
                <span>
                  Name a registered voice from similarity <strong>{s.voiceMatchThreshold.toFixed(2)}</strong>
                </span>
                <input type="range" min={0.2} max={0.9} step={0.01} value={s.voiceMatchThreshold} onChange={(e) => update({ voiceMatchThreshold: Number(e.target.value) })} />
              </label>
              <label className="field">
                <span>
                  Treat as an already-heard voice from <strong>{s.voiceClusterThreshold.toFixed(2)}</strong>
                </span>
                <input type="range" min={0.2} max={0.9} step={0.01} value={s.voiceClusterThreshold} onChange={(e) => update({ voiceClusterThreshold: Number(e.target.value) })} />
              </label>
              <p className="muted small">
                Higher values mean fewer wrong names but more people split into extra speakers. Use <em>Test recognition</em> on the Voice profiles page to see
                the scores your voices get.
              </p>
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
