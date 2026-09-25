<script setup lang="ts">
import { useUiStore, useChatStore, useConfigStore, useAppStore } from "../stores";
import { toggleQp, toggleModelPop } from "../lib/uiActions";
import { sendCmd, sendNow, queuePrompt } from "../lib/transport";

const ui = useUiStore();
const chat = useChatStore();
const config = useConfigStore();
const app = useAppStore();

function onSend() {
  const text = ui.draft.trim();
  if (chat.prompting) {
    if (text) {
      queuePrompt(text);
      ui.draft = "";
    } else {
      sendCmd("session/cancel");
    }
    return;
  }
  if (!text) {
    app.toast("输入任务，或从快捷消息中选择");
    return;
  }
  ui.draft = "";
  sendNow(text);
}
</script>

<template>
  <div class="composer">
    <textarea v-model="ui.draft" rows="2" placeholder="描述任务，派给 dsh…（Enter 发送 · Shift+Enter 换行）"></textarea>
    <div class="bar">
      <div class="qp-wrap">
        <button class="icon" title="快捷消息" @click.stop="toggleQp()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>
        </button>
      </div>
      <div class="spin" :class="{ on: chat.prompting }"></div>
      <button class="model" title="模型 · 思考强度（当前值来自 dsh）" @click.stop="toggleModelPop()">
        <span>{{ config.modelLabel }}</span><span class="sep">·</span><span>{{ config.effortLabel }}</span>
      </button>
      <button class="send" :class="{ stop: chat.prompting }" :title="chat.prompting ? '中断' : '发送'" @click="onSend()">
        <svg v-if="!chat.prompting" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>
      </button>
    </div>
  </div>
</template>
