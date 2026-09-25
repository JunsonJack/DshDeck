<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useChatStore } from "../stores";
import Composer from "./Composer.vue";
import { retryPrompt } from "../lib/transport";
import { renderMarkdown, mdAvailable } from "../lib/markdown";

const chat = useChatStore();
const streamEl = ref<HTMLElement | null>(null);

watch(
  () => chat.items.map((i) => (i.raw || i.output || "")).join("|") + "|" + chat.items.length,
  async () => {
    await nextTick();
    if (streamEl.value) streamEl.value.scrollTop = streamEl.value.scrollHeight;
  }
);

function statusText(s: string) {
  if (s === "running") return "运行中";
  if (s === "ok") return "完成";
  if (s === "err") return "失败";
  return s || "…";
}
</script>

<template>
  <div ref="streamEl" class="stream">
    <template v-for="(item, idx) in chat.items" :key="idx">
      <div v-if="item.kind === 'user'" class="flow">
        <div class="msg-user">
          <div class="meta">{{ item.meta || "你" }}</div>{{ item.text }}
        </div>
      </div>

      <div v-else-if="item.kind === 'agent'" class="flow">
        <div class="msg-stream" :class="{ md: mdAvailable, 'cursor-blink': item.live }" v-html="renderMarkdown(item.raw)"></div>
        <div v-if="item.live && chat.usage" class="usage">{{ chat.usage }}</div>
      </div>

      <div v-else-if="item.kind === 'thought'" class="flow">
        <details class="panel">
          <summary>
            <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            <span class="panel-title">思考</span>
            <div class="grow"></div>
            <span v-if="item.live" class="status running"><span class="run-dot"></span>thought</span>
          </summary>
          <div class="panel-body" :class="{ md: mdAvailable }" v-html="renderMarkdown(item.raw)"></div>
        </details>
      </div>

      <div v-else-if="item.kind === 'tool'" class="flow">
        <details class="panel" :open="item.live">
          <summary>
            <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            <span class="panel-title mono">{{ item.title }}</span>
            <div class="grow"></div>
            <span class="status" :class="item.status === 'running' ? 'running' : item.status === 'ok' ? 'ok' : item.status === 'err' ? 'err' : ''">
              <span v-if="item.status === 'running'" class="run-dot"></span>{{ statusText(item.status) }}
            </span>
          </summary>
          <div class="panel-body">
            <div class="blk-label">输入</div>
            <pre>{{ item.rawInput }}</pre>
            <div class="blk-label">观察</div>
            <div class="tool-out">{{ item.output }}<span v-if="item.live" class="cursor-blink"></span></div>
          </div>
        </details>
      </div>

      <div v-else-if="item.kind === 'say'" class="flow">
        <div class="say"><p :class="item.cls === 'err' ? 'sys-err' : 'sys-warn'" style="margin:0">{{ item.text }}</p></div>
      </div>

      <div v-else-if="item.kind === 'error'" class="flow">
        <div class="say">
          <p class="sys-err" style="margin:0 0 8px">出错：{{ item.text }}</p>
          <button v-if="item.retry" class="btn" @click="retryPrompt()">重试上一条</button>
        </div>
      </div>

      <div v-else-if="item.kind === 'hint'" class="flow">
        <div class="say"><p class="hint" style="margin:0">{{ item.text }}</p></div>
      </div>

      <div v-else-if="item.kind === 'replay-divider'" class="replay-divider"><span>历史回放 · {{ item.count }} 条</span></div>
    </template>
  </div>
  <div class="dock">
    <button v-if="chat.queue.length" class="queue-bar" title="点击移除最后一条排队消息" @click="chat.queue.pop()">
      <span>已排队 {{ chat.queue.length }}：{{ chat.queue[0]?.slice(0, 42) }}</span>
      <span class="hint">点击移除末条</span>
    </button>
    <Composer />
  </div>
</template>
