# AURA memory evaluation (Direction A)

Reproducible experiments on AURA's long-term memory: how the "ask before changes" review gate,
the extractor's candidate selection and memory search affect what the assistant ends up believing.
Results and what they support: **[RESULTS.md](RESULTS.md)**.

Everything runs against AURA's **real** server code (`server/memory.mjs`, `server/db.mjs`), the real SQLite
schema and the real local embedding model (`Xenova/all-MiniLM-L6-v2`), on a **throw-away database in a
temporary folder**. Your own `data/aura.db` is never opened: `lib/env.mjs` refuses to run if the database
path is not inside the new temporary folder.

## Running

```bash
npm run eval:gate          # Exp. 1  review policies vs. extractor error rate      (~1-2 min)
npm run eval:gate:fix      # Exp. 1 again, extractor candidates without the 0.25 minimum score
npm run eval:retrieval     # Exp. 2  does search find the right memory?            (<1 min)
npm run eval:reach         # Exp. 3  can the extractor see the memory it must change? (<1 min)
npm run eval:all           # all of the above
npm run eval:real          # Exp. 4  real Gemini extractor: shows the plan, sends nothing
npm run eval:real -- --yes # ... and runs it (needs internet + GEMINI_API_KEY in .env; ~170 requests)
npm run eval:rescore -- <real-gemini run folder>   # re-score with the current rules + annotation sheet
npm run eval:compare       # paired comparison of baseline / +F1 / +F2 / both (writes ABLATION.md, ABLATION.csv)
npm run eval:results       # writes RESULTS.md from the result folders (never edit its numbers by hand)
python eval/make_figures.py # figures (PDF + PNG) from the result folders; needs matplotlib
```

Exp. 5, LongMemEval (needs `longmemeval_s_cleaned.json` in `eval/data/`, see the header of `run-longmemeval.mjs`):

```bash
npm run eval:lme                    # shows the plan and the number of requests, sends nothing
npm run eval:lme -- --yes           # 30 knowledge-update questions x (append, auto, gate + 2 baselines)
npm run eval:lme -- --questions 78 --yes   # all knowledge-update questions (many more requests)
npm run eval:lme -- --check-with-sim       # plumbing test on a made-up fixture, no Gemini, no dataset
```

Each question is played through AURA's real extractor and store with its evidence sessions plus a few
distractor sessions, then answered from the memories AURA's search returns and graded by a Gemini judge and by
string match. The gate's reviewer is an oracle approximation (LongMemEval has no labels for which changes are
right); read `run-longmemeval.mjs`'s header before quoting results. Resumable like Exp. 4 (`--out`, `--budget`).

