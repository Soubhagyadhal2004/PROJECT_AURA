import { useCallback, useEffect, useRef, useState } from "react";
import { api, SpeakerProfile } from "../lib/api";
import { AudioRecorder } from "../lib/audio-recorder";
import { dateTime } from "../lib/format";
import ConfirmButton from "../components/ConfirmButton";
import Orb from "../components/Orb";

const PASSAGE =
  "The morning train was late again, so I walked along the river instead. A cyclist rang her bell, two ducks argued near the bridge, " +
  "and somewhere a radio was playing an old song. By the time I reached the office, I had planned the whole week in my head.";

const MIN_SECONDS = 12;

/** Records raw 16 kHz PCM from the microphone until stopped. */
function usePcmCapture(onError: (e: string) => void) {
  const rec = useRef<AudioRecorder | null>(null);
  const chunks = useRef<Int16Array[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);

  const start = async () => {
    chunks.current = [];
    setSeconds(0);
    const r = new AudioRecorder();
    r.on("pcm", (b: ArrayBuffer) => {
      chunks.current.push(new Int16Array(b));
      setSeconds(chunks.current.reduce((a, c) => a + c.length, 0) / 16000);
    });
    r.on("volume", setLevel);
    try {
      await r.start();
      rec.current = r;
      setActive(true);
    } catch (e: any) {
      onError(e.message);
    }
  };
  const stop = (): ArrayBuffer => {
    rec.current?.stop();
    rec.current?.removeAllListeners();
    rec.current = null;
    setActive(false);
    setLevel(0);
    const total = chunks.current.reduce((a, c) => a + c.length, 0);
    const out = new Int16Array(total);
    let off = 0;
    for (const c of chunks.current) {
      out.set(c, off);
      off += c.length;
    }
    return out.buffer;
  };
  useEffect(() => () => rec.current?.stop(), []);
  return { start, stop, seconds, level, active };
}

export default function VoiceProfiles({ disabled, onError }: { disabled: boolean; onError: (e: string) => void }) {
  const [profiles, setProfiles] = useState<SpeakerProfile[]>([]);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"enroll" | "test" | null>(null);
  const [testResult, setTestResult] = useState<{ name: string; score: number }[] | null>(null);
  const [threshold, setThreshold] = useState(0.86);
  const cap = usePcmCapture(onError);

  const load = useCallback(() => {
    api.get<SpeakerProfile[]>("/api/speakers").then(setProfiles).catch((e) => onError(e.message));
    api.get<{ speakerMatchThreshold: number }>("/api/settings").then((s) => setThreshold(s.speakerMatchThreshold)).catch(() => {});
  }, [onError]);
  useEffect(load, [load]);

  const beginEnroll = async () => {
    setMode("enroll");
    setTestResult(null);
    await cap.start();
  };
  const finishEnroll = async () => {
    const pcm = cap.stop();
    setMode(null);
    if (pcm.byteLength / 32000 < MIN_SECONDS) {
      onError(`That recording was too short. Please record at least ${MIN_SECONDS} seconds.`);
      return;
    }
    setBusy(true);
    try {
      await api.postAudio(`/api/speakers?name=${encodeURIComponent(name.trim())}&consent=yes`, pcm);
      setName("");
      setConsent(false);
      load();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const beginTest = async () => {
    setMode("test");
    setTestResult(null);
    await cap.start();
  };
  const finishTest = async () => {
    const pcm = cap.stop();
    setMode(null);
    setBusy(true);
    try {
      setTestResult(await api.postAudio<{ name: string; score: number }[]>("/api/speakers/identify", pcm));
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const canEnroll = name.trim().length > 0 && consent && !disabled && !busy && !mode;

  return (
    <div className="voices">
      <div className="voices__enroll card">
        <h2>Add a voice profile</h2>
        <p className="muted">
          A profile lets Meeting Mode show a person's name instead of “Speaker 2”. Only a numeric voiceprint is kept on this computer, not the recording.
        </p>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" disabled={!!mode} />
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={!!mode} />
          <span>{name.trim() || "This person"} knows their voice is being recorded and agrees to a voice profile being stored here.</span>
        </label>

        {mode === "enroll" ? (
          <div className="enroll-live">
            <Orb size={56} level={cap.level * 8} active tone="recording" />
            <div>
              <p className="passage">{PASSAGE}</p>
              <div className="progress" aria-label="Recording progress">
                <span style={{ width: `${Math.min(100, (cap.seconds / MIN_SECONDS) * 100)}%` }} />
              </div>
              <p className="muted">
                {cap.seconds < MIN_SECONDS
                  ? `Read the passage aloud in a normal voice — ${Math.ceil(MIN_SECONDS - cap.seconds)} s to go`
                  : "That's enough. Keep reading for a better profile, or save now."}
              </p>
            </div>
            <div className="enroll-live__actions">
              <button className="btn btn--primary" onClick={finishEnroll} disabled={cap.seconds < MIN_SECONDS}>
                Save profile
              </button>
              <button className="btn btn--ghost" onClick={() => { cap.stop(); setMode(null); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn--primary" onClick={beginEnroll} disabled={!canEnroll}>
            <span className="material-symbols-outlined">mic</span>
            {busy ? "Saving…" : "Record voice sample"}
          </button>
        )}
        {disabled && <p className="muted">Stop the meeting recording to add profiles.</p>}
      </div>

      <div className="voices__list card">
        <div className="voices__list-head">
          <h2>Saved profiles</h2>
          {profiles.length > 0 &&
            (mode === "test" ? (
              <button className="btn btn--primary btn--small" onClick={finishTest}>
                Check now ({Math.floor(cap.seconds)} s)
              </button>
            ) : (
              <button className="btn btn--ghost btn--small" onClick={beginTest} disabled={disabled || busy || !!mode}>
                <span className="material-symbols-outlined">hearing</span>
                Test recognition
              </button>
            ))}
        </div>
        {mode === "test" && <p className="muted">Say a sentence or two, then press Check now.</p>}
        {testResult && (
          <div className="test-result">
            {testResult.length === 0 ? (
              <p>No profiles to compare with.</p>
            ) : testResult[0].score >= threshold ? (
              <p>
                Recognised as <strong>{testResult[0].name}</strong> (similarity {testResult[0].score.toFixed(2)}, needs {threshold.toFixed(2)}).
              </p>
            ) : (
              <p>
                Not confident enough to name this voice. Closest is {testResult[0].name} at {testResult[0].score.toFixed(2)}; a name is shown from{" "}
                {threshold.toFixed(2)}.
              </p>
            )}
          </div>
        )}
        <ul>
          {profiles.length === 0 && <li className="empty">No voice profiles yet. Everyone will appear as Speaker 1, Speaker 2…</li>}
          {profiles.map((p) => (
            <li key={p.id} className="profile">
              <span className="profile__avatar" aria-hidden="true">
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{p.name}</strong>
                <span className="muted">
                  {Math.round(p.sampleSeconds)} s sample, added {dateTime(p.createdAt)}
                </span>
              </div>
              <ConfirmButton
                small
                iconOnly
                onConfirm={async () => {
                  await api.del(`/api/speakers/${p.id}`);
                  load();
                }}
                label={`Delete ${p.name}'s profile`}
                confirmLabel="Delete profile"
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
