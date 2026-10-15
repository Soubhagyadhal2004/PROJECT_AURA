# Experiment 5: LongMemEval knowledge-update (Gemini gemini-3.1-flash-lite)

30 questions from longmemeval_s_cleaned.json; each played with its evidence sessions plus 3 distractor session(s) (seed 1); answers from the top 10 memories of AURA's search; candidate selection: default (0.25), mode `adaptive`, re-proposal limit 2; gate reviewer: evidence. Accuracy = Gemini judge (knowledge-update rule), with 95% Wilson interval. "Answer in memory" = a normalised active memory contains the reference answer string (a heuristic, only meaningful for short answers).

| system | n | accuracy [95% CI] | strict match | answer in active memory | answer in top-k | prompts / question | active memories | superseded or outdated | requests |
|---|---|---|---|---|---|---|---|---|---|
| none | 30 | 0.000 [-0.000, 0.114] | 0.000 | n/a | n/a | n/a | n/a | n/a | 60 |
| context | 30 | 0.733 [0.556, 0.858] | 0.567 | n/a | n/a | n/a | n/a | n/a | 60 |
| append | 30 | 0.333 [0.192, 0.512] | 0.300 | 0.433 | 0.433 | 0.00 | 11.27 | 0.00 | 210 |
| auto | 30 | 0.500 [0.332, 0.668] | 0.400 | 0.500 | 0.500 | 0.00 | 10.73 | 0.67 | 210 |
| gate | 30 | 0.433 [0.274, 0.608] | 0.367 | 0.467 | 0.433 | 0.87 | 10.80 | 0.63 | 210 |

Paired comparisons (same questions; b = only the first system is right, c = only the second; exact two-sided sign test):

| first | second | b | c | p |
|---|---|---|---|---|
| none | context | 0 | 22 | 0.000 |
| none | append | 0 | 10 | 0.002 |
| none | auto | 0 | 15 | 0.000 |
| none | gate | 0 | 13 | 0.000 |
| context | append | 12 | 0 | 0.000 |
| context | auto | 8 | 1 | 0.039 |
| context | gate | 9 | 0 | 0.004 |
| append | auto | 0 | 5 | 0.063 |
| append | gate | 1 | 4 | 0.375 |
| auto | gate | 3 | 1 | 0.625 |

Every row: runs.csv. Every final memory store: memories.jsonl. The model's answers are in the `response` column.
