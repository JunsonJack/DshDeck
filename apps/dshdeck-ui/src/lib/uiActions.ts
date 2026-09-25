import { useUiStore } from "../stores";
import { useAppStore } from "../stores";
import { useChatStore } from "../stores";
import { sendCmd } from "./transport";

export function toggleTheme() {
  useAppStore().toggleTheme();
}
export function toggleDiff() {
  const ui = useUiStore();
  ui.diffOpen = !ui.diffOpen;
  sendCmd("git/diff");
}
export function closeDiff() {
  useUiStore().diffOpen = false;
}
export function shutdown() {
  sendCmd("shutdown");
}
export function newSession() {
  const chat = useChatStore();
  closeSettings();
  chat.items = [];
  chat.usage = "";
  chat.prompting = false;
  sendCmd("session/new");
}
export function openHistory() {
  closeSettings();
  sendCmd("session/list");
}
export function openSettings() {
  const ui = useUiStore();
  ui.settingsOpen = true;
  ui.settingsSection = "status";
  sendCmd("model/config", { profile: "acp" });
}
export function closeSettings() {
  useUiStore().settingsOpen = false;
}
export function closeQp() {
  useUiStore().qpOpen = false;
}
export function toggleQp() {
  const ui = useUiStore();
  ui.qpOpen = !ui.qpOpen;
  if (ui.qpOpen) {
    ui.qpQuery = "";
    ui.qpPage = 1;
  }
}
export function closeModelPop() {
  useUiStore().modelPop = false;
}
export function toggleModelPop() {
  const ui = useUiStore();
  ui.modelPop = !ui.modelPop;
}
export function closeMq() {
  useUiStore().mqOpen = false;
}
export function openMq() {
  const ui = useUiStore();
  ui.mqDraft = ui.quickPrompts.slice();
  ui.mqOpen = true;
}
