# AURA — Adaptive Unified Responsive Assistant

A local, working-prototype personal assistant built on Google's
[Live API web console](https://github.com/google-gemini/live-api-web-console).

- **Assistant**: real-time voice conversations with Gemini Live, plus typed messages in the same session.
  It can search the web (Google Search grounding) for news and other current information and shows its sources.
- **Memory**: AURA learns durable facts from your conversations, stores them in SQLite on your computer,
  and recalls them in later sessions (even after a restart). You can inspect, edit, restore and delete them.
- **Meeting Mode**: records a room through your microphone and produces a timestamped transcript with
  speaker labels. People with a registered voice profile appear by name; everyone else becomes
  Speaker 1, Speaker 2, … You can rename speakers, move or merge lines, fix text, and export.

Everything except the Gemini API calls runs on your machine.

## Requirements

- **Node.js 22.13 or newer** (Node 24 LTS recommended). AURA uses Node's built-in SQLite module, so
  nothing native has to be compiled.
- A Gemini API key from <https://aistudio.google.com/apikey>.
- Chrome or Edge (microphone access requires `localhost` or HTTPS).
- About 70 MB of disk for the local models, downloaded automatically on first start.

## Setup and start

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
# open .env and paste your key after GEMINI_API_KEY=
npm run dev
```

`npm run dev` starts the local server on port 3001 and the web app on <http://localhost:3000>.
The first start downloads three small models from the Hugging Face hub into `data/models`
(memory search, voiceprints, speaker-change detection). The Meeting page shows a notice while that is happening.

Single-port alternative: `npm run build` once, then `npm run serve` and open <http://localhost:3001>.

## How it works

```
browser (React, existing CRA stack)               local server (server/, plain Node)
 ├─ Gemini Live websocket  ◄── ephemeral token ──  POST /api/live/token   (API key stays here)
 ├─ conversation + memory UI  ───── REST ──────►   SQLite: data/aura.db
 └─ Meeting Mode: mic → VAD segments ─ PCM ────►   speaker embedding (local) → Gemini transcription
```

### Assistant (`src/hooks/use-live-api.ts`, `src/lib/genai-live-client.ts`)

- Reuses the console's Gemini Live client, audio recorder, audio streamer and worklets.
- The browser never sees the API key: the server issues a single-use
  [ephemeral token](https://ai.google.dev/gemini-api/docs/ephemeral-tokens) for each session.
- Input and output audio transcription are enabled, so spoken turns appear as text and are saved.
- Dropped sessions show a **Reconnect** button that resumes the same context (session resumption);
  server `goAway` notices reconnect automatically. Microphone and API errors are shown in plain words.
- Default Live model: `gemini-3.1-flash-live-preview` (change it in Settings, e.g. to
  `gemini-2.5-flash-native-audio-latest`).
- **Web search**: the session is given Gemini's built-in Google Search tool, so questions about news,
  scores, prices or anything recent are answered from the web. Answers that used search show the
  search terms and numbered source links; the sources are saved with the conversation. Turn it off in
  Settings ("Let AURA search the web"). Search runs inside Gemini; nothing else is called.

### Memory (`server/memory.mjs`)

- **Extraction**: a few seconds after each reply (and when a session ends), new messages are sent to
  Gemini (`GEMINI_TEXT_MODEL`, default `gemini-3.5-flash-lite`, chosen for its larger free daily quota) together with the related existing
  memories. The model returns `add` / `update` / `retire` / `forget` operations.
- **Conflicts**: an `update` never overwrites. The old fact is kept with status *superseded* and a
  link to its replacement; `retire` marks a fact *outdated*. Only *active* facts are given to the
  assistant, each with its "last confirmed" date. The model can only change memories it was shown.
- **Retrieval**: sentence embeddings from a local model (`Xenova/all-MiniLM-L6-v2` via transformers.js)
  plus keyword overlap. The 30 most recent active facts are placed in the Live system prompt; the
  assistant can search the rest through a `recall_memories` tool, and typed messages get the closest
  matches attached. If the embedding model can't load, search falls back to keywords.
- **Asking before changes**: new facts are saved automatically, but when AURA wants to change, mark
  outdated or delete a memory you already have, it asks first (a card in the Assistant view and on the
  Memory page, with a badge in the sidebar). You can accept, edit the wording first, or keep the old
  fact; a change you turned down isn't proposed again. Turn this off in Settings.
- **Conversations** are stored and listed in the sidebar (pinned ones first). Open one to read it,
  **continue it** (the assistant gets the earlier messages as context), rename it (click the title),
  pin it, export it as Markdown, text or JSON, or delete it.

### Meeting Mode (`src/lib/segmenter.ts`, `server/meetings.mjs`)

1. The browser records 16 kHz audio and cuts it into pieces at pauses (energy-based voice
   activity detection; ≥0.7 s silence, max 10 s per piece).
2. **Speaker changes inside a piece** are found with a local speaker-segmentation model
   (`onnx-community/pyannote-segmentation-3.0`), so two people talking back to back become two lines.
   Very short turns (< 0.6 s) are folded into their neighbour.
3. Each turn gets a **voiceprint** from a local model (`onnx-community/wespeaker-voxceleb-resnet34-LM`,
   the embedding model behind pyannote 3.x).
4. The voiceprint is compared with the voices already heard in this meeting (default similarity
   ≥ 0.55) and with registered voice profiles (≥ 0.58, and clearly ahead of the next profile).
   Otherwise it becomes a new *Speaker N*. Numbers are never reused within a meeting. An unnamed
   speaker who later turns out to match a profile gets that name.
5. Turns are **transcribed by Gemini**, in one of two ways (Settings → Meeting Mode → Transcription):
   - **Live** (default): the browser keeps a Live API session open with `gemini-3.5-transcribe-live`
     and sends each speaker turn as its own utterance. On the free tier this model has no daily request
     cap. If it fails, the rest of the meeting switches to Standard automatically, and turns the
     browser never reported back are transcribed by the server.
   - **Standard**: turns are collected for a few seconds and sent several at a time to
     `GEMINI_TRANSCRIBE_MODEL` (default `gemini-3.5-flash-lite`), together with the last few transcript
     lines as context. An optional language hint (Settings, e.g. "English and Hindi") helps with mixed-language
   meetings. 429/5xx responses are retried; failed or empty pieces keep their audio and can be retried.
6. **After the meeting ends**, every line is checked again against the final voiceprint of each
   speaker: unnamed speakers that are really one person are merged, and lines that clearly belong to
   someone else are moved. Lines you moved by hand and speakers you renamed are never changed.
7. Corrections: click a speaker chip to rename it everywhere, use the merge icon when one person was
   split in two (their future lines follow the merge), change a single line's speaker from its
   dropdown, double-click text to fix it. Export as text, Markdown or JSON.
8. **Memory from meetings** (`server/meeting-notes.mjs`): once the speaker check is done, durable facts
   from the transcript (plans, decisions, people, dates) go into long-term memory, linked to the meeting.
   It follows the same rules as conversations (changes to existing memories wait for your OK). Turn it
   off in Settings; the meeting page has "Add to memory" / "Check again" to run it by hand.
9. **Minutes of meeting**: "Write minutes" on a finished meeting asks Gemini (the text model) for a
   summary, key points, decisions, action items (owner and due date only when clear from the
   transcript) and open questions. They are stored with the meeting, included in exports, and an
   automatic "Meeting <date>" title is replaced by the topic. One request per click.
10. **Asking about meetings**: the assistant knows today's date and has two tools, `find_meetings`
    (date range and/or topic) and `get_meeting` (minutes, memories and transcript of one meeting). So
    "what meetings did I have last Wednesday?" or "what did we decide about the budget on the 13th?"
    work in voice and typed chat. Long transcripts are shortened (start and end kept) before being
    sent to the model.

Voice profiles (Meeting Mode → Voice profiles) require ticking a consent box and reading a short
passage for at least 12 seconds. Record them with the microphone and room you use for meetings.
Only the numeric voiceprint is stored, not the recording. "Test recognition" shows the similarity to
every profile for a fresh sample, which helps tune the thresholds in Settings. Profiles made with an
older speaker model are marked and must be re-recorded (voiceprints from different models can't be
compared).

## Your data

All data lives in `data/` (git-ignored): `aura.db` (conversations, memories, meetings, voice
profiles) and `models/` (downloaded model files). Delete items individually in the app, or use
Settings → Your data to delete conversations, memories, transcripts or everything.

## Tests

```bash
npm run test:server   # API, memory conflict handling, speaker attribution, corrections, export
npm test -- --watchAll=false   # frontend unit tests (voice-activity segmenter)
```

The server tests replace Gemini and the two local models with fakes, so they check AURA's own logic,
not model quality.

## Known limitations (honest status)

- **Speaker recognition accuracy has not been measured on real meetings.** The models and thresholds
  were checked only on synthetic voices with added room noise and echo: there, the same voice scored
  0.61–0.96 and different voices −0.02–0.56, and a 12-line test meeting with two registered and two
  unregistered voices (including two people talking back to back) was attributed correctly. Real
  rooms will do worse. Expect mistakes with similar voices, people far from the microphone,
  short interjections (under 1 s they are attached to the previous speaker and marked *unsure*) and
  overlapping speech (overlaps go to whoever was already talking). Lines near a threshold are marked
  *unsure*; correct them in the transcript.
- One laptop microphone in a room is the hardest case for any speaker recognition. Recording voice
  profiles in the same room and on the same microphone helps the most.
- Transcription quality and speed depend on the Gemini model and your API quota. Standard
  transcription uses the daily request quota of the text model; Live transcription doesn't, but a Live
  session lasts at most 10 minutes and is reopened automatically.
- Web search on the free tier: Google's quota table lists Search grounding for Gemini 3 models at 0
  requests/day on free keys. If answers that need the web fail or come back without sources, switch the
  Live model in Settings to `gemini-2.5-flash-native-audio-preview-12-2025` (Gemini 2.5 grounding quota).
- Memory extraction depends on Gemini's judgment; review the Memory page and correct anything wrong.
  Facts learned from meetings rely on speaker names from voice recognition, which can be wrong.
- Minutes, memory-from-meetings and the meeting lookup tools were tested with a fake Gemini only; the
  quality of real minutes and whether the Live model calls the meeting tools reliably are unverified.
- Only one microphone user at a time: starting a meeting ends the current voice session.
- Single local user, no accounts. The server listens on 127.0.0.1 only.

## Project layout

```
server/            local API (node:http + node:sqlite), Gemini calls, local models
  index.mjs        routes          memory.mjs    extraction / conflicts / search
  meetings.mjs     diarization, transcription worker, export
  meeting-notes.mjs  minutes, memory from meetings, date/topic lookup for the assistant
  models.mjs       transformers.js embeddings   gemini.mjs   tokens, JSON + transcription calls
src/
  hooks/use-live-api.ts      Live session, transcripts, persistence, recall tool
  lib/genai-live-client.ts   Live websocket client (from the console, token-based)
  lib/segmenter.ts           voice-activity segmentation for Meeting Mode
  views/                     Assistant, Memory, Meeting, Voice profiles
  components/                Sidebar, Settings drawer, Orb, ConfirmButton
```

Based on the Apache-2.0 licensed Live API Web Console by Google LLC.
