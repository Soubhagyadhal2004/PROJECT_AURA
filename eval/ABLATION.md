# Variant comparison (paired)

Baseline: `results/ablation/baseline`. +F1 (re-propose): `results/ablation/f1`; +F2 (adaptive candidates): `results/ablation/f2`; F1 + F2: `results/ablation/both`.

Each row is a paired difference (variant - baseline) over the same persona and seed. Interval = 95% bootstrap (4000 resamples); p = exact two-sided sign test on non-tied pairs. "better" means the direction that helps (higher F1, fewer stale/false/destroyed). No correction for multiple tests is applied.

## +F1 (re-propose) vs. baseline

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| error | auto | 0.1 | 0.05 | F1 | 60 | 0.819 -> 0.819 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.1 | 0.05 | stale facts | 60 | 1.617 -> 1.617 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.1 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0.2 | 0.05 | F1 | 60 | 0.750 -> 0.750 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | stale facts | 60 | 1.617 -> 1.617 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0 | 0.05 | F1 | 60 | 0.881 -> 0.881 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | stale facts | 60 | 1.567 -> 1.567 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | gate | 0.1 | 0.05 | F1 | 60 | 0.817 -> 0.821 | +0.005 [0.000, 0.012] | 0.500 | better |
| error | gate | 0.1 | 0.05 | stale facts | 60 | 1.833 -> 1.800 | -0.033 [-0.083, 0.000] | 0.500 | better |
| error | gate | 0.1 | 0.05 | prompts / 100 turns | 60 | 23.700 -> 23.915 | +0.215 [0.000, 0.496] | 0.250 |  |
| error | gate | 0.2 | 0.05 | F1 | 60 | 0.737 -> 0.747 | +0.010 [0.000, 0.023] | 0.250 | better |
| error | gate | 0.2 | 0.05 | stale facts | 60 | 1.983 -> 1.917 | -0.067 [-0.150, 0.000] | 0.250 | better |
| error | gate | 0.2 | 0.05 | prompts / 100 turns | 60 | 28.611 -> 28.819 | +0.209 [0.000, 0.484] | 0.250 |  |
| error | gate | 0 | 0.05 | F1 | 60 | 0.854 -> 0.865 | +0.012 [0.003, 0.022] | 0.031 | better |
| error | gate | 0 | 0.05 | stale facts | 60 | 1.800 -> 1.700 | -0.100 [-0.183, -0.033] | 0.031 | better |
| error | gate | 0 | 0.05 | prompts / 100 turns | 60 | 17.618 -> 18.319 | +0.701 [0.278, 1.212] | 0.008 |  |
| user | gate | 0.1 | 0 | F1 | 60 | 0.826 -> 0.826 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | stale facts | 60 | 1.750 -> 1.750 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | prompts / 100 turns | 60 | 23.706 -> 23.776 | +0.069 [0.000, 0.208] | 1.000 |  |
| user | gate | 0.1 | 0.1 | F1 | 60 | 0.801 -> 0.809 | +0.008 [0.000, 0.018] | 0.375 | better |
| user | gate | 0.1 | 0.1 | stale facts | 60 | 1.983 -> 1.917 | -0.067 [-0.167, 0.017] | 0.375 | better |
| user | gate | 0.1 | 0.1 | prompts / 100 turns | 60 | 23.567 -> 24.193 | +0.626 [0.212, 1.066] | 0.008 |  |
| user | gate | 0.1 | 0.2 | F1 | 60 | 0.771 -> 0.793 | +0.022 [0.010, 0.035] | 0.002 | better |
| user | gate | 0.1 | 0.2 | stale facts | 60 | 2.317 -> 2.200 | -0.117 [-0.217, -0.033] | 0.039 | better |
| user | gate | 0.1 | 0.2 | prompts / 100 turns | 60 | 23.269 -> 24.488 | +1.218 [0.718, 1.756] | <0.001 |  |
| user | gate | 0.1 | 0.3 | F1 | 60 | 0.740 -> 0.750 | +0.010 [-0.007, 0.029] | 0.332 | better |
| user | gate | 0.1 | 0.3 | stale facts | 60 | 2.600 -> 2.533 | -0.067 [-0.217, 0.067] | 0.791 | better |
| user | gate | 0.1 | 0.3 | prompts / 100 turns | 60 | 23.348 -> 25.261 | +1.913 [1.296, 2.570] | <0.001 |  |

