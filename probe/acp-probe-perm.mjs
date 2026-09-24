/**
 * Probe ACP methods related to permission / config.
 */
import { AcpBridge } from "../packages/acp-client/index.mjs";

const b = new AcpBridge({ cwd: "E:\\VibeCodingProject" });
b.on((evt) => {
  if (evt.kind === "message") {
    console.log("MSG", JSON.stringify(evt.msg).slice(0, 400));
  }
});
await b.start();
const s = await b.sessionNew();
console.log("config", JSON.stringify(s.configOptions).slice(0, 500));

const methods = [
  ["session/setConfig", { sessionId: s.sessionId, config: { permission_mode: "ask" } }],
  ["session/set_config", { sessionId: s.sessionId, permission_mode: "ask" }],
  ["session/updateConfig", { sessionId: s.sessionId, updates: { permission_mode: "default" } }],
  ["session/request_permission", { sessionId: s.sessionId }],
  ["permission/request", { sessionId: s.sessionId }],
  ["session/setPermissionMode", { sessionId: s.sessionId, mode: "default" }],
];
for (const [m, p] of methods) {
  try {
    const r = await b.call(m, p);
    console.log(m, "OK", JSON.stringify(r).slice(0, 200));
  } catch (e) {
    console.log(m, "FAIL", e.message);
  }
}

// list all methods via invalid to see error? try method not found list
for (const m of ["tools/list", "session/tools", "agent/tools", "capabilities"]) {
  try {
    const r = await b.call(m, { sessionId: s.sessionId });
    console.log(m, "OK", JSON.stringify(r).slice(0, 250));
  } catch (e) {
    console.log(m, "FAIL", e.message);
  }
}

await b.sessionClose(s.sessionId).catch(() => {});
b.stop();
console.log("DONE");
