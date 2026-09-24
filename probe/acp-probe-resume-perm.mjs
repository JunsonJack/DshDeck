/**
 * W0: discover session/resume params + permission request shape.
 */
import { AcpBridge } from "../packages/acp-client/index.mjs";

const b = new AcpBridge({ cwd: "E:\\VibeCodingProject" });
b.on((evt) => {
  if (evt.kind === "message") {
    const m = evt.msg;
    if (m.method === "session/update") {
      const u = m.params.update;
      if (u.sessionUpdate !== "usage_update") console.log("U", JSON.stringify(u).slice(0, 300));
    } else {
      console.log("N", JSON.stringify(m).slice(0, 400));
    }
  }
});

await b.start();
const s = await b.sessionNew();
console.log("sid", s.sessionId);

// --- resume param shapes ---
const candidates = [
  { sessionId: s.sessionId },
  { id: s.sessionId },
  { session_id: s.sessionId },
  { sessionId: s.sessionId, cwd: "E:\\VibeCodingProject" },
];
// also try a historical id from list
const list = await b.sessionList();
const hist = list.sessions?.find((x) => x.sessionId.startsWith("session-")) || list.sessions?.[0];
if (hist) {
  candidates.push({ sessionId: hist.sessionId });
  candidates.push({ sessionId: hist.sessionId, cwd: hist.cwd });
  candidates.push({ id: hist.sessionId });
}

for (const p of candidates) {
  try {
    const r = await b.call("session/resume", p);
    console.log("RESUME OK", JSON.stringify(p), JSON.stringify(r).slice(0, 400));
  } catch (e) {
    console.log("RESUME FAIL", JSON.stringify(p), e.message);
  }
}

// --- permission: try shell / delete ---
for (const text of [
  "Run a shell command that just echoes PERM_PROBE (use the bash/shell tool). Reply DONE.",
  "Delete the file named probe-tool.txt in the workspace if it exists. Reply DONE.",
]) {
  console.log("=== prompt ===", text.slice(0, 40));
  try {
    const r = await Promise.race([
      b.sessionPrompt(s.sessionId, text),
      new Promise((res) => setTimeout(() => res({ __t: 1 }), 35000)),
    ]);
    console.log("stop", r);
    if (r && r.__t) await b.sessionCancel(s.sessionId).catch(() => {});
  } catch (e) {
    console.log("prompt fail", e.message);
  }
}

await b.sessionClose(s.sessionId).catch(() => {});
b.stop();
console.log("DONE");
