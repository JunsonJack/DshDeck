/**
 * Protocol transport — WebSocket (node host) or Tauri IPC, dual-channel.
 * Incoming messages are routed into Pinia stores; outgoing commands keep the
 * same message names across both channels. Protocol notes: docs/W0-调研笔记.md
 */
import { useAppStore } from "../stores";
import { useSessionStore } from "../stores";
import { useChatStore } from "../stores";
import { useConfigStore } from "../stores";
import { useUiStore } from "../stores";
import { esc, renderMarkdown, mdAvailable } from "./markdown";

type Msg = { type: string; payload?: any };

const TauriCmd: Record<string, string> = {
  boot: "boot",
  "session/new": "session_new",
  "session/list": "session_list",
  "session/resume": "session_resume",
  "session/prompt": "session_prompt",
  "session/cancel": "session_cancel",
  "session/close": "session_close",
  "session/set_config": "session_set_config",
  "session/replay": "session_replay",
  "model/config": "model_config",
  "git/diff": "git_diff",
  "git/status": "git_status",
  "permission/response": "permission_response",
  shutdown: "session_close",
};

let ws: WebSocket | null = null;

function sendWs(type: string, payload: any = {}) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, payload }));
}

function tauri(): any {
  return (window as any).__TAURI__;
}

export function sendCmd(type: string, payload: any = {}) {
  const app = useAppStore();
  if (app.tauri) {
    const cmd = TauriCmd[type];
    if (!cmd) return;
    const args: any = { ...payload };
    if (type === "session/resume") {
      args.sessionId = payload.sessionId || payload.session_id;
      args.cwd = payload.cwd || "";
    }
    if (type === "session/prompt") {
      args.text = payload.text;
      handleMsg({ type: "prompt/start", payload: {} });
    }
    tauri()
      .core.invoke(cmd, args)
      .then((result: any) => {
        if (type === "boot") {
          handleMsg({ type: "booted", payload: { agent: result, cwd: "" } });
        } else if (type === "session/new") {
          handleMsg({ type: "session/ready", payload: result });
        } else if (type === "session/resume") {
          handleMsg({ type: "session/ready", payload: { ...result, resumed: true, sessionId: args.sessionId } });
        } else if (type === "session/list") {
          handleMsg({ type: "session/list", payload: result });
        } else if (type === "session/set_config") {
          handleMsg({ type: "config/options", payload: { configOptions: result.configOptions || [] } });
        } else if (type === "session/replay") {
          handleMsg({ type: "session/replay", payload: result });
        } else if (type === "model/config") {
          handleMsg({ type: "model/config", payload: result });
        } else if (type === "session/prompt") {
          handleMsg({ type: "prompt/stop", payload: result });
        } else if (type === "session/cancel") {
          // notification — the in-flight prompt settles separately
        } else if (type === "git/diff") {
          handleMsg({ type: "git/diff", payload: result });
        } else if (type === "git/status") {
          handleMsg({ type: "git/status", payload: result });
        }
      })
      .catch((e: any) => {
        const message = String(e);
        if (type === "session/prompt") handleMsg({ type: "prompt/error", payload: { message } });
        else handleMsg({ type: "error", payload: { message } });
      });
    return;
  }
  sendWs(type, payload);
}

/* ---------- transcript helpers ---------- */

function addBlock(item: any) {
  useChatStore().push(item);
}

function ensureStream() {
  const chat = useChatStore();
  const live = chat.items.find((i) => i.kind === "agent" && i.live);
  if (!live) chat.push({ kind: "agent", raw: "", live: true });
  return live || chat.items.find((i) => i.kind === "agent" && i.live);
}

/* ---------- message router ---------- */

