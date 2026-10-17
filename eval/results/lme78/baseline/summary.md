# Experiment 5: LongMemEval knowledge-update (Gemini gemini-3.5-flash-lite)

72 questions from longmemeval_s_cleaned.json; each played with its evidence sessions plus 3 distractor session(s) (seed 1); answers from the top 10 memories of AURA's search; candidate selection: default (0.25), mode `default`, re-proposal limit 0; gate reviewer: evidence. Accuracy = Gemini judge (knowledge-update rule), with 95% Wilson interval. "Answer in memory" = a normalised active memory contains the reference answer string (a heuristic, only meaningful for short answers).

| system | n | accuracy [95% CI] | strict match | answer in active memory | answer in top-k | prompts / question | active memories | superseded or outdated | requests |
|---|---|---|---|---|---|---|---|---|---|
| none | 72 | 0.000 [0.000, 0.051] | 0.000 | n/a | n/a | n/a | n/a | n/a | 144 |
| context | 72 | 0.819 [0.715, 0.891] | 0.708 | n/a | n/a | n/a | n/a | n/a | 144 |
| append | 72 | 0.361 [0.260, 0.476] | 0.319 | 0.431 | 0.417 | 0.00 | 10.50 | 0.00 | 504 |
| auto | 72 | 0.472 [0.361, 0.586] | 0.389 | 0.500 | 0.458 | 0.00 | 9.43 | 0.63 | 504 |
| gate | 72 | 0.444 [0.335, 0.559] | 0.361 | 0.444 | 0.417 | 0.74 | 9.72 | 0.58 | 504 |

Paired comparisons (same questions; b = only the first system is right, c = only the second; exact two-sided sign test):

| first | second | b | c | p |
|---|---|---|---|---|
| none | context | 0 | 59 | 0.000 |
| none | append | 0 | 26 | 0.000 |
| none | auto | 0 | 34 | 0.000 |
| none | gate | 0 | 32 | 0.000 |
| context | append | 36 | 3 | 0.000 |
| context | auto | 29 | 4 | 0.000 |
| context | gate | 30 | 3 | 0.000 |
| append | auto | 10 | 18 | 0.185 |
| append | gate | 12 | 18 | 0.362 |
| auto | gate | 8 | 6 | 0.791 |

Every row: runs.csv. Every final memory store: memories.jsonl. The model's answers are in the `response` column.
