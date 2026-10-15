"""Builds every table (LaTeX fragments), in-text number macros and the two real-run figures of the paper
from the experiment result folders. Nothing in the paper's results is typed by hand.

    python eval/make_paper_assets.py --root eval --out paper

--root is the eval folder (contains results/, ABLATION*.csv, ABLATION-LME.md).  Needs Python 3 + matplotlib.
"""
import argparse, csv, json, math, os, re
from collections import defaultdict

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ap = argparse.ArgumentParser()
ap.add_argument("--root", default="eval")
ap.add_argument("--out", default="paper")
ap.add_argument("--gate", default="gate-sim/v2-20261013")
ap.add_argument("--reach", default="reachability/v3-20261014")
args = ap.parse_args()
R = os.path.join(args.root, "results")
OUT = args.out
os.makedirs(os.path.join(OUT, "tables"), exist_ok=True)
os.makedirs(os.path.join(OUT, "figures"), exist_ok=True)


def read_csv(p):
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_jsonl(p):
    with open(p, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def mean(x):
    x = list(x)
    return sum(x) / len(x) if x else float("nan")


def sign_p(b, c):
    n = b + c
    if n == 0:
        return 1.0
    lo = min(b, c)
    s, t = 0.0, 1.0
    for i in range(lo + 1):
        s += t
        t = t * (n - i) / (i + 1)
    return min(1.0, 2 * s / 2 ** n)


def pf(p):
    return "\\ensuremath{<}0.001" if p < 0.001 else f"{p + 1e-9:.3f}"


def f3(x, d=3):
    return f"{x:.{d}f}"


def sd(x, d=3):  # signed difference
    return f"{x:+.{d}f}".replace("-", "$-$")


def tex(name, body):
    with open(os.path.join(OUT, "tables", name + ".tex"), "w", encoding="utf-8") as f:
        f.write(body)


MACROS = {}


def macro(name, val):
    MACROS[name] = val


# ---------------------------------------------------------------- Table: simulated policies
gs = read_csv(os.path.join(R, args.gate, "summary.csv"))
POL = [("append", "append-only"), ("auto", "auto-apply"), ("gate", "gate changes"), ("gateAll", "gate all")]
rows = []
for e in ("0", "0.1", "0.3"):
    for i, (p, lab) in enumerate(POL):
        r = next(x for x in gs if x["sweep"] == "error" and x["policy"] == p and x["e"] == e)
        destroyed = float(r["destroyed_mean"]) + float(r["fillerLost_mean"])
        rows.append(
            (f"{e}" if i == 0 else "", lab, f"{float(r['f1_mean']):.3f} $\\pm$ {float(r['f1_ci95']):.3f}",
             f3(float(r["stale_mean"]), 2), f3(float(r["falseMem_mean"]), 2), f3(destroyed, 2),
             f3(float(r["promptsPer100Turns_mean"]), 1))
        )
        macro(f"sim{p}E{e.replace('.', '')}Destroyed", f3(destroyed, 2))
    rows.append(None)
body = "\\begin{tabular}{llccccc}\n\\toprule\n$e$ & policy & F1 & stale & false & destroyed & prompts/100 \\\\\n\\midrule\n"
for r in rows:
    body += "\\addlinespace[2pt]\n" if r is None else " & ".join(r) + " \\\\\n"
body = body.removesuffix("\\addlinespace[2pt]\n") + "\\bottomrule\n\\end{tabular}\n"
tex("policies", body)
n_personas = next(x for x in gs if x["sweep"] == "error")["n"]
macro("simN", n_personas)
# destroyed reduction, gate vs auto, over the error sweep
red = []
for e in ("0.05", "0.1", "0.2", "0.3"):
    a = next(x for x in gs if x["sweep"] == "error" and x["policy"] == "auto" and x["e"] == e)
    g = next(x for x in gs if x["sweep"] == "error" and x["policy"] == "gate" and x["e"] == e)
    da = float(a["destroyed_mean"]) + float(a["fillerLost_mean"])
    dg = float(g["destroyed_mean"]) + float(g["fillerLost_mean"])
    red.append(1 - dg / da)
    macro(f"autoDestroyedE{e.replace('.', '')}", f3(da, 2))
    macro(f"gateDestroyedE{e.replace('.', '')}", f3(dg, 2))
macro("destroyRedMin", f"{100 * min(red):.0f}")
macro("destroyRedMax", f"{100 * max(red):.0f}")
g0 = [float(x["promptsPer100Turns_mean"]) for x in gs if x["sweep"] == "error" and x["policy"] == "gate"]
macro("gatePromptsMin", f"{min(g0):.0f}")
macro("gatePromptsMax", f"{max(g0):.0f}")
ga = [float(x["promptsPer100Turns_mean"]) for x in gs if x["sweep"] == "error" and x["policy"] == "gateAll"]
macro("gateAllRatio", f"{mean(ga) / mean(g0):.1f}")
macro("appendStaleEZero", f3(float(next(x for x in gs if x["sweep"] == "error" and x["policy"] == "append" and x["e"] == "0")["stale_mean"]), 2))

# user slip sweep (gate)
rows = []
for r in sorted((x for x in gs if x["sweep"] == "user" and x["policy"] == "gate"), key=lambda x: float(x["u"])):
    rows.append((r["u"], f"{float(r['f1_mean']):.3f} $\\pm$ {float(r['f1_ci95']):.3f}", f3(float(r["stale_mean"]), 2),
                 f3(float(r["wrongChangesApplied_mean"]), 2), f3(float(r["promptsPer100Turns_mean"]), 1)))
body = "\\begin{tabular}{ccccc}\n\\toprule\nslip $u$ & F1 & stale & wrong changes applied & prompts/100 \\\\\n\\midrule\n"
body += "".join(" & ".join(r) + " \\\\\n" for r in rows) + "\\bottomrule\n\\end{tabular}\n"
tex("slip", body)
u0 = next(x for x in gs if x["sweep"] == "user" and x["policy"] == "gate" and float(x["u"]) == 0)
u3 = next(x for x in gs if x["sweep"] == "user" and x["policy"] == "gate" and float(x["u"]) == 0.3)
macro("slipFZero", f3(float(u0["f1_mean"])))
macro("slipFThree", f3(float(u3["f1_mean"])))
macro("slipStaleZero", f3(float(u0["stale_mean"]), 2))
macro("slipStaleThree", f3(float(u3["stale_mean"]), 2))

# ---------------------------------------------------------------- Table: reachability
rs = [r for r in read_csv(os.path.join(R, args.reach, "summary.csv")) if r["kind"] == "all"]
rs.sort(key=lambda r: int(r["size"]))
body = "\\begin{tabular}{rcc}\n\\toprule\n$N$ & shown (default) & shown (no minimum score) \\\\\n\\midrule\n"
for r in rs:
    body += (f"{r['size']} & {float(r['reachable']):.3f} [{float(r['lo']):.3f}, {float(r['hi']):.3f}] & "
             f"{float(r['reachableNoMin']):.3f} [{float(r['lo2']):.3f}, {float(r['hi2']):.3f}] \\\\\n")
body += "\\bottomrule\n\\end{tabular}\n"
tex("reach", body)
macro("reachZero", f3(float(rs[0]["reachable"])))
macro("reachLast", f3(float(rs[-1]["reachable"])))
macro("reachLastNoMin", f3(float(rs[-1]["reachableNoMin"])))
macro("reachStores", "30")
macro("reachChanges", rs[0]["n"])

md = read_csv(os.path.join(R, args.reach, "summary_modes.csv"))
KIND = {"single sentence": "single sentence", "mixed (change + 2 unrelated sentences)": "mixed turn"}
body = "\\begin{tabular}{llcccc}\n\\toprule\n$N$ & turn type & default & no min. & sentence & adaptive \\\\\n\\midrule\n"
for n in ("0", "350"):
    first = True
    for k in KIND:
        r = next(x for x in md if x["size"] == n and x["turn"] == k and x["kind"] == "all")
        body += (f"{n if first else ''} & {KIND[k]} & " + " & ".join(
            f"{float(r['reach_' + m]):.3f} ({float(r['cand_' + m]):.1f})" for m in ("default", "nomin", "sentence", "adaptive")) + " \\\\\n")
        first = False
    if n == "0":
        body += "\\addlinespace[2pt]\n"
body += "\\bottomrule\n\\end{tabular}\n"
tex("modes", body)
m350 = next(x for x in md if x["size"] == "350" and x["turn"].startswith("mixed") and x["kind"] == "all")
macro("mixedDefault", f3(float(m350["reach_default"])))
macro("mixedAdaptive", f3(float(m350["reach_adaptive"])))
macro("mixedNomin", f3(float(m350["reach_nomin"])))
macro("mixedSentence", f3(float(m350["reach_sentence"])))
macro("candDefault", f"{float(m350['cand_default']):.1f}")
macro("candAdaptive", f"{float(m350['cand_adaptive']):.1f}")
s350 = next(x for x in md if x["size"] == "350" and x["turn"] == "single sentence" and x["kind"] == "all")
macro("singleAdaptive", f3(float(s350["reach_adaptive"])))

# ---------------------------------------------------------------- Table: simulated ablation
ab = read_csv(os.path.join(args.root, "ABLATION.csv"))
VAR = [("baseline", "baseline"), ("f1", "+F1"), ("f2", "+F2"), ("both", "F1+F2")]


def ab_get(variant, e, metric, sweep="error", u=None):
    return next(x for x in ab if x["variant"] == variant and x["policy"] == "gate" and x["sweep"] == sweep
                and x["e"] == e and x["metric"] == metric and (u is None or float(x["u"]) == u))


body = "\\begin{tabular}{llccc}\n\\toprule\n$e$ & variant & F1 (diff., $p$) & stale (diff., $p$) & prompts/100 \\\\\n\\midrule\n"
for e in ("0", "0.1", "0.2"):
    ref_f = ab_get("f1", e, "f1")
    ref_s = ab_get("f1", e, "stale")
    ref_p = ab_get("f1", e, "promptsPer100Turns")
    body += f"{e} & baseline & {float(ref_f['base']):.3f} & {float(ref_s['base']):.2f} & {float(ref_p['base']):.1f} \\\\\n"
    for v, lab in VAR[1:]:
        f = ab_get(v, e, "f1"); s = ab_get(v, e, "stale"); p = ab_get(v, e, "promptsPer100Turns")
        body += (f" & {lab} & {float(f['variantMean']):.3f} ({sd(float(f['diff']))}, {pf(float(f['signP']))}) & "
                 f"{float(s['variantMean']):.2f} ({sd(float(s['diff']), 2)}, {pf(float(s['signP']))}) & {float(p['variantMean']):.1f} \\\\\n")
    body += "\\addlinespace[2pt]\n"
body = body.removesuffix("\\addlinespace[2pt]\n") + "\\bottomrule\n\\end{tabular}\n"
tex("sim_ablation", body)
n_sim_tests = len({(x["variant"], x["sweep"], x["policy"], x["e"], x["u"], x["metric"]) for x in ab})
macro("simTests", str(n_sim_tests))
for v in ("f1", "f2", "both"):
    f = ab_get(v, "0", "f1"); macro(f"simAblF{v}Zero", sd(float(f["diff"])))
    s = ab_get(v, "0.1", "stale"); macro(f"simAblStale{v}OneBase", f3(float(s["base"]), 2)); macro(f"simAblStale{v}One", f3(float(s["variantMean"]), 2))
macro("simFOneZero", f3(float(ab_get("f1", "0", "f1")["variantMean"])))
macro("simFOneZeroP", pf(float(ab_get("f1", "0", "f1")["signP"])))

# ---------------------------------------------------------------- Real Gemini runs
def real_runs(folder, variants):
    d = {}
    for v in variants:
        d[v] = read_jsonl(os.path.join(R, folder, v, "runs.jsonl"))
    return d


def real_csv(path):
    return read_csv(path)


def table_real(folder, csvname, variants, labels, name, model):
    runs = real_runs(folder, variants)
    cs = real_csv(os.path.join(args.root, csvname))
    body = "\\begin{tabular}{llccccc}\n\\toprule\npolicy & variant & F1 & stale & false & prompts/100 & prompt tokens ($\\times10^3$) \\\\\n\\midrule\n"
    for pol in ("auto", "gate"):
        for v, lab in zip(variants, labels):
            rr = [r for r in runs[v] if r["policy"] == pol]
            cell = lambda m, d=3: mean(r[m] for r in rr)

            def pv(metric, fmt, dd):
                if v == "baseline":
                    return fmt(cell(metric))
                row = next(x for x in cs if x["variant"] == v and x["policy"] == pol and x["metric"] == metric)
                return f"{fmt(cell(metric))} ({sd(float(row['diff']), dd)}, {pf(float(row['signP']))})"
            body += (f"{pol if v == variants[0] else ''} & {lab} & {pv('f1', lambda x: f3(x), 3)} & {pv('stale', lambda x: f3(x, 2), 2)} & "
                     f"{pv('falseMem', lambda x: f3(x, 2), 2)} & {f3(cell('promptsPer100Turns'), 1)} & {cell('promptTokens') / 1000:.1f} \\\\\n")
        body += "\\addlinespace[2pt]\n"
    body = body.removesuffix("\\addlinespace[2pt]\n") + "\\bottomrule\n\\end{tabular}\n"
    tex(name, body)
    return runs, cs


V4 = ["baseline", "f1", "f2", "both"]
L4 = ["baseline", "+F1", "+F2", "F1+F2"]
runs1, cs1 = table_real("real-ablation", "ABLATION-REAL.csv", V4, L4, "real1", "m1")
runs2, cs2 = table_real("real-ablation-m2", "ABLATION-REAL-M2.csv", ["baseline", "both"], ["baseline", "F1+F2"], "real2", "m2")


def rget(cs, v, pol, metric):
    return next(x for x in cs if x["variant"] == v and x["policy"] == pol and x["metric"] == metric)


for tag, cs, runs in (("A", cs1, runs1), ("B", cs2, runs2)):
    for pol in ("gate", "auto"):
        for m in ("f1", "stale", "promptsPer100Turns", "promptTokens"):
            r = rget(cs, "both", pol, m)
            macro(f"real{tag}{pol}{m}Base", f3(float(r["base"]), 3 if m == "f1" else 2 if m == "stale" else 1 if m == "promptsPer100Turns" else 0))
            macro(f"real{tag}{pol}{m}Both", f3(float(r["variantMean"]), 3 if m == "f1" else 2 if m == "stale" else 1 if m == "promptsPer100Turns" else 0))
            macro(f"real{tag}{pol}{m}Diff", sd(float(r["diff"]), 3 if m == "f1" else 2 if m == "stale" else 1 if m == "promptsPer100Turns" else 0))
            macro(f"real{tag}{pol}{m}P", pf(float(r["signP"])))
            if m != "promptTokens":
                macro(f"real{tag}{pol}{m}Lo", f3(float(r["lo"]), 3 if m == "f1" else 2))
                macro(f"real{tag}{pol}{m}Hi", f3(float(r["hi"]), 3 if m == "f1" else 2))
for m in ("f1", "stale"):
    for v in ("f1", "f2"):
        r = rget(cs1, v, "gate", m)
        macro(f"realAgate{m}{v}Val", f3(float(r["variantMean"]), 3 if m == "f1" else 2))
        macro(f"realAgate{m}{v}P", pf(float(r["signP"])))
tokinc = (float(rget(cs1, "both", "gate", "promptTokens")["variantMean"]) / float(rget(cs1, "both", "gate", "promptTokens")["base"]) - 1) * 100
macro("tokInc", f"{tokinc:.0f}")
macro("realTests", str(len(cs1) + len(cs2)))
macro("realPairs", rget(cs1, "both", "gate", "f1")["pairs"])
errs = sum(r["extractionErrors"] for rs_ in list(runs1.values()) + list(runs2.values()) for r in rs_)
macro("realExtractionErrors", str(errs))
macro("realExtractions", str(sum(r["extractions"] for rs_ in list(runs1.values()) + list(runs2.values()) for r in rs_)))
macro("realWrongApplied", str(sum(r["wrongChangesApplied"] for rs_ in list(runs1.values()) + list(runs2.values()) for r in rs_)))
macro("realDestroyed", str(sum(r.get("fillerLost", 0) for rs_ in list(runs1.values()) + list(runs2.values()) for r in rs_)))

# ---------------------------------------------------------------- Agreement
def agreement(path):
    t = open(path, encoding="utf-8").read()
    m = re.search(r"(\d+) labelled rows; agreement (\d+) \(([\d.]+)\); Cohen's kappa (\d\.\d+)", t)
    return m.groups()


ag_b = agreement(os.path.join(R, "real-ablation", "baseline", "agreement.md"))
ag_o = agreement(os.path.join(R, "real-ablation", "both", "agreement.md"))
body = "\\begin{tabular}{lcccc}\n\\toprule\nrun & labelled memories & agreement & rate & Cohen's $\\kappa$ \\\\\n\\midrule\n"
for lab, a in (("baseline", ag_b), ("F1+F2", ag_o)):
    body += f"{lab} & {a[0]} & {a[1]} & {a[2]} & {a[3]} \\\\\n"
body += "\\bottomrule\n\\end{tabular}\n"
tex("agreement", body)
macro("agrBaseN", ag_b[0]); macro("agrBaseK", ag_b[3]); macro("agrBaseRate", ag_b[2]); macro("agrBaseHit", ag_b[1])
macro("agrBothN", ag_o[0]); macro("agrBothK", ag_o[3]); macro("agrBothRate", ag_o[2]); macro("agrBothHit", ag_o[1])

# ---------------------------------------------------------------- LongMemEval
lb = read_jsonl(os.path.join(R, "lme", "baseline", "runs.jsonl"))
lo = read_jsonl(os.path.join(R, "lme", "both", "runs.jsonl"))
SYS = [("none", "no memory"), ("context", "full context"), ("append", "append-only"), ("auto", "auto-apply"), ("gate", "gate (oracle reviewer)")]
body = "\\begin{tabular}{lccccc}\n\\toprule\nsystem & baseline & F1+F2 & difference & $b/c$ & $p$ \\\\\n\\midrule\n"
nq = len({r["qid"] for r in lb})
macro("lmeQ", str(nq))
bmap = {(r["policy"], r["qid"]): r for r in lo}
for p, lab in SYS:
    pairs = [(r, bmap[(p, r["qid"])]) for r in lb if r["policy"] == p and (p, r["qid"]) in bmap]
    a0 = mean(x["judged"] for x, _ in pairs); a1 = mean(y["judged"] for _, y in pairs)
    b = sum(1 for x, y in pairs if x["judged"] and not y["judged"]); c = sum(1 for x, y in pairs if not x["judged"] and y["judged"])
    body += f"{lab} & {a0:.3f} & {a1:.3f} & {sd(a1 - a0)} & {b}/{c} & {pf(sign_p(b, c))} \\\\\n"
    macro(f"lme{p}Base", f3(a0)); macro(f"lme{p}Both", f3(a1)); macro(f"lme{p}P", pf(sign_p(b, c))); macro(f"lme{p}Diff", sd(a1 - a0))
    st0 = mean(x["strict"] for x, _ in pairs); st1 = mean(y["strict"] for _, y in pairs)
    macro(f"lme{p}StrictBase", f3(st0)); macro(f"lme{p}StrictBoth", f3(st1))
    if p == "gate":
        macro("lmeGateB", str(b)); macro("lmeGateC", str(c))
body += "\\bottomrule\n\\end{tabular}\n"
tex("lme", body)
# AURA vs. full context, in the F1+F2 run
cm = {r["qid"]: r for r in lo if r["policy"] == "context"}
gm = {r["qid"]: r for r in lo if r["policy"] == "gate"}
b = sum(1 for q in cm if cm[q]["judged"] and not gm[q]["judged"]); c = sum(1 for q in cm if not cm[q]["judged"] and gm[q]["judged"])
macro("lmeCtxGateP", pf(sign_p(b, c))); macro("lmeCtxGateB", str(b)); macro("lmeCtxGateC", str(c))
macro("lmeGateMemPrompts", f"{mean(r['prompts'] for r in lo if r['policy'] == 'gate'):.1f}")

# ---- counts straight from the real runs
def tot(rs_, key, pol=None):
    return sum(r[key] for r in rs_ if pol is None or r["policy"] == pol)
macro("realAutoLostBase", str(tot(runs1["baseline"], "fillerLost", "auto") + tot(runs2["baseline"], "fillerLost", "auto")))
macro("realAutoLostAll", str(sum(tot(rs_, "fillerLost", "auto") for rs_ in list(runs1.values()) + list(runs2.values()))))
macro("realGateLostAll", str(sum(tot(rs_, "fillerLost", "gate") for rs_ in list(runs1.values()) + list(runs2.values()))))
macro("realAutoRuns", str(sum(sum(1 for r in rs_ if r["policy"] == "auto") for rs_ in list(runs1.values()) + list(runs2.values()))))
macro("realGateRuns", str(sum(sum(1 for r in rs_ if r["policy"] == "gate") for rs_ in list(runs1.values()) + list(runs2.values()))))
for tag, runs in (("A", runs1), ("B", runs2)):
    macro(f"candMiss{tag}Base", str(tot(runs["baseline"], "candidateMissesOnChange")))
    macro(f"candMiss{tag}Both", str(tot(runs["both"], "candidateMissesOnChange")))
    macro(f"changeTurns{tag}", str(tot(runs["both"], "changeTurns")))
    macro(f"gateAccepted{tag}Base", str(tot(runs["baseline"], "correctAccepted", "gate")))
    macro(f"gateAccepted{tag}Both", str(tot(runs["both"], "correctAccepted", "gate")))
    macro(f"gatePrompts{tag}Base", str(tot(runs["baseline"], "prompts", "gate")))
    macro(f"gatePrompts{tag}Both", str(tot(runs["both"], "prompts", "gate")))
    macro(f"gateRejected{tag}", str(sum(tot(rs_, "correctRejected", "gate") + tot(rs_, "wrongAccepted", "gate") for rs_ in runs.values())))
macro("falseAutoTwoA", str(tot(runs1["f2"], "falseMem", "auto")))
macro("userTurnsPersona", f"{mean(r['userTurns'] for r in runs1['baseline']):.0f}")

# ---------------------------------------------------------------- macros file
with open(os.path.join(OUT, "numbers.tex"), "w", encoding="utf-8") as f:
    f.write("% generated by make_paper_assets.py -- do not edit\n")
    for k, v in sorted(MACROS.items()):
        kk = re.sub(r"[^A-Za-z]", lambda m: {"0": "Zero", "1": "One", "2": "Two", "3": "Three", "4": "Four", "5": "Five", "6": "Six", "7": "Seven", "8": "Eight", "9": "Nine"}.get(m.group(), ""), k)
        f.write(f"\\newcommand{{\\{kk}}}{{{v}}}\n")

# ---------------------------------------------------------------- figures
C = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
INK, INK2, GRID = "#0b0b0b", "#52514e", "#e4e3df"
plt.rcParams.update({"font.family": "serif", "font.serif": ["Times New Roman", "Times", "STIXGeneral", "DejaVu Serif"],
                     "mathtext.fontset": "stix", "font.size": 8, "axes.titlesize": 8.5, "axes.labelsize": 8,
                     "xtick.labelsize": 7.5, "ytick.labelsize": 7.5, "legend.fontsize": 7, "axes.edgecolor": INK2,
                     "axes.linewidth": 0.6, "savefig.dpi": 300})


def style(ax):
    ax.grid(True, axis="y", color=GRID, linewidth=0.5)
    ax.set_axisbelow(True)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)


