/** Quick tool-card shape check via bridge */
import { AcpBridge } from "../packages/acp-client/index.mjs";

const b = new AcpBridge({ cwd: "E:\\VibeCodingProject" });
const kinds = new Set();
b.on((evt) => {
  if (evt.kind === "message" && evt.msg.method === "session/update") {
    const u = evt.msg.params.update;
    kinds.add(u.sessionUpdate);
    if (u.sessionUpdate.startsWith("tool_")) {
      console.log(u.sessionUpdate, u.toolCallId, u.status || u.title, Object.keys(u));
    }
  }
});
await b.start();
const s = await b.sessionNew();
const r = await b.sessionPrompt(
  s.sessionId,
  "Use the write tool to create probe-tool2.txt with content ok. Then say DONE."
);
console.log("stop", r);
console.log("kinds", [...kinds].join(","));
// resume a historical session
const list = await b.sessionList();
const hist = (list.sessions || []).find((x) => String(x.sessionId).startsWith("session-"));
if (hist) {
  try {
    const rr = await b.sessionResume(hist.sessionId, hist.cwd);
    console.log("RESUMED", hist.sessionId, rr.sessionId || "(same)", (rr.configOptions || []).length);
  } catch (e) {
    console.log("RESUME FAIL", e.message);
  }
}
await b.sessionClose(s.sessionId).catch(() => {});
b.stop();
console.log("OK");
