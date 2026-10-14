"""Figures for the paper, drawn from the result folders (needs Python 3 with matplotlib).

    python eval/make_figures.py                      uses the run folders listed below
    python eval/make_figures.py --out eval/results/figures

Every number plotted is read from a summary.csv / threshold.csv written by the experiment scripts.
Series are told apart by colour AND marker AND line style, so the figures also work in grayscale print.
"""
import argparse
import csv
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")
RUNS = {
    "gate": os.path.join(RES, "gate-sim", "v2-20261013"),
    "gate_fix": os.path.join(RES, "gate-sim", "v2-20261013-extract-nomin"),
    "retrieval": os.path.join(RES, "retrieval", "v2-20261013"),
    "reach": os.path.join(RES, "reachability", "v2-20261013"),
}

# reference categorical palette (validated: adjacent CVD dE >= 9.1, normal-vision >= 22.9 on #fcfcfb)
C = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
INK, INK2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
POLICY = {  # label, colour, marker, line style
    "append": ("append-only", C[0], "s", (0, (1, 1.5))),
    "auto": ("auto-apply", C[1], "o", "-"),
    "gate": ("gate changes (AURA)", C[2], "^", "--"),
    "gateAll": ("gate all", C[3], "D", "-."),
}

plt.rcParams.update({
    "font.family": "serif",
    "font.serif": ["Times New Roman", "Times", "STIXGeneral", "DejaVu Serif"],
    "mathtext.fontset": "stix",
    "font.size": 8,
    "axes.titlesize": 8.5,
    "axes.labelsize": 8,
    "xtick.labelsize": 7.5,
    "ytick.labelsize": 7.5,
    "legend.fontsize": 7,
    "axes.edgecolor": INK2,
    "axes.labelcolor": INK,
    "xtick.color": INK2,
    "ytick.color": INK2,
    "axes.linewidth": 0.6,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
    "savefig.dpi": 300,
})


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def style(ax):
    ax.grid(True, color=GRID, linewidth=0.5)
    ax.set_axisbelow(True)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)


def save(fig, out, name):
    for ext in ("pdf", "png"):
        fig.savefig(os.path.join(out, f"{name}.{ext}"), bbox_inches="tight")
    plt.close(fig)
    print("wrote", name)


def fig_policies(out):
    """Fig. 1: F1, true facts destroyed, review prompts vs. extractor error rate."""
    rows = [r for r in read(os.path.join(RUNS["gate"], "summary.csv")) if r["sweep"] == "error"]
    es = sorted({float(r["e"]) for r in rows})
    fig, axes = plt.subplots(1, 3, figsize=(7.16, 2.15))
    panels = [
        ("f1_mean", "f1_ci95", "F1 of the final memory", "(a) Memory accuracy"),
        ("destroyed", None, "true facts destroyed / persona", "(b) Wrong changes that got through"),
        ("promptsPer100Turns_mean", "promptsPer100Turns_ci95", "review prompts / 100 turns", "(c) User burden"),
    ]
    for ax, (key, ci, ylabel, title) in zip(axes, panels):
        for p, (label, col, mk, ls) in POLICY.items():
            sel = sorted((r for r in rows if r["policy"] == p), key=lambda r: float(r["e"]))
            if key == "destroyed":
                ys = [float(r["destroyed_mean"]) + float(r["fillerLost_mean"]) for r in sel]
            else:
                ys = [float(r[key]) for r in sel]
            ax.plot(es, ys, color=col, marker=mk, markersize=4, linestyle=ls, linewidth=1.4, label=label,
                    markeredgecolor="white", markeredgewidth=0.6)
            if ci:
                lo = [y - float(r[ci]) for y, r in zip(ys, sel)]
                hi = [y + float(r[ci]) for y, r in zip(ys, sel)]
                ax.fill_between(es, lo, hi, color=col, alpha=0.12, linewidth=0)
        ax.set_xlabel("extractor error rate $e$")
        ax.set_ylabel(ylabel)
        ax.set_title(title, loc="left", color=INK)
        ax.set_xticks(es)
        style(ax)
    axes[0].set_ylim(0.45, 1.0)
    axes[1].set_ylim(bottom=0)
    axes[2].set_ylim(bottom=0)
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", ncol=4, frameon=False, bbox_to_anchor=(0.5, 1.08), labelcolor=INK)
    fig.tight_layout(w_pad=1.2)
    save(fig, out, "fig1_policies")


