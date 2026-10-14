# Re-scored: Gemini gemini-3.5-flash-lite, 4 personas x 1 seed(s), candidate selection default (0.25)

Scoring rules of 2026-10-13 (eval/lib/loose.mjs): precision = (true + ended) / (true + ended + stale + false + hypothetical); third-party and other are not counted. Destroyed = a memory that is still true but no longer active.

| policy | n | F1 | precision | recall | ended | stale | false | hypothetical | third-party | destroyed | prompts / 100 turns | cards judged right / wrong during the run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auto | 4 | 0.916 ± 0.027 | 0.846 | 1.000 | 0.50 | 0.50 | 0.25 | 0.50 | 0.75 | 0 | 0.0 | 0 / 0 |
| gate | 4 | 0.914 ± 0.063 | 0.846 | 1.000 | 0.00 | 0.75 | 0.00 | 0.50 | 0.50 | 0 | 24.6 | 20 / 1 |

Note: the simulated user decided the review cards during the run with the scoring rules in place at that time. 1 card(s) were judged wrong then; if the current rules would accept them, the gate result is pessimistic until the run is repeated.

Active memories that are not plainly true:

- auto-1-0: [hypothetical] The user would spend every evening on the beach if they moved to Goa.
- auto-1-1: [third-party] The user's friend Rohan bought a Thar.
- auto-1-1: [stale] The user drives a Seltos.
- auto-1-1: [ended] The user finished leading project Lotus last week and is currently between projects as of October 2026.
- auto-1-2: [third-party] The user's cousin works at Google in Zurich.
- auto-1-2: [stale] The user lives in Bhubaneswar.
- auto-1-3: [hypothetical] If the user had a cat, they would name her Luna.
- auto-1-3: [false] The user wants to move to Goa someday.
- auto-1-3: [third-party] The user's friend Rohan bought a Thar.
- auto-1-3: [ended] The user finished leading the Nimbus project and is currently between projects as of October 2026.
- gate-1-1: [third-party] The user's friend Rohan bought a Thar.
- gate-1-1: [stale] The user drives a Seltos.
- gate-1-1: [stale] The user is leading a project called Lotus at work.
- gate-1-2: [third-party] The user's cousin works at Google in Zurich.
- gate-1-2: [stale] The user lives in Bhubaneswar.
- gate-1-2: [hypothetical] If the user had a cat, they would name her Luna.
- gate-1-3: [hypothetical] The user would name a hypothetical cat Luna.
