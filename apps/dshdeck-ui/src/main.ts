import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./style.css";
import { boot } from "./lib/transport";

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
boot();
