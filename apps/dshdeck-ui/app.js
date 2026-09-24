const $ = (id) => document.getElementById(id);

let ws = null;
let sessionId = null;
let prompting = false;
let streamEl = null;
let usageEl = null;
let qpPage = 1;
let qpQuery = "";
let mqDraft = [];
const QP_PAGE_SIZE = 8;

const DEFAULT_QP = [
  "你好，你是什么模型",
  "继续",
  "用中文回答我",
  "给出完整可运行的文件",
  "只改必要文件，不要重构无关代码",
  "先给方案，确认后再改代码",
  "Say only: PONG",
  "总结当前目录结构",
  "解释这段改动的风险点",
  "补一组回归测试",
  "检查是否误写了 ~/.dsh",
  "提交",
  "推送",
  "提交推送",
];
let QUICK_PROMPTS = loadQp();

function loadQp() {
  try {
    const raw = localStorage.getItem("dshdeck.quickMessages");
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_QP.slice();
}
function saveQp() {
  localStorage.setItem("dshdeck.quickMessages", JSON.stringify(QUICK_PROMPTS));
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* heatmap */
function renderHeat(mode) {
  const weeks = 53;
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const bias = w / weeks;
      const n = Math.sin(w * 0.7 + d) * 0.5 + 0.5;
      const r = n * 0.35 + bias * 0.65;
      let level = 0;
      if (mode === "credits") {
        if (r > 0.92) level = 4;
        else if (r > 0.84) level = 3;
        else if (r > 0.72) level = 2;
        else if (r > 0.58) level = 1;
      } else {
        if (r > 0.9) level = 3;
        else if (r > 0.78) level = 2;
        else if (r > 0.62) level = 1;
      }
      if (w === weeks - 1 && d === 0) level = mode === "credits" ? 4 : 3;
      cells.push(level);
    }
  }
  $("heatGrid").innerHTML = cells.map((lv) => `<div class="heat-cell${lv ? " l" + lv : ""}"></div>`).join("");
  const monthLabels = ["10月","11月","12月","1月","2月","3月","4月","5月","6月","7月","8月","9月"];
  $("heatMonths").innerHTML = monthLabels.map((m) => `<span style="width:${Math.round((weeks * 13) / 12)}px">${m}</span>`).join("");
}
document.querySelectorAll("[data-heat]").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("[data-heat]").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    renderHeat(b.dataset.heat);
  };
});
renderHeat("session");

/* quick prompts */
function qpFiltered() {
  const q = qpQuery.trim().toLowerCase();
  return q ? QUICK_PROMPTS.filter((t) => t.toLowerCase().includes(q)) : QUICK_PROMPTS;
}
function renderQp() {
  const items = qpFiltered();
  const pages = Math.max(1, Math.ceil(items.length / QP_PAGE_SIZE));
  if (qpPage > pages) qpPage = pages;
  const slice = items.slice((qpPage - 1) * QP_PAGE_SIZE, qpPage * QP_PAGE_SIZE);
  $("qpCount").textContent = "共 " + items.length + " 条";
  $("qpList").innerHTML = slice.map((t, i) => `
    <button class="qp-item ${i === 0 ? "hl" : ""}" data-t="${esc(t)}">
      <span class="txt">${esc(t)}</span><span class="qp-send" data-send="1">➤</span>
    </button>`).join("") || `<div class="hint" style="padding:16px;text-align:center">无匹配</div>`;
  $("qpPages").innerHTML = Array.from({ length: pages }, (_, i) => {
    const n = i + 1;
    return `<button class="qp-page ${n === qpPage ? "on" : ""}" data-p="${n}">${n}</button>`;
  }).join("");
  $("qpPrev").disabled = qpPage <= 1;
  $("qpNext").disabled = qpPage >= pages;
  $("qpList").querySelectorAll(".qp-item").forEach((row) => {
    row.onclick = (e) => {
      const t = row.dataset.t;
      if (e.target.closest("[data-send]")) { insertQp(t); send(); }
      else insertQp(t);
    };
  });
  $("qpPages").querySelectorAll("[data-p]").forEach((b) => {
    b.onclick = () => { qpPage = +b.dataset.p; renderQp(); };
  });
}
function currentInput() {
  return document.body.classList.contains("chat-mode") ? $("input") : $("inputW");
}
function insertQp(t) {
  currentInput().value = t;
  currentInput().focus();
  closeQp();
}
function openQp() {
  $("qpPop").classList.add("open");
  qpQuery = ""; qpPage = 1;
  $("qpSearch").value = "";
  renderQp();
  setTimeout(() => $("qpSearch").focus(), 0);
}
function closeQp() { $("qpPop").classList.remove("open"); }
$("btnQp").onclick = $("btnQpW").onclick = (e) => {
  e.stopPropagation();
  $("qpPop").classList.contains("open") ? closeQp() : openQp();
};
$("qpSearch").oninput = (e) => { qpQuery = e.target.value; qpPage = 1; renderQp(); };
$("qpSearch").onkeydown = (e) => {
  if (e.key === "Enter") { e.preventDefault(); const f = qpFiltered()[0]; if (f) insertQp(f); }
  if (e.key === "Escape") closeQp();
};
$("qpPrev").onclick = () => { if (qpPage > 1) { qpPage--; renderQp(); } };
$("qpNext").onclick = () => {
  const pages = Math.max(1, Math.ceil(qpFiltered().length / QP_PAGE_SIZE));
  if (qpPage < pages) { qpPage++; renderQp(); }
};
$("qpSort").onclick = (e) => { e.stopPropagation(); openMq(); };
document.addEventListener("click", (e) => {
  if (!e.target.closest("#qpPop") && !e.target.closest("#btnQp") && !e.target.closest("#btnQpW")) closeQp();
});

