<script setup lang="ts">
import { onMounted, watch } from "vue";
import Sidebar from "./components/Sidebar.vue";
import TitleBar from "./components/TitleBar.vue";
import AlertBar from "./components/AlertBar.vue";
import WelcomeView from "./components/WelcomeView.vue";
import ChatView from "./components/ChatView.vue";
import ModelPopover from "./components/ModelPopover.vue";
import QuickPrompts from "./components/QuickPrompts.vue";
import DiffDrawer from "./components/DiffDrawer.vue";
import SettingsModal from "./components/SettingsModal.vue";
import QpModal from "./components/QpModal.vue";
import Toast from "./components/Toast.vue";
import { useChatStore, useUiStore, useAppStore } from "./stores";
import { sendCmd, reconnect } from "./lib/transport";
import { closeSettings, closeQp, closeModelPop, closeMq } from "./lib/uiActions";

const chat = useChatStore();
const ui = useUiStore();
const app = useAppStore();

watch(
  () => chat.chatMode,
  (v) => document.body.classList.toggle("chat-mode", v)
);
watch(
  () => app.theme,
  (t) => (document.documentElement.dataset.theme = t),
  { immediate: true }
);

onMounted(() => {
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (ui.mqOpen) ui.mqOpen = false;
    else if (ui.settingsOpen) closeSettings();
    else if (ui.qpOpen) closeQp();
    else if (ui.modelPop) closeModelPop();
    else if (chat.prompting) sendCmd("session/cancel");
  });
  reconnect; // re-exported reference keeps import used
});

sendCmd; // keep import referenced (called inside stores/components)
reconnect;
</script>

<template>
  <div class="shell">
    <Sidebar />
    <section class="main">
      <TitleBar />
      <div class="stage">
        <AlertBar />
        <WelcomeView />
        <ChatView />
        <ModelPopover />
        <QuickPrompts />
        <DiffDrawer />
      </div>
    </section>
    <SettingsModal />
    <QpModal />
    <Toast />
  </div>
</template>
