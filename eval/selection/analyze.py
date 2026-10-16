#!/usr/bin/env python3
"""Analyse eval/results/selection/raw/events.jsonl (standard library only).

Unit of analysis: the persona (40). Every persona has the same number of eligible events per store size, so
the pooled rate equals the mean of per-persona rates. Intervals: persona-clustered bootstrap. Paired tests:
exact two-sided sign test over personas, Holm-corrected across the six pre-registered comparisons.
Usage (repository root): python3 eval/selection/analyze.py
"""
import json, math, os, random, csv
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(ROOT, "eval", "results", "selection", "raw")
OUT = os.path.join(ROOT, "eval", "results", "selection")
CFG = json.load(open(os.path.join(HERE, "config.json")))
COND = list(CFG["conditions"].keys())
B = CFG["bootstrap"]["resamples"]
SEED = CFG["bootstrap"]["seed"]
MAIN_N = CFG["mainStoreSize"]


def check_counts(rows):
    keys = [(r["event"], r["N"]) for r in rows]
    assert len(keys) == len(set(keys)), "duplicate (event, N) rows"
    per = defaultdict(int)
    for r in rows:
        per[(r["persona"], r["N"])] += 1
    personas = sorted({r["persona"] for r in rows})
    assert len(personas) == CFG["personas"], len(personas)
    assert set(r["N"] for r in rows) == set(CFG["storeSizes"])
    assert sorted(set(per.values())) == [80], sorted(set(per.values()))
    return {"rows": len(rows), "personas": len(personas), "eventsPerPersonaPerN": 80}


def per_persona(rows, cond, field="final", pred=lambda r: True):
    acc = defaultdict(lambda: [0, 0])
    for r in rows:
        if pred(r):
            a = acc[r["persona"]]
            a[0] += r["conds"][cond][field]
            a[1] += 1
    return {p: v[0] / v[1] for p, v in acc.items() if v[1]}


def boot_ci(per, b=B, seed=SEED):
    vals = [per[p] for p in sorted(per)]
    rnd = random.Random(seed)
    n = len(vals)
    means = sorted(sum(vals[rnd.randrange(n)] for _ in range(n)) / n for _ in range(b))
    return sum(vals) / n, means[int(0.025 * b)], means[int(0.975 * b) - 1]


def sign_test(diffs):
    pos = sum(1 for d in diffs if d > 0)
    neg = sum(1 for d in diffs if d < 0)
    n = pos + neg
    if n == 0:
        return pos, neg, 1.0
    k = min(pos, neg)
    return pos, neg, min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)


def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    adj, running, m = [0.0] * len(ps), 0.0, len(ps)
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (m - rank) * ps[i]))
        adj[i] = running
    return adj


def paired(a, b):
    ps = sorted(set(a) & set(b))
    diffs = {p: a[p] - b[p] for p in ps}
    m, lo, hi = boot_ci(diffs)
    pos, neg, p = sign_test(list(diffs.values()))
    return {"diff": m, "lo": lo, "hi": hi, "pos": pos, "neg": neg, "ties": len(ps) - pos - neg, "p": p, "n": len(ps)}


