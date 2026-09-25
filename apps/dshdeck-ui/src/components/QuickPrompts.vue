<script setup lang="ts">
import { computed } from "vue";
import { useUiStore } from "../stores";
import { closeQp, openMq } from "../lib/uiActions";
import { sendNow } from "../lib/transport";

const ui = useUiStore();

const filtered = computed(() => {
  const q = ui.qpQuery.trim().toLowerCase();
  return q ? ui.quickPrompts.filter((t: string) => t.toLowerCase().includes(q)) : ui.quickPrompts;
});
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 8)));
const slice = computed(() => filtered.value.slice((ui.qpPage - 1) * 8, ui.qpPage * 8));

function insert(t: string) {
  ui.draft = t;
  closeQp();
}
function insertAndSend(t: string) {
  ui.draft = "";
  closeQp();
  sendNow(t);
}
</script>

<template>
  <div v-if="ui.qpOpen" class="qp-pop open">
    <div class="qp-top">
      <div class="qp-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input v-model="ui.qpQuery" placeholder="搜索快捷消息…" @keydown.enter.prevent="insert(filtered[0] || '')" />
      </div>
      <button class="qp-icon" title="管理快捷消息" @click.stop="openMq()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>
      </button>
    </div>
    <div class="qp-tip">点条目插入输入框 · 右侧箭头直接发送 · 回车插入首条</div>
    <div class="qp-list">
      <button
        v-for="(t, i) in slice" :key="i"
        class="qp-item" :class="{ hl: i === 0 }"
        @click="insert(t)"
      >
        <span class="txt">{{ t }}</span>
        <span class="qp-send" @click.stop="insertAndSend(t)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </span>
      </button>
      <div v-if="!slice.length" class="hint" style="padding:16px;text-align:center">无匹配</div>
    </div>
    <div class="qp-foot">
      <span>共 {{ filtered.length }} 条</span>
      <div class="grow"></div>
      <div class="qp-pager">
        <button class="qp-page" :disabled="ui.qpPage <= 1" @click="ui.qpPage--">‹</button>
        <button
          v-for="n in pages" :key="n"
          class="qp-page" :class="{ on: n === ui.qpPage }"
          @click="ui.qpPage = n"
        >{{ n }}</button>
        <button class="qp-page" :disabled="ui.qpPage >= pages" @click="ui.qpPage++">›</button>
      </div>
    </div>
  </div>
</template>
