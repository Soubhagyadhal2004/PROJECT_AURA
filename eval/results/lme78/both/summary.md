# Experiment 5: LongMemEval knowledge-update (Gemini gemini-3.5-flash-lite)

72 questions from longmemeval_s_cleaned.json; each played with its evidence sessions plus 3 distractor session(s) (seed 1); answers from the top 10 memories of AURA's search; candidate selection: default (0.25), mode `adaptive`, re-proposal limit 2; gate reviewer: evidence. Accuracy = Gemini judge (knowledge-update rule), with 95% Wilson interval. "Answer in memory" = a normalised active memory contains the reference answer string (a heuristic, only meaningful for short answers).

| system | n | accuracy [95% CI] | strict match | answer in active memory | answer in top-k | prompts / question | active memories | superseded or outdated | requests |
|---|---|---|---|---|---|---|---|---|---|
| none | 72 | 0.000 [0.000, 0.051] | 0.000 | n/a | n/a | n/a | n/a | n/a | 144 |
| context | 72 | 0.847 [0.747, 0.912] | 0.694 | n/a | n/a | n/a | n/a | n/a | 144 |
| append | 72 | 0.361 [0.260, 0.476] | 0.319 | 0.458 | 0.444 | 0.00 | 9.89 | 0.00 | 504 |
| auto | 72 | 0.431 [0.323, 0.546] | 0.375 | 0.444 | 0.417 | 0.00 | 9.19 | 0.53 | 504 |
| gate | 72 | 0.444 [0.335, 0.559] | 0.361 | 0.458 | 0.431 | 0.81 | 9.38 | 0.63 | 504 |

Paired comparisons (same questions; b = only the first system is right, c = only the second; exact two-sided sign test):

| first | second | b | c | p |
|---|---|---|---|---|
| none | context | 0 | 61 | 0.000 |
| none | append | 0 | 26 | 0.000 |
| none | auto | 0 | 31 | 0.000 |
| none | gate | 0 | 32 | 0.000 |
| context | append | 36 | 1 | 0.000 |
| context | auto | 32 | 2 | 0.000 |
| context | gate | 31 | 2 | 0.000 |
| append | auto | 7 | 12 | 0.359 |
| append | gate | 6 | 12 | 0.238 |
| auto | gate | 9 | 10 | 1.000 |

Every row: runs.csv. Every final memory store: memories.jsonl. The model's answers are in the `response` column.
