#!/usr/bin/env node
/** Verify: cancel-as-notification settles the in-flight prompt; set_config_option actually takes effect. */
import { AcpBridge } from "../packages/acp-client/index.mjs";

const b = new AcpBridge({ cwd: "E:\\VibeCodingProject\\DshDeck" });
await b.start();
const s = await b.sessionNew();

console.log("== set effort → low (configId shape) ==");
const r1 = await b.call("session/set_config_option", { sessionId: s.sessionId, configId: "reasoning_effort", value: "low" });
const eff = (r1.configOptions || []).find((o) => o.id === "reasoning_effort");
console.log("effort now:", eff?.currentValue);

console.log("== set model → deepseek-v4-pro ==");
const r2 = await b.call("session/set_config_option", {
  sessionId: s.sessionId,
  configId: "model",
  value: '["deepseek-official","deepseek-v4-pro"]',
});
const model = (r2.configOptions || []).find((o) => o.id === "model");
console.log("model now:", model?.currentValue);
const eff2 = (r2.configOptions || []).find((o) => o.id === "reasoning_effort");
console.log("effort persisted:", eff2?.currentValue);

console.log("== notify-cancel settles in-flight prompt ==");
const t0 = Date.now();
const long = b.sessionPrompt(s.sessionId, "用中文写一篇约1000字的关于分布式系统的短文。");
await new Promise((r) => setTimeout(r, 2000));
b.notify("session/cancel", { sessionId: s.sessionId });
console.log("cancel notification sent at", Date.now() - t0, "ms");
const settled = await long.then(
  (r) => ({ stop: r.stopReason, ms: Date.now() - t0 }),
  (e) => ({ err: String(e.message).slice(0, 90), ms: Date.now() - t0 })
);
console.log("long prompt settled:", JSON.stringify(settled));
const again = await b.sessionPrompt(s.sessionId, "Say only: PONG");
console.log("post-cancel prompt:", JSON.stringify(again).slice(0, 100));

await b.sessionClose(s.sessionId).catch(() => {});
b.stop();
console.log("DONE");
