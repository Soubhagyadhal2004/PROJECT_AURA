# Variant comparison (paired)

Baseline: `results/real-ablation/baseline`. +F1 (re-propose): `results/real-ablation/f1`; +F2 (adaptive candidates): `results/real-ablation/f2`; F1 + F2: `results/real-ablation/both`.

Each row is a paired difference (variant - baseline) over the same persona and seed. Interval = 95% bootstrap (4000 resamples); p = exact two-sided sign test on non-tied pairs. "better" means the direction that helps (higher F1, fewer stale/false/destroyed). No correction for multiple tests is applied.

## +F1 (re-propose) vs. baseline

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| - | auto | - | - | F1 | 12 | 0.908 -> 0.902 | -0.007 [-0.031, 0.013] | 1.000 | worse |
| - | auto | - | - | stale facts | 12 | 1.000 -> 1.000 | +0.000 [-0.250, 0.250] | 1.000 | same |
| - | auto | - | - | prompts / 100 turns | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| - | gate | - | - | F1 | 12 | 0.905 -> 0.897 | -0.008 [-0.026, 0.009] | 0.625 | worse |
| - | gate | - | - | stale facts | 12 | 1.000 -> 1.083 | +0.083 [0.000, 0.250] | 1.000 | worse |
| - | gate | - | - | prompts / 100 turns | 12 | 23.332 -> 21.898 | -1.434 [-3.231, 0.000] | 0.250 |  |

<details><summary>All metrics</summary>

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| - | auto | - | - | F1 | 12 | 0.908 -> 0.902 | -0.007 [-0.031, 0.013] | 1.000 | worse |
| - | auto | - | - | stale facts | 12 | 1.000 -> 1.000 | +0.000 [-0.250, 0.250] | 1.000 | same |
| - | auto | - | - | false facts | 12 | 0.000 -> 0.083 | +0.083 [0.000, 0.250] | 1.000 | worse |
| - | auto | - | - | wrong changes applied | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | auto | - | - | prompts / 100 turns | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| - | auto | - | - | prompt tokens | 12 | 13201.917 -> 13186.417 | -15.500 [-34.000, 0.167] | 0.146 |  |
| - | gate | - | - | F1 | 12 | 0.905 -> 0.897 | -0.008 [-0.026, 0.009] | 0.625 | worse |
| - | gate | - | - | stale facts | 12 | 1.000 -> 1.083 | +0.083 [0.000, 0.250] | 1.000 | worse |
| - | gate | - | - | false facts | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | gate | - | - | wrong changes applied | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | gate | - | - | prompts / 100 turns | 12 | 23.332 -> 21.898 | -1.434 [-3.231, 0.000] | 0.250 |  |
| - | gate | - | - | prompt tokens | 12 | 13375.917 -> 13324.333 | -51.583 [-158.750, 39.167] | 0.774 |  |

</details>

## +F2 (adaptive candidates) vs. baseline

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| - | auto | - | - | F1 | 12 | 0.908 -> 0.943 | +0.035 [0.003, 0.067] | 0.453 | better |
| - | auto | - | - | stale facts | 12 | 1.000 -> 0.000 | -1.000 [-1.333, -0.667] | 0.002 | better |
| - | auto | - | - | prompts / 100 turns | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| - | gate | - | - | F1 | 12 | 0.905 -> 0.953 | +0.048 [-0.015, 0.100] | 0.146 | better |
| - | gate | - | - | stale facts | 12 | 1.000 -> 0.333 | -0.667 [-1.250, 0.167] | 0.021 | better |
| - | gate | - | - | prompts / 100 turns | 12 | 23.332 -> 24.211 | +0.879 [-1.573, 3.042] | 0.508 |  |

<details><summary>All metrics</summary>

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| - | auto | - | - | F1 | 12 | 0.908 -> 0.943 | +0.035 [0.003, 0.067] | 0.453 | better |
| - | auto | - | - | stale facts | 12 | 1.000 -> 0.000 | -1.000 [-1.333, -0.667] | 0.002 | better |
| - | auto | - | - | false facts | 12 | 0.000 -> 0.250 | +0.250 [0.000, 0.500] | 0.250 | worse |
| - | auto | - | - | wrong changes applied | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | auto | - | - | prompts / 100 turns | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| - | auto | - | - | prompt tokens | 12 | 13201.917 -> 18037.333 | +4835.417 [4653.083, 5037.333] | <0.001 |  |
| - | gate | - | - | F1 | 12 | 0.905 -> 0.953 | +0.048 [-0.015, 0.100] | 0.146 | better |
| - | gate | - | - | stale facts | 12 | 1.000 -> 0.333 | -0.667 [-1.250, 0.167] | 0.021 | better |
| - | gate | - | - | false facts | 12 | 0.000 -> 0.083 | +0.083 [0.000, 0.250] | 1.000 | worse |
| - | gate | - | - | wrong changes applied | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | gate | - | - | prompts / 100 turns | 12 | 23.332 -> 24.211 | +0.879 [-1.573, 3.042] | 0.508 |  |
| - | gate | - | - | prompt tokens | 12 | 13375.917 -> 18180.167 | +4804.250 [4546.583, 5033.083] | <0.001 |  |

</details>

## F1 + F2 vs. baseline

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| - | auto | - | - | F1 | 12 | 0.908 -> 0.956 | +0.048 [0.019, 0.076] | 0.109 | better |
| - | auto | - | - | stale facts | 12 | 1.000 -> 0.000 | -1.000 [-1.333, -0.667] | 0.002 | better |
| - | auto | - | - | prompts / 100 turns | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| - | gate | - | - | F1 | 12 | 0.905 -> 0.982 | +0.077 [0.037, 0.114] | 0.021 | better |
| - | gate | - | - | stale facts | 12 | 1.000 -> 0.000 | -1.000 [-1.333, -0.667] | 0.002 | better |
| - | gate | - | - | prompts / 100 turns | 12 | 23.332 -> 24.912 | +1.580 [-0.266, 3.382] | 0.289 |  |

<details><summary>All metrics</summary>

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| - | auto | - | - | F1 | 12 | 0.908 -> 0.956 | +0.048 [0.019, 0.076] | 0.109 | better |
| - | auto | - | - | stale facts | 12 | 1.000 -> 0.000 | -1.000 [-1.333, -0.667] | 0.002 | better |
| - | auto | - | - | false facts | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | auto | - | - | wrong changes applied | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | auto | - | - | prompts / 100 turns | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| - | auto | - | - | prompt tokens | 12 | 13201.917 -> 18049.333 | +4847.417 [4658.833, 5055.667] | <0.001 |  |
| - | gate | - | - | F1 | 12 | 0.905 -> 0.982 | +0.077 [0.037, 0.114] | 0.021 | better |
| - | gate | - | - | stale facts | 12 | 1.000 -> 0.000 | -1.000 [-1.333, -0.667] | 0.002 | better |
| - | gate | - | - | false facts | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | gate | - | - | wrong changes applied | 12 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| - | gate | - | - | prompts / 100 turns | 12 | 23.332 -> 24.912 | +1.580 [-0.266, 3.382] | 0.289 |  |
| - | gate | - | - | prompt tokens | 12 | 13375.917 -> 18071.750 | +4695.833 [4472.917, 4920.917] | <0.001 |  |

</details>

36 paired tests were run in total.
