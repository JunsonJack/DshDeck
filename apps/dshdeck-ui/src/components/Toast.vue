<script setup lang="ts">
import { useAppStore } from "../stores";

const app = useAppStore();
</script>

<template>
  <div class="toast" :class="{ show: app.toastShow }">{{ app.toastMsg }}</div>
</template>