function openMq() {
  mqDraft = QUICK_PROMPTS.slice();
  renderMq();
  $("mqMask").classList.add("open");
}
function closeMq() { $("mqMask").classList.remove("open"); }
function renderMq() {
  $("mqList").innerHTML = mqDraft.map((t, i) => `
    <div class="mq-row" data-i="${i}">
      <input value="${esc(t)}" data-edit="${i}" />
      <button class="mq-act" data-up="${i}">↑</button>
      <button class="mq-act" data-down="${i}">↓</button>
      <button class="mq-act" data-del="${i}">🗑</button>
    </div>`).join("");
  $("mqList").querySelectorAll("[data-edit]").forEach((inp) => {
    inp.oninput = () => { mqDraft[+inp.dataset.edit] = inp.value; };
  });
  $("mqList").querySelectorAll("[data-up]").forEach((b) => {
    b.onclick = () => { const i = +b.dataset.up; if (i <= 0) return; [mqDraft[i-1], mqDraft[i]] = [mqDraft[i], mqDraft[i-1]]; renderMq(); };
  });
  $("mqList").querySelectorAll("[data-down]").forEach((b) => {
    b.onclick = () => { const i = +b.dataset.down; if (i >= mqDraft.length - 1) return; [mqDraft[i+1], mqDraft[i]] = [mqDraft[i], mqDraft[i+1]]; renderMq(); };
  });
  $("mqList").querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => { mqDraft.splice(+b.dataset.del, 1); renderMq(); };
  });
}
$("mqAdd").onclick = () => { if (mqDraft.length < 30) { mqDraft.push(""); renderMq(); } };
$("mqReset").onclick = () => { mqDraft = DEFAULT_QP.slice(); renderMq(); };
$("mqClose").onclick = closeMq;
$("mqDone").onclick = () => {
  QUICK_PROMPTS = mqDraft.map((s) => s.trim()).filter(Boolean).slice(0, 30);
  saveQp();
  closeMq();
  toast("已保存快捷消息");
};
$("mqMask").onclick = (e) => { if (e.target === $("mqMask")) closeMq(); };

