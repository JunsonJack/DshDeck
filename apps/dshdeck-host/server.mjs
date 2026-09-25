/**
 * DshDeck M1 host — HTTP + WebSocket bridge to dsh ACP.
 * Serves apps/dshdeck-ui and forwards live session/update streams.
 *
 * Usage: node apps/dshdeck-host/server.mjs [--port 5177] [--cwd <workspace>]
 */
import { createServer } from "node:http";
import { createServer as netCreateServer, connect } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { AcpBridge } from "../../packages/acp-client/index.mjs";
import { gitDiff, gitStatus } from "../../packages/acp-client/git-diff.mjs";
import { readSessionReplay } from "../../packages/dsh-readonly/session-replay.mjs";

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

/** DataRootLock — one live connection per profile, via a deterministic localhost port.
 *  Binding succeeds → we hold the lock (listener kept alive). Binding fails →
 *  probe the port: reachable means another instance holds it; unreachable means
 *  conservative refusal (EPERM-style). Self-cleans on process death. */
function profileLockPort(profile) {
  let h = 0;
  for (const c of String(profile)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 47700 + (h % 256);
}
function acquireProfileLock(profile) {
  const port = profileLockPort(profile);
  return new Promise((res, rej) => {
    const srv = netCreateServer();
    srv.once("error", async () => {
      const reachable = await new Promise((r) => {
        const s = connect(port, "127.0.0.1");
        s.once("connect", () => { s.destroy(); r(true); });
        s.once("error", () => r(false));
        setTimeout(() => { s.destroy(); r(false); }, 800);
      });
      rej(new Error(
        reachable
          ? `profile「${profile}」已有活动连接（另一个 DshDeck 窗口或宿主进程在运行），同 profile 不双开`
          : `profile 锁端口 ${port} 不可用且无持有者，保守拒绝启动`
      ));
    });
    srv.listen(port, "127.0.0.1", () => res({ port, srv }));
  });
}

/** CrashBudget — N unclean exits inside the window refuse further boots with an actionable error */
class CrashBudget {
  constructor(max = 3, windowMs = 120000) {
    this.max = max; this.windowMs = windowMs; this.times = [];
  }
  record() {
    const now = Date.now();
    this.times = this.times.filter((t) => now - t < this.windowMs);
    this.times.push(now);
    return this.exhausted();
  }
  exhausted() {
    const now = Date.now();
    this.times = this.times.filter((t) => now - t < this.windowMs);
    return this.times.length >= this.max;
  }
}

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
  let lock = null;
  let sessionId = null;
  let sessionCwd = CWD;
  let prompting = false;
  let shuttingDown = false;
  const crashBudget = new CrashBudget();
  /** @type {Map<string, any>} */
  const pendingPerm = new Map();

  const send = (obj) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  };

  ws.on("message", async (raw) => {
    let cmd;
    try { cmd = JSON.parse(String(raw)); } catch { return; }
    const { type, payload = {} } = cmd;
    try {
      if (type === "boot") {
        const profile = payload.profile || "acp";
        if (bridge) {
          shuttingDown = true;
          bridge.stop();
          bridge = null;
          shuttingDown = false;
        }
        if (crashBudget.exhausted()) {
          send({ type: "error", payload: { message: "dsh 连续崩溃多次（120 秒窗口内 ≥3 次），已停止自动重试。请检查 profile 或 dsh 安装后重试" } });
          return;
        }
        if (!lock) lock = await acquireProfileLock(profile);
        const newBridge = new AcpBridge({ cwd: payload.cwd || sessionCwd, profile });
        newBridge.on((evt) => {
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
              const reqId = m.id;
              send({ type: "permission/request", payload: { id: reqId, method, params: m.params || {} } });
              pendingPerm.set(reqId, m);
            } else {
              send({ type: "acp/request", payload: { id: m.id, method, params: m.params } });
              newBridge.respond(m.id, null, { code: -32601, message: "method not supported by host: " + method });
            }
          } else if (evt.kind === "stderr") {
            send({ type: "stderr", payload: { text: evt.text } });
          } else if (evt.kind === "exit") {
            if (!shuttingDown) crashBudget.record();
            prompting = false;
            pendingPerm.clear();
            bridge = null;
            send({ type: "exit", payload: { code: evt.code, sig: evt.sig } });
          }
        });
        const agent = await newBridge.start();
        bridge = newBridge;
        if (payload.cwd) sessionCwd = payload.cwd;
        send({ type: "booted", payload: { agent, cwd: sessionCwd, resumed: sessionId != null } });
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
        if (payload.allow) {
          bridge.respond(payload.id, { outcome: { outcome: "selected", optionId: payload.optionId || "allow-once" } });
        } else {
          bridge.respond(payload.id, { outcome: { outcome: "cancelled" } });
        }
        send({ type: "permission/resolved", payload: { id: payload.id, allow: !!payload.allow } });
        return;
      }
      if (type === "session/set_config") {
        if (!sessionId) throw new Error("no session");
        const result = await bridge.sessionSetConfig(sessionId, payload.configId, payload.value);
        send({ type: "config/options", payload: { configOptions: result.configOptions || [] } });
        return;
      }
      if (type === "session/replay") {
        // read-only ~/.dsh/sessions parse — never blocks the live connection
        send({ type: "session/replay", payload: readSessionReplay(payload.sessionId, payload.cwd) });
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
        // notification — the in-flight prompt settles on its own with stopReason "cancelled"
        bridge.sessionCancel(sessionId);
        return;
      }
      if (type === "session/close") {
        if (sessionId) await bridge.sessionClose(sessionId);
        sessionId = null;
        send({ type: "session/closed", payload: {} });
        return;
      }
      if (type === "shutdown") {
        shuttingDown = true;
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
    shuttingDown = true;
    try { bridge?.stop(); } catch {}
    try { lock?.srv?.close(); } catch {}
  });
});

http.listen(PORT, "127.0.0.1", () => {
  console.log(`DshDeck M1  http://127.0.0.1:${PORT}  cwd=${CWD}`);
  console.log(`WebSocket   ws://127.0.0.1:${PORT}/acp`);
});
