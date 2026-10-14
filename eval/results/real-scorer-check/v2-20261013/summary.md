# Scorer check: value-based scoring vs. exact scoring (simulated extractor, e = 0.1)

10 personas x 1 seed(s); simulated user slip rate u = 0.05; candidate selection: default (0.25). Memories are scored by the values they mention (eval/lib/loose.mjs): true = mentions the current value; ended = correctly records that a retired fact ended; stale = only an earlier value; false = a value the user never stated as their own; hypothetical = a hypothetical kept as a memory (counted as an error); third-party = a fact about someone in the user's life (allowed, not counted); other = mentions none of the scenario values (not counted).

| policy | n | F1 | precision | recall | ended | stale | false | hypothetical | third-party | other | prompts / 100 turns | proposals judged correct | requests | mean latency (ms) | tokens in / out per request |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auto | 10 | 0.853 ± 0.059 | 0.790 | 0.952 | 0.00 | 1.30 | 0.50 | 0.00 | 0.00 | 0.00 | 0.0 | n/a | 0 | 1 | n/a |
| gate | 10 | 0.852 ± 0.082 | 0.789 | 0.955 | 0.00 | 1.50 | 0.40 | 0.00 | 0.00 | 0.00 | 27.7 | 36 of 58 | 0 | 1 | n/a |
| gateAll | 10 | 0.841 ± 0.072 | 0.802 | 0.907 | 0.00 | 1.60 | 0.00 | 0.00 | 0.00 | 0.00 | 71.2 | 124 of 150 | 0 | 1 | n/a |

Agreement of value-based and exact scoring (correct, stale and false counts identical): 30 of 30 persona runs.
Agreement of the value-based and exact review judges: 208 of 208 decisions.

Every final memory with its judgement: memories.jsonl. Raw rows: runs.csv.
