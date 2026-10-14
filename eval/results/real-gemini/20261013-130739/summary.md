# Experiment 4: real Gemini extractor (Gemini gemini-3.5-flash-lite)

4 personas x 1 seed(s); simulated user slip rate u = 0; candidate selection: default (0.25). Memories are scored by the values they mention (eval/lib/loose.mjs): true = mentions the current value; stale = only an earlier value; false = a value the user never stated as their own; other = mentions none of the scenario values (not counted in precision).

| policy | n | F1 | precision | recall | stale | false | other | prompts / 100 turns | proposals judged correct | requests | mean latency (ms) | tokens in / out per request |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auto | 4 | 0.837 ± 0.075 | 0.725 | 1.000 | 1.00 | 1.50 | 0.00 | 0.0 | n/a | 85 | 4917 | 571 / 39 |
| gate | 4 | 0.887 ± 0.091 | 0.806 | 1.000 | 0.75 | 1.00 | 0.00 | 24.6 | 20 of 21 | 85 | 5491 | 574 / 39 |

Every final memory with its judgement: memories.jsonl. Raw rows: runs.csv.
