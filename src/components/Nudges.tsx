import { useCallback, useEffect, useRef, useState } from "react";
import cn from "classnames";
import { api, Nudge, ProactiveState } from "../lib/api";
import { useLiveAPIContext } from "../contexts/LiveAPIContext";
import { NUDGES_REFRESH } from "../hooks/use-live-api";

const POLL_MS = 15_000; // reminders are spoken within about 15 s of their time

// per-browser conveniences (storage may be unavailable: then everything still works, just not remembered)
const SPEAK_KEY = "aura.speakReminders";
const SPOKEN_KEY = "aura.spokenReminders";
const readStore = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeStore = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {}
};

/** Read text aloud with the browser's own speech engine, preferring a voice installed on this computer. */
function speakAloud(text: string) {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const en = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().startsWith("en");
    u.voice = voices.find((v) => v.localService && en(v)) || voices.find(en) || null;
    u.rate = 1;
    synth.cancel();
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}
const HEARTBEAT_MS = 60_000;

const when = (t?: number) =>
  t ? new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

/**
 * AURA's own suggestions: memory checks, reminders, a short briefing. Shows nothing at all unless one of the
 * AURA_PROACTIVE_* switches is on in the server's .env. During a voice conversation only reminder cards show.
 */
export default function Nudges({ onChanged }: { onChanged?: () => void }) {
  const { status, announceReminder } = useLiveAPIContext();
  const live = status !== "disconnected";
  const [state, setState] = useState<ProactiveState | null>(null);
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Set<number>());
  const [speak, setSpeak] = useState(() => readStore(SPEAK_KEY) !== "0");
  // reminders already spoken (kept across reloads so one isn't read out twice)
  const spoken = useRef(
    new Set<number>(
      (() => {
        try {
          return JSON.parse(readStore(SPOKEN_KEY) || "[]") as number[];
        } catch {
          return [];
        }
      })()
    )
  );

  const load = useCallback(async () => {
    try {
      const s = await api.get<ProactiveState>("/api/proactive");
      setState(s);
      // something new arrived: open the inbox
      if (s.nudges.some((n) => !seen.current.has(n.id))) setOpen(true);
      s.nudges.forEach((n) => seen.current.add(n.id));
    } catch {
      // server down: the app shows its own banner
    }
  }, []);

  const enabled = !!state && Object.values(state.switches).some(Boolean);

  useEffect(() => {
    load();
    // the voice assistant just used a reminder tool
    window.addEventListener(NUDGES_REFRESH, load);
    return () => window.removeEventListener(NUDGES_REFRESH, load);
  }, [load]);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [enabled, load]);

  // tell the server while voice chat runs, so it holds everything back
  useEffect(() => {
    if (!enabled) return;
    const say = (voice: boolean) => api.post("/api/proactive/presence", { voice }).catch(() => {});
    say(live);
    if (!live) return;
    const t = setInterval(() => say(true), HEARTBEAT_MS);
    return () => {
      clearInterval(t);
      say(false);
    };
  }, [enabled, live]);

  // say a reminder out loud when it comes due: in AURA's voice during a voice session, otherwise with the browser's speech
  useEffect(() => {
    if (!state) return;
    const due = state.nudges.filter((n) => n.type === "reminder" && n.kind === "due" && !spoken.current.has(n.id));
    if (!due.length) return;
    for (const n of due) {
      spoken.current.add(n.id);
      // one that came due long ago (the app was closed) only gets its card
      if (!speak || Date.now() - n.dueAt > 10 * 60_000) continue;
      if (!announceReminder(n.text)) speakAloud(`Reminder: ${n.text}`);
    }
    writeStore(SPOKEN_KEY, JSON.stringify([...spoken.current].slice(-100)));
  }, [state, speak, announceReminder]);

  const toggleSpeak = () => {
    setSpeak((s) => {
      writeStore(SPEAK_KEY, s ? "0" : "1");
      if (s) window.speechSynthesis?.cancel();
      return !s;
    });
  };

  if (!enabled || !state) return null;
  // during voice chat only reminder cards are shown
  const nudges = live ? state.nudges.filter((n) => n.type === "reminder") : state.nudges;
  if (live && !nudges.length) return null;

  const decide = async (n: Nudge, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/nudges/${n.id}/decide`, body);
      if (n.type === "memory_check") onChanged?.();
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const briefMe = async () => {
    setBusy(true);
    setError(null);
    try {
      setBrief((await api.post<{ lines: string[] }>("/api/proactive/briefing")).lines);
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const count = nudges.length;
  if (!open) {
    return (
      <button className="nudges__pill" onClick={() => setOpen(true)} aria-label={count ? `From AURA (${count})` : "From AURA"}>
        <span className="material-symbols-outlined" aria-hidden="true">
          {count ? "notifications_unread" : "notifications"}
        </span>
        {count > 0 && <span className="nudges__count">{count}</span>}
      </button>
    );
  }

  return (
    <section className="nudges" aria-label="From AURA" aria-live="polite">
      <header className="nudges__head">
        <strong>From AURA</strong>
        <div className="nudges__head-actions">
          {state.switches.reminders && (
            <button
              className="icon-button"
              onClick={toggleSpeak}
              aria-pressed={speak}
              aria-label={speak ? "Reminders are read aloud. Turn off" : "Reminders are silent. Read them aloud"}
              title={speak ? "Read reminders aloud: on" : "Read reminders aloud: off"}
            >
              <span className="material-symbols-outlined">{speak ? "volume_up" : "volume_off"}</span>
            </button>
          )}
          {state.switches.briefing && !live && (
            <button className="btn btn--ghost btn--small" onClick={briefMe} disabled={busy}>
              <span className="material-symbols-outlined">summarize</span>
              Brief me
            </button>
          )}
          <button className="icon-button" onClick={() => setOpen(false)} aria-label="Hide">
            <span className="material-symbols-outlined">expand_more</span>
          </button>
        </div>
      </header>

      {brief && (
        <div className="nudge nudge--brief">
          <ul>
            {brief.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <div className="nudge__actions">
            <button className="btn btn--ghost btn--small" onClick={() => setBrief(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {nudges.map((n) => (
        <NudgeCard key={n.id} n={n} busy={busy} onDecide={(body) => decide(n, body)} />
      ))}

      {!count && !brief && <p className="nudges__empty">Nothing right now.</p>}
      {error && (
        <p className="nudges__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function NudgeCard({ n, busy, onDecide }: { n: Nudge; busy: boolean; onDecide: (body: Record<string, unknown>) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.payload?.memory || "");
  const later = (label = "Later") => (
    <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => onDecide({ decision: "snooze" })}>
      {label}
    </button>
  );
  const dismiss = (label = "Dismiss") => (
    <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => onDecide({ decision: "dismiss" })}>
      {label}
    </button>
  );

  if (n.type === "memory_check") {
    return (
      <article className="nudge">
        <p className="nudge__label">
          <span className="material-symbols-outlined" aria-hidden="true">psychology</span>
          Is this still true?
          <button className="icon-button nudge__close" disabled={busy} onClick={() => onDecide({ decision: "dismiss" })} aria-label="Dismiss" title="Dismiss">
            <span className="material-symbols-outlined">close</span>
          </button>
        </p>
        {editing ? (
          <form
            className="nudge__edit"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) onDecide({ decision: "accept", answer: "changed", content: text.trim() });
            }}
          >
            <label htmlFor={`nudge-${n.id}`}>What's true now?</label>
            <textarea id={`nudge-${n.id}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <div className="nudge__actions">
              <button className="btn btn--primary btn--small" disabled={busy || !text.trim()}>
                Save
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <blockquote className="nudge__quote">{n.payload?.memory}</blockquote>
            {n.payload?.lowConfidence && <p className="nudge__note">Learned from a meeting transcript.</p>}
            <div className="nudge__actions">
              <button className="btn btn--primary btn--small" disabled={busy} onClick={() => onDecide({ decision: "accept", answer: "yes" })}>
                Yes
              </button>
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => setEditing(true)}>
                Changed
              </button>
              <button className="btn btn--ghost btn--small" disabled={busy} onClick={() => onDecide({ decision: "accept", answer: "forget" })}>
                Forget
              </button>
              {later()}
            </div>
          </>
        )}
      </article>
    );
  }

  if (n.type === "reminder" && n.kind === "confirm") {
    return (
      <article className="nudge">
        <p className="nudge__label">
          <span className="material-symbols-outlined" aria-hidden="true">alarm_add</span>
          Set a reminder?
        </p>
        <p className="nudge__text">{n.payload?.what}</p>
        <p className="nudge__when">
          {when(n.payload?.at)}
          {n.payload?.when && <span className="nudge__note"> (from "{n.payload.when}")</span>}
        </p>
        <div className="nudge__actions">
          <button className="btn btn--primary btn--small" disabled={busy} onClick={() => onDecide({ decision: "accept" })}>
            Set reminder
          </button>
          {later()}
          {dismiss("No thanks")}
        </div>
      </article>
    );
  }

  if (n.type === "reminder") {
    return (
      <article className={cn("nudge", "nudge--due")}>
        <p className="nudge__label">
          <span className="material-symbols-outlined" aria-hidden="true">alarm</span>
          Reminder · {when(n.payload?.at)}
        </p>
        <p className="nudge__text">{n.text}</p>
        <div className="nudge__actions">
          <button className="btn btn--primary btn--small" disabled={busy} onClick={() => onDecide({ decision: "accept" })}>
            Done
          </button>
          {later("In 10 minutes")}
          {dismiss()}
        </div>
      </article>
    );
  }

  return (
    <article className="nudge nudge--brief">
      <p className="nudge__label">
        <span className="material-symbols-outlined" aria-hidden="true">summarize</span>
        Your briefing
      </p>
      <ul>
        {(n.payload?.lines || n.text.split("\n")).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <div className="nudge__actions">
        <button className="btn btn--primary btn--small" disabled={busy} onClick={() => onDecide({ decision: "accept" })}>
          Got it
        </button>
        {later()}
      </div>
    </article>
  );
}
