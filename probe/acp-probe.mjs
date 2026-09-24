#!/usr/bin/env node
/**
 * W0 ACP probe — spawn `dsh --profile acp` and exercise initialize / session lifecycle.
 * Logs every JSON-RPC message to docs/W0-acp-trace.jsonl (or stdout).
 *
 * Usage: node probe/acp-probe.mjs [--cwd <dir>] [--out <file>]
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
function argVal(flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const cwd = resolve(argVal("--cwd", process.cwd()));
const outFile = resolve(argVal("--out", resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../docs/W0-acp-trace.jsonl")));

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, "");

function log(kind, msg) {
  const rec = { ts: new Date().toISOString(), kind, msg };
  appendFileSync(outFile, JSON.stringify(rec) + "\n");
  const brief = typeof msg === "object" ? JSON.stringify(msg).slice(0, 240) : String(msg).slice(0, 240);
  console.log(`[${kind}] ${brief}`);
}

const child = spawn("dsh", ["--profile", "acp"], {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
  shell: true,
  windowsHide: true,
});

const rlOut = createInterface({ input: child.stdout });
const rlErr = createInterface({ input: child.stderr });
rlOut.on("line", (line) => {
  if (!line.trim()) return;
  try {
    log("recv", JSON.parse(line));
  } catch {
    log("stdout", line);
  }
});
rlErr.on("line", (line) => log("stderr", line));
child.on("exit", (code, sig) => {
  log("exit", { code, sig });
  process.exit(code ?? 0);
});

let nextId = 1;
const pending = new Map();

function send(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method, params };
  const line = JSON.stringify(payload) + "\n";
  log("send", payload);
  child.stdin.write(line);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method, t0: Date.now() });
  });
}

function notify(method, params) {
  const payload = { jsonrpc: "2.0", method, params };
  log("notify", payload);
  child.stdin.write(JSON.stringify(payload) + "\n");
}

// Route responses: patch rlOut handler by intercepting parse — simpler: wrap after
// We already log on line; also resolve pending here via a second parser.
// Re-parse from file is fine; better: attach on the same events by re-reading child stdout — already consumed.
// Instead, intercept by monkey-patching: subscribe before? Too late.
// Fix: use a custom line router.

// Rebuild: kill and use a cleaner approach if needed. For now parse from a dual handler —
// attach another listener on stdout data.
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      log("result", { method: p.method, ms: Date.now() - p.t0, msg });
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  await sleep(800);
  log("step", "initialize");

  const initParams = {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
    },
    clientInfo: { name: "dshdeck-probe", version: "0.1.0" },
  };

  let initResult;
  try {
    initResult = await send("initialize", initParams);
    log("step", { name: "initialize.ok", result: initResult });
  } catch (e) {
    log("step", { name: "initialize.fail", error: String(e) });
    // try without protocolVersion / different shape
    try {
      initResult = await send("initialize", {
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        clientInfo: { name: "dshdeck-probe", version: "0.1.0" },
      });
      log("step", { name: "initialize.retry.ok", result: initResult });
    } catch (e2) {
      log("step", { name: "initialize.retry.fail", error: String(e2) });
    }
  }

  try {
    notify("initialized", {});
    log("step", "initialized.notified");
  } catch (e) {
    log("step", { name: "initialized.fail", error: String(e) });
  }

  // session/new
  const newParamsCandidates = [
    { cwd, mcpServers: {} },
    { cwd },
    { path: cwd },
    {},
  ];
  let session;
  for (const p of newParamsCandidates) {
    try {
      session = await send("session/new", p);
      log("step", { name: "session/new.ok", params: p, result: session });
      break;
    } catch (e) {
      log("step", { name: "session/new.try", params: p, error: String(e) });
    }
  }

  const sessionId = session?.sessionId ?? session?.id ?? session?.session_id;
  log("step", { name: "session.id", sessionId, raw: session });

  // session/list
  try {
    const list = await send("session/list", {});
    log("step", { name: "session/list.ok", result: list });
  } catch (e) {
    try {
      const list = await send("session/list", undefined);
      log("step", { name: "session/list.ok2", result: list });
    } catch (e2) {
      log("step", { name: "session/list.fail", error: String(e2) });
    }
  }

  // prompt
  if (sessionId) {
    let prompted = false;
    for (const p of promptCandidates(sessionId)) {
      try {
        // stream for ~12s then cancel
        const pr = send("session/prompt", p);
        // race with timeout to collect notifications
        const result = await Promise.race([
          pr,
          sleep(12000).then(() => ({ __timeout: true })),
        ]);
        if (result && result.__timeout) {
          log("step", { name: "prompt.streaming", note: "no response in 12s, sending cancel" });
          try {
            await send("session/cancel", { sessionId });
            log("step", { name: "cancel.ok" });
          } catch (e) {
            notify("session/cancel", { sessionId });
            log("step", { name: "cancel.notify", error: String(e) });
          }
          prompted = true;
          break;
        }
        log("step", { name: "prompt.ok", result });
        prompted = true;
        break;
      } catch (e) {
        log("step", { name: "prompt.try", params: p, error: String(e) });
      }
    }
    if (!prompted) log("step", { name: "prompt.all.failed" });
  }

  await sleep(1500);

  // close
  if (sessionId) {
    try {
      await send("session/close", { sessionId });
      log("step", { name: "close.ok" });
    } catch (e) {
      log("step", { name: "close.fail", error: String(e) });
    }
  }

  child.stdin.end();
  await sleep(500);
  try { child.kill(); } catch {}
  log("done", { outFile });
}

function promptCandidates(sessionId) {
  return [
    { sessionId, prompt: [{ type: "text", text: "Say only: PONG" }] },
    { sessionId, prompt: "Say only: PONG" },
  ];
}

main().catch((e) => {
  log("fatal", String(e));
  try { child.kill(); } catch {}
  process.exit(1);
});