<details><summary>All metrics</summary>

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| error | auto | 0.1 | 0.05 | F1 | 60 | 0.819 -> 0.819 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.1 | 0.05 | stale facts | 60 | 1.617 -> 1.617 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.1 | 0.05 | false facts | 60 | 0.400 -> 0.400 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.1 | 0.05 | true facts destroyed | 60 | 0.117 -> 0.117 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.1 | 0.05 | wrong changes applied | 60 | 2.000 -> 2.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.1 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0.1 | 0.05 | exact final state | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | F1 | 60 | 0.750 -> 0.750 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | stale facts | 60 | 1.617 -> 1.617 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | false facts | 60 | 0.933 -> 0.933 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | true facts destroyed | 60 | 0.133 -> 0.133 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | wrong changes applied | 60 | 3.567 -> 3.567 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0.2 | 0.05 | exact final state | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | F1 | 60 | 0.881 -> 0.881 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | stale facts | 60 | 1.567 -> 1.567 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | false facts | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | wrong changes applied | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0 | 0.05 | exact final state | 60 | 0.083 -> 0.083 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.1 | 0.05 | F1 | 60 | 0.817 -> 0.821 | +0.005 [0.000, 0.012] | 0.500 | better |
| error | gate | 0.1 | 0.05 | stale facts | 60 | 1.833 -> 1.800 | -0.033 [-0.083, 0.000] | 0.500 | better |
| error | gate | 0.1 | 0.05 | false facts | 60 | 0.333 -> 0.333 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.1 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.1 | 0.05 | wrong changes applied | 60 | 0.067 -> 0.067 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.1 | 0.05 | prompts / 100 turns | 60 | 23.700 -> 23.915 | +0.215 [0.000, 0.496] | 0.250 |  |
| error | gate | 0.1 | 0.05 | exact final state | 60 | 0.067 -> 0.067 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.2 | 0.05 | F1 | 60 | 0.737 -> 0.747 | +0.010 [0.000, 0.023] | 0.250 | better |
| error | gate | 0.2 | 0.05 | stale facts | 60 | 1.983 -> 1.917 | -0.067 [-0.150, 0.000] | 0.250 | better |
| error | gate | 0.2 | 0.05 | false facts | 60 | 0.800 -> 0.800 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.2 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.2 | 0.05 | wrong changes applied | 60 | 0.150 -> 0.167 | +0.017 [0.000, 0.050] | 1.000 | worse |
| error | gate | 0.2 | 0.05 | prompts / 100 turns | 60 | 28.611 -> 28.819 | +0.209 [0.000, 0.484] | 0.250 |  |
| error | gate | 0.2 | 0.05 | exact final state | 60 | 0.017 -> 0.017 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | F1 | 60 | 0.854 -> 0.865 | +0.012 [0.003, 0.022] | 0.031 | better |
| error | gate | 0 | 0.05 | stale facts | 60 | 1.800 -> 1.700 | -0.100 [-0.183, -0.033] | 0.031 | better |
| error | gate | 0 | 0.05 | false facts | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | wrong changes applied | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | prompts / 100 turns | 60 | 17.618 -> 18.319 | +0.701 [0.278, 1.212] | 0.008 |  |
| error | gate | 0 | 0.05 | exact final state | 60 | 0.033 -> 0.050 | +0.017 [0.000, 0.050] | 1.000 | better |
| user | gate | 0.1 | 0 | F1 | 60 | 0.826 -> 0.826 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | stale facts | 60 | 1.750 -> 1.750 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | false facts | 60 | 0.333 -> 0.333 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | wrong changes applied | 60 | 0.017 -> 0.017 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | prompts / 100 turns | 60 | 23.706 -> 23.776 | +0.069 [0.000, 0.208] | 1.000 |  |
| user | gate | 0.1 | 0 | exact final state | 60 | 0.083 -> 0.083 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0.1 | F1 | 60 | 0.801 -> 0.809 | +0.008 [0.000, 0.018] | 0.375 | better |
| user | gate | 0.1 | 0.1 | stale facts | 60 | 1.983 -> 1.917 | -0.067 [-0.167, 0.017] | 0.375 | better |
| user | gate | 0.1 | 0.1 | false facts | 60 | 0.350 -> 0.350 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0.1 | true facts destroyed | 60 | 0.033 -> 0.033 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0.1 | wrong changes applied | 60 | 0.300 -> 0.317 | +0.017 [0.000, 0.050] | 1.000 | worse |
| user | gate | 0.1 | 0.1 | prompts / 100 turns | 60 | 23.567 -> 24.193 | +0.626 [0.212, 1.066] | 0.008 |  |
| user | gate | 0.1 | 0.1 | exact final state | 60 | 0.050 -> 0.050 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0.2 | F1 | 60 | 0.771 -> 0.793 | +0.022 [0.010, 0.035] | 0.002 | better |
| user | gate | 0.1 | 0.2 | stale facts | 60 | 2.317 -> 2.200 | -0.117 [-0.217, -0.033] | 0.039 | better |
| user | gate | 0.1 | 0.2 | false facts | 60 | 0.350 -> 0.333 | -0.017 [-0.050, 0.000] | 1.000 | better |
| user | gate | 0.1 | 0.2 | true facts destroyed | 60 | 0.033 -> 0.017 | -0.017 [-0.050, 0.000] | 1.000 | better |
| user | gate | 0.1 | 0.2 | wrong changes applied | 60 | 0.517 -> 0.467 | -0.050 [-0.117, 0.000] | 0.250 | better |
| user | gate | 0.1 | 0.2 | prompts / 100 turns | 60 | 23.269 -> 24.488 | +1.218 [0.718, 1.756] | <0.001 |  |
| user | gate | 0.1 | 0.2 | exact final state | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0.3 | F1 | 60 | 0.740 -> 0.750 | +0.010 [-0.007, 0.029] | 0.332 | better |
| user | gate | 0.1 | 0.3 | stale facts | 60 | 2.600 -> 2.533 | -0.067 [-0.217, 0.067] | 0.791 | better |
| user | gate | 0.1 | 0.3 | false facts | 60 | 0.383 -> 0.383 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0.3 | true facts destroyed | 60 | 0.050 -> 0.050 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0.3 | wrong changes applied | 60 | 0.633 -> 0.583 | -0.050 [-0.150, 0.050] | 0.508 | better |
| user | gate | 0.1 | 0.3 | prompts / 100 turns | 60 | 23.348 -> 25.261 | +1.913 [1.296, 2.570] | <0.001 |  |
| user | gate | 0.1 | 0.3 | exact final state | 60 | 0.017 -> 0.017 | +0.000 [0.000, 0.000] | 1.000 | same |