def save(fig, name):
    for ext in ("pdf", "png"):
        fig.savefig(os.path.join(OUT, "figures", f"{name}.{ext}"), bbox_inches="tight")
    plt.close(fig)


def boot_ci(vals, B=4000, seed=7):
    import random
    rnd = random.Random(seed)
    n = len(vals)
    ms = sorted(sum(vals[rnd.randrange(n)] for _ in range(n)) / n for _ in range(B))
    return ms[int(0.025 * B)], ms[int(0.975 * B) - 1]


# Fig. 6: real Gemini, gate policy: F1 and stale facts per variant, two models (per-persona dots + mean)
fig, axes = plt.subplots(1, 2, figsize=(7.16, 2.4))
marks = ["o", "s", "^", "D"]
for ax, (metric, ylab, title) in zip(axes, (("f1", "F1 of the final memory", "(a) Accuracy"), ("stale", "stale facts / persona", "(b) Updates that were missed"))):
    for mi, (runs, vs, col, shift, lab) in enumerate(((runs1, V4, C[0], -0.12, "gemini-3.5-flash-lite"),
                                                      (runs2, ["baseline", "both"], C[1], 0.12, "gemini-3.1-flash-lite"))):
        xs, ms, los, his = [], [], [], []
        for v in vs:
            vals = [r[metric] for r in runs[v] if r["policy"] == "gate"]
            lo_, hi_ = boot_ci(vals)
            xs.append(V4.index(v) + shift); ms.append(mean(vals)); los.append(mean(vals) - lo_); his.append(hi_ - mean(vals))
        ax.errorbar(xs, ms, yerr=[los, his], color=col, marker=marks[mi], markersize=5, linestyle="--" if mi else "-",
                    linewidth=1.3, capsize=2, elinewidth=0.8, markeredgecolor="white", markeredgewidth=0.6, label=lab)
    ax.set_xticks(range(4)); ax.set_xticklabels(L4)
    ax.set_ylabel(ylab); ax.set_title(title, loc="left", color=INK)
    if metric == "stale":
        ax.set_ylim(bottom=-0.05)
    style(ax)
