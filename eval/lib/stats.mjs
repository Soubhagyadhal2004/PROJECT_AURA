// Summary statistics and file output.
import fs from "node:fs";
import path from "node:path";

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Half-width of a normal-approximation 95% confidence interval of the mean. */
export const ci95 = (xs) => (xs.length > 1 ? (1.96 * sd(xs)) / Math.sqrt(xs.length) : 0);

/** Wilson 95% interval for a proportion k/n, returned as [lo, hi]. */
export function wilson(k, n) {
  if (!n) return [NaN, NaN];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}

export const fmt = (x, digits = 3) => (Number.isFinite(x) ? x.toFixed(digits) : "n/a");
export const pm = (xs, digits = 3) => `${fmt(mean(xs), digits)} ± ${fmt(ci95(xs), digits)}`;

export function toCSV(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? "" : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

/** Reads CSV written by toCSV (quoted fields, doubled quotes). Returns objects keyed by the header. */
export function parseCSV(text) {
  const out = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) out.push(row); row = []; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  const [head = [], ...body] = out;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

export function mdTable(header, rows) {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

/** eval/results/<name>/<timestamp>/ */
export function resultDir(evalDir, name) {
  const t = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = `${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}`;
  const dir = path.join(evalDir, "results", name, stamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

// ---- resumable runs: rows are appended to a .jsonl checkpoint as each unit of work finishes ----

/** The output folder: the one given with --out (to resume a run), or a new timestamped one. */
export function outDir(evalDir, name, given) {
  if (given) {
    fs.mkdirSync(given, { recursive: true });
    return path.resolve(given);
  }
  return resultDir(evalDir, name);
}

export function appendRows(dir, file, rows) {
  if (rows.length) fs.appendFileSync(path.join(dir, file), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function readRows(dir, file) {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Stops starting new work after `seconds` (0 = no limit). */
export function budget(seconds) {
  const t0 = performance.now(); // real time, also when Date.now() is the simulated clock
  return () => seconds > 0 && (performance.now() - t0) / 1000 > seconds;
}
