// Re-scores a finished real-Gemini run from its saved memories, with the current eval/lib/loose.mjs,
// and prepares (or reads back) a sheet for checking the automatic labels by hand.
// No database and no Gemini requests.
//
//   npm run eval:rescore -- <run folder>
//
// Writes into the run folder:
//   rescored.md / rescored.csv   the summary with the current scoring rules
//   annotation.csv               one row per memory the assistant still believes (status active);
//                                fill in human_label (created once; never overwritten)
//   annotation-guide.md          what each user said, the truth at the end, and the label definitions
// Once human_label is filled in for some rows, it also reports agreement (Cohen's kappa).
import fs from "node:fs";
import path from "node:path";
import { makePersona, isFiller, SLOT } from "./lib/scenarios.mjs";
import { classify, mentions } from "./lib/loose.mjs";
import { mean, ci95, fmt, toCSV, mdTable, parseCSV } from "./lib/stats.mjs";

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, "memories.jsonl"))) {
  console.log("Usage: npm run eval:rescore -- <folder of a real-gemini run, containing memories.jsonl>");
  process.exit(1);
}
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
const runs = read("runs.jsonl");
const mems = read("memories.jsonl");
const LABELS = ["true", "ended", "stale", "false", "hypothetical", "third-party", "other"];

// ---- re-score ----
const rows = [];
const annot = [];
for (const m of mems) {
  const persona = makePersona(m.seed, m.persona);
  const gold = persona.finalGold;
  const run = runs.find((r) => r.policy === m.policy && r.seed === m.seed && r.persona === m.persona) || {};
  const active = m.memories.filter((x) => x.status === "active" && !isFiller(x.content));
  const cls = active.map((x) => classify(x.content, gold));
  const n = (c) => cls.filter((x) => x === c).length;
  const goldPairs = [...gold.state].filter(([, v]) => v != null);
  const correct = goldPairs.filter(([k, v]) => active.some((x) => mentions(x.content).some((mm) => mm.slot === k && mm.value === v))).length;
  const scored = n("true") + n("ended") + n("stale") + n("false") + n("hypothetical");
  const precision = scored ? (n("true") + n("ended")) / scored : 1;
  const recall = goldPairs.length ? correct / goldPairs.length : 1;
  const destroyed = m.memories.filter((x) => x.status !== "active" && ["true"].includes(classify(x.content, gold))).length;
  rows.push({
    policy: m.policy, seed: m.seed, persona: m.persona,
    goldFacts: goldPairs.length, correct, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    true: n("true"), ended: n("ended"), stale: n("stale"), false: n("false"), hypothetical: n("hypothetical"), thirdParty: n("third-party"), other: n("other"),
    destroyed,
    prompts: run.prompts ?? null, userTurns: run.userTurns ?? null,
    proposalsJudgedRightDuringRun: run.correctAccepted + run.correctRejected, proposalsJudgedWrongDuringRun: run.wrongAccepted + run.wrongRejected,
    requests: run.requests ?? null, promptTokens: run.promptTokens ?? null, outputTokens: run.outputTokens ?? null, meanLatencyMs: run.meanLatencyMs ?? null,
  });
  active.forEach((x, i) => annot.push({ run: `${m.policy}-${m.seed}-${m.persona}`, policy: m.policy, seed: m.seed, persona: m.persona, memory_id: x.id, content: x.content, auto_label: cls[i], human_label: "", notes: "" }));
}
fs.writeFileSync(path.join(dir, "rescored.csv"), toCSV(rows));
fs.writeFileSync(path.join(dir, "rescored.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
fs.writeFileSync(path.join(dir, "labels.jsonl"), annot.map((r) => JSON.stringify({ run: r.run, policy: r.policy, memory_id: r.memory_id, content: r.content, auto_label: r.auto_label })).join("\n") + "\n");

const policies = [...new Set(rows.map((r) => r.policy))];
const md = [];
md.push(`# Re-scored: ${cfg.extractor}, ${cfg.personas} personas x ${cfg.seeds} seed(s), candidate selection ${cfg.extractMinScore}`);
md.push(``);
md.push(`Scoring rules of ${new Date().toISOString().slice(0, 10)} (eval/lib/loose.mjs): precision = (true + ended) / (true + ended + stale + false + hypothetical); ` +
  `third-party and other are not counted. Destroyed = a memory that is still true but no longer active.`);
md.push(``);
md.push(mdTable(
  ["policy", "n", "F1", "precision", "recall", "ended", "stale", "false", "hypothetical", "third-party", "destroyed", "prompts / 100 turns", "cards judged right / wrong during the run"],
  policies.map((p) => {
    const sel = rows.filter((r) => r.policy === p);
    const s = (k) => sel.reduce((t, r) => t + (r[k] || 0), 0);
    return [p, sel.length, `${fmt(mean(sel.map((r) => r.f1)))} ± ${fmt(ci95(sel.map((r) => r.f1)))}`, fmt(mean(sel.map((r) => r.precision))), fmt(mean(sel.map((r) => r.recall))),
      fmt(mean(sel.map((r) => r.ended)), 2), fmt(mean(sel.map((r) => r.stale)), 2), fmt(mean(sel.map((r) => r.false)), 2), fmt(mean(sel.map((r) => r.hypothetical)), 2), fmt(mean(sel.map((r) => r.thirdParty)), 2),
      s("destroyed"), fmt(mean(sel.map((r) => (100 * r.prompts) / r.userTurns)), 1), `${s("proposalsJudgedRightDuringRun")} / ${s("proposalsJudgedWrongDuringRun")}`];
  })
));
md.push(``);
const wrongCards = rows.reduce((t, r) => t + r.proposalsJudgedWrongDuringRun, 0);
if (wrongCards) {
  md.push(`Note: the simulated user decided the review cards during the run with the scoring rules in place at that time. ` +
    `${wrongCards} card(s) were judged wrong then; if the current rules would accept them, the gate result is pessimistic until the run is repeated.`);
  md.push(``);
}
md.push(`Active memories that are not plainly true:`);
md.push(``);
for (const a of annot.filter((x) => x.auto_label !== "true")) md.push(`- ${a.run}: [${a.auto_label}] ${a.content}`);
fs.writeFileSync(path.join(dir, "rescored.md"), md.join("\n") + "\n");

// ---- annotation sheet (created once, never overwritten) ----
const sheet = path.join(dir, "annotation.csv");
if (!fs.existsSync(sheet)) {
  fs.writeFileSync(sheet, toCSV(annot));
  const guide = [];
  guide.push(`# Checking the automatic labels by hand`);
  guide.push(``);
  guide.push(`Open annotation.csv. For each row, read the memory, look up that persona below, and write one label in human_label ` +
    `(without looking at auto_label first if you can). Ideally a second person labels a copy independently.`);
  guide.push(``);
  guide.push(`| label | use when the memory... |`);
  guide.push(`|---|---|`);
  guide.push(`| true | states something that is true about the user at the end |`);
  guide.push(`| ended | correctly says that a fact the user retired is over ("finished the Lotus project") |`);
  guide.push(`| stale | states something the user said earlier that is no longer true, or something the user asked to forget |`);
  guide.push(`| false | states something the user never said about themselves (misread, invented) |`);
  guide.push(`| hypothetical | keeps a hypothetical or a maybe as a memory ("if the user had a cat...") |`);
  guide.push(`| third-party | is a fact about someone else the user mentioned (allowed) |`);
  guide.push(`| other | none of the above (write why in notes) |`);
  guide.push(``);
  for (const key of [...new Set(mems.map((m) => `${m.seed}-${m.persona}`))]) {
    const [seed, idx] = key.split("-").map(Number);
    const p = makePersona(seed, idx);
    guide.push(`## Persona ${key}`);
    guide.push(``);
    p.sessions.forEach((turns, s) => {
      guide.push(`Session ${s + 1}: ` + turns.map((t) => (t.assistantFirst ? `(AURA: "${t.assistantFirst}") ` : "") + `"${t.user}"`).join(" "));
    });
    guide.push(``);
    const truth = [...p.finalGold.state].map(([k, v]) => (v == null ? `${k}: no longer true` : `${k}: ${v}`));
    guide.push(`Truth at the end: ${truth.join("; ")}.` + (p.finalGold.forgotten.length ? ` Asked to forget: ${p.finalGold.forgotten.map((f) => `${f.slot} (${f.value})`).join(", ")}.` : ""));
    guide.push(``);
  }
  fs.writeFileSync(path.join(dir, "annotation-guide.md"), guide.join("\n") + "\n");
}

// ---- agreement, once labels are filled in ----
// Excel turns the word "true" into TRUE when a CSV is saved, so both columns are compared in lower case
const labelled = parseCSV(fs.readFileSync(sheet, "utf8")).map((r) => ({ ...r, auto_label: String(r.auto_label ?? "").trim().toLowerCase() })).filter((r) => r.human_label.trim());
if (labelled.length) {
  const norm = (s) => s.trim().toLowerCase();
  const agree = labelled.filter((r) => norm(r.human_label) === r.auto_label).length;
  const po = agree / labelled.length;
  const pe = LABELS.reduce((t, l) => t + (labelled.filter((r) => norm(r.human_label) === l).length / labelled.length) * (labelled.filter((r) => r.auto_label === l).length / labelled.length), 0);
  const kappa = pe < 1 ? (po - pe) / (1 - pe) : 1;
  const lines = [`# Human vs. automatic labels`, ``, `${labelled.length} labelled rows; agreement ${agree} (${fmt(po)}); Cohen's kappa ${fmt(kappa)}.`, ``, `Disagreements:`, ``];
  for (const r of labelled.filter((x) => norm(x.human_label) !== x.auto_label)) lines.push(`- ${r.run} #${r.memory_id}: auto ${r.auto_label}, human ${norm(r.human_label)} | ${r.content}${r.notes ? ` (${r.notes})` : ""}`);
  fs.writeFileSync(path.join(dir, "agreement.md"), lines.join("\n") + "\n");
  console.log(`Agreement: ${agree} of ${labelled.length}, kappa ${fmt(kappa)} -> agreement.md`);
}
console.log(`Re-scored ${rows.length} persona runs -> ${path.join(dir, "rescored.md")}`);
console.log(fs.existsSync(sheet) ? `Annotation sheet: ${sheet} (${annot.length} rows)` : "");