</details>

## +F2 (adaptive candidates) vs. baseline

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| error | auto | 0.1 | 0.05 | F1 | 60 | 0.819 -> 0.899 | +0.080 [0.060, 0.099] | <0.001 | better |
| error | auto | 0.1 | 0.05 | stale facts | 60 | 1.617 -> 0.433 | -1.183 [-1.417, -0.967] | <0.001 | better |
| error | auto | 0.1 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0.2 | 0.05 | F1 | 60 | 0.750 -> 0.800 | +0.050 [0.029, 0.071] | <0.001 | better |
| error | auto | 0.2 | 0.05 | stale facts | 60 | 1.617 -> 0.883 | -0.733 [-0.983, -0.500] | <0.001 | better |
| error | auto | 0.2 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0 | 0.05 | F1 | 60 | 0.881 -> 0.989 | +0.108 [0.091, 0.125] | <0.001 | better |
| error | auto | 0 | 0.05 | stale facts | 60 | 1.567 -> 0.083 | -1.483 [-1.717, -1.233] | <0.001 | better |
| error | auto | 0 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | gate | 0.1 | 0.05 | F1 | 60 | 0.817 -> 0.890 | +0.074 [0.057, 0.091] | <0.001 | better |
| error | gate | 0.1 | 0.05 | stale facts | 60 | 1.833 -> 0.650 | -1.183 [-1.433, -0.950] | <0.001 | better |
| error | gate | 0.1 | 0.05 | prompts / 100 turns | 60 | 23.700 -> 29.067 | +5.367 [4.352, 6.430] | <0.001 |  |
| error | gate | 0.2 | 0.05 | F1 | 60 | 0.737 -> 0.776 | +0.039 [0.022, 0.055] | <0.001 | better |
| error | gate | 0.2 | 0.05 | stale facts | 60 | 1.983 -> 1.217 | -0.767 [-1.000, -0.533] | <0.001 | better |
| error | gate | 0.2 | 0.05 | prompts / 100 turns | 60 | 28.611 -> 32.170 | +3.559 [2.517, 4.665] | <0.001 |  |
| error | gate | 0 | 0.05 | F1 | 60 | 0.854 -> 0.950 | +0.096 [0.077, 0.115] | <0.001 | better |
| error | gate | 0 | 0.05 | stale facts | 60 | 1.800 -> 0.400 | -1.400 [-1.633, -1.167] | <0.001 | better |
| error | gate | 0 | 0.05 | prompts / 100 turns | 60 | 17.618 -> 24.252 | +6.634 [5.557, 7.678] | <0.001 |  |
| user | gate | 0.1 | 0 | F1 | 60 | 0.826 -> 0.900 | +0.074 [0.058, 0.091] | <0.001 | better |
| user | gate | 0.1 | 0 | stale facts | 60 | 1.750 -> 0.567 | -1.183 [-1.417, -0.950] | <0.001 | better |
| user | gate | 0.1 | 0 | prompts / 100 turns | 60 | 23.706 -> 29.143 | +5.437 [4.408, 6.532] | <0.001 |  |
| user | gate | 0.1 | 0.1 | F1 | 60 | 0.801 -> 0.861 | +0.060 [0.044, 0.077] | <0.001 | better |
| user | gate | 0.1 | 0.1 | stale facts | 60 | 1.983 -> 0.967 | -1.017 [-1.250, -0.800] | <0.001 | better |
| user | gate | 0.1 | 0.1 | prompts / 100 turns | 60 | 23.567 -> 28.851 | +5.284 [4.272, 6.353] | <0.001 |  |
| user | gate | 0.1 | 0.2 | F1 | 60 | 0.771 -> 0.829 | +0.058 [0.038, 0.078] | <0.001 | better |
| user | gate | 0.1 | 0.2 | stale facts | 60 | 2.317 -> 1.250 | -1.067 [-1.300, -0.850] | <0.001 | better |
| user | gate | 0.1 | 0.2 | prompts / 100 turns | 60 | 23.269 -> 28.633 | +5.364 [4.349, 6.427] | <0.001 |  |
| user | gate | 0.1 | 0.3 | F1 | 60 | 0.740 -> 0.765 | +0.025 [0.003, 0.049] | 0.049 | better |
| user | gate | 0.1 | 0.3 | stale facts | 60 | 2.600 -> 1.800 | -0.800 [-1.050, -0.567] | <0.001 | better |
| user | gate | 0.1 | 0.3 | prompts / 100 turns | 60 | 23.348 -> 28.570 | +5.222 [4.230, 6.261] | <0.001 |  |

