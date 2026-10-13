// Turns uploaded files into something Gemini can read.
//   PDF and images are sent to Gemini as they are (it reads them, including scans).
//   Word, PowerPoint and Excel files are ZIP archives of XML: their text is pulled out here,
//   without extra dependencies. Plain-text formats are decoded.
import { inflateRawSync } from "node:zlib";

const ext = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

const IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", heic: "image/heic", heif: "image/heif" };
const OFFICE = { docx: "Word document", pptx: "PowerPoint presentation", xlsx: "Excel workbook" };
const TEXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "xml", "html", "htm", "log", "yaml", "yml", "ini", "toml", "srt", "vtt",
  "js", "jsx", "ts", "tsx", "py", "java", "c", "h", "cpp", "cs", "go", "rs", "rb", "php", "sql", "sh", "css", "scss",
]);
const OLD_OFFICE = { doc: "docx", ppt: "pptx", xls: "xlsx" };

/** What kind of file this is: { kind: "pdf" | "image" | "office" | "text", mime, label } or { error }. */
export function classify(name) {
  const e = ext(name);
  if (e === "pdf") return { kind: "pdf", mime: "application/pdf", label: "PDF" };
  if (IMAGE[e]) return { kind: "image", mime: IMAGE[e], label: "Image" };
  if (OFFICE[e]) return { kind: "office", mime: "text/plain", label: OFFICE[e] };
  if (TEXT.has(e)) return { kind: "text", mime: "text/plain", label: e === "csv" || e === "tsv" ? "Spreadsheet (CSV)" : "Text" };
  if (OLD_OFFICE[e]) return { error: `Old .${e} files can't be read. Save it as .${OLD_OFFICE[e]} or PDF and add it again.` };
  return { error: `.${e || "?"} files aren't supported. Add a PDF, Word, PowerPoint, Excel, text, CSV or image file.` };
}

/** Accepted file types, for the browser's file picker. */
export const ACCEPT = [".pdf", ...Object.keys(IMAGE), ...Object.keys(OFFICE), ...TEXT].map((e) => (e.startsWith(".") ? e : "." + e));

// ---- text ---------------------------------------------------------------------------------

export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const b = Buffer.from(buf.subarray(2));
    b.swap16();
    return b.toString("utf16le");
  }
  return buf.toString("utf8").replace(/^﻿/, "");
}

const ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
const decodeXml = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m
  );
const stripTags = (s) => decodeXml(s.replace(/<[^>]+>/g, ""));
const tidy = (s) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

// ---- zip ----------------------------------------------------------------------------------

const MAX_UNZIPPED = 60 * 1024 * 1024; // per entry, guards against zip bombs

/** Minimal ZIP reader: Map of entry name -> () => Buffer. */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a valid Office file (damaged or password-protected?)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED });
      throw new Error(`unsupported compression in ${name}`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const read = (zip, name) => (zip.has(name) ? zip.get(name)().toString("utf8") : null);
const byNumber = (re) => (a, b) => Number(a.match(re)[1]) - Number(b.match(re)[1]);

function docxText(zip) {
  const xml = read(zip, "word/document.xml");
  if (xml == null) throw new Error("this .docx has no document body");
  return tidy(
    stripTags(
      xml
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br[^>]*\/>/g, "\n")
        .replace(/<\/w:tc>/g, "\t")
        .replace(/<\/w:tr>/g, "\n")
        .replace(/<\/w:p>/g, "\n")
    )
  );
}

function pptxText(zip) {
  const re = /^ppt\/slides\/slide(\d+)\.xml$/;
  const slides = [...zip.keys()].filter((k) => re.test(k)).sort(byNumber(re));
  if (!slides.length) throw new Error("this .pptx has no slides");
  return slides
    .map((s, i) => {
      const body = tidy(stripTags(read(zip, s).replace(/<a:br[^>]*\/>/g, "\n").replace(/<\/a:p>/g, "\n")));
      return `--- Slide ${i + 1} ---\n${body}`;
    })
    .join("\n\n");
}

const colIndex = (ref) => {
  const letters = (ref.match(/^[A-Z]+/) || ["A"])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function xlsxText(zip, { maxRows = 3000, maxCols = 100 } = {}) {
  const shared = [];
  const ss = read(zip, "xl/sharedStrings.xml");
  if (ss) for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) shared.push(decodeXml((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  // sheet names in workbook order, mapped to their files through the relationships
  const wb = read(zip, "xl/workbook.xml") || "";
  const rels = read(zip, "xl/_rels/workbook.xml.rels") || "";
  const target = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const t = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target[id] = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
  }
  let sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: decodeXml(/name="([^"]*)"/.exec(m[0])?.[1] || "Sheet"),
    file: target[/r:id="([^"]+)"/.exec(m[0])?.[1]],
  }));
  if (!sheets.some((s) => s.file && zip.has(s.file))) {
    const re = /^xl\/worksheets\/sheet(\d+)\.xml$/;
    sheets = [...zip.keys()].filter((k) => re.test(k)).sort(byNumber(re)).map((f, i) => ({ name: `Sheet ${i + 1}`, file: f }));
  }
  const out = [];
  for (const s of sheets) {
    const xml = s.file && read(zip, s.file);
    if (!xml) continue;
    const rows = [];
    let cut = false;
    for (const row of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
      if (rows.length >= maxRows) {
        cut = true;
        break;
      }
      const cells = [];
      for (const c of row.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inner = c[2] || "";
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const i = ref ? colIndex(ref) : cells.length;
        if (i >= maxCols) continue;
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let val = "";
        if (type === "s") val = shared[Number(v)] ?? "";
        else if (type === "inlineStr") val = stripTags((/<is>([\s\S]*?)<\/is>/.exec(inner) || [, ""])[1]);
        else if (v != null) val = decodeXml(v);
        cells[i] = val.replace(/\s+/g, " ").trim();
      }
      if (cells.some((x) => x)) rows.push(Array.from(cells, (x) => x ?? "").join("\t"));
    }
    if (rows.length) out.push(`--- Sheet: ${s.name} ---\n${rows.join("\n")}${cut ? `\n[... more rows not included ...]` : ""}`);
  }
  if (!out.length) throw new Error("this workbook has no cells with values");
  return out.join("\n\n") + "\n\n(Dates may appear as Excel serial numbers.)";
}

/** Text of an Office file or a plain-text file. */
export function extractText(name, buf) {
  const e = ext(name);
  if (e === "docx") return docxText(unzip(buf));
  if (e === "pptx") return pptxText(unzip(buf));
  if (e === "xlsx") return xlsxText(unzip(buf));
  return tidy(decodeText(buf));
}
