#!/usr/bin/env node
/** Focused probe: set_config_option param shapes, session/new initial config, streaming cancel. */
import { AcpBridge } from "../packages/acp-client/index.mjs";

const b = new AcpBridge({ cwd: "E:\\VibeCodingProject\\DshDeck" });
b.on((evt) => {
  if (evt.kind === "request") console.log("REQUEST:", evt.msg.method, JSON.stringify(evt.msg.params).slice(0, 300));
});
await b.start();

const s = await b.sessionNew();
console.log("session:", s.sessionId);

console.log("\n== A. set_config_option param shapes ==");
const shapes = [
  ["configOptionId+value", { sessionId: s.sessionId, configOptionId: "reasoning_effort", value: "low" }],
  ["id+value", { sessionId: s.sessionId, id: "reasoning_effort", value: "low" }],
  ["config_option_id+value", { sessionId: s.sessionId, config_option_id: "reasoning_effort", value: "low" }],
  ["configId+value", { sessionId: s.sessionId, configId: "reasoning_effort", value: "low" }],
  ["configOption obj", { sessionId: s.sessionId, configOption: { id: "reasoning_effort", value: "low" } }],
  ["name+value", { sessionId: s.sessionId, name: "reasoning_effort", value: "low" }],
  ["configOptionId+value+sessionIdNum", { sessionId: s.sessionId, configOptionId: 1, value: "low" }],
];
for (const [label, params] of shapes) {
  try {
    const r = await b.call("session/set_config_option", params);
    console.log("OK  ", label, JSON.stringify(r).slice(0, 140));
    break;
  } catch (e) {
    console.log("FAIL", label, "→", String(e.message).slice(0, 90));
  }
}

console.log("\n== B. session/new with initial config ==");
const variants = [
  ["configOptions array", { configOptions: [{ id: "reasoning_effort", value: "low" }] }],
  ["config obj", { config: { reasoning_effort: "low" } }],
  ["flat key", { reasoning_effort: "low" }],
];
for (const [label, extra] of variants) {
  try {
    const s2 = await b.call("session/new", { cwd: "E:\\VibeCodingProject\\DshDeck", mcpServers: {}, ...extra });
    const eff = (s2.configOptions || []).find((o) => o.id === "reasoning_effort");
    console.log("OK  ", label, "→ effort =", eff?.currentValue);
    await b.sessionClose(s2.sessionId).catch(() => {});
  } catch (e) {
    console.log("FAIL", label, "→", String(e.message).slice(0, 90));
  }
}

console.log("\n== C. streaming cancel ==");
const long = b.sessionPrompt(s.sessionId, "用中文写一篇约800字的关于计算机网络的短文。");
await new Promise((r) => setTimeout(r, 2500));
try {
  const cr = await b.sessionCancel(s.sessionId);
  console.log("cancel call ok:", JSON.stringify(cr).slice(0, 100));
} catch (e) {
  console.log("cancel FAIL:", String(e.message).slice(0, 100));
}
const settled = await long.then((r) => ({ stop: r.stopReason }), (e) => ({ err: String(e.message).slice(0, 90) }));
console.log("long prompt settled:", JSON.stringify(settled));
try {
  const again = await b.sessionPrompt(s.sessionId, "Say only: PONG");
  console.log("post-cancel prompt ok:", JSON.stringify(again).slice(0, 100));
} catch (e) {
  console.log("post-cancel FAIL:", String(e.message).slice(0, 100));
}

await b.sessionClose(s.sessionId).catch(() => {});
b.stop();
console.log("DONE");
