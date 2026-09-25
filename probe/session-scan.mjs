/** W0c probe: scan ALL dsh sessions (read-only), decompress, report shapes, dump the richest one. */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import zlib from "node:zlib";
import { join } from "node:path";

const root = "C:/Users/Administrator/.dsh/sessions";
const outLines = [];
for (const dir of readdirSync(root)) {
  for (const id of readdirSync(join(root, dir))) {
    const p = join(root, dir, id, "session.v4.jsonl.zstd");
    try {
      const buf = readFileSync(p);
      const out = zlib.zstdDecompressSync(buf);
      const lines = out.toString("utf8").split("\n").filter(Boolean);
      const hist = {};
      for (const l of lines) {
        try {
          const o = JSON.parse(l);
          hist[o.type || "?"] = (hist[o.type || "?"] || 0) + 1;
        } catch { hist["<unparsable>"] = (hist["<unparsable>"] || 0) + 1; }
      }
      console.log(`${dir}/${id}  ${buf.length}B -> ${out.length}B  lines=${lines.length}  ${JSON.stringify(hist)}`);
      if (lines.length > outLines.length) outLines.push({ id, lines, out });
    } catch (e) {
      console.log(`${dir}/${id}  FAIL ${e.message}`);
    }
  }
}
const best = outLines[outLines.length - 1];
if (best) {
  writeFileSync("docs/_session-sample.jsonl", best.out);
  console.log(`\nrichest: ${best.id} (${best.lines.length} lines) -> docs/_session-sample.jsonl`);
}
