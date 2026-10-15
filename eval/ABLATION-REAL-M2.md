# Variant comparison (paired)

Baseline: `results/real-ablation-m2/baseline`. F1 + F2: `results/real-ablation-m2/both`.

Each row is a paired difference (variant - baseline) over the same persona and seed. Interval = 95% bootstrap (4000 resamples); p = exact two-sided sign test on non-tied pairs. "better" means the direction that helps (higher F1, fewer stale/false/destroyed). No correction for multiple tests is applied.

## F1 + F2 vs. baseline

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| - | auto | - | - | F1 | 12 | 0.840 -> 0.892 | +0.053 [0.031, 0.076] | 0.012 | better |
| - | auto | - | - | stale facts | 12 | 0.917 -> 0.000 | -0.917 [-1.000, -0.750] | <0.001 | better |
| - | auto | - | - | prompts / 100 turns | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| - | gate | - | - | F1 | 12 | 0.845 -> 0.901 | +0.057 [0.038, 0.073] | 0.002 | better |
| - | gate | - | - | stale facts | 12 | 1.083 -> 0.000 | -1.083 [-1.417, -0.750] | 0.002 | better |
| - | gate | - | - | prompts / 100 turns | 12 | 24.487 -> 25.984 | +1.497 [-0.952, 3.612] | 0.180 |  |

<details><summary>All metrics</summary>

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| - | auto | - | - | F1 | 12 | 0.840 -> 0.892 | +0.053 [0.031, 0.076] | 0.012 | better |
| - | auto | - | - | stale facts | 12 | 0.917 -> 0.000 | -0.917 [-1.000, -0.750] | <0.001 | better |
| - | auto | - | - | false facts | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | auto | - | - | wrong changes applied | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | auto | - | - | prompts / 100 turns | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| - | auto | - | - | prompt tokens | 12 | 13231.333 -> 18090.083 | +4858.750 [4645.917, 5095.000] | <0.001 |  |
| - | gate | - | - | F1 | 12 | 0.845 -> 0.901 | +0.057 [0.038, 0.073] | 0.002 | better |
| - | gate | - | - | stale facts | 12 | 1.083 -> 0.000 | -1.083 [-1.417, -0.750] | 0.002 | better |
| - | gate | - | - | false facts | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | gate | - | - | wrong changes applied | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | gate | - | - | prompts / 100 turns | 12 | 24.487 -> 25.984 | +1.497 [-0.952, 3.612] | 0.180 |  |
| - | gate | - | - | prompt tokens | 12 | 13347.167 -> 18394.500 | +5047.333 [4718.750, 5396.917] | <0.001 |  |

</details>

12 paired tests were run in total.
