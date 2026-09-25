import { defineStore } from "pinia";

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

function loadQp(): string[] {
  try {
    const raw = localStorage.getItem("dshdeck.quickMessages");
    if (raw) return JSON.parse(raw);
  } catch { /* fallthrough */ }
  return DEFAULT_QP.slice();
}
function loadCustomModels(): any[] {
  try { return JSON.parse(localStorage.getItem("dshdeck.customModels") ?? "[]"); } catch { return []; }
}

/* ---------- app / transport / theme / alerts ---------- */
export const useAppStore = defineStore("app", {
  state: () => ({
    tauri: !!(window as any).__TAURI__,
    theme: localStorage.getItem("dshdeck.theme") === "light" ? "light" : "dark",
    connected: false,
    agentInfo: null as any,
    healthState: null as any,
    lastCwd: "",
    reconnecting: false,
    pendingResume: false,
    alert: null as null | { kind: "warn" | "danger"; text: string; actionLabel?: string; action?: () => void },
    toastMsg: "",
    toastShow: false,
    toastTimer: null as ReturnType<typeof setTimeout> | null,
  }),
  actions: {
    setTheme(t: string) {
      this.theme = t;
      document.documentElement.dataset.theme = t;
      localStorage.setItem("dshdeck.theme", t);
    },
    toggleTheme() {
      this.setTheme(this.theme === "dark" ? "light" : "dark");
    },
    toast(msg: string) {
      this.toastMsg = msg;
      this.toastShow = true;
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => (this.toastShow = false), 2400);
    },
    showAlert(kind: "warn" | "danger", text: string, actionLabel?: string, action?: () => void) {
      this.alert = { kind, text, actionLabel, action };
    },
    hideAlert() {
      this.alert = null;
    },
  },
});

/* ---------- session lifecycle / history ---------- */
export const useSessionStore = defineStore("session", {
  state: () => ({
    sessionId: null as string | null,
    lastSessionId: null as string | null,
    lastTitles: {} as Record<string, string>,
    sessions: [] as any[],
    replay: null as any,
    replayDone: false,
  }),
});

/* ---------- transcript / queue / approvals ---------- */
export const useChatStore = defineStore("chat", {
  state: () => ({
    items: [] as any[],
    prompting: false,
    usage: "",
    lastPromptText: "",
    queue: [] as string[],
    perms: [] as any[],
  }),
  getters: {
    chatMode: (s) => s.items.length > 0,
  },
  actions: {
    push(item: any) {
      this.items.push(item);
    },
    resetStream() {
      this.items = this.items.filter((i) => i.kind !== "agent" || !i.live);
      this.usage = "";
    },
    findTool(id: string): any {
      return this.items.find((i) => i.kind === "tool" && i.id === id);
    },
    clearQueue() {
      this.queue = [];
    },
  },
});

/* ---------- config options / model catalog / custom models ---------- */
export const useConfigStore = defineStore("config", {
  state: () => ({
    configOptions: [] as any[],
    modelConfig: null as any,
    customModels: loadCustomModels(),
  }),
  getters: {
    model(state): any {
      return state.configOptions.find((o: any) => o.id === "model");
    },
    modelCur(): string | undefined {
      return this.model?.currentValue;
    },
    flatModels(state): any[] {
      const out: any[] = [];
      for (const g of this.model?.options || []) {
        for (const o of g.options || [g]) out.push(o);
      }
      return out;
    },
    modelLabel(): string {
      const cur = this.flatModels.find((o) => o.value === this.model?.currentValue) || this.flatModels[0];
      return cur?.name || this.model?.currentValue || "…";
    },
    effort(state): any {
      return state.configOptions.find((o: any) => o.id === "reasoning_effort");
    },
    effortLabel(): string {
      return this.effort?.currentValue || "…";
    },
  },
  actions: {
    applyConfigOptions(options: any[]) {
      this.configOptions = options || [];
    },
    saveCustomModels() {
      localStorage.setItem("dshdeck.customModels", JSON.stringify(this.customModels.slice(0, 20)));
    },
    addCustom(provider: string, modelId: string): boolean {
      const value = JSON.stringify([provider, modelId]);
      if (this.customModels.some((m: any) => m.value === value)) return false;
      this.customModels.push({ name: modelId, provider, value });
      this.saveCustomModels();
      return true;
    },
    removeCustom(value: string) {
      this.customModels = this.customModels.filter((m: any) => m.value !== value);
      this.saveCustomModels();
    },
  },
});

/* ---------- ui surfaces (popovers / modals / drawer) ---------- */
export const useUiStore = defineStore("ui", {
  state: () => ({
    quickPrompts: loadQp(),
    qpOpen: false,
    qpQuery: "",
    qpPage: 1,
    mqOpen: false,
    mqDraft: [] as string[],
    modelPop: false,
    diffOpen: false,
    diff: null as any,
    settingsOpen: false,
    settingsSection: "status",
    draft: "",
  }),
  actions: {
    saveQp() {
      localStorage.setItem("dshdeck.quickMessages", JSON.stringify(this.quickPrompts));
    },
  },
});
