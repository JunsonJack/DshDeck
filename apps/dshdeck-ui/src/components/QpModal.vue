<script setup lang="ts">
import { useUiStore } from "../stores";
import { closeMq } from "../lib/uiActions";

const ui = useUiStore();

function up(i: number) {
  if (i <= 0) return;
  const d = ui.mqDraft;
  [d[i - 1], d[i]] = [d[i], d[i - 1]];
}
function down(i: number) {
  const d = ui.mqDraft;
  if (i >= d.length - 1) return;
  [d[i + 1], d[i]] = [d[i], d[i + 1]];
}
function del(i: number) {
  ui.mqDraft.splice(i, 1);
}
function add() {
  if (ui.mqDraft.length < 30) ui.mqDraft.push("");
}
function reset() {
  ui.mqDraft = ui.quickPrompts.slice();
}
function done() {
  ui.quickPrompts = ui.mqDraft.map((s: string) => s.trim()).filter(Boolean).slice(0, 30);
  ui.saveQp();
  closeMq();
}
</script>

<template>
  <div v-if="ui.mqOpen" class="modal-mask open" @click.self="closeMq()">
    <div class="modal">
      <div class="modal-head">
        <h2>管理快捷消息</h2>
        <p>排序 / 增删，最多 30 条，保存在本机。</p>
        <button class="close" title="关闭" @click="closeMq()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div v-for="(t, i) in ui.mqDraft" :key="i" class="mq-row">
          <input v-model="ui.mqDraft[i]" />
          <button class="mq-act" title="上移" @click="up(i)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
          </button>
          <button class="mq-act" title="下移" @click="down(i)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>
          </button>
          <button class="mq-act" title="删除" @click="del(i)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
          </button>
        </div>
      </div>
      <div class="modal-mid">
        <button class="btn" @click="add()">＋ 添加</button>
      </div>
      <div class="modal-foot">
        <button class="linkish" @click="reset()">恢复默认</button>
        <div class="grow"></div>
        <button class="btn primary" @click="done()">完成</button>
      </div>
    </div>
  </div>
</template>
