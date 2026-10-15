# Experiment 4: real Gemini extractor (Gemini gemini-3.5-flash-lite)

12 personas x 1 seed(s); simulated user slip rate u = 0; candidate selection: default (0.25); features: candidates `adaptive`, re-proposal limit 0, restate probability 1. Memories are scored by the values they mention (eval/lib/loose.mjs): true = mentions the current value; ended = correctly records that a retired fact ended; stale = only an earlier value; false = a value the user never stated as their own; hypothetical = a hypothetical kept as a memory (counted as an error); third-party = a fact about someone in the user's life (allowed, not counted); other = mentions none of the scenario values (not counted).

| policy | n | F1 | precision | recall | ended | stale | false | hypothetical | third-party | other | prompts / 100 turns | proposals judged correct | requests | mean latency (ms) | tokens in / out per request |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auto | 12 | 0.943 ± 0.031 | 0.914 | 0.983 | 0.08 | 0.00 | 0.25 | 0.42 | 0.67 | 0.17 | 0.0 | n/a | 277 | 5408 | 781 / 36 |
| gate | 12 | 0.953 ± 0.047 | 0.921 | 1.000 | 0.08 | 0.33 | 0.08 | 0.25 | 0.67 | 0.00 | 24.2 | 64 of 67 | 277 | 5052 | 788 / 35 |

Every final memory with its judgement: memories.jsonl. Raw rows: runs.csv.
