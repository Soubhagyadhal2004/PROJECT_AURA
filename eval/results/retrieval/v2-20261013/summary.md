# Experiment 2: memory retrieval with AURA's search

Real local embedding model (Xenova/all-MiniLM-L6-v2) and AURA's real searchMemories(). Each store holds one persona's current facts plus N unrelated facts; each fact is asked about with 2 natural questions. 20 personas x 3 seeds per size. Hit@k = the right fact is among the k results; 95% Wilson intervals in brackets.

| store size N | variant | queries | hit@k | top-1 | no results |
|---|---|---|---|---|---|
| 25 | AURA (hybrid 0.85/0.15, min 0.25), k=6 — recall tool | 726 | 0.707 [0.672, 0.739] | 0.705 | 0.287 |
| 25 | AURA (hybrid, min 0.25), k=4 — typed messages | 726 | 0.707 [0.672, 0.739] | 0.705 | 0.287 |
| 25 | hybrid, no minimum score, k=6 | 726 | 0.994 [0.986, 0.998] | 0.920 | 0.000 |
| 25 | embedding only, no minimum score, k=6 | 726 | 0.994 [0.986, 0.998] | 0.897 | 0.000 |
| 25 | keywords only (AURA fallback when the model is unavailable, min 0.1), k=6 | 726 | 0.606 [0.570, 0.641] | 0.581 | 0.335 |
| 100 | AURA (hybrid 0.85/0.15, min 0.25), k=6 — recall tool | 726 | 0.705 [0.671, 0.737] | 0.690 | 0.281 |
| 100 | AURA (hybrid, min 0.25), k=4 — typed messages | 726 | 0.702 [0.668, 0.735] | 0.690 | 0.281 |
| 100 | hybrid, no minimum score, k=6 | 726 | 0.968 [0.953, 0.979] | 0.861 | 0.000 |
| 100 | embedding only, no minimum score, k=6 | 726 | 0.957 [0.940, 0.970] | 0.828 | 0.000 |
| 100 | keywords only (AURA fallback when the model is unavailable, min 0.1), k=6 | 726 | 0.606 [0.570, 0.641] | 0.576 | 0.325 |
| 350 | AURA (hybrid 0.85/0.15, min 0.25), k=6 — recall tool | 726 | 0.700 [0.665, 0.732] | 0.687 | 0.281 |
| 350 | AURA (hybrid, min 0.25), k=4 — typed messages | 726 | 0.694 [0.660, 0.727] | 0.687 | 0.281 |
| 350 | hybrid, no minimum score, k=6 | 726 | 0.891 [0.866, 0.912] | 0.833 | 0.000 |
| 350 | embedding only, no minimum score, k=6 | 726 | 0.872 [0.846, 0.894] | 0.787 | 0.000 |
| 350 | keywords only (AURA fallback when the model is unavailable, min 0.1), k=6 | 726 | 0.606 [0.570, 0.641] | 0.567 | 0.309 |

- Right fact scores below AURA's minimum (0.25) on the hybrid score: 639 of 2178 queries (0.293). Mean hybrid score of the right fact: 0.378; mean embedding similarity: 0.406.
- Sanity check: re-scoring reproduced the real searchMemories() top-6 in 2178 of 2178 queries (differences come only from ties).

## By kind of fact (N = 350)

| slot | queries | AURA hit@6 | hybrid no-min hit@6 | mean embedding similarity |
|---|---|---|---|---|
| city | 60 | 0.27 | 0.37 | 0.253 |
| employer | 76 | 0.24 | 0.89 | 0.248 |
| pet | 68 | 1.00 | 1.00 | 0.595 |
| sister | 44 | 1.00 | 1.00 | 0.582 |
| diet | 56 | 0.09 | 0.41 | 0.175 |
| gym | 68 | 1.00 | 1.00 | 0.480 |
| language | 66 | 1.00 | 1.00 | 0.494 |
| car | 64 | 0.34 | 1.00 | 0.236 |
| project | 62 | 1.00 | 1.00 | 0.436 |
| coffee | 56 | 1.00 | 1.00 | 0.483 |
| hobby | 66 | 0.65 | 1.00 | 0.400 |
| birthday | 40 | 1.00 | 1.00 | 0.602 |

## Choosing the minimum score

Trade-off for the hybrid score at k = 6: "found" = questions about a stored fact that get it among the results; "noise" = questions about something the user never stated (or that is no longer true) that still return memories (unrelated ones). 714 such questions per size.

| store size N | min 0 | min 0.1 | min 0.15 | min 0.2 | min 0.25 | min 0.3 | min 0.35 |
|---|---|---|---|---|---|---|---|
| 25 | 0.99 / 1.00 | 0.97 / 0.89 | 0.93 / 0.66 | 0.85 / 0.37 | 0.71 / 0.20 | 0.64 / 0.09 | 0.53 / 0.02 |
| 100 | 0.97 / 1.00 | 0.94 / 0.96 | 0.91 / 0.81 | 0.85 / 0.51 | 0.71 / 0.35 | 0.64 / 0.23 | 0.53 / 0.07 |
| 350 | 0.89 / 1.00 | 0.89 / 0.96 | 0.88 / 0.85 | 0.83 / 0.62 | 0.70 / 0.49 | 0.64 / 0.34 | 0.53 / 0.16 |

Cells: found / noise. AURA uses min 0.25. Check: AURA's real search returned something for 0.49 of the never-stated questions at N = 350 (table: 0.49).

Note: AURA puts the 30 most recently confirmed memories into the Live system prompt, so search matters once a user has more than 30 active memories.
