<script setup lang="ts">
import { useUiStore, useConfigStore } from "../stores";
import { switchModel } from "../lib/transport";
import { closeModelPop } from "../lib/uiActions";

const ui = useUiStore();
const config = useConfigStore();

const allModels = () => [
  ...config.flatModels,
  ...config.customModels.map((m: any) => ({ value: m.value, name: m.name, description: `自定义 · ${m.provider}` })),
];
</script>

<template>
  <div v-if="ui.modelPop" class="modal-backdrop-transparent" @click="closeModelPop()"></div>
  <div v-if="ui.modelPop" class="model-pop open">
    <div class="mp-sec">模型</div>
    <div>
      <button
        v-for="o in allModels()" :key="o.value"
        class="mp-item" :class="{ sel: o.value === config.modelCur }"
        @click="switchModel('model', o.value); closeModelPop()"
      >
        <span class="mp-check">✓</span>
        <span>{{ o.name }}<span v-if="o.description" class="mp-desc">{{ o.description }}</span></span>
      </button>
      <div v-if="!allModels().length" class="hint" style="padding:4px 8px">未获取到模型列表</div>
    </div>
    <div class="mp-sec">思考强度</div>
    <div>
      <button
        v-for="o in config.effort?.options || []" :key="o.value"
        class="mp-item" :class="{ sel: o.value === config.effort?.currentValue }"
        :title="o.description || ''"
        @click="switchModel('reasoning_effort', o.value); closeModelPop()"
      >
        <span class="mp-check">✓</span><span>{{ o.name }} · {{ o.value }}</span>
      </button>
      <div v-if="!config.effort?.options?.length" class="hint" style="padding:4px 8px">未获取到思考强度</div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop-transparent { position: fixed; inset: 0; z-index: 44; }
.model-pop.open { display: block; }
</style>