<details><summary>All metrics</summary>

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| error | auto | 0.1 | 0.05 | F1 | 60 | 0.819 -> 0.899 | +0.080 [0.060, 0.099] | <0.001 | better |
| error | auto | 0.1 | 0.05 | stale facts | 60 | 1.617 -> 0.433 | -1.183 [-1.417, -0.967] | <0.001 | better |
| error | auto | 0.1 | 0.05 | false facts | 60 | 0.400 -> 0.417 | +0.017 [-0.067, 0.100] | 1.000 | worse |
| error | auto | 0.1 | 0.05 | true facts destroyed | 60 | 0.117 -> 0.067 | -0.050 [-0.150, 0.050] | 0.508 | better |
| error | auto | 0.1 | 0.05 | wrong changes applied | 60 | 2.000 -> 2.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.1 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0.1 | 0.05 | exact final state | 60 | 0.000 -> 0.050 | +0.050 [0.000, 0.117] | 0.250 | better |
| error | auto | 0.2 | 0.05 | F1 | 60 | 0.750 -> 0.800 | +0.050 [0.029, 0.071] | <0.001 | better |
| error | auto | 0.2 | 0.05 | stale facts | 60 | 1.617 -> 0.883 | -0.733 [-0.983, -0.500] | <0.001 | better |
| error | auto | 0.2 | 0.05 | false facts | 60 | 0.933 -> 0.867 | -0.067 [-0.183, 0.050] | 0.549 | better |
| error | auto | 0.2 | 0.05 | true facts destroyed | 60 | 0.133 -> 0.083 | -0.050 [-0.167, 0.067] | 0.581 | better |
| error | auto | 0.2 | 0.05 | wrong changes applied | 60 | 3.567 -> 3.567 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0.2 | 0.05 | exact final state | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | F1 | 60 | 0.881 -> 0.989 | +0.108 [0.091, 0.125] | <0.001 | better |
| error | auto | 0 | 0.05 | stale facts | 60 | 1.567 -> 0.083 | -1.483 [-1.717, -1.233] | <0.001 | better |
| error | auto | 0 | 0.05 | false facts | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | wrong changes applied | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0 | 0.05 | exact final state | 60 | 0.083 -> 0.917 | +0.833 [0.733, 0.917] | <0.001 | better |
| error | gate | 0.1 | 0.05 | F1 | 60 | 0.817 -> 0.890 | +0.074 [0.057, 0.091] | <0.001 | better |
| error | gate | 0.1 | 0.05 | stale facts | 60 | 1.833 -> 0.650 | -1.183 [-1.433, -0.950] | <0.001 | better |
| error | gate | 0.1 | 0.05 | false facts | 60 | 0.333 -> 0.333 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.1 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.1 | 0.05 | wrong changes applied | 60 | 0.067 -> 0.083 | +0.017 [-0.050, 0.100] | 1.000 | worse |
| error | gate | 0.1 | 0.05 | prompts / 100 turns | 60 | 23.700 -> 29.067 | +5.367 [4.352, 6.430] | <0.001 |  |
| error | gate | 0.1 | 0.05 | exact final state | 60 | 0.067 -> 0.267 | +0.200 [0.100, 0.317] | <0.001 | better |
| error | gate | 0.2 | 0.05 | F1 | 60 | 0.737 -> 0.776 | +0.039 [0.022, 0.055] | <0.001 | better |
| error | gate | 0.2 | 0.05 | stale facts | 60 | 1.983 -> 1.217 | -0.767 [-1.000, -0.533] | <0.001 | better |
| error | gate | 0.2 | 0.05 | false facts | 60 | 0.800 -> 0.817 | +0.017 [0.000, 0.050] | 1.000 | worse |
| error | gate | 0.2 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.017 | +0.017 [0.000, 0.050] | 1.000 | worse |
| error | gate | 0.2 | 0.05 | wrong changes applied | 60 | 0.150 -> 0.217 | +0.067 [-0.017, 0.167] | 0.289 | worse |
| error | gate | 0.2 | 0.05 | prompts / 100 turns | 60 | 28.611 -> 32.170 | +3.559 [2.517, 4.665] | <0.001 |  |
| error | gate | 0.2 | 0.05 | exact final state | 60 | 0.017 -> 0.083 | +0.067 [0.017, 0.133] | 0.125 | better |
| error | gate | 0 | 0.05 | F1 | 60 | 0.854 -> 0.950 | +0.096 [0.077, 0.115] | <0.001 | better |
| error | gate | 0 | 0.05 | stale facts | 60 | 1.800 -> 0.400 | -1.400 [-1.633, -1.167] | <0.001 | better |
| error | gate | 0 | 0.05 | false facts | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | wrong changes applied | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | prompts / 100 turns | 60 | 17.618 -> 24.252 | +6.634 [5.557, 7.678] | <0.001 |  |
| error | gate | 0 | 0.05 | exact final state | 60 | 0.033 -> 0.667 | +0.633 [0.500, 0.750] | <0.001 | better |
| user | gate | 0.1 | 0 | F1 | 60 | 0.826 -> 0.900 | +0.074 [0.058, 0.091] | <0.001 | better |
| user | gate | 0.1 | 0 | stale facts | 60 | 1.750 -> 0.567 | -1.183 [-1.417, -0.950] | <0.001 | better |
| user | gate | 0.1 | 0 | false facts | 60 | 0.333 -> 0.333 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | wrong changes applied | 60 | 0.017 -> 0.000 | -0.017 [-0.050, 0.000] | 1.000 | better |
| user | gate | 0.1 | 0 | prompts / 100 turns | 60 | 23.706 -> 29.143 | +5.437 [4.408, 6.532] | <0.001 |  |
| user | gate | 0.1 | 0 | exact final state | 60 | 0.083 -> 0.350 | +0.267 [0.167, 0.383] | <0.001 | better |
| user | gate | 0.1 | 0.1 | F1 | 60 | 0.801 -> 0.861 | +0.060 [0.044, 0.077] | <0.001 | better |
| user | gate | 0.1 | 0.1 | stale facts | 60 | 1.983 -> 0.967 | -1.017 [-1.250, -0.800] | <0.001 | better |
| user | gate | 0.1 | 0.1 | false facts | 60 | 0.350 -> 0.333 | -0.017 [-0.050, 0.000] | 1.000 | better |
| user | gate | 0.1 | 0.1 | true facts destroyed | 60 | 0.033 -> 0.000 | -0.033 [-0.083, 0.000] | 0.500 | better |
| user | gate | 0.1 | 0.1 | wrong changes applied | 60 | 0.300 -> 0.250 | -0.050 [-0.133, 0.033] | 0.453 | better |
| user | gate | 0.1 | 0.1 | prompts / 100 turns | 60 | 23.567 -> 28.851 | +5.284 [4.272, 6.353] | <0.001 |  |
| user | gate | 0.1 | 0.1 | exact final state | 60 | 0.050 -> 0.233 | +0.183 [0.100, 0.283] | <0.001 | better |
| user | gate | 0.1 | 0.2 | F1 | 60 | 0.771 -> 0.829 | +0.058 [0.038, 0.078] | <0.001 | better |
| user | gate | 0.1 | 0.2 | stale facts | 60 | 2.317 -> 1.250 | -1.067 [-1.300, -0.850] | <0.001 | better |
| user | gate | 0.1 | 0.2 | false facts | 60 | 0.350 -> 0.367 | +0.017 [-0.033, 0.083] | 1.000 | worse |
| user | gate | 0.1 | 0.2 | true facts destroyed | 60 | 0.033 -> 0.017 | -0.017 [-0.067, 0.033] | 1.000 | better |
| user | gate | 0.1 | 0.2 | wrong changes applied | 60 | 0.517 -> 0.517 | +0.000 [-0.100, 0.100] | 1.000 | same |
| user | gate | 0.1 | 0.2 | prompts / 100 turns | 60 | 23.269 -> 28.633 | +5.364 [4.349, 6.427] | <0.001 |  |
| user | gate | 0.1 | 0.2 | exact final state | 60 | 0.000 -> 0.050 | +0.050 [0.000, 0.117] | 0.250 | better |
| user | gate | 0.1 | 0.3 | F1 | 60 | 0.740 -> 0.765 | +0.025 [0.003, 0.049] | 0.049 | better |
| user | gate | 0.1 | 0.3 | stale facts | 60 | 2.600 -> 1.800 | -0.800 [-1.050, -0.567] | <0.001 | better |
| user | gate | 0.1 | 0.3 | false facts | 60 | 0.383 -> 0.350 | -0.033 [-0.100, 0.033] | 0.625 | better |
| user | gate | 0.1 | 0.3 | true facts destroyed | 60 | 0.050 -> 0.017 | -0.033 [-0.100, 0.033] | 0.625 | better |
| user | gate | 0.1 | 0.3 | wrong changes applied | 60 | 0.633 -> 0.650 | +0.017 [-0.117, 0.167] | 1.000 | worse |
| user | gate | 0.1 | 0.3 | prompts / 100 turns | 60 | 23.348 -> 28.570 | +5.222 [4.230, 6.261] | <0.001 |  |
| user | gate | 0.1 | 0.3 | exact final state | 60 | 0.017 -> 0.033 | +0.017 [0.000, 0.050] | 1.000 | better |

