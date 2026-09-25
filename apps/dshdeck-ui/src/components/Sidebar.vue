<script setup lang="ts">
import logo from "../assets/dsh-mark.svg";
import { useAppStore, useSessionStore } from "../stores";
import { newSession, openHistory, openSettings } from "../lib/uiActions";
import { sendCmd } from "../lib/transport";

const app = useAppStore();
const session = useSessionStore();
</script>

<template>
  <aside class="side">
    <div class="side-top">
      <div class="brand">
        <img class="brand-mark" :src="logo" alt="" width="22" height="22" />
        <span>DshDeck</span><span class="ver">0.1.0</span>
      </div>
    </div>
    <div class="nav-list">
      <button class="nav-item" title="新建会话" @click="newSession()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        <span>新建会话</span>
      </button>
      <button class="nav-item" title="会话历史（resume）" @click="openHistory()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>
        <span>会话历史</span>
      </button>
    </div>
    <div class="sec-head">会话</div>
    <div class="proj-list">
      <button
        v-for="s in session.sessions" :key="s.sessionId"
        class="proj" :title="`${s.title ? '标题: ' + s.title + '\n' : ''}ID: ${s.sessionId}\n${s.cwd || ''}`"
        @click="sendCmd('session/resume', { sessionId: s.sessionId, cwd: s.cwd })"
      >
        <span class="name">{{ s.title || s.sessionId }}</span>
      </button>
      <div v-if="!session.sessions.length" class="hint" style="padding:8px">会话列表将显示在这里</div>
    </div>
    <footer class="side-foot">
      <button class="tbtn" title="设置" @click="openSettings()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
      <span class="grow"></span>
      <span>dsh · acp</span>
    </footer>
  </aside>
</template>
