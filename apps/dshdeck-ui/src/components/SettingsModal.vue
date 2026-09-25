<script setup lang="ts">
import { computed, ref } from "vue";
import { useAppStore, useConfigStore, useSessionStore, useUiStore } from "../stores";
import { closeSettings } from "../lib/uiActions";
import { switchModel } from "../lib/transport";

const app = useAppStore();
const config = useConfigStore();
const session = useSessionStore();
const ui = useUiStore();
const addProvider = ref("");
const addModelId = ref("");

const statusRows = computed<[string, string][]>(() => [
  ["ACP 连接", app.connected ? `<span class="dot"></span>已连接` : `<span class="dot err"></span>未连接`],
  ["Agent", app.agentInfo ? `${app.agentInfo.name} · ${app.agentInfo.version || ""}` : "—"],
  ["dsh 可执行", app.healthState ? (app.healthState.dsh ? app.healthState.dsh : "未在 PATH 中找到") : "经宿主进程管理"],
  ["上次退出", app.healthState ? (app.healthState.uncleanLastExit ? "异常" : "正常") : "—"],
  ["当前会话", session.sessionId || "—"],
  ["工作区", app.lastCwd || "—"],
]);

function addCustom() {
  const provider = addProvider.value.trim();
  const modelId = addModelId.value.trim();
  if (!provider || !modelId) {
    app.toast("Provider 和 Model ID 都要填");
    return;
  }
  if (!config.addCustom(provider, modelId)) {
    app.toast("该模型已存在");
    return;
  }
  addProvider.value = "";
  addModelId.value = "";
  app.toast("已添加自定义模型");
}
</script>

<template>
  <div v-if="ui.settingsOpen" class="modal-mask open" @click.self="closeSettings()">
    <div class="modal settings-modal">
      <div class="settings-modal-body">
        <aside class="settings-menu">
          <div class="settings-menu-title">设置</div>
          <button class="sm-item" :class="{ active: ui.settingsSection === 'status' }" @click="ui.settingsSection = 'status'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            <span>状态</span>
          </button>
          <button class="sm-item" :class="{ active: ui.settingsSection === 'models' }" @click="ui.settingsSection = 'models'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="7" width="14" height="10" rx="2"/><path d="M12 3v4M12 17v4M9 12h.01M15 12h.01"/></svg>
            <span>模型配置</span>
          </button>
        </aside>
        <div class="settings-content">
          <div v-show="ui.settingsSection === 'status'" class="settings-pane active">
            <div class="settings-sec">
              <div class="settings-sec-title">核心与 ACP 状态</div>
              <div class="status-grid">
                <template v-for="(row, i) in statusRows" :key="i">
                  <div class="k">{{ row[0] }}</div>
                  <div class="v" v-html="row[1]"></div>
                </template>
              </div>
            </div>
          </div>
          <div v-show="ui.settingsSection === 'models'" class="settings-pane active">
            <div class="settings-sec">
              <div class="settings-sec-title">模型</div>
              <p class="hint" style="margin:0 0 10px">「dsh」来源的模型来自各 profile 配置，可直接切换；自定义模型仅保存在本机，切换时经 ACP 下发给 dsh，若 dsh 侧未配置该模型会被拒绝。</p>
              <div class="prov-toolbar"><span>{{ (config.modelConfig?.providers || []).length + 1 }} 个供应商</span></div>
              <details v-for="p in config.modelConfig?.providers || []" :key="p.key" class="prov" :open="p.models.some((m: any) => m.active)">
                <summary>
                  <span class="p-name">{{ p.displayName }}</span>
                  <span class="chip">{{ p.models.length }} 模型</span>
                  <span class="p-base">{{ p.baseURL || "" }}</span>
                </summary>
                <div class="m-table">
                  <div class="m-tr head"><span>ID</span><span>名称</span><span>上下文</span><span>Profile</span><span>操作</span></div>
                  <div v-for="m in p.models" :key="m.id" class="m-tr">
                    <span class="mono">{{ m.id }}</span>
                    <span>{{ m.name }}<span v-if="m.active" class="chip cur">可选</span></span>
                    <span class="mono">{{ m.contextWindow || "" }}</span>
                    <span><span v-for="pf in m.profiles" :key="pf" class="chip prof">{{ pf }}</span></span>
                    <span class="ops">
                      <button v-if="m.active" class="btn" :disabled="!session.sessionId" @click="switchModel('model', JSON.stringify([p.key, m.id]))">切换</button>
                      <button v-else class="btn" disabled title="该模型定义在其它 profile；当前 profile 未配置（壳不代写 ~/.dsh）">需配置</button>
                    </span>
                  </div>
                </div>
              </details>
              <details class="prov" :open="config.customModels.length > 0">
                <summary><span class="p-name">自定义</span><span class="chip">{{ config.customModels.length }} 模型</span><span class="p-base">仅保存在本机</span></summary>
                <div class="m-table">
                  <div class="m-tr head"><span>ID</span><span>名称</span><span>上下文</span><span>Profile</span><span>操作</span></div>
                  <div v-for="m in config.customModels" :key="m.value" class="m-tr">
                    <span class="mono">{{ m.name }}</span>
                    <span class="mono" style="font-size:10.5px">{{ m.value }}</span>
                    <span></span>
                    <span><span class="chip prof">本机</span></span>
                    <span class="ops">
                      <button class="btn" :disabled="!session.sessionId" @click="switchModel('model', m.value)">切换</button>
                      <button class="btn danger" @click="config.removeCustom(m.value); app.toast('已删除自定义模型')">删除</button>
                    </span>
                  </div>
                  <div v-if="!config.customModels.length" class="m-tr"><span class="hint">暂无自定义模型</span></div>
                </div>
              </details>
              <div class="add-model">
                <input v-model="addProvider" placeholder="Provider（如 deepseek-official）" spellcheck="false" />
                <input v-model="addModelId" placeholder="Model ID（如 deepseek-v4-x）" spellcheck="false" />
                <button class="btn primary" @click="addCustom()">添加</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <button class="close" title="关闭" @click="closeSettings()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
  </div>
</template>
