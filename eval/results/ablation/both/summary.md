# Experiment 1: review policy vs. extractor error rate (simulated extractor)

Features under test: candidate selection `adaptive`, re-proposal limit 2, restate probability 1 (restated facts add turns to every persona and let a correct extractor update a stale memory it is shown).

Candidate selection for the extractor: AURA as shipped (search minimum score 0.25).

20 personas x 3 seeds per cell (n = 60); each persona has 5 sessions (~21 user turns). The memory store starts with 30 unrelated facts and gains 10 between sessions. Means with 95% CI half-widths. Extractor = simulated with error rate e (not Gemini); database, memory logic, candidate selection and embeddings are AURA's real code and local model.

## Error-rate sweep (user slip rate u = 0.05)

| policy | e | F1 | exact final state | stale facts | false facts | true facts destroyed | wrong changes applied | prompts / 100 turns | prompt precision |
|---|---|---|---|---|---|---|---|---|---|
| auto | 0 | 0.989 ± 0.010 | 0.92 | 0.08 | 0.00 | 0.00 | 0.00 | 0.0 | n/a |
| gate | 0 | 0.967 ± 0.016 | 0.75 | 0.27 | 0.00 | 0.00 | 0.00 | 25.0 | 1.00 |
| auto | 0.1 | 0.899 ± 0.029 | 0.05 | 0.43 | 0.42 | 1.88 | 2.00 | 0.0 | n/a |
| gate | 0.1 | 0.901 ± 0.025 | 0.30 | 0.58 | 0.33 | 0.08 | 0.10 | 29.4 | 0.69 |
| auto | 0.2 | 0.800 ± 0.029 | 0.00 | 0.88 | 0.87 | 3.33 | 3.57 | 0.0 | n/a |
| gate | 0.2 | 0.784 ± 0.030 | 0.08 | 1.17 | 0.82 | 0.17 | 0.22 | 32.7 | 0.52 |

## User-reliability sweep (extractor error rate e = 0.1)

| policy | u | F1 | stale facts | false facts | wrong changes applied | prompts / 100 turns |
|---|---|---|---|---|---|---|
| gate | 0 | 0.903 ± 0.025 | 0.55 | 0.33 | 0.02 | 29.2 |
| gate | 0.1 | 0.881 ± 0.028 | 0.82 | 0.33 | 0.27 | 29.9 |
| gate | 0.2 | 0.851 ± 0.025 | 1.10 | 0.37 | 0.50 | 30.1 |
| gate | 0.3 | 0.800 ± 0.031 | 1.57 | 0.33 | 0.67 | 31.0 |

## Other measurements

- Change turns whose target memory was not among the candidates shown to the extractor (e = 0): auto 0.006, gate 0.006.
- Forget requests (per persona) whose value is still in a memory row / still in the stored conversation text (e = 0): auto 0.03 / 1.67; gate 0.07 / 1.67 (forget requests per persona: 1.67).

Column definitions: eval/README.md. Raw rows: runs.csv. Configuration: config.json.
