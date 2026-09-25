<script setup lang="ts">
import logo from "../assets/dsh-mark.svg";
import { useSessionStore } from "../stores";
import Composer from "./Composer.vue";
import { sendCmd } from "../lib/transport";

const session = useSessionStore();
</script>

<template>
  <div class="welcome">
    <div class="welcome-inner">
      <div>
        <img class="app-logo" :src="logo" alt="" width="52" height="52" />
        <h1>派个活给 dsh</h1>
        <p class="sub">会话过程实时可见 · 工具调用需审批 · 改动可用 diff 审阅</p>
      </div>
      <Composer />
      <div class="recent">
        <div class="recent-head"><span>最近会话</span></div>
        <button
          v-for="s in session.sessions.slice(0, 6)" :key="s.sessionId"
          class="recent-row" :title="`${s.title ? '标题: ' + s.title + '\n' : ''}ID: ${s.sessionId}\n${s.cwd || ''}`"
          @click="sendCmd('session/resume', { sessionId: s.sessionId, cwd: s.cwd })"
        >
          <span class="sid">{{ s.title || s.sessionId }}</span><span class="cwd">{{ s.cwd || "" }}</span>
        </button>
        <div v-if="!session.sessions.length" class="hint" style="padding:2px">暂无会话记录</div>
      </div>
    </div>
  </div>
</template>
