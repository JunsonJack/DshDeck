/** W0c probe 2: multi-frame zstd — count frames, decode sequentially, dump richest session. */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import zlib from "node:zlib";
import { join } from "node:path";

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const root = "C:/Users/Administrator/.dsh/sessions";

function frameOffsets(buf) {
  const offs = [];
  let i = 0;
  while ((i = buf.indexOf(MAGIC, i)) !== -1) {
    offs.push(i);
    i += 1;
  }
  return offs;
}

function decodeAll(buf) {
  const offs = frameOffsets(buf);
  const chunks = [];
  for (let f = 0; f < offs.length; f++) {
    const start = offs[f];
    const end = f + 1 < offs.length ? offs[f + 1] : buf.length;
    const chunk = buf.subarray(start, end);
    try {
      chunks.push(zlib.zstdDecompressSync(chunk));
    } catch (e) {
      chunks.push(Buffer.from(`<frame ${f} decode error: ${e.message}>\n`));
    }
  }
  return { frames: offs.length, data: Buffer.concat(chunks) };
}

let best = null;
for (const dir of readdirSync(root)) {
  for (const id of readdirSync(join(root, dir))) {
    const p = join(root, dir, id, "session.v4.jsonl.zstd");
    try {
      const buf = readFileSync(p);
      const { frames, data } = decodeAll(buf);
      const lines = data.toString("utf8").split("\n").filter(Boolean);
      if (lines.length > (best?.lines.length || 0)) best = { id: `${dir}/${id}`, lines, data };
      if (lines.length > 1) {
        const hist = {};
        for (const l of lines) {
          try { const o = JSON.parse(l); hist[o.type || "?"] = (hist[o.type || "?"] || 0) + 1; }
          catch { hist["<unparsable>"] = (hist["<unparsable>"] || 0) + 1; }
        }
        console.log(`${dir}/${id}  frames=${frames}  lines=${lines.length}  ${JSON.stringify(hist)}`);
      }
    } catch (e) {
      console.log(`${dir}/${id}  FAIL ${e.message}`);
    }
  }
}
if (best) {
  writeFileSync("docs/_session-sample.jsonl", best.data);
  console.log(`\nrichest: ${best.id} (${best.lines.length} lines) -> docs/_session-sample.jsonl`);
}
