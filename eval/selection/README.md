# Selection study and end-to-end checks

All commands run from the repository root (`AURA v3`). Nothing here opens `data/aura.db`; every run uses a
scratch data folder and only copies the local embedding model from `data/models`.

## Already run (no API key needed)

| Experiment | Command | Output |
|---|---|---|
| Tests (test set, equivalence with `server/memory.mjs`, forked extraction, statistics) | `node --experimental-test-module-mocks --no-warnings --test eval/selection/tests/*.test.mjs` and `python -m unittest discover -s eval/selection/tests -p "test_*.py"` | 7 + 5 tests pass |
| Reachability: 15 selection conditions (AURA modes, ablations, same-budget lists, BM25, fusion), 40 personas x 6 store sizes | `node --no-warnings eval/selection/run-reach.mjs` (or in chunks: `--start 0 --count 15`, then `--start 15 --count 16`, `--start 31 --count 9`) | `eval/results/selection/raw/` |
| Analysis (persona-clustered bootstrap, sign tests, Holm) | `python eval/selection/analyze.py` | `eval/results/selection/processed/` |
| Paper tables, macros, figure 9 | `python eval/selection/make_paper_tables.py` | `paper/tables/sel_*.tex`, `paper/numbers_sel.tex`, `paper/figures/fig9_selection.*` |
| End-to-end harness check with a fake model (no API) | `node --no-warnings eval/selection/e2e/run-e2e.mjs --dry --personas 2 --out eval/results/selection/e2e/dry` | `eval/results/selection/e2e/dry/` |

## To run on your machine

### 1. Real-model pilot: oracle-target and same-budget list (Gemini; started on 16 Oct 2026, 22:20)

Conditions `default`, `adaptive`, `nomin_k24` (plain list of 24 matches, no minimum score) and `oracle_target`
(default candidates plus the true target: a diagnostic upper bound), gate policy with an oracle reviewer,
8 personas x 18 turns, 100 unrelated memories, `gemini-3.5-flash-lite` from `.env`. 576 extraction calls,
about 2 hours at the throttle of 14 requests per minute.

```bat
eval\selection\e2e\run_pilot.bat
```
or directly: `node --no-warnings eval/selection/e2e/run-e2e.mjs --rpm 14 --out eval/results/selection/e2e/pilot`.
The run is resumable: if it stops, run the same command again; finished runs (listed in `done.jsonl`) are skipped.
Progress: `type eval\results\selection\e2e\pilot\run.log`. When `done` appears:

```bat
python eval/selection/e2e/analyze_e2e.py eval/results/selection/e2e/pilot
```

To add auto-apply runs as well (another 576 calls): append `--policies gate,auto` to the command above.

### 2. Cross-encoder reranker baseline (no Gemini; downloads `Xenova/ms-marco-MiniLM-L-6-v2`, about 23 MB, once)

Takes the 50 best matches of AURA's search without a minimum score, reranks them with the cross-encoder and shows
the top 24, on the same events and stores as the reachability study (N = 350).

```bat
node --no-warnings eval/selection/run-rerank.mjs --smoke
node --no-warnings eval/selection/run-rerank.mjs
python eval/selection/analyze_rerank.py
```
Run `--smoke` first (one persona, a few minutes); this script could not be tested in the cloud workspace because
the model download is blocked there.

### 3. All 78 LongMemEval knowledge-update questions (Gemini; needs `eval/data/longmemeval_s_cleaned.json`)

```bat
npm run eval:lme -- --questions 78 --candidates default --repropose 0 --out eval/results/lme78/baseline
npm run eval:lme -- --questions 78 --candidates default --repropose 0 --out eval/results/lme78/baseline --yes
npm run eval:lme -- --questions 78 --candidates adaptive --repropose 2 --out eval/results/lme78/both --yes
```
The first command only prints the plan and the number of requests. Then compare with `npm run eval:compare-lme`
(check its options against these folders).

## Not possible without new data or people

- A user study (approval, rejection and slip rates of real users).
- Other languages and other model families.
