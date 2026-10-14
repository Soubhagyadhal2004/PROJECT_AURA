# Experiment 1: review policy vs. extractor error rate (simulated extractor)

Candidate selection for the extractor: AURA as shipped (search minimum score 0.25).

20 personas x 3 seeds per cell (n = 60); each persona has 5 sessions (~21 user turns). The memory store starts with 30 unrelated facts and gains 10 between sessions. Means with 95% CI half-widths. Extractor = simulated with error rate e (not Gemini); database, memory logic, candidate selection and embeddings are AURA's real code and local model.

## Error-rate sweep (user slip rate u = 0.05)

| policy | e | F1 | exact final state | stale facts | false facts | true facts destroyed | wrong changes applied | prompts / 100 turns | prompt precision |
|---|---|---|---|---|---|---|---|---|---|
| append | 0 | 0.597 ± 0.025 | 0.00 | 5.00 | 0.00 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0 | 0.881 ± 0.018 | 0.08 | 1.57 | 0.00 | 0.00 | 0.00 | 0.0 | n/a |
| gate | 0 | 0.854 ± 0.022 | 0.03 | 1.80 | 0.00 | 0.00 | 0.00 | 19.5 | 1.00 |
| gateAll | 0 | 0.861 ± 0.023 | 0.08 | 1.62 | 0.00 | 0.00 | 0.00 | 65.8 | 1.00 |
| append | 0.05 | 0.584 ± 0.029 | 0.00 | 4.90 | 0.12 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0.05 | 0.840 ± 0.023 | 0.03 | 1.65 | 0.17 | 0.78 | 0.82 | 0.0 | n/a |
| gate | 0.05 | 0.820 ± 0.023 | 0.03 | 1.90 | 0.12 | 0.05 | 0.07 | 22.2 | 0.82 |
| gateAll | 0.05 | 0.818 ± 0.028 | 0.05 | 1.82 | 0.00 | 0.03 | 0.05 | 67.3 | 0.93 |
| append | 0.1 | 0.581 ± 0.023 | 0.00 | 4.58 | 0.33 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0.1 | 0.798 ± 0.026 | 0.00 | 1.68 | 0.43 | 1.60 | 1.75 | 0.0 | n/a |
| gate | 0.1 | 0.797 ± 0.026 | 0.07 | 1.85 | 0.33 | 0.03 | 0.05 | 24.4 | 0.66 |
| gateAll | 0.1 | 0.795 ± 0.029 | 0.07 | 1.83 | 0.02 | 0.05 | 0.05 | 69.0 | 0.86 |
| append | 0.2 | 0.549 ± 0.031 | 0.00 | 4.25 | 0.70 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0.2 | 0.735 ± 0.031 | 0.00 | 1.73 | 0.83 | 2.83 | 3.10 | 0.0 | n/a |
| gate | 0.2 | 0.733 ± 0.032 | 0.00 | 1.98 | 0.70 | 0.18 | 0.23 | 28.8 | 0.48 |
| gateAll | 0.2 | 0.765 ± 0.033 | 0.02 | 1.88 | 0.00 | 0.13 | 0.17 | 72.5 | 0.75 |
| append | 0.3 | 0.523 ± 0.034 | 0.00 | 3.87 | 1.20 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0.3 | 0.650 ± 0.032 | 0.00 | 1.92 | 1.33 | 4.60 | 4.97 | 0.0 | n/a |
| gate | 0.3 | 0.653 ± 0.033 | 0.00 | 2.18 | 1.22 | 0.25 | 0.28 | 33.4 | 0.30 |
| gateAll | 0.3 | 0.707 ± 0.030 | 0.00 | 1.98 | 0.07 | 0.40 | 0.43 | 77.6 | 0.62 |

## User-reliability sweep (extractor error rate e = 0.1)

| policy | u | F1 | stale facts | false facts | wrong changes applied | prompts / 100 turns |
|---|---|---|---|---|---|---|
| gate | 0 | 0.808 ± 0.026 | 1.75 | 0.33 | 0.02 | 24.5 |
| gateAll | 0 | 0.828 ± 0.025 | 1.75 | 0.00 | 0.02 | 68.8 |
| gate | 0.1 | 0.783 ± 0.028 | 2.00 | 0.35 | 0.28 | 24.4 |
| gateAll | 0.1 | 0.763 ± 0.026 | 1.93 | 0.12 | 0.17 | 69.3 |
| gate | 0.2 | 0.757 ± 0.027 | 2.33 | 0.35 | 0.42 | 24.0 |
| gateAll | 0.2 | 0.730 ± 0.038 | 1.95 | 0.08 | 0.27 | 70.0 |
| gate | 0.3 | 0.732 ± 0.029 | 2.52 | 0.38 | 0.62 | 24.1 |
| gateAll | 0.3 | 0.669 ± 0.039 | 2.00 | 0.13 | 0.57 | 69.6 |

## Other measurements

- Change turns whose target memory was not among the candidates shown to the extractor (e = 0): append 0.254, auto 0.272, gate 0.272, gateAll 0.246.
- Forget requests (per persona) whose value is still in a memory row / still in the stored conversation text (e = 0): append 1.55 / 1.67; auto 0.45 / 1.67; gate 0.45 / 1.67; gateAll 0.47 / 1.67 (forget requests per persona: 1.67).

Column definitions: eval/README.md. Raw rows: runs.csv. Configuration: config.json.
