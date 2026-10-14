# Experiment 1: review policy vs. extractor error rate (simulated extractor)

Features under test: candidate selection `default`, re-proposal limit 0, restate probability 1 (restated facts add turns to every persona and let a correct extractor update a stale memory it is shown).

Candidate selection for the extractor: AURA as shipped (search minimum score 0.25).

20 personas x 3 seeds per cell (n = 60); each persona has 5 sessions (~21 user turns). The memory store starts with 30 unrelated facts and gains 10 between sessions. Means with 95% CI half-widths. Extractor = simulated with error rate e (not Gemini); database, memory logic, candidate selection and embeddings are AURA's real code and local model.

## Error-rate sweep (user slip rate u = 0.05)

| policy | e | F1 | exact final state | stale facts | false facts | true facts destroyed | wrong changes applied | prompts / 100 turns | prompt precision |
|---|---|---|---|---|---|---|---|---|---|
| auto | 0 | 0.881 ± 0.018 | 0.08 | 1.57 | 0.00 | 0.00 | 0.00 | 0.0 | n/a |
| gate | 0 | 0.854 ± 0.022 | 0.03 | 1.80 | 0.00 | 0.00 | 0.00 | 17.6 | 1.00 |
| auto | 0.1 | 0.819 ± 0.026 | 0.00 | 1.62 | 0.40 | 1.85 | 2.00 | 0.0 | n/a |
| gate | 0.1 | 0.817 ± 0.027 | 0.07 | 1.83 | 0.33 | 0.05 | 0.07 | 23.7 | 0.62 |
| auto | 0.2 | 0.750 ± 0.026 | 0.00 | 1.62 | 0.93 | 3.27 | 3.57 | 0.0 | n/a |
| gate | 0.2 | 0.737 ± 0.026 | 0.02 | 1.98 | 0.80 | 0.10 | 0.15 | 28.6 | 0.46 |

## User-reliability sweep (extractor error rate e = 0.1)

| policy | u | F1 | stale facts | false facts | wrong changes applied | prompts / 100 turns |
|---|---|---|---|---|---|---|
| gate | 0 | 0.826 ± 0.027 | 1.75 | 0.33 | 0.02 | 23.7 |
| gate | 0.1 | 0.801 ± 0.031 | 1.98 | 0.35 | 0.30 | 23.6 |
| gate | 0.2 | 0.771 ± 0.026 | 2.32 | 0.35 | 0.52 | 23.3 |
| gate | 0.3 | 0.740 ± 0.032 | 2.60 | 0.38 | 0.63 | 23.3 |

## Other measurements

- Change turns whose target memory was not among the candidates shown to the extractor (e = 0): auto 0.272, gate 0.272.
- Forget requests (per persona) whose value is still in a memory row / still in the stored conversation text (e = 0): auto 0.45 / 1.67; gate 0.45 / 1.67 (forget requests per persona: 1.67).

Column definitions: eval/README.md. Raw rows: runs.csv. Configuration: config.json.