After a real-Gemini run: `npm run eval:rescore -- <folder>`, fill in `human_label` in that folder's
`annotation.csv` (labels explained in `annotation-guide.md`; ideally a second person labels a copy),
run `eval:rescore` again to get the agreement (Cohen's kappa, `agreement.md`), then
`npm run eval:results -- --real <folder>`. Real runs also save every review card and decision
(`decisions.jsonl`) and every final memory (`memories.jsonl`).

Each run writes `eval/results/<experiment>/<timestamp>/`: `config.json` (settings), `summary.md`
(tables), `summary.csv`, raw rows (`runs.csv` / `queries.csv` / `changes.csv` and the `.jsonl`
checkpoint), `run-info.json`. Runs are resumable: `--out <folder>` continues an unfinished run, and
`--budget <seconds>` stops starting new work after that many seconds. Useful options:
`--personas`, `--seeds`, `--errors 0,0.1`, `--policies auto,gate`, `--u`, `--sizes`.

Simulation runs are exactly repeatable: they use a simulated clock (`Date.now()` ticks 1 ms per call
from a fixed start), because AURA orders memories by millisecond timestamps and same-millisecond ties
otherwise depend on timing (an earlier version without it varied by about 0.5% between runs). A repeated
slice of Exp. 1 matched the full run field by field. Real-Gemini runs use the real clock.

On Linux, transformers.js cannot load the Windows build of the `sharp` image library; the harness
replaces it with a stub (`lib/sharp-stub.mjs`) because only text is embedded. On Windows nothing
changes.

## What is real and what is simulated

| Part | Exp. 1-3 | Exp. 4 |
|---|---|---|
| Memory store, operations, supersede/retire/forget, review proposals | AURA code | AURA code |
| Candidate selection for the extractor (12 related + 8 most recent) | AURA code | AURA code |
| Sentence embeddings | local MiniLM model | local MiniLM model |
| Extractor (Gemini) | **simulated, known error rate e** | **real Gemini** |
| User who reviews proposals | simulated, slip rate u | simulated, slip rate u |
| Conversations | scripted personas (`lib/scenarios.mjs`) | same personas |

## Design

**Personas** (`lib/scenarios.mjs`). Each persona has 8 of 12 fact types (city, employer, dog, sister,
diet, gym time, language, car, project, coffee, hobby, birthday) and 5 sessions, about 21 user turns:
facts are stated, later updated ("I've just moved to Hyderabad."), retired ("I stopped going to the
gym."), forgotten on request ("Please forget what I told you about my car."), repeated, and mixed with
distractors that must not become memories (hypotheticals, questions, an assistant suggestion, facts
about friends). The true memory state is known after every turn. The memory store starts with 30
unrelated true facts and gains 10 between sessions, as months of earlier use would.

**Simulated extractor** (`lib/harness.mjs`, `makeSimExtractor`). Returns what a correct model would
return for the turn, using only the memories shown in the prompt (a change whose target is not shown
becomes an "add", as a real model would do). Errors are injected at rate e: a correct operation is
dropped (miss), a distractor becomes a false memory (spurious add), and a true memory shown to the model
is retired or overwritten with a false value (wrong change). Random draws are made in a fixed order per
turn, so all policies face the same errors.

**Policies.**
`append` = only new facts are stored, nothing is ever changed;
`auto` = every operation is applied (AURA with "Ask before changing memories" off);
`gate` = changes to existing memories wait for the user (AURA's default);
`gateAll` = new facts must be confirmed too (emulated by the harness; AURA has no such setting).

**Simulated user.** Reviews pending proposals at the end of each session; approves correct ones and turns
down wrong ones, but gets it wrong with probability u.

## Metrics

| Metric | Meaning |
|---|---|
| precision / recall / F1 | over the persona's facts: active persona memories that are true / true facts that are active |
| stale facts | active memories holding a value the user stated earlier but that is no longer true |
| false facts | active memories the user never stated about themselves (spurious or corrupted) |
| true facts destroyed | true memories (persona **and** background) that ended up superseded, outdated or deleted by a wrong change. F1 does not see background memories, so this is the safety metric |
| wrong changes applied | injected wrong changes that took effect (applied directly, or accepted by the user) |
| prompts / 100 turns | review cards the user had to answer per 100 user turns (burden) |
| prompt precision | share of review cards that proposed a correct change |
| candidate miss rate | share of change turns whose target memory was not among the candidates shown to the extractor |
| forget residual | forget requests whose value is still stored in a memory row (any status) / in the conversation text |
| ended / hypothetical / third-party (Exp. 4) | model wording: a correct note that a retired fact ended / a hypothetical kept as a memory (error) / a fact about someone else (allowed) |
| hit@k, found / noise (Exp. 2) | right memory among the top k / never-stated questions that still return memories |
| reachable (Exp. 3) | the memory a change refers to is among the extractor's candidates |

## Files

```
eval/
  run-gate-sim.mjs      Exp. 1          run-retrieval.mjs   Exp. 2
  run-reachability.mjs  Exp. 3          run-real.mjs        Exp. 4 (+ --check-with-sim)
  rescore-real.mjs      re-score a real run, annotation sheet, agreement
  build-results.mjs     writes RESULTS.md from the result folders
  make_figures.py       figures         RESULTS.md          findings (generated)
  lib/env.mjs           isolated database, safety check
  lib/harness.mjs       persona runner, simulated extractor and user, exact scoring
  lib/scenarios.mjs     personas, distractors, background facts, ground truth
  lib/loose.mjs         value-based scoring for model-written memories (Exp. 4)
  lib/hooks.mjs, register.mjs, proxy-gemini.mjs, cached-models.mjs, sharp-stub.mjs   module plumbing
  lib/stats.mjs, rng.mjs  statistics, seeded random numbers
  results/              one folder per run; figures/ for the paper
```

## Changes made to AURA for the evaluation

- `server/memory.mjs`: `memoryEvents` (extraction, applied operations, review decisions, whether the
  user edited the wording before accepting); `lexicalScore` exported; `searchMemories(..., { minScore })`
  option; `AURA_EXTRACT_MIN_SCORE` environment variable for the extractor's candidate selection
  (unset = unchanged behaviour).
- `server/gemini.mjs`: `usage` totals (requests, prompt/output tokens, latency) for `generateJSON`.
- `package.json`: the `eval:*` scripts.

None of these change what the app does by default; `npm run test:server` passes (26/26).


## Ablation of the two memory switches (journal paper, Direction 1)

Switches (all default off, read from the environment on every call; see `server/memory.mjs`):

- `AURA_CANDIDATES=default|nomin|sentence|adaptive`: which stored memories the extractor is shown.
- `AURA_REPROPOSE=N`: a rejected change may come back at most N times, only after the user said something new.

Every runner takes `--candidates`, `--repropose` (and the simulated and real runners also `--restate 1`, which adds a
"Like I said, ..." turn after each update). Use one folder per variant:

```
# simulated (about 4 s per variant)
for v in "baseline default 0" "f1 default 2" "f2 adaptive 0" "both adaptive 2"; do set -- $v
  npm run eval:gate -- --errors 0,0.1,0.2 --policies auto,gate --restate 1 --candidates $2 --repropose $3 --out eval/results/ablation/$1
done
npm run eval:compare                      # paired differences, bootstrap intervals, sign tests

# real Gemini: same four variants into eval/results/real-ablation/<name>, then
npm run eval:compare -- --dir eval/results/real-ablation --out eval/ABLATION-REAL.md

# LongMemEval: baseline vs. both
npm run eval:lme -- --candidates default --repropose 0 --out eval/results/lme/baseline
npm run eval:lme -- --candidates adaptive --repropose 2 --out eval/results/lme/both
```
