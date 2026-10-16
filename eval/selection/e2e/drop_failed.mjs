// Removes runs that contain a turn with an error (for example a quota error) from a pilot folder, so that the
// same run command redoes exactly those runs. Removed lines are kept in failed_*.jsonl (nothing is lost).
//   node eval/selection/e2e/drop_failed.mjs eval/results/selection/e2e/pilot
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[2];
if (!dir) { console.log("usage: node eval/selection/e2e/drop_failed.mjs <pilot folder>"); process.exit(1); }
const rd = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const turns = rd("turns.jsonl"), finals = rd("final_state.jsonl"), done = rd("done.jsonl");
const N = done[0]?.key.split("|").pop() ?? "N100";
const k = (o) => `${o.persona}|${o.cond}|${o.policy}`;
const bad = new Set(turns.filter((t) => t.error).map(k));
const dk = (d) => d.key.split("|").slice(0, 3).join("|");
const save = (f, rows) => fs.writeFileSync(path.join(dir, f), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
const app = (f, rows) => rows.length && fs.appendFileSync(path.join(dir, f), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
app("failed_turns.jsonl", turns.filter((t) => bad.has(k(t))));
app("failed_final_state.jsonl", finals.filter((t) => bad.has(k(t))));
app("failed_done.jsonl", done.filter((d) => bad.has(dk(d))));
save("turns.jsonl", turns.filter((t) => !bad.has(k(t))));
save("final_state.jsonl", finals.filter((t) => !bad.has(k(t))));
save("done.jsonl", done.filter((d) => !bad.has(dk(d))));
console.log(`removed ${bad.size} failed run(s): ${[...bad].join(", ") || "none"}; kept ${done.length - bad.size} finished run(s)`);
