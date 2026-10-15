# Re-scored: Gemini gemini-3.5-flash-lite, 12 personas x 1 seed(s), candidate selection default (0.25)

Scoring rules of 2026-10-15 (eval/lib/loose.mjs): precision = (true + ended) / (true + ended + stale + false + hypothetical); third-party and other are not counted. Destroyed = a memory that is still true but no longer active.

| policy | n | F1 | precision | recall | ended | stale | false | hypothetical | third-party | destroyed | prompts / 100 turns | cards judged right / wrong during the run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auto | 12 | 0.956 ± 0.027 | 0.949 | 0.971 | 0.17 | 0.00 | 0.00 | 0.42 | 0.67 | 1 | 0.0 | 0 / 0 |
| gate | 12 | 0.982 ± 0.024 | 0.968 | 1.000 | 0.17 | 0.00 | 0.00 | 0.25 | 0.75 | 0 | 24.9 | 68 / 1 |

Note: the simulated user decided the review cards during the run with the scoring rules in place at that time. 1 card(s) were judged wrong then; if the current rules would accept them, the gate result is pessimistic until the run is repeated.

Active memories that are not plainly true:

- auto-1-1: [third-party] The user's friend Rohan bought a Thar.
- auto-1-1: [ended] The user finished leading project Lotus last week and is currently between projects as of October 2026.
- auto-1-2: [third-party] The user's cousin works at Google in Zurich.
- auto-1-3: [hypothetical] If the user had a cat, they would name her Luna.
- auto-1-3: [hypothetical] The user would spend every evening on the beach if they moved to Goa.
- auto-1-3: [third-party] The user's friend Rohan bought a Thar.
- auto-1-3: [ended] The user finished leading the Nimbus project in October 2026 and is currently between projects.
- auto-1-4: [third-party] The user's cousin works at Google in Zurich.
- auto-1-4: [other] The user is currently not working as of October 2026.
- auto-1-5: [hypothetical] The user would name a pet cat Luna if they had one.
- auto-1-6: [hypothetical] The user would like to move to Goa someday.
- auto-1-6: [third-party] The user's cousin works at Google in Zurich.
- auto-1-7: [hypothetical] If the user had a cat, they would name her Luna.
- auto-1-9: [third-party] The user's cousin works at Google in Zurich.
- auto-1-10: [third-party] The user's cousin works at Google in Zurich.
- auto-1-11: [third-party] The user's cousin works at Google in Zurich.
- gate-1-1: [third-party] The user's friend Rohan bought a Thar.
- gate-1-1: [ended] The user finished leading the project called Lotus and is currently between projects as of October 2026.
- gate-1-2: [third-party] The user's cousin works at Google in Zurich.
- gate-1-3: [hypothetical] If the user had a cat, they would name her Luna.
- gate-1-3: [hypothetical] The user would like to live in Goa someday.
- gate-1-3: [third-party] The user's friend Rohan bought a Thar.
- gate-1-3: [ended] The user finished leading the Nimbus project and is currently between projects.
- gate-1-4: [third-party] The user's cousin works at Google in Zurich.
- gate-1-6: [third-party] The user's friend Rohan bought a Thar.
- gate-1-6: [third-party] The user's cousin works at Google in Zurich.
- gate-1-9: [hypothetical] The user would spend every evening on the beach if they moved to Goa.
- gate-1-9: [third-party] The user's cousin works at Google in Zurich.
- gate-1-10: [third-party] The user's cousin works at Google in Zurich.
- gate-1-11: [third-party] The user's cousin works at Google in Zurich.
