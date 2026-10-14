# Experiment 3: can the extractor see the memory it has to change?

30 stores per size; each store has one fact for each of the 12 slots plus N unrelated facts with random ages (0-90 days). For every fact, the sentences a user would say to change it ("I've just moved to …", "I stopped going to the gym.", "Please forget …") are run through AURA's real candidate selection (searchMemories(text, 12) + coreMemories(8)). Reachable = the fact to change is among the candidates; 95% Wilson intervals.

| unrelated facts N | change | cases | reachable (AURA) | found by search | only via the 8 most recent | reachable without the 0.25 minimum |
|---|---|---|---|---|---|---|
| 0 | all | 2610 | 0.898 [0.886, 0.909] | 0.695 | 0.203 | 1.000 [0.999, 1.000] |
| 0 | update | 900 | 0.913 [0.893, 0.930] | 0.753 | 0.160 | 1.000 [0.996, 1.000] |
| 0 | retire | 630 | 0.892 [0.865, 0.914] | 0.689 | 0.203 | 1.000 [0.994, 1.000] |
| 0 | forget | 1080 | 0.889 [0.869, 0.906] | 0.649 | 0.240 | 1.000 [0.996, 1.000] |
| 25 | all | 2610 | 0.752 [0.736, 0.769] | 0.700 | 0.053 | 0.990 [0.986, 0.994] |
| 25 | update | 900 | 0.807 [0.780, 0.831] | 0.759 | 0.048 | 0.994 [0.987, 0.998] |
| 25 | retire | 630 | 0.730 [0.694, 0.763] | 0.695 | 0.035 | 1.000 [0.994, 1.000] |
| 25 | forget | 1080 | 0.720 [0.693, 0.746] | 0.653 | 0.068 | 0.981 [0.972, 0.988] |
| 50 | all | 2610 | 0.749 [0.732, 0.765] | 0.701 | 0.048 | 0.975 [0.968, 0.980] |
| 50 | update | 900 | 0.809 [0.782, 0.833] | 0.766 | 0.043 | 0.990 [0.981, 0.995] |
| 50 | retire | 630 | 0.749 [0.714, 0.781] | 0.698 | 0.051 | 1.000 [0.994, 1.000] |
| 50 | forget | 1080 | 0.699 [0.671, 0.726] | 0.648 | 0.051 | 0.947 [0.932, 0.959] |
| 100 | all | 2610 | 0.727 [0.710, 0.744] | 0.693 | 0.034 | 0.952 [0.944, 0.960] |
| 100 | update | 900 | 0.776 [0.747, 0.802] | 0.748 | 0.028 | 0.961 [0.946, 0.972] |
| 100 | retire | 630 | 0.730 [0.694, 0.763] | 0.690 | 0.040 | 0.997 [0.988, 0.999] |
| 100 | forget | 1080 | 0.685 [0.657, 0.712] | 0.648 | 0.037 | 0.919 [0.902, 0.934] |
| 200 | all | 2610 | 0.704 [0.686, 0.721] | 0.690 | 0.014 | 0.934 [0.924, 0.943] |
| 200 | update | 900 | 0.744 [0.715, 0.772] | 0.732 | 0.012 | 0.939 [0.921, 0.953] |
| 200 | retire | 630 | 0.708 [0.671, 0.742] | 0.695 | 0.013 | 0.990 [0.979, 0.996] |
| 200 | forget | 1080 | 0.668 [0.639, 0.695] | 0.651 | 0.017 | 0.897 [0.878, 0.914] |
| 350 | all | 2610 | 0.690 [0.672, 0.707] | 0.690 | 0.000 | 0.911 [0.900, 0.922] |
| 350 | update | 900 | 0.734 [0.705, 0.762] | 0.734 | 0.000 | 0.907 [0.886, 0.924] |
| 350 | retire | 630 | 0.697 [0.660, 0.731] | 0.695 | 0.002 | 0.989 [0.977, 0.995] |
| 350 | forget | 1080 | 0.649 [0.620, 0.677] | 0.649 | 0.000 | 0.870 [0.849, 0.889] |

Each fact type is changed with 3 phrasings per kind of change (update / retire / forget); rows in changes.csv.

## By fact type (N = 350)

| slot | cases | reachable (AURA) | without minimum | median rank of the fact (hybrid score) |
|---|---|---|---|---|
| city | 180 | 0.34 | 0.34 | 28 |
| employer | 270 | 0.18 | 0.91 | 2 |
| pet | 270 | 1.00 | 1.00 | 1 |
| sister | 90 | 1.00 | 1.00 | 1 |
| diet | 180 | 0.27 | 0.83 | 1 |
| gym | 270 | 0.94 | 1.00 | 1 |
| language | 270 | 0.95 | 1.00 | 1 |
| car | 270 | 0.04 | 0.79 | 3 |
| project | 270 | 0.89 | 1.00 | 1 |
| coffee | 270 | 1.00 | 1.00 | 1 |
| hobby | 180 | 0.91 | 1.00 | 1 |
| birthday | 90 | 1.00 | 1.00 | 1 |
