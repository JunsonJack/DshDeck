/** Dump one example line per key event type from the session sample. */
import { readFileSync } from "node:fs";

const lines = readFileSync("docs/_session-sample.jsonl", "utf8").split("\n").filter(Boolean);
const want = ["user/message", "assistant/message", "tool/call", "tool/result", "session/title", "system/message"];
for (const t of want) {
  const l = lines.find((x) => {
    try { return JSON.parse(x).type === t; } catch { return false; }
  });
  if (l) console.log(`## ${t}\n${l.slice(0, 600)}\n`);
}