</details>

## F1 + F2 vs. baseline

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| error | auto | 0.1 | 0.05 | F1 | 60 | 0.819 -> 0.899 | +0.080 [0.060, 0.099] | <0.001 | better |
| error | auto | 0.1 | 0.05 | stale facts | 60 | 1.617 -> 0.433 | -1.183 [-1.417, -0.967] | <0.001 | better |
| error | auto | 0.1 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0.2 | 0.05 | F1 | 60 | 0.750 -> 0.800 | +0.050 [0.029, 0.071] | <0.001 | better |
| error | auto | 0.2 | 0.05 | stale facts | 60 | 1.617 -> 0.883 | -0.733 [-0.983, -0.500] | <0.001 | better |
| error | auto | 0.2 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0 | 0.05 | F1 | 60 | 0.881 -> 0.989 | +0.108 [0.091, 0.125] | <0.001 | better |
| error | auto | 0 | 0.05 | stale facts | 60 | 1.567 -> 0.083 | -1.483 [-1.717, -1.233] | <0.001 | better |
| error | auto | 0 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | gate | 0.1 | 0.05 | F1 | 60 | 0.817 -> 0.901 | +0.084 [0.067, 0.102] | <0.001 | better |
| error | gate | 0.1 | 0.05 | stale facts | 60 | 1.833 -> 0.583 | -1.250 [-1.500, -1.017] | <0.001 | better |
| error | gate | 0.1 | 0.05 | prompts / 100 turns | 60 | 23.700 -> 29.431 | +5.731 [4.717, 6.836] | <0.001 |  |
| error | gate | 0.2 | 0.05 | F1 | 60 | 0.737 -> 0.784 | +0.047 [0.028, 0.066] | <0.001 | better |
| error | gate | 0.2 | 0.05 | stale facts | 60 | 1.983 -> 1.167 | -0.817 [-1.050, -0.583] | <0.001 | better |
| error | gate | 0.2 | 0.05 | prompts / 100 turns | 60 | 28.611 -> 32.729 | +4.118 [3.151, 5.159] | <0.001 |  |
| error | gate | 0 | 0.05 | F1 | 60 | 0.854 -> 0.967 | +0.114 [0.094, 0.134] | <0.001 | better |
| error | gate | 0 | 0.05 | stale facts | 60 | 1.800 -> 0.267 | -1.533 [-1.767, -1.300] | <0.001 | better |
| error | gate | 0 | 0.05 | prompts / 100 turns | 60 | 17.618 -> 25.020 | +7.401 [6.335, 8.494] | <0.001 |  |
| user | gate | 0.1 | 0 | F1 | 60 | 0.826 -> 0.903 | +0.077 [0.062, 0.094] | <0.001 | better |
| user | gate | 0.1 | 0 | stale facts | 60 | 1.750 -> 0.550 | -1.200 [-1.433, -0.967] | <0.001 | better |
| user | gate | 0.1 | 0 | prompts / 100 turns | 60 | 23.706 -> 29.222 | +5.516 [4.493, 6.604] | <0.001 |  |
| user | gate | 0.1 | 0.1 | F1 | 60 | 0.801 -> 0.881 | +0.080 [0.061, 0.099] | <0.001 | better |
| user | gate | 0.1 | 0.1 | stale facts | 60 | 1.983 -> 0.817 | -1.167 [-1.417, -0.933] | <0.001 | better |
| user | gate | 0.1 | 0.1 | prompts / 100 turns | 60 | 23.567 -> 29.932 | +6.365 [5.202, 7.604] | <0.001 |  |
| user | gate | 0.1 | 0.2 | F1 | 60 | 0.771 -> 0.851 | +0.080 [0.061, 0.099] | <0.001 | better |
| user | gate | 0.1 | 0.2 | stale facts | 60 | 2.317 -> 1.100 | -1.217 [-1.433, -1.000] | <0.001 | better |
| user | gate | 0.1 | 0.2 | prompts / 100 turns | 60 | 23.269 -> 30.142 | +6.873 [5.733, 8.026] | <0.001 |  |
| user | gate | 0.1 | 0.3 | F1 | 60 | 0.740 -> 0.800 | +0.060 [0.035, 0.086] | <0.001 | better |
| user | gate | 0.1 | 0.3 | stale facts | 60 | 2.600 -> 1.567 | -1.033 [-1.317, -0.767] | <0.001 | better |
| user | gate | 0.1 | 0.3 | prompts / 100 turns | 60 | 23.348 -> 31.013 | +7.665 [6.503, 8.903] | <0.001 |  |

