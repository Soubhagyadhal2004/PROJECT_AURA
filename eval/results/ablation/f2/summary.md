# Experiment 1: review policy vs. extractor error rate (simulated extractor)

Features under test: candidate selection `adaptive`, re-proposal limit 0, restate probability 1 (restated facts add turns to every persona and let a correct extractor update a stale memory it is shown).

Candidate selection for the extractor: AURA as shipped (search minimum score 0.25).

20 personas x 3 seeds per cell (n = 60); each persona has 5 sessions (~21 user turns). The memory store starts with 30 unrelated facts and gains 10 between sessions. Means with 95% CI half-widths. Extractor = simulated with error rate e (not Gemini); database, memory logic, candidate selection and embeddings are AURA's real code and local model.

## Error-rate sweep (user slip rate u = 0.05)

| policy | e | F1 | exact final state | stale facts | false facts | true facts destroyed | wrong changes applied | prompts / 100 turns | prompt precision |
|---|---|---|---|---|---|---|---|---|---|
| auto | 0 | 0.989 ± 0.010 | 0.92 | 0.08 | 0.00 | 0.00 | 0.00 | 0.0 | n/a |
| gate | 0 | 0.950 ± 0.020 | 0.67 | 0.40 | 0.00 | 0.00 | 0.00 | 24.3 | 1.00 |
| auto | 0.1 | 0.899 ± 0.029 | 0.05 | 0.43 | 0.42 | 1.88 | 2.00 | 0.0 | n/a |
| gate | 0.1 | 0.890 ± 0.025 | 0.27 | 0.65 | 0.33 | 0.08 | 0.08 | 29.1 | 0.69 |
| auto | 0.2 | 0.800 ± 0.029 | 0.00 | 0.88 | 0.87 | 3.33 | 3.57 | 0.0 | n/a |
| gate | 0.2 | 0.776 ± 0.030 | 0.08 | 1.22 | 0.82 | 0.17 | 0.22 | 32.2 | 0.52 |

## User-reliability sweep (extractor error rate e = 0.1)

| policy | u | F1 | stale facts | false facts | wrong changes applied | prompts / 100 turns |
|---|---|---|---|---|---|---|
| gate | 0 | 0.900 ± 0.025 | 0.57 | 0.33 | 0.00 | 29.1 |
| gate | 0.1 | 0.861 ± 0.031 | 0.97 | 0.33 | 0.25 | 28.9 |
| gate | 0.2 | 0.829 ± 0.030 | 1.25 | 0.37 | 0.52 | 28.6 |
| gate | 0.3 | 0.765 ± 0.036 | 1.80 | 0.35 | 0.65 | 28.6 |

## Other measurements

- Change turns whose target memory was not among the candidates shown to the extractor (e = 0): auto 0.006, gate 0.006.
- Forget requests (per persona) whose value is still in a memory row / still in the stored conversation text (e = 0): auto 0.03 / 1.67; gate 0.07 / 1.67 (forget requests per persona: 1.67).

Column definitions: eval/README.md. Raw rows: runs.csv. Configuration: config.json.
