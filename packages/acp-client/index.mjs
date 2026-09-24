/**
 * dshdeck-core · ACP bridge (M1)
 * Protocol notes: docs/W0-调研笔记.md
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export class AcpBridge {
  constructor(opts = {}) {
    this.profile = opts.profile || "acp";
    this.cwd = opts.cwd || process.cwd();
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(evt) {
    for (const fn of this.listeners) {
      try { fn(evt); } catch { /* isolate UI errors */ }
    }
  }

  async start() {
    this.child = spawn("dsh", ["--profile", this.profile], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      windowsHide: true,
      env: { ...process.env },
    });

    createInterface({ input: this.child.stdout }).on("line", (line) => this.#onLine(line));
    createInterface({ input: this.child.stderr }).on("line", (line) => {
      this.emit({ kind: "stderr", text: line });
    });
    this.child.on("exit", (code, sig) => {
      this.closed = true;
      this.emit({ kind: "exit", code, sig });
      for (const [, p] of this.pending) p.reject(new Error("acp process exit " + code));
      this.pending.clear();
    });

    this.agent = await this.call("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
      clientInfo: { name: "dshdeck", version: "0.1.0" },
    });
    this.notify("initialized", {});
    return this.agent;
  }

  #onLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch {
      this.emit({ kind: "stdout", text: line });
      return;
    }
    // response to our call
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || "acp error"), { acp: msg.error }));
      else p.resolve(msg.result);
      return;
    }
    // server → client request (e.g. permission, fs.read)
    if (msg.id != null && msg.method) {
      this.emit({ kind: "request", msg });
      return;
    }
    // notification
    this.emit({ kind: "message", msg });
  }

  /** reply to a server→client request */
  respond(id, result, error) {
    const payload = error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result: result ?? {} };
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  call(method, params) {
    if (this.closed) return Promise.reject(new Error("bridge closed"));
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    this.emit({ kind: "send", msg: payload });
    this.child.stdin.write(JSON.stringify(payload) + "\n");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  notify(method, params) {
    const payload = { jsonrpc: "2.0", method, params };
    this.emit({ kind: "send", msg: payload });
    this.child.stdin.write(JSON.stringify(payload) + "\n");
  }

  sessionNew(params) {
    return this.call("session/new", { cwd: this.cwd, mcpServers: {}, ...params });
  }

  sessionList() {
    return this.call("session/list", {});
  }

  /** resume historical session — requires matching cwd */
  sessionResume(sessionId, cwd) {
    return this.call("session/resume", { sessionId, cwd });
  }

  sessionPrompt(sessionId, text) {
    return this.call("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  /** session/cancel is a NOTIFICATION in ACP — calling it with an id yields Method not found */
  sessionCancel(sessionId) {
    this.notify("session/cancel", { sessionId });
    return Promise.resolve({});
  }

  /** set per-session config (model / reasoning_effort); param name is `configId` (dsh deviates from spec) */
  sessionSetConfig(sessionId, configId, value) {
    return this.call("session/set_config_option", { sessionId, configId, value });
  }

  sessionClose(sessionId) {
    return this.call("session/close", { sessionId });
  }

  stop() {
    try { this.child?.stdin?.end(); } catch {}
    try { this.child?.kill(); } catch {}
    this.closed = true;
  }
}
