import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: "./",
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      "/acp": { target: "ws://127.0.0.1:5177", ws: true },
    },
  },
});