def write_csv(name, rows):
    with open(os.path.join(OUT, "processed", name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    rows = [json.loads(l) for l in open(os.path.join(RAW, "events.jsonl"))]
    stores = [json.loads(l) for l in open(os.path.join(RAW, "stores.jsonl"))]
    os.makedirs(os.path.join(OUT, "processed"), exist_ok=True)
    summary = {"checks": check_counts(rows)}
    summary["stores"] = {N: {"activeMean": sum(s["active"] for s in stores if s["N"] == N) / sum(1 for s in stores if s["N"] == N),
                             "mergedMax": max(s["merged"] for s in stores if s["N"] == N)} for N in CFG["storeSizes"]}

    by_n = []
    for N in CFG["storeSizes"]:
        rn = [r for r in rows if r["N"] == N]
        for c in COND:
            m, lo, hi = boot_ci(per_persona(rn, c))
            by_n.append({"N": N, "cond": c, "cr": m, "lo": lo, "hi": hi,
                         "search": sum(r["conds"][c]["search"] for r in rn) / len(rn),
                         "ncand": sum(r["conds"][c]["n"] for r in rn) / len(rn), "events": len(rn)})
    write_csv("reach_by_n.csv", by_n)
    summary["byN"] = by_n

    rm = [r for r in rows if r["N"] == MAIN_N]
    groups = {
        "single": lambda r: r["context"] == "single", "mixed": lambda r: r["context"] == "mixed",
        "cue": lambda r: r["cue"], "cue-free": lambda r: not r["cue"],
        "update": lambda r: r["kind"] == "update", "retire": lambda r: r["kind"] == "retire", "forget": lambda r: r["kind"] == "forget",
    }
    brk = []
    for g, pred in groups.items():
        for c in COND:
            m, lo, hi = boot_ci(per_persona(rm, c, pred=pred))
            ncand = [r["conds"][c]["n"] for r in rm if pred(r)]
            brk.append({"group": g, "cond": c, "cr": m, "lo": lo, "hi": hi, "ncand": sum(ncand) / len(ncand), "events": len(ncand)})
    write_csv(f"reach_breakdown_N{MAIN_N}.csv", brk)
    summary["breakdown"] = brk

    slot_rows = []
    for s in sorted({r["slot"] for r in rm}):
        rs = [r for r in rm if r["slot"] == s]
        d = {"slot": s, "events": len(rs)}
        for c in ["default", "nomin", "sentence", "adaptive", "nomin_k24"]:
            d[c] = sum(r["conds"][c]["final"] for r in rs) / len(rs)
        slot_rows.append(d)
    write_csv(f"reach_by_slot_N{MAIN_N}.csv", slot_rows)
    summary["bySlot"] = slot_rows

    diag = []
    for N in CFG["storeSizes"]:
        rn = [r for r in rows if r["N"] == N]
        n = len(rn)
        diag.append({"N": N, "events": n,
                     "target_in_recent8": sum(r["targetRecent"] for r in rn) / n,
                     "R12_whole_nofloor": sum(1 for r in rn if r["wholeRank"] <= 12) / n,
                     "R24_whole_nofloor": sum(1 for r in rn if r["wholeRank"] <= 24) / n,
                     "lost_to_floor": sum(1 for r in rn if r["wholeRank"] <= 12 and r["wholeScore"] < 0.25) / n,
                     "default_final": sum(r["conds"]["default"]["final"] for r in rn) / n,
                     "default_via_recent_only": sum(1 for r in rn if r["conds"]["default"]["final"] and not r["conds"]["default"]["search"]) / n,
                     "missed_by_all": sum(1 for r in rn if all(not v["final"] for v in r["conds"].values())) / n})
    write_csv("reach_diagnostics.csv", diag)
    summary["diagnostics"] = diag

    pp = {c: per_persona(rm, c) for c in COND}
    comps = [
        ("adaptive vs default", pp["adaptive"], pp["default"]),
        ("adaptive vs nomin_k24", pp["adaptive"], pp["nomin_k24"]),
        ("sentence vs default", pp["sentence"], pp["default"]),
        ("nomin vs default", pp["nomin"], pp["default"]),
        ("cue_k vs default", pp["cue_k"], pp["default"]),
        ("adaptive: cue-free minus cue", per_persona(rm, "adaptive", pred=lambda r: not r["cue"]), per_persona(rm, "adaptive", pred=lambda r: r["cue"])),
    ]
    res = []
    for name, a, b in comps:
        d = paired(a, b)
        d["comparison"] = name
        res.append(d)
    for d, p in zip(res, holm([d["p"] for d in res])):
        d["p_holm"] = p
    # exploratory (not corrected, reported as such)
    extra = []
    for name, a, b in [
        ("sent_nomin_k24 vs nomin_k24", pp["sent_nomin_k24"], pp["nomin_k24"]),
        ("adaptive vs sent_nomin", pp["adaptive"], pp["sent_nomin"]),
        ("nomin_k24 vs nomin", pp["nomin_k24"], pp["nomin"]),
        ("mixed: adaptive vs nomin_k24", per_persona(rm, "adaptive", pred=lambda r: r["context"] == "mixed"), per_persona(rm, "nomin_k24", pred=lambda r: r["context"] == "mixed")),
        ("cue-free: adaptive vs nomin_k24", per_persona(rm, "adaptive", pred=lambda r: not r["cue"]), per_persona(rm, "nomin_k24", pred=lambda r: not r["cue"])),
    ]:
        d = paired(a, b)
        d["comparison"] = name
        extra.append(d)
    # added baselines (BM25, rank fusion): a separate family, Holm-corrected within itself
    fam = []
    if "bm25_k24" in pp:
        for name, a, b in [
            ("bm25_k12 vs default", pp["bm25_k12"], pp["default"]),
            ("bm25_k24 vs nomin_k24", pp["bm25_k24"], pp["nomin_k24"]),
            ("rrf_k24 vs nomin_k24", pp["rrf_k24"], pp["nomin_k24"]),
            ("sent_rrf_k24 vs sent_nomin_k24", pp["sent_rrf_k24"], pp["sent_nomin_k24"]),
        ]:
            d = paired(a, b)
            d["comparison"] = name
            fam.append(d)
        for d, p in zip(fam, holm([d["p"] for d in fam])):
            d["p_holm"] = p
        write_csv(f"reach_baselines_N{MAIN_N}.csv", [{k: d[k] for k in ["comparison", "n", "diff", "lo", "hi", "pos", "neg", "ties", "p", "p_holm"]} for d in fam])
    summary["baselines"] = fam
    write_csv(f"reach_comparisons_N{MAIN_N}.csv", [{k: d[k] for k in ["comparison", "n", "diff", "lo", "hi", "pos", "neg", "ties", "p", "p_holm"]} for d in res])
    write_csv(f"reach_exploratory_N{MAIN_N}.csv", [{k: d[k] for k in ["comparison", "n", "diff", "lo", "hi", "pos", "neg", "ties", "p"]} for d in extra])
    summary["comparisons"] = res
    summary["exploratory"] = extra
    json.dump(summary, open(os.path.join(OUT, "processed", "summary.json"), "w"), indent=1)
    print(json.dumps(summary["checks"]))
    for d in res + extra + fam:
        print(f"{d['comparison']:34s} {d['diff']:+.3f} [{d['lo']:+.3f},{d['hi']:+.3f}] {d['pos']}/{d['neg']}/{d['ties']} p={d['p']:.2g} holm={d.get('p_holm', float('nan')):.2g}")


if __name__ == "__main__":
    main()
