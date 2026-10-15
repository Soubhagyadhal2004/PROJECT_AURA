# Re-scored: Gemini gemini-3.5-flash-lite, 12 personas x 1 seed(s), candidate selection default (0.25)

Scoring rules of 2026-10-15 (eval/lib/loose.mjs): precision = (true + ended) / (true + ended + stale + false + hypothetical); third-party and other are not counted. Destroyed = a memory that is still true but no longer active.

| policy | n | F1 | precision | recall | ended | stale | false | hypothetical | third-party | destroyed | prompts / 100 turns | cards judged right / wrong during the run |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| auto | 12 | 0.908 ± 0.024 | 0.835 | 1.000 | 0.00 | 1.00 | 0.00 | 0.25 | 0.67 | 0 | 0.0 | 0 / 0 |
| gate | 12 | 0.905 ± 0.027 | 0.830 | 1.000 | 0.08 | 1.00 | 0.00 | 0.33 | 0.67 | 0 | 23.3 | 56 / 9 |

Note: the simulated user decided the review cards during the run with the scoring rules in place at that time. 9 card(s) were judged wrong then; if the current rules would accept them, the gate result is pessimistic until the run is repeated.

Active memories that are not plainly true:

- auto-1-1: [third-party] The user's friend Rohan bought a Thar.
- auto-1-1: [stale] The user drives a Seltos.
- auto-1-2: [third-party] The user's cousin works at Google in Zurich.
- auto-1-2: [stale] The user lives in Bhubaneswar.
- auto-1-3: [hypothetical] If the user had a cat, they would name her Luna.
- auto-1-3: [third-party] The user's friend Rohan bought a Thar.
- auto-1-4: [stale] The user works at Freshworks.
- auto-1-4: [third-party] The user's cousin works at Google in Zurich.
- auto-1-5: [stale] The user is vegetarian.
- auto-1-5: [stale] The user is leading a project called Falcon at work.
- auto-1-6: [stale] The user is leading a project called Falcon at work.
- auto-1-6: [third-party] The user's cousin works at Google in Zurich.
- auto-1-7: [stale] The user works at Swiggy.
- auto-1-7: [hypothetical] If the user had a cat, they would name her Luna.
- auto-1-8: [hypothetical] The user would name a cat Luna if they had one.
- auto-1-8: [stale] The user lives in Bhubaneswar.
- auto-1-9: [stale] The user lives in Indore.
- auto-1-9: [third-party] The user's cousin works at Google in Zurich.
- auto-1-10: [stale] The user is an eggetarian.
- auto-1-10: [third-party] The user's cousin works at Google in Zurich.
- auto-1-10: [stale] The user is pescatarian.
- auto-1-11: [stale] The user works at Infosys.
- auto-1-11: [third-party] The user's cousin works at Google in Zurich.
- gate-1-1: [third-party] The user's friend Rohan bought a Thar.
- gate-1-1: [stale] The user drives a Seltos.
- gate-1-1: [stale] The user is leading a project called Lotus at work.
- gate-1-2: [third-party] The user's cousin works at Google in Zurich.
- gate-1-2: [stale] The user lives in Bhubaneswar.
- gate-1-3: [hypothetical] The user would name a pet cat Luna if they had one.
- gate-1-3: [third-party] The user's friend Rohan bought a Thar.
- gate-1-3: [ended] The user wrapped up project Nimbus and is currently between projects as of October 2026.
- gate-1-4: [stale] The user works at Freshworks.
- gate-1-4: [third-party] The user's cousin works at Google in Zurich.
- gate-1-4: [other] The user is currently unemployed as of October 2026.
- gate-1-5: [stale] The user is vegetarian.
- gate-1-5: [hypothetical] If the user had a cat, they would call her Luna as of 2026-10-15.
- gate-1-6: [stale] The user works at Freshworks.
- gate-1-6: [stale] The user is leading a project called Falcon at work.
- gate-1-6: [hypothetical] The user would like to move to Goa someday.
- gate-1-6: [third-party] The user's cousin works at Google in Zurich.
- gate-1-7: [stale] The user works at Swiggy.
- gate-1-7: [hypothetical] If the user had a cat, the user would name her Luna.
- gate-1-8: [stale] The user lives in Bhubaneswar.
- gate-1-9: [stale] The user lives in Indore.
- gate-1-9: [third-party] The user's cousin works at Google in Zurich.
- gate-1-10: [stale] The user is eggetarian.
- gate-1-10: [third-party] The user's cousin works at Google in Zurich.
- gate-1-11: [stale] The user works at Infosys.
- gate-1-11: [third-party] The user's cousin works at Google in Zurich.
