# LongMemEval: baseline vs. F1 + F2 (paired by question)

Baseline: `results/lme/baseline` (candidates default, no re-propose). Other: `results/lme/both`. Same 30 questions, same model; "judged" = the judge model's verdict, "strict" = strict string match. b = right only in the baseline run, c = right only in the other run; exact two-sided sign test on the discordant pairs.

| system | measure | questions | baseline run | other run | difference | b | c | p (sign) |
|---|---|---|---|---|---|---|---|---|
| none | judged | 30 | 0.000 | 0.000 | +0.000 | 0 | 0 | 1.000 |
| none | strict | 30 | 0.000 | 0.000 | +0.000 | 0 | 0 | 1.000 |
| context | judged | 30 | 0.767 | 0.733 | -0.033 | 1 | 0 | 1.000 |
| context | strict | 30 | 0.600 | 0.567 | -0.033 | 1 | 0 | 1.000 |
| append | judged | 30 | 0.400 | 0.333 | -0.067 | 3 | 1 | 0.625 |
| append | strict | 30 | 0.333 | 0.300 | -0.033 | 2 | 1 | 1.000 |
| auto | judged | 30 | 0.467 | 0.500 | +0.033 | 1 | 2 | 1.000 |
| auto | strict | 30 | 0.333 | 0.400 | +0.067 | 1 | 3 | 0.625 |
| gate | judged | 30 | 0.267 | 0.433 | +0.167 | 0 | 5 | 0.063 |
| gate | strict | 30 | 0.200 | 0.367 | +0.167 | 0 | 5 | 0.063 |

The rows for `none` and `context` use no memory: any difference there is noise between runs (sampling of the answering and judging model). Differences of the memory systems (append, auto, gate) of that size should not be read as an effect.