/* stream UI */
function enterChat() {
  document.body.classList.add("chat-mode");
}
function addBlock(html) {
  enterChat();
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  while (wrap.firstChild) $("stream").appendChild(wrap.firstChild);
  $("stream").scrollTop = $("stream").scrollHeight;
}
function setRunning(on) {
  prompting = on;
  [$("btnSend"), $("btnSendW")].forEach((b) => {
    b.classList.toggle("stop", on);
    b.textContent = on ? "■" : "↑";
    b.title = on ? "中断" : "发送";
  });
  [$("spin"), $("spinW")].forEach((s) => s.classList.toggle("on", on));
}
function ensureStream() {
  if (!streamEl) {
    addBlock(`<div class="flow"><div class="msg-stream cursor-blink" id="liveStream"></div><div class="usage" id="liveUsage"></div></div>`);
    streamEl = $("liveStream");
    usageEl = $("liveUsage");
  }
}
function appendChunk(text) {
  ensureStream();
  streamEl.textContent += text;
  $("stream").scrollTop = $("stream").scrollHeight;
}
function endStreamCursor() {
  if (streamEl) streamEl.classList.remove("cursor-blink");
}

/** TAO blocks */
function addThought(messageId, text) {
  addBlock(`<div class="flow"><details class="panel"><summary><span>▶</span><strong>思考</strong><span class="status running"><span class="run-dot"></span>Thought</span></summary><div class="panel-body" data-thought="${esc(messageId)}">${esc(text)}</div></details></div>`);
}
function appendThought(messageId, text) {
  const el = document.querySelector(`[data-thought="${CSS.escape(messageId)}"]`);
  if (el) el.textContent += text;
  else addThought(messageId, text);
  $("stream").scrollTop = $("stream").scrollHeight;
}
function addToolCard(u) {
  const id = u.toolCallId;
  const input = u.rawInput ? JSON.stringify(u.rawInput, null, 2) : "";
  addBlock(`<div class="flow"><details class="panel" id="tool-${esc(id)}" open>
    <summary>
      <span>▶</span>
      <strong class="mono">${esc(u.title || u.kind || "tool")}</strong>
      <div class="grow"></div>
      <span class="status running" data-tool-st="${esc(id)}"><span class="run-dot"></span>运行中</span>
    </summary>
    <div class="panel-body">
      <div class="hint">输入</div>
      <pre class="code" style="margin:4px 0 8px;padding:8px 10px;background:#F3F6FA;border:1px solid var(--line);border-radius:8px;overflow:auto">${esc(input)}</pre>
      <div class="hint">观察</div>
      <div class="panel-body" style="padding:4px 0 0" data-tool-out="${esc(id)}"><span class="cursor-blink"></span></div>
    </div>
  </details></div>`);
}
function updateToolCard(u) {
  const id = u.toolCallId;
  const st = document.querySelector(`[data-tool-st="${CSS.escape(id)}"]`);
  const out = document.querySelector(`[data-tool-out="${CSS.escape(id)}"]`);
  const status = u.status || "";
  if (st) {
    if (status === "completed") st.innerHTML = "✓ 完成", st.className = "status ok";
    else if (status === "failed" || status === "error") st.innerHTML = "✕ 失败", st.className = "status err";
    else if (status === "in_progress") st.innerHTML = '<span class="run-dot"></span>运行中', st.className = "status running";
    else st.textContent = status || "…";
  }
  if (out && u.content) {
    const texts = [];
    for (const c of u.content) {
      if (c?.content?.text) texts.push(c.content.text);
      else if (c?.text) texts.push(c.text);
      else texts.push(JSON.stringify(c));
    }
    out.textContent = texts.join("\n");
    out.classList.remove("cursor-blink");
  }
  $("stream").scrollTop = $("stream").scrollHeight;
}

