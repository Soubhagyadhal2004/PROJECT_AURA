# Experiment 4: real Gemini extractor (Gemini gemini-3.5-flash-lite)

12 personas x 1 seed(s); simulated user slip rate u = 0; candidate selection: default (0.25); features: candidates `adaptive`, re-proposal limit 2, restate probability 1. Memories are scored by the values they mention (eval/lib/loose.mjs): true = mentions the current value; ended = correctly records that a retired fact ended; stale = only an earlier value; false = a value the user never stated as their own; hypothetical = a hypothetical kept as a memory (counted as an error); third-party = a fact about someone in the user's life (allowed, not counted); other = mentions none of the scenario values (not counted).

| policy | n | F1 | precision | recall | ended | stale | false | hypothetical | third-party | other | prompts / 100 turns | proposals judged correct | requests | mean latency (ms) | tokens in / out per request |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auto | 12 | 0.956 ± 0.027 | 0.949 | 0.971 | 0.17 | 0.00 | 0.00 | 0.42 | 0.67 | 0.08 | 0.0 | n/a | 277 | 7992 | 782 / 35 |
| gate | 12 | 0.982 ± 0.024 | 0.968 | 1.000 | 0.17 | 0.00 | 0.00 | 0.25 | 0.75 | 0.00 | 24.9 | 68 of 69 | 277 | 9393 | 783 / 34 |

Every final memory with its judgement: memories.jsonl. Raw rows: runs.csv.