export function handleMsg(msg: Msg) {
  const app = useAppStore();
  const session = useSessionStore();
  const chat = useChatStore();
  const config = useConfigStore();
  const ui = useUiStore();
  const { type, payload = {} } = msg;

  if (type === "booted") {
    app.connected = true;
    app.agentInfo = payload.agent?.agentInfo || null;
    app.lastCwd = payload.cwd || app.lastCwd;
    if (app.reconnecting && session.lastSessionId) {
      app.reconnecting = false;
      app.pendingResume = true;
      sendCmd("session/resume", { sessionId: session.lastSessionId, cwd: app.lastCwd });
    } else {
      app.reconnecting = false;
      sendCmd("session/new", {});
    }
    sendCmd("session/list", {});
  } else if (type === "session/ready") {
    session.sessionId = payload.sessionId;
    session.lastSessionId = payload.sessionId || session.lastSessionId;
    app.pendingResume = false;
    config.applyConfigOptions(payload.configOptions || []);
    if (payload.resumed) sendCmd("session/replay", { sessionId: payload.sessionId, cwd: app.lastCwd });
    app.toast(payload.resumed ? "已恢复历史会话" : "会话已就绪");
  } else if (type === "session/replay") {
    session.replay = payload;
    renderReplay(payload);
  } else if (type === "model/config") {
    config.modelConfig = payload;
  } else if (type === "config/options") {
    config.applyConfigOptions(payload.configOptions || []);
    app.toast("模型配置已更新");
  } else if (type === "session/update") {
    applySessionUpdate(payload);
  } else if (type === "permission/request") {
    const { id, params } = payload;
    const label = params?.toolCall?.title || params?.title || payload.method || "permission";
    const desc = params?.rawInput ? JSON.stringify(params.rawInput).slice(0, 180) : params?.kind || "";
    const opts = Array.isArray(params?.options) && params.options.length
      ? params.options
      : [
          { optionId: "allow-once", name: "允许一次", kind: "allow_once" },
          { optionId: "reject-once", name: "拒绝", kind: "reject_once" },
        ];
    chat.perms.push({ id: String(id), label, desc, opts, resolved: null });
  } else if (type === "permission/resolved") {
    app.toast(payload.allow ? "已允许" : "已拒绝");
  } else if (type === "git/diff") {
    ui.diff = payload;
  } else if (type === "git/status") {
    if (payload.ok) app.toast("改动 " + (payload.files?.length || 0) + " 个文件");
  } else if (type === "prompt/start") {
    chat.prompting = true;
    chat.resetStream();
  } else if (type === "prompt/stop") {
    chat.prompting = false;
    const live = chat.items.find((i) => i.kind === "agent" && i.live);
    if (live) live.live = false;
    if (payload.stopReason === "cancelled") {
      addBlock({ kind: "say", cls: "warn", text: "已中断" });
      app.toast("已中断");
    } else {
      app.toast("完成 · " + (payload.stopReason || ""));
    }
    sendCmd("git/diff");
    setTimeout(dequeueNext, 250);
  } else if (type === "prompt/error") {
    chat.prompting = false;
    addBlock({ kind: "error", text: payload.message, retry: true });
  } else if (type === "prompt/cancelled") {
    chat.prompting = false;
    addBlock({ kind: "say", cls: "warn", text: "已中断" });
  } else if (type === "session/list") {
    const list = payload.sessions || [];
    for (const s of list) {
      if (s.sessionId && s.title) session.lastTitles[s.sessionId] = s.title;
    }
    session.sessions = list;
  } else if (type === "stderr") {
    console.warn("dsh", payload.text);
  } else if (type === "error") {
    if (app.connected && !session.sessionId) {
      app.showAlert("danger", payload.message, "重连", reconnect);
    } else if (!app.connected) {
      app.showAlert("danger", payload.message, "重连", reconnect);
    } else {
      app.toast(payload.message);
    }
  } else if (type === "exit") {
    app.connected = false;
    chat.prompting = false;
    chat.clearQueue();
    app.showAlert("danger", "dsh 连接已断开（进程退出）。重连后会尝试恢复上一个会话。", "重连", reconnect);
  }
}

function applySessionUpdate(u: any) {
  const chat = useChatStore();
  const kind = u?.sessionUpdate;
  if (kind === "agent_message_chunk") {
    let live = ensureStream();
    live.raw += u.content?.text ?? "";
  } else if (kind === "agent_thought_chunk") {
    const id = u.messageId || "t";
    let item = chat.items.find((i) => i.kind === "thought" && i.id === id);
    if (!item) {
      item = { kind: "thought", id, raw: "", live: true };
      chat.push(item);
    }
    item.raw += u.content?.text ?? "";
  } else if (kind === "tool_call") {
    let rawInput = u.rawInput;
    if (rawInput && typeof rawInput !== "string") rawInput = JSON.stringify(rawInput, null, 2);
    chat.push({
      kind: "tool", id: u.toolCallId, title: u.title || u.kind || "tool",
      rawInput: rawInput ?? "", status: "running", output: "", live: true,
    });
  } else if (kind === "tool_call_update") {
    const item = chat.findTool(u.toolCallId);
    if (item) {
      const status = u.status || "";
      if (status === "completed") item.status = "ok";
      else if (status === "failed" || status === "error") item.status = "err";
      else if (status) item.status = status;
      if (u.content) {
        const texts: string[] = [];
        for (const c of u.content) {
          if (c?.content?.text) texts.push(c.content.text);
          else if (c?.text) texts.push(c.text);
          else texts.push(JSON.stringify(c));
        }
        item.output = texts.join("\n");
        item.live = false;
      }
    }
  } else if (kind === "usage_update") {
    ensureStream();
    useChatStore().usage = `tokens ${u.used} / ${u.size}`;
  } else {
    let live = ensureStream();
    live.raw += `\n[${u.sessionUpdate}] ${JSON.stringify(u).slice(0, 200)}`;
  }
}