/** Permission approval card (when ACP sends request) */
function addPermissionCard(id, method, params) {
  const label = params?.title || params?.toolCall?.title || method;
  const desc = params?.rawInput ? JSON.stringify(params.rawInput).slice(0, 180) : (params?.kind || "");
  addBlock(`<div class="flow"><div class="approval" id="perm-${esc(id)}" style="background:linear-gradient(180deg,#FFF8EE,#fff 45%);border:1px solid #F0D2A0;border-radius:12px;padding:14px 16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span class="status" style="background:var(--warn-soft);color:var(--warn)">◌ 待审批</span>
      <strong class="mono">${esc(label)}</strong>
    </div>
    <div style="color:var(--ink-2)">${esc(desc)}</div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn primary" data-perm-allow="${esc(id)}" style="height:32px;padding:0 14px;border-radius:999px">允许一次</button>
      <button class="btn" data-perm-deny="${esc(id)}" style="height:32px;padding:0 14px;border-radius:999px;border:1px solid var(--line-2)">拒绝</button>
    </div>
  </div></div>`);
  document.querySelector(`[data-perm-allow="${CSS.escape(id)}"]`)?.addEventListener("click", () => {
    resolvePerm(id, true);
  });
  document.querySelector(`[data-perm-deny="${CSS.escape(id)}"]`)?.addEventListener("click", () => {
    resolvePerm(id, false);
  });
}
function resolvePerm(id, allow) {
  const card = document.getElementById("perm-" + id);
  if (card) {
    card.style.borderColor = allow ? "#A8E0C0" : "#F0D2A0";
    card.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
      <span class="status ${allow ? "ok" : "denied"}">${allow ? "✓ 已批准" : "⊘ 已拒绝"}</span>
    </div>`;
  }
  sendCmd("permission/response", { id: Number(id) || id, allow });
}

/** Diff drawer */
function renderDiff(payload) {
  const list = $("diffList");
  if (!payload?.ok) {
    list.innerHTML = `<div class="hint" style="padding:16px">${esc(payload?.error || "工作区不是 git 仓库，无法审阅 diff")}</div>`;
    return;
  }
  if (!payload.files?.length) {
    list.innerHTML = `<div class="hint" style="padding:16px">工作区干净（无未提交改动）</div>`;
    $("diffMeta").textContent = "0 文件";
    return;
  }
  $("diffMeta").textContent = payload.files.length + " 文件";
  list.innerHTML = payload.files.map((f) => {
    const patch = (f.patch || "")
      .split("\n")
      .map((line) => {
        const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
        return `<div class="${cls}">${esc(line)}</div>`;
      })
      .join("");
    return `<div class="diff-file" style="border:1px solid var(--line);border-radius:10px;margin-bottom:8px;overflow:hidden;background:#F8FAFC">
      <div style="display:flex;gap:8px;padding:8px 10px;background:#fff;border-bottom:1px solid var(--line);font-family:var(--mono);font-size:11px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.path)}</span>
        <span class="hint">${esc(f.kind)}</span>
      </div>
      <div style="font-family:var(--mono);font-size:11px;line-height:1.55;padding:6px 0">${patch || '<div class="ctx">（无 patch）</div>'}</div>
    </div>`;
  }).join("");
}

/* model labels from configOptions */
function applyConfigOptions(options) {
  const model = options.find((o) => o.id === "model");
  const effort = options.find((o) => o.id === "reasoning_effort");
  let modelLabel = "model";
  if (model) {
    const flat = [];
    for (const g of model.options || []) {
      if (g.options) flat.push(...g.options);
      else flat.push(g);
    }
    const cur = flat.find((o) => o.value === model.currentValue) || flat[0];
    modelLabel = cur?.name || model.currentValue || "model";
  }
  const effortLabel = effort?.currentValue || "high";
  document.querySelectorAll("[data-model]").forEach((n) => (n.textContent = modelLabel));
  document.querySelectorAll("[data-effort]").forEach((n) => (n.textContent = effortLabel));
}
function cycleModel() {
  toast("模型/思考强度来自 dsh configOptions（M1 展示当前值）");
}

/* transport: Tauri IPC or WebSocket host */
const TauriAPI = (() => {
  try {
    if (window.__TAURI__?.core?.invoke) {
      return {
        invoke: window.__TAURI__.core.invoke,
        listen: window.__TAURI__.event.listen,
      };
    }
    if (window.__TAURI_INTERNALS__) {
      return {
        invoke: (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args),
        listen: async (ev, cb) => {
          // fallback: poll-less; use event API if present
          if (window.__TAURI__?.event?.listen) return window.__TAURI__.event.listen(ev, (e) => cb(e.payload));
          return () => {};
        },
      };
    }
  } catch {}
  return null;
})();

const TauriCmd = {
  boot: "boot",
  "session/new": "session_new",
  "session/list": "session_list",
  "session/resume": "session_resume",
  "session/prompt": "session_prompt",
  "session/cancel": "session_cancel",
  "session/close": "session_close",
  "git/diff": "git_diff",
  "git/status": "git_status",
  shutdown: "session_close",
};

function sendCmd(type, payload = {}) {
  if (TauriAPI) {
    const cmd = TauriCmd[type];
    if (!cmd) return;
    const args = { ...payload };
    if (type === "session/resume") {
      args.sessionId = payload.sessionId || payload.session_id;
      args.cwd = payload.cwd || "";
    }
    if (type === "session/prompt") args.text = payload.text;
    handleMsg({ type: "prompt/start", payload: {} });
    TauriAPI.invoke(cmd, args)
      .then((result) => {
        if (type === "boot") {
          handleMsg({ type: "booted", payload: { agent: result, cwd: "" } });
          sendCmd("session/new", {});
          return;
        }
        if (type === "session/new") {
          handleMsg({ type: "session/ready", payload: result });
        } else if (type === "session/resume") {
          handleMsg({
            type: "session/ready",
            payload: { ...result, resumed: true, sessionId: args.sessionId },
          });
        } else if (type === "session/list") {
          handleMsg({ type: "session/list", payload: result });
        } else if (type === "session/prompt") {
          handleMsg({ type: "prompt/stop", payload: result });
        } else if (type === "session/cancel") {
          handleMsg({ type: "prompt/cancelled", payload: {} });
        } else if (type === "git/diff") {
          handleMsg({ type: "git/diff", payload: result });
        } else if (type === "git/status") {
          handleMsg({ type: "git/status", payload: result });
        }
      })
      .catch((e) => {
        if (type === "session/prompt") handleMsg({ type: "prompt/error", payload: { message: String(e) } });
        else handleMsg({ type: "error", payload: { message: String(e) } });
      });
    return;
  }
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, payload }));
}

function handleMsg(msg) {
  const { type, payload } = msg;
    if (type === "booted") {
      $("healthText").textContent = `${payload.agent?.agentInfo?.name || "dsh"} · 就绪`;
      $("crumb").textContent = `工作区 ${payload.cwd}`;
      $("health").classList.remove("warn", "err");
      // auto session
      ws.send(JSON.stringify({ type: "session/new" }));
    } else if (type === "session/ready") {
      sessionId = payload.sessionId;
      applyConfigOptions(payload.configOptions || []);
      $("crumb").textContent = payload.resumed ? `已 resume · ${sessionId || ""}` : `会话 ${sessionId || ""}`;
      toast(payload.resumed ? "已恢复历史会话" : "会话已就绪");
    } else if (type === "session/update") {
      const u = payload.update || {};
      if (u.sessionUpdate === "agent_message_chunk") {
        appendChunk(u.content?.text ?? "");
      } else if (u.sessionUpdate === "agent_thought_chunk") {
        appendThought(u.messageId || "t", u.content?.text ?? "");
      } else if (u.sessionUpdate === "tool_call") {
        addToolCard(u);
      } else if (u.sessionUpdate === "tool_call_update") {
        updateToolCard(u);
      } else if (u.sessionUpdate === "usage_update") {
        ensureStream();
        if (usageEl) usageEl.textContent = `tokens ${u.used} / ${u.size}`;
      } else {
        ensureStream();
        appendChunk(`\n[${u.sessionUpdate}] ${JSON.stringify(u).slice(0, 200)}`);
      }
    } else if (type === "permission/request") {
      addPermissionCard(payload.id, payload.method, payload.params);
    } else if (type === "permission/resolved") {
      toast(payload.allow ? "已允许" : "已拒绝");
    } else if (type === "git/diff") {
      renderDiff(payload);
    } else if (type === "git/status") {
      if (payload.ok) toast("改动 " + (payload.files?.length || 0) + " 个文件");
    } else if (type === "prompt/start") {
      setRunning(true);
      streamEl = null; usageEl = null;
    } else if (type === "prompt/stop") {
      setRunning(false);
      endStreamCursor();
      toast("完成 · " + (payload.stopReason || ""));
      // refresh diff after each turn
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "git/diff" }));
    } else if (type === "prompt/error") {
      setRunning(false);
      endStreamCursor();
      addBlock(`<div class="say"><p style="color:var(--danger)">出错：${esc(payload.message)}</p></div>`);
    } else if (type === "prompt/cancelled") {
      setRunning(false);
      endStreamCursor();
      addBlock(`<div class="say"><p style="color:var(--warn)">已中断</p></div>`);
    } else if (type === "session/list") {
      const list = payload.sessions || [];
      $("sideTitle").textContent = "会话历史 · " + list.length;
      $("projList").innerHTML = list.map((s) =>
        `<button class="proj" data-sid="${esc(s.sessionId)}" data-cwd="${esc(s.cwd || "")}" title="${esc(s.cwd || "")}">
          <span class="name">${esc(s.sessionId)}</span>
        </button>`
      ).join("") || `<div class="hint" style="padding:12px">无历史会话</div>`;
      $("projList").querySelectorAll("[data-sid]").forEach((btn) => {
        btn.onclick = () => {
          if (!ws || ws.readyState !== 1) return;
          toast("resume…");
          ws.send(JSON.stringify({
            type: "session/resume",
            payload: { sessionId: btn.dataset.sid, cwd: btn.dataset.cwd },
          }));
        };
      });
    } else if (type === "stderr") {
      console.warn("dsh", payload.text);
    } else if (type === "error") {
      toast(payload.message);
    } else if (type === "exit") {
      $("healthText").textContent = "连接已退出";
      $("health").classList.add("err");
    }
}

function boot() {
  if (TauriAPI) {
    TauriAPI.listen("session/update", (payload) => handleMsg({ type: "session/update", payload }));
    TauriAPI.listen("permission/request", (payload) => handleMsg({ type: "permission/request", payload }));
    TauriAPI.listen("stderr", (payload) => handleMsg({ type: "stderr", payload }));
    TauriAPI.listen("exit", (payload) => handleMsg({ type: "exit", payload }));
    TauriAPI.invoke("health")
      .then((h) => {
        $("healthText").textContent = h?.ok ? "dsh 就绪" : "未找到 dsh";
        if (!h?.ok) $("health").classList.add("warn");
      })
      .catch(() => {});
    sendCmd("boot", {});
    return;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/acp`);
  ws.onopen = () => sendCmd("boot", {});
  ws.onmessage = (ev) => handleMsg(JSON.parse(ev.data));
  ws.onclose = () => {
    $("healthText").textContent = "WebSocket 断开";
    $("health").classList.add("err");
  };
}

