/** W0c probe: decompress a dsh session file (read-only) and dump its JSONL shape. */
import { readFileSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";

const dir = "C:/Users/Administrator/.dsh/sessions/--E-VibeCodingProject-DshDeck--";
const id = process.argv[2] || "6da13459-4025-4e82-8572-7620f7b56e6b";
const p = `${dir}/${id}/session.v4.jsonl.zstd`;

const buf = readFileSync(p);
console.log("compressed bytes:", buf.length);
const out = zlib.zstdDecompressSync(buf);
writeFileSync("docs/_session-sample.jsonl", out);
const lines = out.toString("utf8").split("\n").filter(Boolean);
console.log("decompressed bytes:", out.length, "lines:", lines.length);
console.log("--- first 5 lines (truncated to 260 chars) ---");
lines.slice(0, 5).forEach((l) => console.log(l.slice(0, 260)));
console.log("--- line-type histogram (top-level keys) ---");
const hist = {};
for (const l of lines) {
  try {
    const o = JSON.parse(l);
    const k = o.type || o.kind || Object.keys(o).slice(0, 3).join(",");
    hist[k] = (hist[k] || 0) + 1;
  } catch { hist["<unparsable>"] = (hist["<unparsable>"] || 0) + 1; }
}
console.log(JSON.stringify(hist, null, 2));
