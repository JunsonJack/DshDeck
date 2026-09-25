/** CDP helper — drive headless Edge for UI diagnostics.
 * Usage: node probe/cdp.mjs <url> <eval-js> [screenshot-out]
 * Evaluates JS after page load, prints result, optionally screenshots.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const [url, evalJs, shot] = process.argv.slice(2);
const PORT = 9223;

const edge = spawn(
  "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207\\bin\\HostX64\\x64\\cl.exe",
  [], { stdio: "ignore" }
).on("error", () => {});
edge.kill();

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const proc = spawn(edgePath, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, "--window-size=1280,840",
  "--user-data-dir=" + process.env.TEMP + "\\edge-cdp", url,
], { stdio: "ignore" });

async function getTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("no debug target");
}

const wsUrl = await getTarget();
const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
});
await new Promise((r) => ws.on("open", r));

await send("Runtime.enable");
await new Promise((r) => setTimeout(r, 4000)); // let the app boot

const evalRes = await send("Runtime.evaluate", {
  expression: evalJs,
  returnByValue: true,
  awaitPromise: true,
});
console.log(JSON.stringify(evalRes.result?.value ?? evalRes, null, 2));

if (shot) {
  const cap = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(shot, Buffer.from(cap.data, "base64"));
  console.log("screenshot:", shot);
}
ws.close();
proc.kill();
process.exit(0);