function renderReplay(payload: any) {
  const session = useSessionStore();
  if (!payload?.ok) {
    addBlock({ kind: "hint", text: `历史消息不可回放：${payload?.error || "未知原因"}` });
    return;
  }
  const evs = payload.events || [];
  if (!evs.length) return;
  session.replayDone = true;
  addBlock({ kind: "replay-divider", count: evs.length });
  for (const ev of evs) {
    if (ev.kind === "user") {
      addBlock({ kind: "user", text: ev.text });
    } else if (ev.kind === "assistant") {
      addBlock({ kind: "agent", raw: ev.text, live: false });
    } else if (ev.kind === "thought") {
      addBlock({ kind: "thought", id: "replay-" + session.replayDone, raw: ev.text, live: false });
    } else if (ev.kind === "tool_call") {
      addBlock({
        kind: "tool", id: "replay:" + ev.id, title: ev.title || "tool",
        rawInput: typeof ev.rawInput === "string" ? ev.rawInput : JSON.stringify(ev.rawInput, null, 2),
        status: "ok", output: "", live: false,
      });
    } else if (ev.kind === "tool_result") {
      const item = useChatStore().findTool("replay:" + ev.id);
      if (item) item.output = ev.text || "";
    }
  }
}

/* ---------- queue ---------- */

export function queuePrompt(text: string) {
  const chat = useChatStore();
  const app = useAppStore();
  if (chat.queue.length >= 5) { app.toast("队列已满（5），请等当前任务完成"); return; }
  chat.queue.push(text);
  app.toast("已排队 · 当前任务完成后自动发送");
}

export function dequeueNext() {
  const chat = useChatStore();
  if (!chat.queue.length || chat.prompting) return;
  const next = chat.queue.shift() as string;
  sendNow(next);
}

export function clearQueue() {
  useChatStore().clearQueue();
}

export function sendNow(text: string) {
  const chat = useChatStore();
  addBlock({ kind: "user", text });
  chat.resetStream();
  chat.usage = "";
  chat.lastPromptText = text;
  sendCmd("session/prompt", { text });
}

export function retryPrompt() {
  const chat = useChatStore();
  if (!chat.lastPromptText || chat.prompting) return;
  addBlock({ kind: "user", text: chat.lastPromptText, meta: "你 · 重试" });
  chat.resetStream();
  sendCmd("session/prompt", { text: chat.lastPromptText });
}

/* ---------- reconnect / health ---------- */

export function reconnect() {
  const app = useAppStore();
  const chat = useChatStore();
  app.hideAlert();
  chat.clearQueue();
  app.reconnecting = true;
  sendCmd("boot", { cwd: app.lastCwd });
}

export function switchModel(configId: string, value: string) {
  const session = useSessionStore();
  const app = useAppStore();
  if (!session.sessionId) { app.toast("会话未就绪，无法切换"); return; }
  sendCmd("session/set_config", { configId, value });
  app.toast("已下发切换，dsh 返回后刷新");
}

/* ---------- boot ---------- */

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/acp`;
}

export function boot() {
  const app = useAppStore();
  if (app.tauri) {
    const t = tauri();
    t.event.listen("session/update", (e: any) => handleMsg({ type: "session/update", payload: e.payload }));
    t.event.listen("permission/request", (e: any) => handleMsg({ type: "permission/request", payload: e.payload }));
    t.event.listen("stderr", (e: any) => handleMsg({ type: "stderr", payload: e.payload }));
    t.event.listen("exit", (e: any) => handleMsg({ type: "exit", payload: e.payload }));
    t.core
      .invoke("health")
      .then((h: any) => {
        app.healthState = h;
        if (!h?.ok) {
          app.showAlert("warn", "未找到 dsh（本机经 nvmd shim 安装）。请确认 PATH 中包含 dsh 后重试。", "重试", reconnect);
        } else if (h?.uncleanLastExit) {
          app.toast("上次未正常退出，可从「会话历史」恢复");
        }
      })
      .catch(() => {});
    sendCmd("boot", {});
    return;
  }
  ws = new WebSocket(wsUrl());
  ws.onopen = () => sendCmd("boot", {});
  ws.onmessage = (ev) => handleMsg(JSON.parse(ev.data));
  ws.onclose = () => handleMsg({ type: "exit", payload: { code: 0 } });
}

export { mdAvailable, renderMarkdown, esc };