<details><summary>All metrics</summary>

| sweep | policy | e | u | metric | pairs | baseline -> variant | difference [95% CI] | p (sign) |  |
|---|---|---|---|---|---|---|---|---|---|
| error | auto | 0.1 | 0.05 | F1 | 60 | 0.819 -> 0.899 | +0.080 [0.060, 0.099] | <0.001 | better |
| error | auto | 0.1 | 0.05 | stale facts | 60 | 1.617 -> 0.433 | -1.183 [-1.417, -0.967] | <0.001 | better |
| error | auto | 0.1 | 0.05 | false facts | 60 | 0.400 -> 0.417 | +0.017 [-0.067, 0.100] | 1.000 | worse |
| error | auto | 0.1 | 0.05 | true facts destroyed | 60 | 0.117 -> 0.067 | -0.050 [-0.150, 0.050] | 0.508 | better |
| error | auto | 0.1 | 0.05 | wrong changes applied | 60 | 2.000 -> 2.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.1 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0.1 | 0.05 | exact final state | 60 | 0.000 -> 0.050 | +0.050 [0.000, 0.117] | 0.250 | better |
| error | auto | 0.2 | 0.05 | F1 | 60 | 0.750 -> 0.800 | +0.050 [0.029, 0.071] | <0.001 | better |
| error | auto | 0.2 | 0.05 | stale facts | 60 | 1.617 -> 0.883 | -0.733 [-0.983, -0.500] | <0.001 | better |
| error | auto | 0.2 | 0.05 | false facts | 60 | 0.933 -> 0.867 | -0.067 [-0.183, 0.050] | 0.549 | better |
| error | auto | 0.2 | 0.05 | true facts destroyed | 60 | 0.133 -> 0.083 | -0.050 [-0.167, 0.067] | 0.581 | better |
| error | auto | 0.2 | 0.05 | wrong changes applied | 60 | 3.567 -> 3.567 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0.2 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0.2 | 0.05 | exact final state | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | F1 | 60 | 0.881 -> 0.989 | +0.108 [0.091, 0.125] | <0.001 | better |
| error | auto | 0 | 0.05 | stale facts | 60 | 1.567 -> 0.083 | -1.483 [-1.717, -1.233] | <0.001 | better |
| error | auto | 0 | 0.05 | false facts | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | wrong changes applied | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | auto | 0 | 0.05 | prompts / 100 turns | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 |  |
| error | auto | 0 | 0.05 | exact final state | 60 | 0.083 -> 0.917 | +0.833 [0.733, 0.917] | <0.001 | better |
| error | gate | 0.1 | 0.05 | F1 | 60 | 0.817 -> 0.901 | +0.084 [0.067, 0.102] | <0.001 | better |
| error | gate | 0.1 | 0.05 | stale facts | 60 | 1.833 -> 0.583 | -1.250 [-1.500, -1.017] | <0.001 | better |
| error | gate | 0.1 | 0.05 | false facts | 60 | 0.333 -> 0.333 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.1 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0.1 | 0.05 | wrong changes applied | 60 | 0.067 -> 0.100 | +0.033 [-0.050, 0.117] | 0.688 | worse |
| error | gate | 0.1 | 0.05 | prompts / 100 turns | 60 | 23.700 -> 29.431 | +5.731 [4.717, 6.836] | <0.001 |  |
| error | gate | 0.1 | 0.05 | exact final state | 60 | 0.067 -> 0.300 | +0.233 [0.133, 0.350] | <0.001 | better |
| error | gate | 0.2 | 0.05 | F1 | 60 | 0.737 -> 0.784 | +0.047 [0.028, 0.066] | <0.001 | better |
| error | gate | 0.2 | 0.05 | stale facts | 60 | 1.983 -> 1.167 | -0.817 [-1.050, -0.583] | <0.001 | better |
| error | gate | 0.2 | 0.05 | false facts | 60 | 0.800 -> 0.817 | +0.017 [0.000, 0.050] | 1.000 | worse |
| error | gate | 0.2 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.017 | +0.017 [0.000, 0.050] | 1.000 | worse |
| error | gate | 0.2 | 0.05 | wrong changes applied | 60 | 0.150 -> 0.217 | +0.067 [-0.017, 0.167] | 0.289 | worse |
| error | gate | 0.2 | 0.05 | prompts / 100 turns | 60 | 28.611 -> 32.729 | +4.118 [3.151, 5.159] | <0.001 |  |
| error | gate | 0.2 | 0.05 | exact final state | 60 | 0.017 -> 0.083 | +0.067 [0.017, 0.133] | 0.125 | better |
| error | gate | 0 | 0.05 | F1 | 60 | 0.854 -> 0.967 | +0.114 [0.094, 0.134] | <0.001 | better |
| error | gate | 0 | 0.05 | stale facts | 60 | 1.800 -> 0.267 | -1.533 [-1.767, -1.300] | <0.001 | better |
| error | gate | 0 | 0.05 | false facts | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | wrong changes applied | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| error | gate | 0 | 0.05 | prompts / 100 turns | 60 | 17.618 -> 25.020 | +7.401 [6.335, 8.494] | <0.001 |  |
| error | gate | 0 | 0.05 | exact final state | 60 | 0.033 -> 0.750 | +0.717 [0.600, 0.833] | <0.001 | better |
| user | gate | 0.1 | 0 | F1 | 60 | 0.826 -> 0.903 | +0.077 [0.062, 0.094] | <0.001 | better |
| user | gate | 0.1 | 0 | stale facts | 60 | 1.750 -> 0.550 | -1.200 [-1.433, -0.967] | <0.001 | better |
| user | gate | 0.1 | 0 | false facts | 60 | 0.333 -> 0.333 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | true facts destroyed | 60 | 0.000 -> 0.000 | +0.000 [0.000, 0.000] | 1.000 | same |
| user | gate | 0.1 | 0 | wrong changes applied | 60 | 0.017 -> 0.017 | +0.000 [-0.050, 0.050] | 1.000 | same |
| user | gate | 0.1 | 0 | prompts / 100 turns | 60 | 23.706 -> 29.222 | +5.516 [4.493, 6.604] | <0.001 |  |
| user | gate | 0.1 | 0 | exact final state | 60 | 0.083 -> 0.367 | +0.283 [0.167, 0.400] | <0.001 | better |
| user | gate | 0.1 | 0.1 | F1 | 60 | 0.801 -> 0.881 | +0.080 [0.061, 0.099] | <0.001 | better |
| user | gate | 0.1 | 0.1 | stale facts | 60 | 1.983 -> 0.817 | -1.167 [-1.417, -0.933] | <0.001 | better |
| user | gate | 0.1 | 0.1 | false facts | 60 | 0.350 -> 0.333 | -0.017 [-0.050, 0.000] | 1.000 | better |
| user | gate | 0.1 | 0.1 | true facts destroyed | 60 | 0.033 -> 0.000 | -0.033 [-0.083, 0.000] | 0.500 | better |
| user | gate | 0.1 | 0.1 | wrong changes applied | 60 | 0.300 -> 0.267 | -0.033 [-0.133, 0.050] | 0.727 | better |
| user | gate | 0.1 | 0.1 | prompts / 100 turns | 60 | 23.567 -> 29.932 | +6.365 [5.202, 7.604] | <0.001 |  |
| user | gate | 0.1 | 0.1 | exact final state | 60 | 0.050 -> 0.267 | +0.217 [0.117, 0.317] | <0.001 | better |
| user | gate | 0.1 | 0.2 | F1 | 60 | 0.771 -> 0.851 | +0.080 [0.061, 0.099] | <0.001 | better |
| user | gate | 0.1 | 0.2 | stale facts | 60 | 2.317 -> 1.100 | -1.217 [-1.433, -1.000] | <0.001 | better |
| user | gate | 0.1 | 0.2 | false facts | 60 | 0.350 -> 0.367 | +0.017 [-0.033, 0.083] | 1.000 | worse |
| user | gate | 0.1 | 0.2 | true facts destroyed | 60 | 0.033 -> 0.017 | -0.017 [-0.067, 0.033] | 1.000 | better |
| user | gate | 0.1 | 0.2 | wrong changes applied | 60 | 0.517 -> 0.500 | -0.017 [-0.133, 0.100] | 1.000 | better |
| user | gate | 0.1 | 0.2 | prompts / 100 turns | 60 | 23.269 -> 30.142 | +6.873 [5.733, 8.026] | <0.001 |  |
| user | gate | 0.1 | 0.2 | exact final state | 60 | 0.000 -> 0.050 | +0.050 [0.000, 0.117] | 0.250 | better |
| user | gate | 0.1 | 0.3 | F1 | 60 | 0.740 -> 0.800 | +0.060 [0.035, 0.086] | <0.001 | better |
| user | gate | 0.1 | 0.3 | stale facts | 60 | 2.600 -> 1.567 | -1.033 [-1.317, -0.767] | <0.001 | better |
| user | gate | 0.1 | 0.3 | false facts | 60 | 0.383 -> 0.333 | -0.050 [-0.117, 0.000] | 0.250 | better |
| user | gate | 0.1 | 0.3 | true facts destroyed | 60 | 0.050 -> 0.017 | -0.033 [-0.100, 0.033] | 0.625 | better |
| user | gate | 0.1 | 0.3 | wrong changes applied | 60 | 0.633 -> 0.667 | +0.033 [-0.083, 0.150] | 0.791 | worse |
| user | gate | 0.1 | 0.3 | prompts / 100 turns | 60 | 23.348 -> 31.013 | +7.665 [6.503, 8.903] | <0.001 |  |
| user | gate | 0.1 | 0.3 | exact final state | 60 | 0.017 -> 0.033 | +0.017 [0.000, 0.050] | 1.000 | better |

</details>

210 paired tests were run in total.
