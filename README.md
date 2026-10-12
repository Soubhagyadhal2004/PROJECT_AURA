# AURA — Adaptive Unified Responsive Assistant

A local, working-prototype personal assistant built on Google's
[Live API web console](https://github.com/google-gemini/live-api-web-console).

- **Assistant**: real-time voice conversations with Gemini Live, plus typed messages in the same session.
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
- About 500 MB of disk for the local models, downloaded automatically on first start.

## Setup and start

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
# open .env and paste your key after GEMINI_API_KEY=
npm run dev
```

`npm run dev` starts the local server on port 3001 and the web app on <http://localhost:3000>.
The first start downloads two models from the Hugging Face hub into `data/models`
(the memory search model is small; the speaker model is a few hundred MB). The Meeting page shows a
notice while that is happening.

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

### Memory (`server/memory.mjs`)

- **Extraction**: a few seconds after each reply (and when a session ends), new messages are sent to
  Gemini (`GEMINI_TEXT_MODEL`, default `gemini-flash-latest`) together with the related existing
  memories. The model returns `add` / `update` / `retire` / `forget` operations.
- **Conflicts**: an `update` never overwrites. The old fact is kept with status *superseded* and a
  link to its replacement; `retire` marks a fact *outdated*. Only *active* facts are given to the
  assistant, each with its "last confirmed" date. The model can only change memories it was shown.
- **Retrieval**: sentence embeddings from a local model (`Xenova/all-MiniLM-L6-v2` via transformers.js)
  plus keyword overlap. The 30 most recent active facts are placed in the Live system prompt; the
  assistant can search the rest through a `recall_memories` tool, and typed messages get the closest
  matches attached. If the embedding model can't load, search falls back to keywords.
- Conversation history is stored too (sidebar → Conversations, read-only view).

### Meeting Mode (`src/lib/segmenter.ts`, `server/meetings.mjs`)

1. The browser records 16 kHz audio and cuts it into utterances at pauses (energy-based voice
   activity detection; ≥0.7 s silence, max 15 s per piece).
2. Each piece gets a speaker embedding from a local model (`Xenova/wavlm-base-plus-sv`, WavLM x-vector).
3. If it matches a registered voice profile (cosine ≥ 0.86 and clearly ahead of the next profile) the
   line gets that name. Otherwise it is compared with the voices already heard in this meeting
   (≥ 0.80) or becomes a new *Speaker N*. Numbers are never reused within a meeting.
4. Pieces are transcribed by Gemini (`GEMINI_TRANSCRIBE_MODEL`, default `gemini-flash-lite-latest`),
   several per request when a backlog builds up. 429/5xx responses are retried; failed pieces keep
   their audio and can be retried from the page.
5. Corrections: click a speaker chip to rename it everywhere, use the merge icon when one person was
   split in two (their future lines follow the merge), change a single line's speaker from its
   dropdown, double-click text to fix it. Export as text, Markdown or JSON.

Voice profiles (Meeting Mode → Voice profiles) require ticking a consent box and reading a short
passage for at least 12 seconds. Only the numeric voiceprint is stored, not the recording.
"Test recognition" shows the similarity score for a fresh sample, which helps tune the thresholds in
Settings.

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

- **Speaker recognition accuracy has not been measured on real meetings.** The pipeline is implemented
  end to end, but the default thresholds come from the model's published guidance, not from tests in
  real rooms. Expect mistakes with similar voices, far-away speakers, short interjections (pieces
  under 1 s are attached to the previous speaker and marked *unsure*) and overlapping speech
  (one piece is always attributed to one person). Lines near the threshold are marked *unsure*;
  correct them in the transcript.
- Speaker changes without a pause are not split: if two people talk back-to-back with no gap, the
  piece goes to whoever dominates it.
- Transcription quality and speed depend on the Gemini model and your API quota; on the free tier,
  long meetings can hit rate limits (pieces are batched and retried).
- Memory extraction depends on Gemini's judgment; review the Memory page and correct anything wrong.
- Only one microphone user at a time: starting a meeting ends the current voice session.
- Single local user, no accounts. The server listens on 127.0.0.1 only.

## Project layout

```
server/            local API (node:http + node:sqlite), Gemini calls, local models
  index.mjs        routes          memory.mjs    extraction / conflicts / search
  meetings.mjs     diarization, transcription worker, export
  models.mjs       transformers.js embeddings   gemini.mjs   tokens, JSON + transcription calls
src/
  hooks/use-live-api.ts      Live session, transcripts, persistence, recall tool
  lib/genai-live-client.ts   Live websocket client (from the console, token-based)
  lib/segmenter.ts           voice-activity segmentation for Meeting Mode
  views/                     Assistant, Memory, Meeting, Voice profiles
  components/                Sidebar, Settings drawer, Orb, ConfirmButton
```

Based on the Apache-2.0 licensed Live API Web Console by Google LLC.
