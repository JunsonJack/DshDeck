/** Smoke: boot ACP bridge, new session, short prompt, close. */
import { AcpBridge } from "../packages/acp-client/index.mjs";

const b = new AcpBridge({ cwd: "E:\\VibeCodingProject" });
b.on((evt) => {
  if (evt.kind === "message") {
    const m = evt.msg;
    if (m.method === "session/update") {
      const u = m.params.update;
      console.log("UPDATE", u.sessionUpdate, u.content?.text ?? u.used ?? "");
    }
  }
});

const agent = await b.start();
console.log("AGENT", agent.agentInfo);
const s = await b.sessionNew();
console.log("SESSION", s.sessionId);
console.log("CONFIG", (s.configOptions || []).map((o) => o.id + "=" + o.currentValue).join(", "));
const r = await b.sessionPrompt(s.sessionId, "Reply with exactly: M1-OK");
console.log("STOP", r);
await b.sessionClose(s.sessionId);
b.stop();
console.log("SMOKE_OK");
