# Experiment 4: real Gemini extractor (Gemini gemini-3.5-flash-lite)

12 personas x 1 seed(s); simulated user slip rate u = 0; candidate selection: default (0.25); features: candidates `default`, re-proposal limit 2, restate probability 1. Memories are scored by the values they mention (eval/lib/loose.mjs): true = mentions the current value; ended = correctly records that a retired fact ended; stale = only an earlier value; false = a value the user never stated as their own; hypothetical = a hypothetical kept as a memory (counted as an error); third-party = a fact about someone in the user's life (allowed, not counted); other = mentions none of the scenario values (not counted).

| policy | n | F1 | precision | recall | ended | stale | false | hypothetical | third-party | other | prompts / 100 turns | proposals judged correct | requests | mean latency (ms) | tokens in / out per request |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auto | 12 | 0.902 ± 0.027 | 0.824 | 1.000 | 0.17 | 1.00 | 0.08 | 0.33 | 0.75 | 0.00 | 0.0 | n/a | 277 | 5952 | 571 / 36 |
| gate | 12 | 0.897 ± 0.023 | 0.816 | 1.000 | 0.00 | 1.08 | 0.00 | 0.33 | 0.75 | 0.08 | 21.9 | 55 of 61 | 277 | 5008 | 577 / 36 |

Every final memory with its judgement: memories.jsonl. Raw rows: runs.csv.
