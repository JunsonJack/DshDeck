/**
 * dsh-readonly · session replay parser.
 * Reads ~/.dsh/sessions/<encoded-cwd>/<id>/session.v4.jsonl.zstd (STRICTLY read-only)
 * and maps the multi-frame zstd JSONL event stream to UI replay events.
 * Format notes: docs/W0-调研笔记.md §10
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function decodeFrames(buf) {
  const offs = [];
  let i = 0;
  while ((i = buf.indexOf(MAGIC, i)) !== -1) {
    offs.push(i);
    i += 1;
  }
  if (!offs.length) throw new Error("no zstd frames found");
  const chunks = [];
  for (let f = 0; f < offs.length; f++) {
    const start = offs[f];
    const end = f + 1 < offs.length ? offs[f + 1] : buf.length;
    chunks.push(zlib.zstdDecompressSync(buf.subarray(start, end)));
  }
  return Buffer.concat(chunks);
}

function encodeCwdDir(cwd) {
  return "--" + cwd.replace(/[:\\/]+/g, "-") + "--";
}

const texts = (blocks) =>
  (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");

function mapEvents(lines) {
  const events = [];
  let title = null;
  for (const l of lines) {
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    try {
      switch (o.type) {
        case "session/title":
          if (o.data?.title) title = o.data.title;
          break;
        case "user/message": {
          const text = texts(o.data?.content);
          if (text) events.push({ kind: "user", text });
          break;
        }
        case "assistant/message": {
          const blocks = o.data?.message?.content || [];
          for (const b of blocks) {
            if (b?.type === "text" && b.text) events.push({ kind: "assistant", text: b.text });
            else if (b?.type === "reasoning" && b.text) events.push({ kind: "thought", text: b.text });
            // tool-call blocks are covered by the dedicated tool/call events
          }
          break;
        }
        case "tool/call": {
          if (!o.data?.callId) break;
          let rawInput = o.data.arguments;
          try { rawInput = JSON.parse(o.data.arguments); } catch { /* keep raw string */ }
          events.push({ kind: "tool_call", id: o.data.callId, title: o.data.name || "tool", rawInput });
          break;
        }
        case "tool/result": {
          const id = o.data?.message?.toolCallId || o.data?.message?.source?.callId;
          const text = texts(o.data?.message?.content);
          if (id) events.push({ kind: "tool_result", id, text, status: "completed" });
          break;
        }
        default:
          break; // internal events — ignored for replay
      }
    } catch { /* skip malformed event line */ }
  }
  return { events, title };
}

/** locate the session file: fast path via encoded cwd dir, fallback to a header scan */
export function locate(sessionId, cwd, dshDir) {
  const bare = String(sessionId).replace(/^session-/, "");
  const root = dshDir ? join(dshDir, "sessions") : join(process.env.USERPROFILE || "", ".dsh", "sessions");
  if (!existsSync(root)) throw new Error("未找到 ~/.dsh/sessions 目录");
  const candidates = [];
  if (cwd) candidates.push(join(root, encodeCwdDir(cwd), bare, "session.v4.jsonl.zstd"));
  candidates.push(join(root, encodeCwdDir(cwd || ""), "session-" + bare, "session.v4.jsonl.zstd"));
  for (const c of candidates) if (existsSync(c)) return c;
  // fallback: header scan across cwd dirs (decode first frame's first line only)
  for (const dir of readdirSync(root)) {
    for (const name of [bare, "session-" + bare]) {
      const p = join(root, dir, name, "session.v4.jsonl.zstd");
      if (!existsSync(p)) continue;
      try {
        const first = decodeFrames(readFileSync(p)).toString("utf8").split("\n")[0];
        const head = JSON.parse(first);
        if (head.id === bare || head.id === sessionId) return p;
      } catch { /* try next */ }
    }
  }
  throw new Error(`未找到会话 ${bare} 的存储文件`);
}

export function readSessionReplay(sessionId, cwd, dshDir) {
  try {
    const p = locate(sessionId, cwd, dshDir);
    const lines = decodeFrames(readFileSync(p)).toString("utf8").split("\n").filter(Boolean);
    const { events, title } = mapEvents(lines);
    return { ok: true, events, title, source: p };
  } catch (e) {
    return { ok: false, error: String(e.message || e), events: [] };
  }
}

/** titles for a batch of sessions: pairs = [{ sessionId, cwd }] → { sessionId: title } */
export function readSessionTitles(pairs, dshDir) {
  const out = {};
  for (const { sessionId, cwd } of pairs || []) {
    try {
      const p = locate(sessionId, cwd, dshDir);
      const data = decodeFrames(readFileSync(p)).toString("utf8");
      let title = null;
      for (const l of data.split("\n")) {
        try {
          const o = JSON.parse(l);
          if (o.type === "session/title" && o.data?.title) title = o.data.title;
        } catch { /* skip malformed */ }
      }
      if (title) out[sessionId] = title;
    } catch { /* file missing / undecodable — leave untitled */ }
  }
  return out;
}
