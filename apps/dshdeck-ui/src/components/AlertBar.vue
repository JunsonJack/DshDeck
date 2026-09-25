<script setup lang="ts">
import { useAppStore } from "../stores";

const app = useAppStore();
</script>

<template>
  <div v-if="app.alert" class="alert" :class="app.alert.kind">
    <span>{{ app.alert.text }}</span>
    <div class="grow"></div>
    <button v-if="app.alert.actionLabel" class="btn" @click="app.alert.action?.()">{{ app.alert.actionLabel }}</button>
    <button class="tbtn" title="关闭" @click="app.hideAlert()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  </div>
</template>
