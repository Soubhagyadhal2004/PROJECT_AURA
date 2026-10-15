# Experiment 5: LongMemEval knowledge-update (Gemini gemini-3.1-flash-lite)

30 questions from longmemeval_s_cleaned.json; each played with its evidence sessions plus 3 distractor session(s) (seed 1); answers from the top 10 memories of AURA's search; candidate selection: default (0.25), mode `default`, re-proposal limit 0; gate reviewer: evidence. Accuracy = Gemini judge (knowledge-update rule), with 95% Wilson interval. "Answer in memory" = a normalised active memory contains the reference answer string (a heuristic, only meaningful for short answers).

| system | n | accuracy [95% CI] | strict match | answer in active memory | answer in top-k | prompts / question | active memories | superseded or outdated | requests |
|---|---|---|---|---|---|---|---|---|---|
| none | 30 | 0.000 [-0.000, 0.114] | 0.000 | n/a | n/a | n/a | n/a | n/a | 60 |
| context | 30 | 0.767 [0.591, 0.882] | 0.600 | n/a | n/a | n/a | n/a | n/a | 60 |
| append | 30 | 0.400 [0.246, 0.577] | 0.333 | 0.467 | 0.433 | 0.00 | 11.37 | 0.00 | 210 |
| auto | 30 | 0.467 [0.302, 0.639] | 0.333 | 0.400 | 0.400 | 0.00 | 10.47 | 0.73 | 210 |
| gate | 30 | 0.267 [0.142, 0.444] | 0.200 | 0.400 | 0.367 | 0.83 | 10.47 | 0.60 | 210 |

Paired comparisons (same questions; b = only the first system is right, c = only the second; exact two-sided sign test):

| first | second | b | c | p |
|---|---|---|---|---|
| none | context | 0 | 23 | 0.000 |
| none | append | 0 | 12 | 0.000 |
| none | auto | 0 | 14 | 0.000 |
| none | gate | 0 | 8 | 0.008 |
| context | append | 12 | 1 | 0.003 |
| context | auto | 9 | 0 | 0.004 |
| context | gate | 15 | 0 | 0.000 |
| append | auto | 3 | 5 | 0.727 |
| append | gate | 7 | 3 | 0.344 |
| auto | gate | 6 | 0 | 0.031 |

Every row: runs.csv. Every final memory store: memories.jsonl. The model's answers are in the `response` column.
