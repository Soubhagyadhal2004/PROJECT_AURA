#!/usr/bin/env python3
"""Turn eval/results/selection/processed/summary.json into paper tables, number macros and a figure.

Writes paper/tables/sel_*.tex, paper/numbers_sel.tex and paper/figures/fig9_selection.pdf.
Usage (repository root): python3 eval/selection/make_paper_tables.py [--paper paper]
Every number in the selection section of the paper comes from here; nothing is typed by hand.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PAPER = os.path.join(ROOT, sys.argv[sys.argv.index("--paper") + 1]) if "--paper" in sys.argv else os.path.join(ROOT, "paper")
S = json.load(open(os.path.join(ROOT, "eval", "results", "selection", "processed", "summary.json")))
CFG = json.load(open(os.path.join(HERE, "config.json")))
MAIN = CFG["mainStoreSize"]
os.makedirs(os.path.join(PAPER, "tables"), exist_ok=True)
os.makedirs(os.path.join(PAPER, "figures"), exist_ok=True)

LABEL = {
    "default": "default", "nomin": "no minimum", "sentence": "per sentence", "adaptive": "adaptive (F2)",
    "sent_nomin": "per sentence + no min.", "cue_k": "$k{=}24$ on cue", "nomin_cue_k": "no min. + $k{=}24$ on cue",
    "sent_cue_k": "per sentence + $k{=}24$ on cue", "default_k24": "default, $k{=}24$", "nomin_k24": "no min., $k{=}24$",
    "sent_nomin_k24": "per sentence + no min., $k{=}24$",
    "bm25_k12": "BM25, $k{=}12$", "bm25_k24": "BM25, $k{=}24$", "rrf_k24": "fusion (RRF), $k{=}24$",
    "sent_rrf_k24": "per sentence + fusion, $k{=}24$",
}
DESC = {  # sentences, floor, k
    c: ("yes" if v["sentences"] else "no", "0.25" if v["floor"] else "--", f"{v['k']}" if v["k"] == v["kCue"] else f"{v['k']}/{v['kCue']}")
    for c, v in CFG["conditions"].items()
}
ROLE = {"default": "in AURA", "nomin": "in AURA", "sentence": "in AURA", "adaptive": "in AURA",
        "sent_nomin": "ablation", "cue_k": "ablation", "nomin_cue_k": "ablation", "sent_cue_k": "ablation",
        "default_k24": "budget", "nomin_k24": "budget", "sent_nomin_k24": "budget",
        "bm25_k12": "lexical", "bm25_k24": "lexical", "rrf_k24": "fused", "sent_rrf_k24": "fused"}


def byn(N, c):
    return next(d for d in S["byN"] if d["N"] == N and d["cond"] == c)


def brk(g, c):
    return next(d for d in S["breakdown"] if d["group"] == g and d["cond"] == c)


def f3(x):
    return f"{x:.3f}"


def pf(p):
    return r"\ensuremath{<}0.001" if p < 0.001 else f"{p:.3f}"


# --- table: all conditions at N = 350 -------------------------------------------------------------
lines = [r"\begin{tabular}{llcccccc}", r"\toprule",
         r"condition & role & sent. & floor & $k$ & reach. [95\% CI] & cand. & single / mixed / cue-free \\", r"\midrule"]
for c in CFG["conditions"]:
    d = byn(MAIN, c)
    s, fl, k = DESC[c]
    lines.append(f"{LABEL[c]} & {ROLE[c]} & {s} & {fl} & {k} & {f3(d['cr'])} [{f3(d['lo'])}, {f3(d['hi'])}] & {d['ncand']:.1f} & "
                 f"{f3(brk('single', c)['cr'])} / {f3(brk('mixed', c)['cr'])} / {f3(brk('cue-free', c)['cr'])} \\\\")
RRP0 = os.path.join(ROOT, "eval", "results", "selection", "processed", "rerank_summary.json")
if os.path.exists(RRP0):
    R0 = json.load(open(RRP0))
    lines.append(f"cross-encoder rerank of top 50, $k{{=}}24$ & reranker & no & -- & 24 & {f3(R0['rerank'][0])} [{f3(R0['rerank'][1])}, {f3(R0['rerank'][2])}] & {R0['rerankCand']:.1f} & "
                 f"{f3(R0['rerank_single'])} / {f3(R0['rerank_mixed'])} / {f3(R0['rerank_cue-free'])} \\\\")
lines += [r"\bottomrule", r"\end{tabular}"]
open(os.path.join(PAPER, "tables", "sel_main.tex"), "w").write("\n".join(lines) + "\n")

# --- table: pre-registered comparisons -------------------------------------------------------------
NAMES = {"adaptive vs default": "adaptive $-$ default", "adaptive vs nomin_k24": "adaptive $-$ no min., $k{=}24$",
         "sentence vs default": "per sentence $-$ default", "nomin vs default": "no minimum $-$ default",
         "cue_k vs default": "$k{=}24$ on cue $-$ default", "adaptive: cue-free minus cue": "adaptive: cue-free $-$ cue messages"}
lines = [r"\begin{tabular}{lccc}", r"\toprule", r"comparison ($N=350$) & difference [95\% CI] & personas $+/-/=$ & Holm $p$ \\", r"\midrule"]
for d in S["comparisons"]:
    lines.append(f"{NAMES[d['comparison']]} & {d['diff']:+.3f} [{d['lo']:+.3f}, {d['hi']:+.3f}] & {d['pos']}/{d['neg']}/{d['ties']} & {pf(d['p_holm'])} \\\\")
lines += [r"\bottomrule", r"\end{tabular}"]
open(os.path.join(PAPER, "tables", "sel_comp.tex"), "w").write("\n".join(lines) + "\n")

# --- table: store size (appendix) ------------------------------------------------------------------
lines = [r"\begin{tabular}{l" + "c" * len(CFG["storeSizes"]) + "}", r"\toprule",
         "condition & " + " & ".join(f"$N={N}$" for N in CFG["storeSizes"]) + r" \\", r"\midrule"]
for c in CFG["conditions"]:
    lines.append(LABEL[c] + " & " + " & ".join(f3(byn(N, c)["cr"]) for N in CFG["storeSizes"]) + r" \\")
lines.append(r"\midrule")
for key, lab in [("R12_whole_nofloor", "target in top 12, no floor"), ("R24_whole_nofloor", "target in top 24, no floor"),
                 ("lost_to_floor", "in top 12 but below 0.25"), ("missed_by_all", "missed by all 11 conditions")]:
    lines.append(lab + " & " + " & ".join(f3(next(d for d in S["diagnostics"] if d["N"] == N)[key]) for N in CFG["storeSizes"]) + r" \\")
lines += [r"\bottomrule", r"\end{tabular}"]
open(os.path.join(PAPER, "tables", "sel_bysize.tex"), "w").write("\n".join(lines) + "\n")

# --- macros -----------------------------------------------------------------------------------------
def mac(name, val):
    return f"\\newcommand{{\\{name}}}{{{val}}}\n"


comp = {d["comparison"]: d for d in S["comparisons"]}
ex = {d["comparison"]: d for d in S["exploratory"]}
diag = {d["N"]: d for d in S["diagnostics"]}
m = ""
m += mac("selPersonas", CFG["personas"]) + mac("selEvents", S["checks"]["eventsPerPersonaPerN"]) + mac("selRows", f"{S['checks']['rows']:,}".replace(",", "{,}"))
m += mac("selEventsTotal", f"{CFG['personas'] * S['checks']['eventsPerPersonaPerN']:,}".replace(",", "{,}"))
for c, key in [("default", "Default"), ("nomin", "Nomin"), ("sentence", "Sentence"), ("adaptive", "Adaptive"), ("sent_nomin", "SentNomin"),
               ("cue_k", "CueK"), ("default_k24", "DefaultKk"), ("nomin_k24", "NominKk"), ("sent_nomin_k24", "SentNominKk"), ("nomin_cue_k", "NominCueK")]:
    d = byn(MAIN, c)
    m += mac(f"sel{key}", f3(d["cr"])) + mac(f"sel{key}Lo", f3(d["lo"])) + mac(f"sel{key}Hi", f3(d["hi"])) + mac(f"sel{key}Cand", f"{d['ncand']:.1f}")
    for g, gk in [("single", "Single"), ("mixed", "Mixed"), ("cue", "Cue"), ("cue-free", "Free")]:
        b = brk(g, c)
        m += mac(f"sel{key}{gk}", f3(b["cr"])) + mac(f"sel{key}{gk}Cand", f"{b['ncand']:.1f}")
for name, key in [("adaptive vs default", "AdaVsDef"), ("adaptive vs nomin_k24", "AdaVsNk"), ("sentence vs default", "SentVsDef"),
                  ("nomin vs default", "NominVsDef"), ("cue_k vs default", "CueVsDef"), ("adaptive: cue-free minus cue", "AdaFreeVsCue")]:
    d = comp[name]
    m += mac(f"selC{key}", f"{d['diff']:+.3f}") + mac(f"selC{key}Lo", f"{d['lo']:+.3f}") + mac(f"selC{key}Hi", f"{d['hi']:+.3f}") + mac(f"selC{key}P", pf(d["p_holm"]))
    m += mac(f"selC{key}Pos", d["pos"]) + mac(f"selC{key}Neg", d["neg"])
for name, key in [("sent_nomin_k24 vs nomin_k24", "SnkVsNk"), ("adaptive vs sent_nomin", "AdaVsSn"), ("mixed: adaptive vs nomin_k24", "MixAdaVsNk"),
                  ("cue-free: adaptive vs nomin_k24", "FreeAdaVsNk"), ("nomin_k24 vs nomin", "NkVsNomin")]:
    d = ex[name]
    m += mac(f"selE{key}", f"{d['diff']:+.3f}") + mac(f"selE{key}Lo", f"{d['lo']:+.3f}") + mac(f"selE{key}Hi", f"{d['hi']:+.3f}") + mac(f"selE{key}P", pf(d["p"]))
for c, key in [("bm25_k12", "BmTwelve"), ("bm25_k24", "BmTwentyfour"), ("rrf_k24", "Rrf"), ("sent_rrf_k24", "SentRrf")]:
    if c in CFG["conditions"]:
        d = byn(MAIN, c)
        m += mac(f"sel{key}", f3(d["cr"])) + mac(f"sel{key}Lo", f3(d["lo"])) + mac(f"sel{key}Hi", f3(d["hi"])) + mac(f"sel{key}Cand", f"{d['ncand']:.1f}")
        for g, gk in [("single", "Single"), ("mixed", "Mixed"), ("cue-free", "Free")]:
            m += mac(f"sel{key}{gk}", f3(brk(g, c)["cr"]))
for d, key in zip(S.get("baselines", []), ["BmVsDef", "BmVsNk", "RrfVsNk", "SentRrfVsSnk"]):
    m += mac(f"selB{key}", f"{d['diff']:+.3f}") + mac(f"selB{key}Lo", f"{d['lo']:+.3f}") + mac(f"selB{key}Hi", f"{d['hi']:+.3f}") + mac(f"selB{key}P", pf(d["p_holm"]))
    m += mac(f"selB{key}Pos", d["pos"]) + mac(f"selB{key}Neg", d["neg"])
m += mac("selNConditions", len(CFG["conditions"]))
# cross-encoder reranker (run-rerank.mjs; run on a machine with internet access), N = 350 only
RRP = os.path.join(ROOT, "eval", "results", "selection", "processed", "rerank_summary.json")
if os.path.exists(RRP):
    R = json.load(open(RRP))
    m += mac("selRerank", f3(R["rerank"][0])) + mac("selRerankLo", f3(R["rerank"][1])) + mac("selRerankHi", f3(R["rerank"][2]))
    m += mac("selRerankCand", f"{R['rerankCand']:.1f}") + mac("selRerankPool", f3(R["inPool"]))
    m += mac("selRerankSingle", f3(R["rerank_single"])) + mac("selRerankMixed", f3(R["rerank_mixed"])) + mac("selRerankFree", f3(R["rerank_cue-free"]))
    m += mac("selMissedAllRerankPct", f"{100 * R['missedByAllInclRerank']:.1f}")
    for c, key in [("default", "Def"), ("nomin_k24", "Nk"), ("adaptive", "Ada"), ("sent_nomin_k24", "Snk"), ("rrf_k24", "Rrf")]:
        d = R[f"rerank vs {c}"]
        m += mac(f"selR{key}", f"{d['diff']:+.3f}") + mac(f"selR{key}Lo", f"{d['lo']:+.3f}") + mac(f"selR{key}Hi", f"{d['hi']:+.3f}")
        m += mac(f"selR{key}P", pf(d["p_holm"])) + mac(f"selR{key}Pos", d["pos"]) + mac(f"selR{key}Neg", d["neg"])
m += mac("selCandSaving", f"{100 * (1 - byn(MAIN, 'adaptive')['ncand'] / byn(MAIN, 'nomin_k24')['ncand']):.0f}")
m += mac("selMissedAll", f3(diag[MAIN]["missed_by_all"])) + mac("selMissedAllPct", f"{100 * diag[MAIN]['missed_by_all']:.1f}")
m += mac("selLostFloor", f3(diag[MAIN]["lost_to_floor"])) + mac("selRtwelve", f3(diag[MAIN]["R12_whole_nofloor"])) + mac("selRtwentyfour", f3(diag[MAIN]["R24_whole_nofloor"]))
m += mac("selDefaultZero", f3(byn(0, "default")["cr"])) + mac("selDefaultTwentyfive", f3(byn(25, "default")["cr"]))
m += mac("selRecentZero", f3(diag[0]["target_in_recent8"])) + mac("selViaRecentZero", f3(diag[0]["default_via_recent_only"]))
m += mac("selMergedMax", S["stores"][str(MAIN)]["mergedMax"])
slot = {d["slot"]: d for d in S["bySlot"]}
m += mac("selCarDefault", f3(slot["car"]["default"])) + mac("selCarAdaptive", f3(slot["car"]["adaptive"])) + mac("selEmployerDefault", f3(slot["employer"]["default"]))
open(os.path.join(PAPER, "numbers_sel.tex"), "w").write("% generated by eval/selection/make_paper_tables.py; do not edit\n" + m)

# --- figure -----------------------------------------------------------------------------------------
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams.update({"font.size": 8, "font.family": "serif", "axes.spines.top": False, "axes.spines.right": False})
COL = {"default": "#2a78d6", "nomin": "#eb6834", "sentence": "#1baf7a", "adaptive": "#eda100", "nomin_k24": "#e87ba4"}
MK = {"default": "o", "nomin": "s", "sentence": "^", "adaptive": "D", "nomin_k24": "v"}
fig, ax = plt.subplots(1, 2, figsize=(7.0, 2.6))
Ns = CFG["storeSizes"]
for c in COL:
    ys = [byn(N, c)["cr"] for N in Ns]
    lo = [byn(N, c)["lo"] for N in Ns]
    hi = [byn(N, c)["hi"] for N in Ns]
    ax[0].plot(Ns, ys, color=COL[c], marker=MK[c], ms=4, lw=1.6, label=LABEL[c].replace("$k{=}24$", "k=24"))
    ax[0].fill_between(Ns, lo, hi, color=COL[c], alpha=0.15, lw=0)
ax[0].set_xlabel("unrelated memories in the store $N$")
ax[0].set_ylabel("target in the extractor's prompt")
ax[0].set_title("(a) Reachability by store size", fontsize=8)
ax[0].set_ylim(0.40, 1.01)
ax[0].grid(axis="y", color="#e5e5e5", lw=0.6)
ax[0].legend(frameon=False, fontsize=6.5, loc="lower right", ncol=2)
for c in CFG["conditions"]:
    d = byn(MAIN, c)
    color = COL.get(c, "#8a8a8a")
    mk = MK.get(c, "x" if ROLE.get(c) in ("lexical", "fused") else "o")
    ax[1].errorbar(d["ncand"], d["cr"], yerr=[[d["cr"] - d["lo"]], [d["hi"] - d["cr"]]], fmt=mk, color=color, ms=5 if c in COL else 4, capsize=0, lw=1)
    off = {"default": (4, -10), "default_k24": (4, 2), "cue_k": (4, -9), "nomin": (6, -3), "sentence": (-14, -13), "sent_cue_k": (-30, 7),
           "sent_nomin": (-6, 6), "adaptive": (-34, 6), "nomin_cue_k": (4, -10), "nomin_k24": (-62, -1), "sent_nomin_k24": (-108, 4),
           "rrf_k24": (-72, -11), "sent_rrf_k24": (5, -1), "bm25_k12": (-14, -12), "bm25_k24": (5, -4)}.get(c, (4, 2))
    lab = LABEL[c].replace("{=}", "=").replace("$", "")
    right = {"sent_nomin_k24": 0.886, "sent_rrf_k24": 0.868, "nomin_k24": 0.850, "rrf_k24": 0.832}
    if c in right:
        ax[1].annotate(lab, (d["ncand"], d["cr"]), xytext=(33.2, right[c]), textcoords="data", fontsize=5.6, color="#333333", va="center",
                       arrowprops=dict(arrowstyle="-", color="#9a9a9a", lw=0.5))
    else:
        ax[1].annotate(lab, (d["ncand"], d["cr"]), textcoords="offset points", xytext=off, fontsize=5.6, color="#333333")
ax[1].set_xlabel(f"mean candidates shown ($N={MAIN}$)")
ax[1].set_xlim(11, 45)
ax[1].set_ylabel("target in the extractor's prompt")
ax[1].set_title("(b) Reachability against candidates shown (x: BM25 / fused)", fontsize=8)
ax[1].grid(color="#e5e5e5", lw=0.6)
fig.tight_layout()
fig.savefig(os.path.join(PAPER, "figures", "fig9_selection.pdf"))
fig.savefig(os.path.join(PAPER, "figures", "fig9_selection.png"), dpi=200)
print("written")
