#!/usr/bin/env node
/** Lock negative case: booting the same profile from a second connection must be refused. */
import WebSocket from "ws";

const boot = (ws) =>
  new Promise((res, rej) => {
    ws.on("message", function h(raw) {
      const m = JSON.parse(String(raw));
      if (m.type === "booted") { ws.off("message", h); res(true); }
      if (m.type === "error") { ws.off("message", h); res(m.payload?.message || "error"); }
    });
    ws.send(JSON.stringify({ type: "boot", payload: { cwd: "E:\\VibeCodingProject\\DshDeck" } }));
    setTimeout(() => rej(new Error("timeout")), 40000);
  });

const a = new WebSocket("ws://127.0.0.1:5177/acp");
await new Promise((r) => a.on("open", r));
const first = await boot(a);
console.log("first boot:", typeof first === "boolean" ? "OK" : first);

const b = new WebSocket("ws://127.0.0.1:5177/acp");
await new Promise((r) => b.on("open", r));
const second = await boot(b);
console.log("second boot:", second);
console.log(second === true ? "FAIL — double boot allowed!" : "PASS — double boot refused");
process.exit(second === true ? 1 : 0);
