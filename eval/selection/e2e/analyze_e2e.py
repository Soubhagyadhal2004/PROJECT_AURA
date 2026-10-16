#!/usr/bin/env python3
"""Analyse an end-to-end run: python3 eval/selection/e2e/analyze_e2e.py <run_dir>

Writes <run_dir>/summary.json and <run_dir>/table.md. Rates are computed per persona, then averaged over
personas (the persona is the unit); 95% intervals by persona-clustered bootstrap (2,000 resamples, seed 7).
Denominators: change turns for reachability and update outcomes; P(O|R) only over change turns whose target
reached the prompt; no-op and new-fact turns for false changes. Turns with errors are counted and excluded.
"""
import json, os, sys, random
from collections import defaultdict

RUN = sys.argv[1]


def correct_op(t, op):
    if t["type"] != "change" or op.get("memory_id") != t["targetId"] or op.get("action") != t["kind"]:
        return False
    if t["kind"] == "update":
        return t["newValue"].lower() in str(op.get("content", "")).lower()
    return True


def boot(vals, b=2000, seed=7):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None, None, None
    rnd = random.Random(seed)
    n = len(vals)
    ms = sorted(sum(vals[rnd.randrange(n)] for _ in range(n)) / n for _ in range(b))
    return sum(vals) / n, ms[int(0.025 * b)], ms[int(0.975 * b) - 1]


def main():
    turns = [json.loads(l) for l in open(os.path.join(RUN, "turns.jsonl"))]
    finals = [json.loads(l) for l in open(os.path.join(RUN, "final_state.jsonl"))]
    groups = defaultdict(list)
    for t in turns:
        groups[(t["cond"], t["policy"])].append(t)
    out = []
    for (cond, policy), ts in sorted(groups.items()):
        P = defaultdict(lambda: defaultdict(float))
        for t in ts:
            p = P[t["persona"]]
            if t.get("error"):
                p["errors"] += 1
                continue
            p["calls"] += 1
            p["tokens"] += t.get("promptTokens", 0)
            p["chars"] += t.get("promptChars", 0)
            p["cand"] += t.get("nCand", 0)
            p["rejected"] += sum(1 for d in t.get("decisions", []) if d["decision"] == "rejected")
            p["accepted"] += sum(1 for d in t.get("decisions", []) if d["decision"] == "accepted")
            p["wrongRowsChanged"] += sum(1 for c in t.get("collateral", []) if c["from"] == "active")
            p["factsDestroyed"] += sum(1 for c in t.get("collateral", []) if c["from"] == "active" and c["personaFact"])
            if t["type"] == "change":
                ok = any(correct_op(t, op) for op in t.get("rawOps", []))
                p["change"] += 1
                p["reach"] += t["reach"]
                p["correctOp"] += ok
                if t["reach"]:
                    p["reachable"] += 1
                    p["correctGivenReach"] += ok
                p["success"] += t.get("success", 0)
                p["missed"] += t.get("missed", 0)
                p["conflict"] += t.get("conflict", 0) or 0
            else:
                p["other"] += 1
                p["falseChange"] += len([op for op in t.get("rawOps", []) if op.get("action") in ("update", "retire", "forget")])
        ps = sorted(P)
        rate = lambda num, den: [P[p][num] / P[p][den] if P[p][den] else None for p in ps]
        per = lambda key: [P[p][key] for p in ps]
        stale = defaultdict(int)
        for f in finals:
            if f["cond"] == cond and f["policy"] == policy:
                stale[f["persona"]] = sum(s["stale"] for s in f["slots"].values() if s["changed"])
        row = {"cond": cond, "policy": policy, "personas": len(ps), "changeTurns": int(sum(per("change"))),
               "reachableTurns": int(sum(per("reachable"))), "errors": int(sum(per("errors")))}
        for name, vals in [("reach", rate("reach", "change")), ("correctOp", rate("correctOp", "change")),
                           ("correctGivenReach", rate("correctGivenReach", "reachable")), ("success", rate("success", "change")),
                           ("missed", rate("missed", "change")), ("conflict", rate("conflict", "change")),
                           ("staleEnd", [stale[p] for p in ps]), ("rejectedPerPersona", per("rejected")),
                           ("wrongRowsChangedPerPersona", per("wrongRowsChanged")), ("factsDestroyedPerPersona", per("factsDestroyed")),
                           ("falseChangeOps", per("falseChange")), ("candidates", rate("cand", "calls")),
                           ("promptTokensPerCall", rate("tokens", "calls")), ("promptCharsPerCall", rate("chars", "calls"))]:
            m, lo, hi = boot(vals)
            row[name] = m
            row[name + "Lo"] = lo
            row[name + "Hi"] = hi
        row["pooledCorrectGivenReach"] = sum(per("correctGivenReach")) / max(1, sum(per("reachable")))
        out.append(row)
    json.dump({"rows": out, "turns": len(turns), "errors": sum(1 for t in turns if t.get("error"))}, open(os.path.join(RUN, "summary.json"), "w"), indent=1)
    keys = ["reach", "correctGivenReach", "success", "missed", "conflict", "staleEnd", "rejectedPerPersona", "candidates", "promptTokensPerCall"]
    with open(os.path.join(RUN, "table.md"), "w") as f:
        f.write(f"turns {len(turns)}, errors {sum(1 for t in turns if t.get('error'))}\n\n| cond | policy | n | " + " | ".join(keys) + " |\n|---|---|---|" + "---|" * len(keys) + "\n")
        for r in out:
            f.write(f"| {r['cond']} | {r['policy']} | {r['personas']} | " + " | ".join("-" if r[k] is None else f"{r[k]:.3f}" for k in keys) + " |\n")
    print(open(os.path.join(RUN, "table.md")).read())


if __name__ == "__main__":
    main()
