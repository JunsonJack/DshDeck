<script setup lang="ts">
import { computed } from "vue";
import { useAppStore, useSessionStore } from "../stores";
import { toggleTheme, toggleDiff, shutdown } from "../lib/uiActions";

const app = useAppStore();
const session = useSessionStore();

const crumb = computed(() => {
  if (!app.connected && !session.sessionId) return "未连接";
  if (app.lastCwd && !session.sessionId) return `工作区 ${app.lastCwd}`;
  const resumedTitle = session.lastTitles[session.sessionId || ""];
  if (resumedTitle) return `已恢复 · ${resumedTitle}`;
  return session.sessionId ? `会话 ${session.sessionId}` : "未连接";
});
const healthText = computed(() => {
  if (app.connected) return `${app.agentInfo?.name || "dsh"} · 就绪`;
  if (app.healthState && !app.healthState.ok) return "未找到 dsh";
  return app.connected ? "就绪" : "启动中…";
});
const healthCls = computed(() => (app.connected ? "" : app.healthState && !app.healthState.ok ? "warn" : "err"));
</script>

<template>
  <div class="titlebar">
    <div class="crumb">{{ crumb }}</div>
    <div class="grow"></div>
    <div class="pill" :class="healthCls"><span class="dot"></span><span>{{ healthText }}</span></div>
    <button class="tbtn" title="切换主题" @click="toggleTheme()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
    </button>
    <button class="tbtn" title="审阅改动（git diff）" @click="toggleDiff()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z"/><path d="M13 3v6h6M12 12v5M9.5 14.5h5"/></svg>
    </button>
    <button class="tbtn close" title="断开连接" @click="shutdown()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
</template>