axes[0].legend(frameon=False, loc="lower right", labelcolor=INK)
fig.tight_layout(w_pad=1.5)
save(fig, "fig6_real")

# Fig. 7: LongMemEval accuracy per system, baseline vs F1+F2
fig, ax = plt.subplots(figsize=(3.5, 2.3))
w = 0.38
for k, (runs, col, lab, hatch) in enumerate(((lb, C[0], "baseline", ""), (lo, C[1], "F1+F2", "//"))):
    ys, cil, cih = [], [], []
    for p, _ in SYS:
        vals = [r["judged"] for r in runs if r["policy"] == p]
        m = mean(vals)
        se = 1.96 * math.sqrt(m * (1 - m) / len(vals))
        ys.append(m); cil.append(min(se, m)); cih.append(min(se, 1 - m))
    ax.bar([i + (k - 0.5) * w for i in range(len(SYS))], ys, w, yerr=[cil, cih], color=col, hatch=hatch, edgecolor="white",
           label=lab, capsize=1.5, error_kw={"elinewidth": 0.7})
ax.set_xticks(range(len(SYS)))
ax.set_xticklabels(["no\nmemory", "full\ncontext", "append", "auto", "gate"])
ax.set_ylabel("answers judged correct")
ax.set_ylim(0, 1)
style(ax)
ax.legend(frameon=False, loc="upper left", labelcolor=INK, ncol=2)
fig.tight_layout()
save(fig, "fig7_lme")
print("done:", len(MACROS), "macros")