function send() {
  if (prompting) {
    sendCmd("session/cancel");
    return;
  }
  const ta = currentInput();
  const text = ta.value.trim();
  if (!text) { toast("输入任务或点 ☰ 选快捷消息"); return; }
  addBlock(`<div class="flow"><div class="bubble-user"><div class="meta">你</div>${esc(text)}</div></div>`);
  ta.value = "";
  streamEl = null; usageEl = null;
  sendCmd("session/prompt", { text });
}

$("btnSendW").onclick = send;
$("btnSend").onclick = send;
$("btnModelW").onclick = $("btnModel").onclick = cycleModel;
$("btnPerm").onclick = $("btnPerm2").onclick = () => toast("权限模式（M1：询问）");
$("btnDiff").onclick = () => {
  $("diffPane").classList.toggle("open");
  sendCmd("git/diff");
};
$("diffClose").onclick = () => $("diffPane").classList.remove("open");
$("btnShutdown").onclick = () => {
  sendCmd("shutdown");
};
$("navNew").onclick = () => {
  document.body.classList.remove("chat-mode");
  $("stream").innerHTML = "";
  streamEl = null;
  sendCmd("session/new");
};
$("navHist").onclick = () => {
  sendCmd("session/list");
};
$("navHealth").onclick = () => toast("dsh 经 ACP 已连接（见右上状态）");
$("modeRow").onclick = () => toast("模式：聊天");
document.querySelectorAll("#seg button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("#seg button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  };
});

[$("inputW"), $("input")].forEach((ta) => {
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === "Escape") {
      if ($("mqMask").classList.contains("open")) closeMq();
      else if ($("qpPop").classList.contains("open")) closeQp();
      else if (prompting) send();
    }
  });
});

$("projList").innerHTML = `<div class="hint" style="padding:12px">点「会话历史」加载 resume 列表</div>`;
boot();
