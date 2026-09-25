<script setup lang="ts">
import { useUiStore } from "../stores";
import { closeDiff } from "../lib/uiActions";
import { esc } from "../lib/markdown";

const ui = useUiStore();

function lineClass(line: string) {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  return "ctx";
}
function counts(patch: string) {
  const lines = (patch || "").split("\n");
  return {
    add: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
    del: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
  };
}
function safeLine(line: string) {
  return esc(line) || " ";
}
</script>

<template>
  <div class="diff" :class="{ open: ui.diffOpen }">
    <div class="diff-head">
      <span>改动审阅</span><span class="diff-meta">{{ (ui.diff?.files || []).length }} 文件</span>
      <div class="grow"></div>
      <button class="icon" title="关闭" @click="closeDiff()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="diff-list">
      <template v-if="ui.diff?.ok">
        <div v-if="!ui.diff.files?.length" class="hint" style="padding:4px 2px">工作区干净（无未提交改动）</div>
        <div v-for="f in ui.diff.files" :key="f.path" class="diff-file">
          <div class="diff-file-head">
            <span class="path">{{ f.path }}</span>
            <span class="stat-add">+{{ counts(f.patch).add }}</span><span class="stat-del">-{{ counts(f.patch).del }}</span>
            <span class="kind">{{ f.kind }}</span>
          </div>
          <div class="diff-patch">
            <div v-for="(line, i) in (f.patch || '').split('\n')" :key="i" :class="lineClass(line)" v-html="safeLine(line)"></div>
          </div>
        </div>
      </template>
      <div v-else class="hint" style="padding:4px 2px">{{ ui.diff?.error || "派活后点这里审阅工作区改动（git diff）。" }}</div>
    </div>
  </div>
</template>
