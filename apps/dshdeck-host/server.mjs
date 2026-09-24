/**
 * DshDeck M1 host — HTTP + WebSocket bridge to dsh ACP.
 * Serves apps/dshdeck-ui and forwards live session/update streams.
 *
 * Usage: node apps/dshdeck-host/server.mjs [--port 5177] [--cwd <workspace>]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { AcpBridge } from "../../packages/acp-client/index.mjs";
import { gitDiff, gitStatus } from "../../packages/acp-client/git-diff.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const uiDir = join(root, "apps", "dshdeck-ui");

const args = process.argv.slice(2);
function argVal(f, d) {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
}
const PORT = Number(argVal("--port", "5177"));
const CWD = resolve(argVal("--cwd", process.cwd()));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const http = createServer(async (req, res) => {
  try {
    let path = req.url.split("?")[0];
    if (path === "/") path = "/index.html";
    const file = join(uiDir, path);
    if (!file.startsWith(uiDir)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const wss = new WebSocketServer({ server: http, path: "/acp" });

wss.on("connection", (ws) => {
  let bridge = null;
  let sessionId = null;
  let prompting = false;
  /** @type {Map<string, any>} */
  const pendingPerm = new Map();
  let sessionCwd = CWD;

  const send = (obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  ws.on("message", async (raw) => {
    let cmd;
    try { cmd = JSON.parse(String(raw)); } catch { return; }
    const { type, payload = {} } = cmd;
    try {
      if (type === "boot") {
        bridge = new AcpBridge({ cwd: payload.cwd || CWD, profile: payload.profile || "acp" });
        bridge.on((evt) => {
          if (evt.kind === "message") {
            const m = evt.msg;
            if (m.method === "session/update") {
              send({ type: "session/update", payload: m.params });
            } else {
              send({ type: "acp/notify", payload: m });
            }
          } else if (evt.kind === "request") {
            const m = evt.msg;
            const method = m.method || "";
            if (/permission/i.test(method)) {
              // surface as approval card; wait for UI decision
              const reqId = m.id;
              const params = m.params || {};
              send({ type: "permission/request", payload: { id: reqId, method, params } });
              pendingPerm.set(reqId, m);
            } else if (/fs\./i.test(method)) {
              // minimal fs capabilities we declared
              send({ type: "acp/request", payload: { id: m.id, method, params: m.params } });
              // auto-fail unknown fs unless simple
              bridge.respond(m.id, null, { code: -32601, message: "fs not implemented in M1 host" });
            } else {
              send({ type: "acp/request", payload: { id: m.id, method, params: m.params } });
              bridge.respond(m.id, null, { code: -32601, message: "method not supported by host: " + method });
            }
          } else if (evt.kind === "stderr") {
            send({ type: "stderr", payload: { text: evt.text } });
          } else if (evt.kind === "exit") {
            send({ type: "exit", payload: { code: evt.code, sig: evt.sig } });
            prompting = false;
            pendingPerm.clear();
          }
        });
        const agent = await bridge.start();
        sessionCwd = payload.cwd || CWD;
        send({ type: "booted", payload: { agent, cwd: sessionCwd } });
        return;
      }
      if (!bridge) {
        send({ type: "error", payload: { message: "not booted" } });
        return;
      }
      if (type === "session/new") {
        const result = await bridge.sessionNew(payload);
        sessionId = result.sessionId;
        if (payload.cwd) sessionCwd = payload.cwd;
        send({ type: "session/ready", payload: result });
        return;
      }
      if (type === "permission/response") {
        const req = pendingPerm.get(payload.id);
        if (!req || !bridge) {
          send({ type: "error", payload: { message: "no pending permission" } });
          return;
        }
        pendingPerm.delete(payload.id);
        // allow/deny — shape refined when ACP request schema is confirmed
        if (payload.allow) {
          bridge.respond(payload.id, { outcome: { outcome: "selected", optionId: payload.optionId || "allow-once" } });
        } else {
          bridge.respond(payload.id, { outcome: { outcome: "cancelled" } });
        }
        send({ type: "permission/resolved", payload: { id: payload.id, allow: !!payload.allow } });
        return;
      }
      if (type === "git/status") {
        send({ type: "git/status", payload: await gitStatus(sessionCwd) });
        return;
      }
      if (type === "git/diff") {
        send({ type: "git/diff", payload: await gitDiff(sessionCwd) });
        return;
      }
      if (type === "session/list") {
        send({ type: "session/list", payload: await bridge.sessionList() });
        return;
      }
      if (type === "session/resume") {
        const result = await bridge.sessionResume(payload.sessionId, payload.cwd);
        sessionId = result.sessionId || payload.sessionId;
        if (payload.cwd) sessionCwd = payload.cwd;
        send({ type: "session/ready", payload: { ...result, resumed: true, sessionId } });
        return;
      }
      if (type === "session/prompt") {
        if (prompting) {
          send({ type: "error", payload: { message: "already prompting" } });
          return;
        }
        prompting = true;
        send({ type: "prompt/start", payload: { sessionId } });
        try {
          const result = await bridge.sessionPrompt(sessionId || payload.sessionId, payload.text);
          send({ type: "prompt/stop", payload: result });
        } catch (e) {
          send({ type: "prompt/error", payload: { message: String(e.message || e) } });
        } finally {
          prompting = false;
        }
        return;
      }
      if (type === "session/cancel") {
        try {
          await bridge.sessionCancel(sessionId);
          send({ type: "prompt/cancelled", payload: { sessionId } });
        } catch (e) {
          send({ type: "error", payload: { message: String(e.message || e) } });
        }
        return;
      }
      if (type === "session/close") {
        if (sessionId) await bridge.sessionClose(sessionId);
        sessionId = null;
        send({ type: "session/closed", payload: {} });
        return;
      }
      if (type === "shutdown") {
        bridge.stop();
        bridge = null;
        send({ type: "exit", payload: { code: 0 } });
        return;
      }
    } catch (e) {
      send({ type: "error", payload: { message: String(e.message || e) } });
    }
  });

  ws.on("close", () => {
    try { bridge?.stop(); } catch {}
  });
});

http.listen(PORT, "127.0.0.1", () => {
  console.log(`DshDeck M1  http://127.0.0.1:${PORT}  cwd=${CWD}`);
  console.log(`WebSocket   ws://127.0.0.1:${PORT}/acp`);
});
