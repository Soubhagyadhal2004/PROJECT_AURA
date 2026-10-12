import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import { api, downloadFile, Health, Meeting, MeetingSpeaker, MeetingSummary, Segment, Settings, SpeakerProfile } from "../lib/api";
import { clock, dateTime, relativeTime } from "../lib/format";
import { AudioRecorder } from "../lib/audio-recorder";
import { Segmenter } from "../lib/segmenter";
import { LiveTranscriber } from "../lib/live-transcriber";
import { setFaviconState } from "../lib/favicon";
import { useLiveAPIContext } from "../contexts/LiveAPIContext";
import ConfirmButton from "../components/ConfirmButton";
import VoiceProfiles from "./VoiceProfiles";
import Orb from "../components/Orb";

const SPEAKER_HUES = [38, 200, 150, 280, 340, 95, 15, 250];
const BUSY: Segment["status"][] = ["pending", "analysing", "live", "queued"];

export default function MeetingView({ health, hidden }: { health: Health | null; hidden?: boolean }) {
  const [tab, setTab] = useState<"transcripts" | "voices">("transcripts");
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useMeetingRecorder(setError);

  const loadList = useCallback(() => {
    api.get<MeetingSummary[]>("/api/meetings").then(setMeetings).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!hidden) loadList();
  }, [loadList, hidden, rec.meetingId]);

  const start = async () => {
    setError(null);
    try {
      const m = await api.post<Meeting>("/api/meetings", {});
      setSelected(m.id);
      await rec.start(m.id);
      loadList();
    } catch (e: any) {
      setSelected(null);
      loadList();
      setError(e.message);
    }
  };

  const speakerModel = health?.models.speaker;
  const segModel = health?.models.segmentation;
  const [outdatedProfiles, setOutdatedProfiles] = useState(0);
  useEffect(() => {
    if (hidden) return;
    api
      .get<SpeakerProfile[]>("/api/speakers")
      .then((ps) => setOutdatedProfiles(ps.filter((p) => p.outdated).length))
      .catch(() => {});
  }, [hidden, tab]);

  return (
    <section className={cn("view meeting", { "is-hidden": hidden })} aria-hidden={hidden}>
      <header className="view__header">
        <div>
          <h1>Meeting Mode</h1>
          <p className="view__sub">Records the room through your microphone and writes a transcript with who said what.</p>
        </div>
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={tab === "transcripts"} className={cn({ "is-on": tab === "transcripts" })} onClick={() => setTab("transcripts")}>
            Transcripts
          </button>
          <button role="tab" aria-selected={tab === "voices"} className={cn({ "is-on": tab === "voices" })} onClick={() => setTab("voices")}>
            Voice profiles
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          <span className="material-symbols-outlined">error</span>
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError(null)} aria-label="Dismiss">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      )}
      {speakerModel?.state === "error" && (
        <div className="banner banner--warn">
          <span className="material-symbols-outlined">warning</span>
          <span>
            The local speaker model couldn't load ({speakerModel.error}). Transcripts still work, but every line will be unattributed.
          </span>
        </div>
      )}
      {(speakerModel?.state === "loading" || segModel?.state === "loading") && (
        <div className="banner banner--info">
          <span className="material-symbols-outlined">downloading</span>
          <span>Loading the local speaker-recognition models. The first run downloads about 35 MB, so this can take a moment…</span>
        </div>
      )}
      {segModel?.state === "error" && (
        <div className="banner banner--warn">
          <span className="material-symbols-outlined">warning</span>
          <span>
            The speaker-change model couldn't load ({segModel.error}). Each piece of speech will go to one speaker, even when two people talk back to back.
          </span>
        </div>
      )}
      {outdatedProfiles > 0 && tab === "transcripts" && (
        <div className="banner banner--warn">
          <span className="material-symbols-outlined">record_voice_over</span>
          <span>
            {outdatedProfiles} voice profile{outdatedProfiles === 1 ? " was" : "s were"} recorded with the previous voice model and won't be recognised.
          </span>
          <button className="btn btn--small" onClick={() => setTab("voices")}>
            Re-record
          </button>
        </div>
      )}

      {tab === "voices" ? (
        <VoiceProfiles disabled={rec.recording} onError={setError} />
      ) : (
        <div className="meeting__layout">
          <aside className="meeting__list">
            <button className="btn btn--record" onClick={start} disabled={rec.recording || rec.starting}>
              <span className="material-symbols-outlined">fiber_manual_record</span>
              {rec.starting ? "Starting…" : "Start recording"}
            </button>
            <ul>
              {meetings.length === 0 && <li className="empty">No meetings yet.</li>}
              {meetings.map((m) => (
                <li key={m.id}>
                  <button className={cn("meeting-item", { "is-on": selected === m.id })} onClick={() => setSelected(m.id)}>
                    <span className="meeting-item__title">
                      {rec.meetingId === m.id && <span className="rec-dot" aria-label="Recording" />}
                      {m.title}
                    </span>
                    <span className="meeting-item__meta">
                      {relativeTime(m.startedAt)}, {clock(m.durationMs)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          {selected ? (
            <MeetingDetail
              key={selected}
              id={selected}
              rec={rec}
              onChanged={loadList}
              onDeleted={() => {
                setSelected(null);
                loadList();
              }}
              onError={setError}
            />
          ) : (
            <div className="meeting__empty">
              <Orb size={120} tone="recording" />
              <h2>Ready when the room is.</h2>
              <p>
                Press <strong>Start recording</strong> and leave this tab open. Each time someone pauses, their words are transcribed and matched to a voice.
                People with a voice profile appear by name; everyone else becomes Speaker 1, Speaker 2, and so on.
              </p>
              <p className="muted">Only record people who know they're being recorded.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------
type Recorder = ReturnType<typeof useMeetingRecorder>;

function useMeetingRecorder(onError: (e: string) => void) {
  const live = useLiveAPIContext();
  const [meetingId, setMeetingId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [uploads, setUploads] = useState(0);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const segRef = useRef<Segmenter | null>(null);
  const idRef = useRef<number | null>(null);
  // Live transcription (Gemini 3.5 Transcribe Live); null = standard transcription
  const liveRef = useRef<LiveTranscriber | null>(null);
  const inFlight = useRef(new Set<Promise<unknown>>());
  const [transcriber, setTranscriber] = useState<"live" | "standard">("standard");

  const track = useCallback((p: Promise<unknown>) => {
    setUploads((u) => u + 1);
    inFlight.current.add(p);
    p.finally(() => {
      inFlight.current.delete(p);
      setUploads((u) => u - 1);
    });
  }, []);

  const upload = useCallback(
    (id: number, s: { startMs: number; endMs: number; pcm: ArrayBuffer }) => {
      const q = `start=${Math.round(s.startMs)}&end=${Math.round(s.endMs)}`;
      const lt = liveRef.current;
      if (!lt) {
        track(api.postAudio(`/api/meetings/${id}/segments?${q}`, s.pcm).catch((e) => onError(`A piece of audio couldn't be saved: ${e.message}`)));
        return;
      }
      const pcm = new Int16Array(s.pcm);
      track(
        api
          .postAudio<{ turns: { id: number; startMs: number; endMs: number }[] }>(`/api/meetings/${id}/segments?${q}&live=1`, s.pcm)
          .then(({ turns }) =>
            Promise.all(
              turns.map(async (t) => {
                // the server split the piece by speaker: transcribe each turn on its own
                const from = Math.max(0, Math.round(((t.startMs - s.startMs) / 1000) * 16000));
                const to = Math.min(pcm.length, Math.round(((t.endMs - s.startMs) / 1000) * 16000));
                const post = (body: object) => api.post(`/api/meetings/${id}/segments/${t.id}/transcript`, body);
                const current = liveRef.current;
                if (!current) return post({ failed: true });
                try {
                  await post({ text: await current.transcribe(pcm.slice(from, to)) });
                } catch (e: any) {
                  if (liveRef.current) {
                    liveRef.current.close();
                    liveRef.current = null;
                    setTranscriber("standard");
                    onError(`Live transcription stopped working (${e.message}). The rest of this meeting uses standard transcription.`);
                  }
                  await post({ failed: true });
                }
              })
            )
          )
          .catch((e) => onError(`A piece of audio couldn't be saved: ${e.message}`))
      );
    },
    [onError, track]
  );

  const start = useCallback(
    async (id: number) => {
      if (live.status !== "disconnected") live.disconnect(); // one microphone user at a time
      setStarting(true);
      liveRef.current?.close();
      liveRef.current = null;
      try {
        const [settings, profiles] = await Promise.all([api.get<Settings>("/api/settings"), api.get<SpeakerProfile[]>("/api/speakers")]);
        if (settings.meetingTranscriber === "live") {
          // names help the transcriber spell people correctly
          liveRef.current = new LiveTranscriber({ vocabulary: [...new Set(profiles.map((p) => p.name))] });
        }
      } catch {}
      setTranscriber(liveRef.current ? "live" : "standard");
      const r = new AudioRecorder();
      const seg = new Segmenter((s) => upload(id, s));
      r.on("pcm", (buf: ArrayBuffer) => {
        seg.push(buf);
      });
      r.on("volume", (v: number) => setLevel(v));
      try {
        await r.start();
      } catch (e: any) {
        setStarting(false);
        liveRef.current?.close();
        liveRef.current = null;
        await api.del(`/api/meetings/${id}`).catch(() => {}); // nothing was recorded
        throw e;
      }
      recorderRef.current = r;
      segRef.current = seg;
      idRef.current = id;
      setMeetingId(id);
      setElapsed(0);
      setStarting(false);
    },
    [live, upload]
  );

  const stop = useCallback(async () => {
    const id = idRef.current;
    segRef.current?.flush();
    recorderRef.current?.stop();
    recorderRef.current?.removeAllListeners();
    recorderRef.current = null;
    segRef.current = null;
    idRef.current = null;
    setMeetingId(null);
    setLevel(0);
    if (id) await api.patch(`/api/meetings/${id}`, { ended: true }).catch(() => {});
    // let the last turns finish transcribing, then close the Live session
    const lt = liveRef.current;
    if (lt) {
      await Promise.allSettled([...inFlight.current]);
      if (liveRef.current === lt) {
        lt.close();
        liveRef.current = null;
      }
    }
  }, []);

  useEffect(() => setFaviconState({ recording: meetingId != null }), [meetingId]);
  useEffect(() => {
    if (!meetingId) return;
    const t = setInterval(() => setElapsed(segRef.current?.elapsedMs ?? 0), 500);
    return () => clearInterval(t);
  }, [meetingId]);

  // stop cleanly if the page is closed mid-meeting
  useEffect(() => () => {
    recorderRef.current?.stop();
  }, []);

  return { meetingId, recording: meetingId != null, starting, elapsed, level, uploads, transcriber, start, stop };
}

// ---------------------------------------------------------------------------------------
function MeetingDetail({
  id,
  rec,
  onChanged,
  onDeleted,
  onError,
}: {
  id: number;
  rec: Recorder;
  onChanged: () => void;
  onDeleted: () => void;
  onError: (e: string) => void;
}) {
  const [m, setM] = useState<Meeting | null>(null);
  const [title, setTitle] = useState("");
  const recordingThis = rec.meetingId === id;
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api
      .get<Meeting>(`/api/meetings/${id}`)
      .then((x) => {
        setM(x);
        setTitle((t) => t || x.title);
      })
      .catch((e) => onError(e.message));
  }, [id, onError]);

  const pending = m?.segments.filter((s) => BUSY.includes(s.status)).length ?? 0;
  // after recording stops, speakers are re-checked once everything is transcribed
  const refining = !!m && !!m.endedAt && !m.refined && m.segments.length > 0;
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!recordingThis && !pending && !rec.uploads && !refining) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [recordingThis, pending, rec.uploads, refining, load]);

  const segCount = m?.segments.length ?? 0;
  useEffect(() => {
    if (recordingThis) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [segCount, recordingThis]);

  const speakers = useMemo(() => new Map((m?.speakers ?? []).map((s, i) => [s.id, { ...s, hue: SPEAKER_HUES[i % SPEAKER_HUES.length] }])), [m]);

  if (!m) return <div className="meeting__detail" />;

  const failed = m.segments.filter((s) => s.status === "error").length;
  const emptyRetryable = m.segments.filter((s) => s.status === "empty" && s.retryable).length;
  const call = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e: any) {
      onError(e.message);
    }
    load();
  };

  return (
    <div className="meeting__detail">
      <div className="meeting__head">
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== m.title && call(api.patch(`/api/meetings/${id}`, { title })).then(onChanged)}
          aria-label="Meeting title"
        />
        <div className="meeting__actions">
          <button className="btn btn--ghost btn--small" onClick={() => call(downloadFile(`/api/meetings/${id}/export?format=txt`, "meeting.txt"))}>
            <span className="material-symbols-outlined">download</span>Text
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => call(downloadFile(`/api/meetings/${id}/export?format=md`, "meeting.md"))}>
            Markdown
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => call(downloadFile(`/api/meetings/${id}/export?format=json`, "meeting.json"))}>
            JSON
          </button>
          <ConfirmButton small iconOnly disabled={recordingThis} onConfirm={async () => { await api.del(`/api/meetings/${id}`); onDeleted(); }} label="Delete meeting" confirmLabel="Delete meeting" />
        </div>
      </div>
      <p className="view__sub">{dateTime(m.startedAt)}</p>

      {recordingThis && (
        <div className="recbar">
          <Orb size={40} level={rec.level * 8} active tone="recording" />
          <div className="recbar__info">
            <strong>
              Recording {clock(rec.elapsed)}
              <span className="recbar__mode" title={rec.transcriber === "live" ? "Gemini 3.5 Transcribe Live" : "Batched Gemini requests"}>
                {rec.transcriber === "live" ? "Live transcription" : "Standard transcription"}
              </span>
            </strong>
            <span>{pending + rec.uploads > 0 ? `Processing ${pending + rec.uploads} piece${pending + rec.uploads === 1 ? "" : "s"} of speech…` : "Waiting for speech"}</span>
          </div>
          <button className="btn btn--stop" onClick={() => rec.stop().then(() => { load(); onChanged(); })}>
            <span className="material-symbols-outlined">stop</span>
            Stop recording
          </button>
        </div>
      )}
      {!recordingThis && pending > 0 && <p className="muted">Finishing {pending} remaining piece{pending === 1 ? "" : "s"}…</p>}
      {!recordingThis && !pending && refining && <p className="muted">Re-checking speakers across the whole meeting…</p>}
      {!failed && emptyRetryable > 0 && !recordingThis && !pending && (
        <div className="banner banner--info">
          <span>
            {emptyRetryable} piece{emptyRetryable === 1 ? "" : "s"} came back without words. If people were talking, try transcribing again.
          </span>
          <button className="btn btn--small" onClick={() => call(api.post(`/api/meetings/${id}/retry`))}>
            Try again
          </button>
        </div>
      )}
      {failed > 0 && (
        <div className="banner banner--error">
          <span>{failed} piece{failed === 1 ? "" : "s"} couldn't be transcribed ({m.segments.find((s) => s.status === "error")?.error}).</span>
          <button className="btn btn--small" onClick={() => call(api.post(`/api/meetings/${id}/retry`))}>
            Retry
          </button>
        </div>
      )}

      {m.speakers.length > 0 && (
        <SpeakerBar speakers={[...speakers.values()]} meetingId={id} onChange={load} onError={onError} />
      )}

      <ol className="transcript">
        {m.segments.length === 0 && <li className="empty">{recordingThis ? "Start talking — the first lines appear a few seconds after someone pauses." : "This meeting has no transcript."}</li>}
        {m.segments.map((s) => (
          <TranscriptRow key={s.id} s={s} speakers={speakers} meetingId={id} onChange={load} onError={onError} />
        ))}
      </ol>
      <div ref={endRef} />
    </div>
  );
}

function SpeakerBar({
  speakers,
  meetingId,
  onChange,
  onError,
}: {
  speakers: (MeetingSpeaker & { hue: number })[];
  meetingId: number;
  onChange: () => void;
  onError: (e: string) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [mergeFrom, setMergeFrom] = useState<number | null>(null);

  const rename = async (sid: number) => {
    if (value.trim()) await api.patch(`/api/meetings/${meetingId}/speakers/${sid}`, { label: value }).catch((e) => onError(e.message));
    setEditing(null);
    onChange();
  };
  const merge = async (into: number) => {
    if (mergeFrom && into !== mergeFrom) await api.post(`/api/meetings/${meetingId}/speakers/${mergeFrom}/merge`, { into }).catch((e) => onError(e.message));
    setMergeFrom(null);
    onChange();
  };

  return (
    <div className="speakers">
      <span className="speakers__label">{mergeFrom ? "Merge into which speaker?" : "Speakers"}</span>
      {speakers.map((s) =>
        editing === s.id ? (
          <form key={s.id} className="speaker-edit" onSubmit={(e) => { e.preventDefault(); rename(s.id); }}>
            <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => rename(s.id)} aria-label="Speaker name" />
          </form>
        ) : (
          <span key={s.id} className={cn("speaker-chip", { "is-merge-target": mergeFrom && mergeFrom !== s.id })} style={{ ["--hue" as any]: s.hue }}>
            <button
              className="speaker-chip__name"
              onClick={() => {
                if (mergeFrom) return merge(s.id);
                setEditing(s.id);
                setValue(s.label);
              }}
              title={mergeFrom ? `Merge into ${s.label}` : "Rename everywhere in this meeting"}
            >
              {s.label}
              {s.profileId && (
                <span className="material-symbols-outlined speaker-chip__badge" title={`Matched a voice profile (similarity ${(s.matchScore ?? 0).toFixed(2)})`}>
                  verified
                </span>
              )}
              <span className="speaker-chip__count">{s.segments}</span>
            </button>
            {!mergeFrom && speakers.length > 1 && (
              <button className="speaker-chip__merge" onClick={() => setMergeFrom(s.id)} title={`${s.label} is the same person as someone else`} aria-label={`Merge ${s.label}`}>
                <span className="material-symbols-outlined">call_merge</span>
              </button>
            )}
          </span>
        )
      )}
      {mergeFrom && (
        <button className="btn btn--ghost btn--small" onClick={() => setMergeFrom(null)}>
          Cancel
        </button>
      )}
    </div>
  );
}

function TranscriptRow({
  s,
  speakers,
  meetingId,
  onChange,
  onError,
}: {
  s: Segment;
  speakers: Map<number, MeetingSpeaker & { hue: number }>;
  meetingId: number;
  onChange: () => void;
  onError: (e: string) => void;
}) {
  const [editText, setEditText] = useState<string | null>(null);
  const sp = s.speakerId ? speakers.get(s.speakerId) : undefined;

  const patch = async (body: object) => {
    await api.patch(`/api/meetings/${meetingId}/segments/${s.id}`, body).catch((e) => onError(e.message));
    onChange();
  };

  return (
    <li className={cn("tline", { "tline--pending": BUSY.includes(s.status), "tline--empty": s.status === "empty" })} style={{ ["--hue" as any]: sp?.hue ?? 0 }}>
      <span className="tline__time">{clock(s.startMs)}</span>
      <div className="tline__who">
        <select
          value={s.speakerId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__new") {
              const name = window.prompt("Name for the new speaker");
              if (name?.trim()) patch({ newLabel: name.trim() });
            } else if (v) patch({ speakerId: Number(v) });
          }}
          aria-label="Speaker for this line"
          className={cn({ unknown: !sp })}
        >
          {!sp && <option value="">{s.status === "pending" ? "Identifying…" : "Unknown"}</option>}
          {[...speakers.values()].map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
          <option value="__new">New speaker…</option>
        </select>
        {s.speakerUncertain && (
          <span className="tline__unsure" title="Low confidence: the voice was too short or close to another speaker. Check and correct if needed.">
            unsure
          </span>
        )}
      </div>
      <div className="tline__text">
        {editText != null ? (
          <textarea
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={() => {
              if (editText !== s.text) patch({ text: editText });
              setEditText(null);
            }}
            rows={2}
          />
        ) : BUSY.includes(s.status) ? (
          <span className="muted">Transcribing…</span>
        ) : s.status === "error" ? (
          <span className="muted">Not transcribed yet</span>
        ) : s.status === "empty" ? (
          <span className="muted" onDoubleClick={() => setEditText("")} title="Double-click to type what was said">
            No words recognised
          </span>
        ) : (
          <span onDoubleClick={() => setEditText(s.text || "")} title="Double-click to correct the text">
            {s.text}
          </span>
        )}
      </div>
    </li>
  );
}
