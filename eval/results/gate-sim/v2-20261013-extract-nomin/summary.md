# Experiment 1: review policy vs. extractor error rate (simulated extractor)

Candidate selection for the extractor: minimum score 0 (AURA_EXTRACT_MIN_SCORE).

20 personas x 3 seeds per cell (n = 60); each persona has 5 sessions (~21 user turns). The memory store starts with 30 unrelated facts and gains 10 between sessions. Means with 95% CI half-widths. Extractor = simulated with error rate e (not Gemini); database, memory logic, candidate selection and embeddings are AURA's real code and local model.

## Error-rate sweep (user slip rate u = 0.05)

| policy | e | F1 | exact final state | stale facts | false facts | true facts destroyed | wrong changes applied | prompts / 100 turns | prompt precision |
|---|---|---|---|---|---|---|---|---|---|
| append | 0 | 0.556 ± 0.028 | 0.00 | 4.87 | 0.00 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0 | 0.978 ± 0.013 | 0.80 | 0.22 | 0.00 | 0.00 | 0.00 | 0.0 | n/a |
| gate | 0 | 0.941 ± 0.021 | 0.58 | 0.52 | 0.00 | 0.00 | 0.00 | 26.1 | 1.00 |
| gateAll | 0 | 0.941 ± 0.020 | 0.57 | 0.48 | 0.00 | 0.00 | 0.00 | 68.1 | 1.00 |
| append | 0.05 | 0.544 ± 0.032 | 0.00 | 4.78 | 0.12 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0.05 | 0.924 ± 0.023 | 0.18 | 0.42 | 0.15 | 0.78 | 0.82 | 0.0 | n/a |
| gate | 0.05 | 0.891 ± 0.023 | 0.25 | 0.77 | 0.12 | 0.05 | 0.07 | 28.3 | 0.86 |
| gateAll | 0.05 | 0.891 ± 0.030 | 0.33 | 0.70 | 0.00 | 0.03 | 0.05 | 69.6 | 0.93 |
| append | 0.1 | 0.556 ± 0.027 | 0.00 | 4.45 | 0.33 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0.1 | 0.854 ± 0.026 | 0.03 | 0.67 | 0.50 | 1.63 | 1.75 | 0.0 | n/a |
| gate | 0.1 | 0.857 ± 0.026 | 0.15 | 0.85 | 0.33 | 0.07 | 0.08 | 29.6 | 0.71 |
| gateAll | 0.1 | 0.846 ± 0.028 | 0.17 | 0.92 | 0.03 | 0.05 | 0.07 | 71.0 | 0.86 |
| append | 0.2 | 0.525 ± 0.032 | 0.00 | 4.18 | 0.70 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0.2 | 0.774 ± 0.037 | 0.00 | 1.07 | 0.78 | 2.95 | 3.10 | 0.0 | n/a |
| gate | 0.2 | 0.771 ± 0.035 | 0.07 | 1.30 | 0.70 | 0.15 | 0.17 | 32.0 | 0.55 |
| gateAll | 0.2 | 0.808 ± 0.034 | 0.12 | 1.23 | 0.00 | 0.15 | 0.15 | 73.7 | 0.76 |
| append | 0.3 | 0.511 ± 0.033 | 0.00 | 3.78 | 1.20 | 0.00 | 0.00 | 0.0 | n/a |
| auto | 0.3 | 0.673 ± 0.035 | 0.00 | 1.35 | 1.35 | 4.72 | 4.97 | 0.0 | n/a |
| gate | 0.3 | 0.679 ± 0.035 | 0.00 | 1.60 | 1.22 | 0.28 | 0.35 | 36.6 | 0.35 |
| gateAll | 0.3 | 0.737 ± 0.030 | 0.00 | 1.47 | 0.03 | 0.40 | 0.47 | 78.8 | 0.63 |

## User-reliability sweep (extractor error rate e = 0.1)

| policy | u | F1 | stale facts | false facts | wrong changes applied | prompts / 100 turns |
|---|---|---|---|---|---|---|
| gate | 0 | 0.870 ± 0.025 | 0.73 | 0.33 | 0.02 | 29.7 |
| gateAll | 0 | 0.893 ± 0.024 | 0.73 | 0.00 | 0.02 | 70.8 |
| gate | 0.1 | 0.831 ± 0.029 | 1.10 | 0.35 | 0.27 | 29.5 |
| gateAll | 0.1 | 0.816 ± 0.029 | 1.08 | 0.07 | 0.15 | 71.0 |
| gate | 0.2 | 0.805 ± 0.029 | 1.42 | 0.40 | 0.50 | 28.9 |
| gateAll | 0.2 | 0.767 ± 0.034 | 1.28 | 0.12 | 0.25 | 72.0 |
| gate | 0.3 | 0.757 ± 0.033 | 1.92 | 0.37 | 0.62 | 29.0 |
| gateAll | 0.3 | 0.688 ± 0.041 | 1.53 | 0.15 | 0.58 | 70.8 |

## Other measurements

- Change turns whose target memory was not among the candidates shown to the extractor (e = 0): append 0.027, auto 0.030, gate 0.030, gateAll 0.027.
- Forget requests (per persona) whose value is still in a memory row / still in the stored conversation text (e = 0): append 1.53 / 1.67; auto 0.10 / 1.67; gate 0.13 / 1.67; gateAll 0.13 / 1.67 (forget requests per persona: 1.67).

Column definitions: eval/README.md. Raw rows: runs.csv. Configuration: config.json.
