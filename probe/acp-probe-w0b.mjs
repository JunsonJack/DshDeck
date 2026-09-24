#!/usr/bin/env node
/**
 * W0b probe — configOptions set-method discovery + streaming cancel + permission capture.
 * Appends full JSON-RPC trace to docs/W0b-acp-trace.jsonl.
 */
import { AcpBridge } from "../packages/acp-client/index.mjs";
import { appendFileSync, writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const traceFile = resolve(here, "../docs/W0b-acp-trace.jsonl");
writeFileSync(traceFile, "");
function trace(kind, msg) {
  appendFileSync(traceFile, JSON.stringify({ ts: new Date().toISOString(), kind, msg }) + "\n");
}

const b = new AcpBridge({ cwd: "E:\\VibeCodingProject\\DshDeck" });
const requestLog = [];
b.on((evt) => {
  if (evt.kind === "send") trace("client", evt.msg);
  else if (evt.kind === "message") trace("server", evt.msg);
  else if (evt.kind === "request") {
    trace("server-request", evt.msg);
    requestLog.push(evt.msg);
  }
});

await b.start();
console.log("== initialize ok ==");

// 1. full configOptions dump
const s = await b.sessionNew();
console.log("\n== configOptions (full) ==");
console.log(JSON.stringify(s.configOptions, null, 2));

// 2. set-method discovery on reasoning_effort (harmless toggle)
const candidates = [
  ["session/set_config_option", { sessionId: s.sessionId, configOptionId: "reasoning_effort", value: "low" }],
  ["session/set_config_option", { sessionId: s.sessionId, optionId: "reasoning_effort", value: "low" }],
  ["session/setConfigOption", { sessionId: s.sessionId, configOptionId: "reasoning_effort", value: "low" }],
  ["session/set_config", { sessionId: s.sessionId, configOptions: [{ id: "reasoning_effort", value: "low" }] }],
  ["session/update_config", { sessionId: s.sessionId, configOptions: [{ id: "reasoning_effort", value: "low" }] }],
  ["session/setConfig", { sessionId: s.sessionId, config: { reasoning_effort: "low" } }],
];
console.log("\n== set-method discovery ==");
let setOk = null;
for (const [m, p] of candidates) {
  try {
    const r = await b.call(m, p);
    console.log("OK  ", m, JSON.stringify(r).slice(0, 160));
    setOk = m;
    break;
  } catch (e) {
    console.log("FAIL", m, "→", String(e.message).slice(0, 110));
  }
}
console.log("winner:", setOk || "(none)");

// 3. permission capture — ask dsh to create a file
console.log("\n== permission capture (prompt asks for file write) ==");
const probeFile = "E:\\VibeCodingProject\\DshDeck\\_perm_probe.txt";
if (existsSync(probeFile)) unlinkSync(probeFile);
const promptPromise = b.sessionPrompt(s.sessionId, `请在当前目录创建文件 _perm_probe.txt，内容只有一行：ping。创建完成后回复 DONE。`);
const promptSettled = promptPromise.then(
  (r) => ({ ok: true, r }), (e) => ({ ok: false, e: String(e.message || e) })
);
// answer any incoming permission request with spec-shaped selection of first allow-ish option
const permTimer = setTimeout(() => {}, 0);
const waitPerm = new Promise((res) => {
  const iv = setInterval(() => {
    const req = requestLog.find((m) => /permission/i.test(m.method || ""));
    if (req) { clearInterval(iv); res(req); }
  }, 200);
  setTimeout(() => { clearInterval(iv); res(null); }, 60000);
  clearTimeout(permTimer);
});
const permReq = await waitPerm;
if (permReq) {
  console.log("PERMISSION REQUEST SHAPE:");
  console.log(JSON.stringify(permReq, null, 2));
  const opts = permReq.params?.options || [];
  const allow = opts.find((o) => String(o.kind || o.optionId).toLowerCase().includes("allow")) || opts[0];
  const result = allow
    ? { outcome: { outcome: "selected", optionId: allow.optionId } }
    : { outcome: { outcome: "cancelled" } };
  b.respond(permReq.id, result);
  console.log("responded:", JSON.stringify(result));
} else {
  console.log("no permission request observed in 60s");
}
const promptResult = await promptSettled;
console.log("prompt result:", JSON.stringify(promptResult).slice(0, 300));
console.log("probe file exists:", existsSync(probeFile));
if (existsSync(probeFile)) { console.log("content:", readFileSync(probeFile, "utf8").slice(0, 80)); unlinkSync(probeFile); }

// 4. streaming cancel
console.log("\n== streaming cancel ==");
const longPrompt = b.sessionPrompt(s.sessionId, "用中文写一篇约600字的关于操作系统的短文。");
await new Promise((r) => setTimeout(r, 2500));
try {
  const cr = await b.sessionCancel(s.sessionId);
  console.log("cancel ok:", JSON.stringify(cr).slice(0, 120));
} catch (e) {
  console.log("cancel FAIL:", String(e.message).slice(0, 120));
}
const longResult = await longPrompt.then((r) => r, (e) => ({ error: String(e.message || e) }));
console.log("long prompt settled:", JSON.stringify(longResult).slice(0, 160));

// 5. session still usable after cancel?
try {
  const again = await b.sessionPrompt(s.sessionId, "Say only: PONG");
  console.log("post-cancel prompt ok:", JSON.stringify(again).slice(0, 120));
} catch (e) {
  console.log("post-cancel prompt FAIL:", String(e.message).slice(0, 120));
}

await b.sessionClose(s.sessionId).catch(() => {});
b.stop();
console.log("\nDONE — trace at docs/W0b-acp-trace.jsonl");
