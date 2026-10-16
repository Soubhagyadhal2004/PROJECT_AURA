#!/usr/bin/env python3
"""Compare the reranker baseline (run-rerank.mjs) with the selection-study conditions on the same events.
Usage (repository root): python3 eval/selection/analyze_rerank.py [eval/results/selection/rerank]"""
import json, os, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze as A

RR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(A.ROOT, "eval", "results", "selection", "rerank")
rr = [json.loads(l) for l in open(os.path.join(RR, "events.jsonl"))]
N = rr[0]["N"]
base = {(r["event"]): r for r in (json.loads(l) for l in open(os.path.join(A.RAW, "events.jsonl"))) if r["N"] == N}
assert all(r["event"] in base for r in rr), "events do not match the selection study"
per = defaultdict(lambda: [0, 0])
for r in rr:
    per[r["persona"]][0] += r["final"]; per[r["persona"]][1] += 1
rer = {p: v[0] / v[1] for p, v in per.items()}
out = {"events": len(rr), "personas": len(rer), "rerank": A.boot_ci(rer), "rerankCand": sum(r["n"] for r in rr) / len(rr),
       "inPool": sum(r["inPool"] for r in rr) / len(rr)}
rows = [base[r["event"]] for r in rr]
for c in ["default", "nomin_k24", "adaptive", "sent_nomin_k24", "rrf_k24"]:
    if c in rows[0]["conds"]:
        d = A.paired(rer, A.per_persona(rows, c))
        out[f"rerank vs {c}"] = d
comps = [k for k in out if k.startswith("rerank vs")]
for k, ph in zip(comps, A.holm([out[k]["p"] for k in comps])):
    out[k]["p_holm"] = ph
for g, pred in [("single", lambda r: r["context"] == "single"), ("mixed", lambda r: r["context"] == "mixed"), ("cue-free", lambda r: not r["cue"])]:
    xs = [r["final"] for r in rr if pred(r)]
    out[f"rerank_{g}"] = sum(xs) / len(xs)
rrmap = {r["event"]: r for r in rr}
out["missedByAllInclRerank"] = sum(1 for r in rows if all(not v["final"] for v in r["conds"].values()) and not rrmap[r["event"]]["final"]) / len(rows)
os.makedirs(os.path.join(A.OUT, "processed"), exist_ok=True)
json.dump(out, open(os.path.join(A.OUT, "processed", "rerank_summary.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