def fig_fix(out):
    """Fig. 2: stale facts left active, AURA as shipped vs. candidate selection without the minimum score."""
    base = [r for r in read(os.path.join(RUNS["gate"], "summary.csv")) if r["sweep"] == "error"]
    fix = [r for r in read(os.path.join(RUNS["gate_fix"], "summary.csv")) if r["sweep"] == "error"]
    es = sorted({float(r["e"]) for r in base})
    fig, ax = plt.subplots(figsize=(3.5, 2.3))
    for p, col, mk in (("auto", C[1], "o"), ("gate", C[2], "^")):
        for rows, ls, tag in ((base, "--", "as shipped"), (fix, "-", "no min. score")):
            sel = sorted((r for r in rows if r["policy"] == p), key=lambda r: float(r["e"]))
            ys = [float(r["stale_mean"]) for r in sel]
            ci = [float(r["stale_ci95"]) for r in sel]
            ax.errorbar(es, ys, yerr=ci, color=col, marker=mk, markersize=4, linestyle=ls, linewidth=1.3, capsize=2,
                        elinewidth=0.7, markeredgecolor="white", markeredgewidth=0.6, label=f"{POLICY[p][0]}, {tag}")
            ax.annotate(f"{POLICY[p][0].split(' (')[0]}, {tag}", (es[-1], ys[-1]), xytext=(4, 0), textcoords="offset points",
                        va="center", fontsize=6.5, color=INK2)
    ax.set_xlabel("extractor error rate $e$")
    ax.set_ylabel("stale facts still active / persona")
    ax.set_xticks(es)
    ax.set_xlim(es[0] - 0.01, es[-1] + 0.16)
    ax.set_ylim(bottom=0)
    style(ax)
    # every line carries a direct label at its end; colour = policy, dashed = as shipped, solid = no minimum score
    fig.tight_layout()
    save(fig, out, "fig2_candidate_fix")


def fig_reach(out):
    """Fig. 3: share of change requests whose target memory is shown to the extractor."""
    rows = [r for r in read(os.path.join(RUNS["reach"], "summary.csv")) if r["kind"] == "all"]
    rows.sort(key=lambda r: float(r["size"]))
    ns = [float(r["size"]) for r in rows]
    fig, ax = plt.subplots(figsize=(3.5, 2.2))
    series = (
        ("reachable", "lo", "hi", "AURA (search min. score 0.25)", C[1], "o", "--"),
        ("reachableNoMin", "lo2", "hi2", "12 best matches, no minimum", C[0], "s", "-"),
    )
    for key, lo, hi, label, col, mk, ls in series:
        ys = [float(r[key]) for r in rows]
        ax.plot(ns, ys, color=col, marker=mk, markersize=4, linestyle=ls, linewidth=1.4, label=label,
                markeredgecolor="white", markeredgewidth=0.6)
        ax.fill_between(ns, [float(r[lo]) for r in rows], [float(r[hi]) for r in rows], color=col, alpha=0.15, linewidth=0)
        ax.annotate(f"{ys[-1]:.2f}", (ns[-1], ys[-1]), xytext=(4, 0), textcoords="offset points", va="center", fontsize=7, color=INK)
    ax.set_xlabel("unrelated memories in the store $N$")
    ax.set_ylabel("change target shown to extractor")
    ax.set_ylim(0.5, 1.02)
    ax.set_xlim(-10, max(ns) + 40)
    style(ax)
    ax.legend(frameon=False, loc="lower left", labelcolor=INK)
    fig.tight_layout()
    save(fig, out, "fig3_reachability")


def fig_threshold(out):
    """Fig. 4: retrieval trade-off of the minimum score: found (stored facts) vs. noise (never-stated questions)."""
    rows = read(os.path.join(RUNS["retrieval"], "threshold.csv"))
    sizes = sorted({float(r["size"]) for r in rows})
    fig, ax = plt.subplots(figsize=(3.5, 2.4))
    marks = ["o", "s", "^"]
    styles = ["-", "--", "-."]
    for i, n in enumerate(sizes):
        sel = sorted((r for r in rows if float(r["size"]) == n), key=lambda r: float(r["threshold"]))
        xs = [float(r["noise"]) for r in sel]
        ys = [float(r["found"]) for r in sel]
        ax.plot(xs, ys, color=C[i], marker=marks[i], markersize=4, linestyle=styles[i], linewidth=1.3,
                label=f"$N$ = {int(n)}", markeredgecolor="white", markeredgewidth=0.6)
        for r, x, y in zip(sel, xs, ys):
            t = float(r["threshold"])
            if t == 0.25:
                ax.scatter([x], [y], s=55, facecolors="none", edgecolors=INK, linewidths=0.8, zorder=5)
            if i == len(sizes) - 1:
                # the points for 0 and 0.1 are close together: put the 0 label to the right of its point
                ax.annotate(f"{t:g}", (x, y), xytext=(5, -2) if t == 0 else (3, -8), textcoords="offset points", fontsize=6, color=INK2)
    ax.set_xlabel("noise: never-stated questions that return memories")
    ax.set_ylabel("found: right fact in top 6")
    ax.set_xlim(-0.02, 1.07)
    ax.set_ylim(0.45, 1.02)
    style(ax)
    ax.legend(frameon=False, loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=3, labelcolor=INK)
    ax.text(0.99, 0.03, "numbers: minimum score ($N$ = 350); circled: AURA's 0.25", transform=ax.transAxes, ha="right", va="bottom", fontsize=6.3, color=INK2)
    fig.tight_layout()
    save(fig, out, "fig4_threshold_tradeoff")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(RES, "figures"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    fig_policies(args.out)
    fig_fix(args.out)
    fig_reach(args.out)
    fig_threshold(args.out)
