/**
 * W0 probe: force tool use + capture permission / tool session/update shapes.
 * Usage: node probe/acp-probe-tools.mjs
 */
import { AcpBridge } from "../packages/acp-client/index.mjs";

const b = new AcpBridge({ cwd: "E:\\VibeCodingProject" });
const seen = new Set();
const log = (k, v) => {
  const s = JSON.stringify(v);
  const key = k + ":" + s.slice(0, 80);
  if (!seen.has(key)) {
    seen.add(key);
    console.log(k, s.slice(0, 500));
  }
};

b.on((evt) => {
  if (evt.kind === "message") {
    const m = evt.msg;
    if (m.method === "session/update") {
      const u = m.params.update;
      log("UPDATE", u);
    } else {
      log("NOTIFY", m);
    }
  }
  if (evt.kind === "send") {
    // skip noise
  }
});

const agent = await b.start();
console.log("caps", JSON.stringify(agent.agentCapabilities, null, 2));

const s = await b.sessionNew();
console.log("session", s.sessionId);

// Force tools: ask agent to write a file (should hit fs.writeTextFile + possibly permission)
const prompt =
  'Use the write_file / fs.writeTextFile tool to create a file named probe-tool.txt in the current workspace with content "hello-dshdeck". Then reply DONE.';

console.log("=== prompt ===");
try {
  const r = await Promise.race([
    b.sessionPrompt(s.sessionId, prompt),
    new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 45000)),
  ]);
  if (r && r.__timeout) {
    console.log("timeout — sending cancel");
    try { await b.sessionCancel(s.sessionId); console.log("cancel ok"); }
    catch (e) { console.log("cancel fail", e.message); }
  } else {
    console.log("stop", r);
  }
} catch (e) {
  console.log("prompt error", e.message, e.acp);
}

// resume probe
console.log("=== resume candidates ===");
for (const method of ["session/resume", "session/load", "session/replay", "session/loadSession"]) {
  try {
    const r = await b.call(method, { sessionId: s.sessionId });
    console.log(method, "OK", JSON.stringify(r).slice(0, 300));
  } catch (e) {
    console.log(method, "FAIL", e.message);
  }
}

try {
  const list = await b.sessionList();
  console.log("list", JSON.stringify(list).slice(0, 400));
} catch (e) {
  console.log("list fail", e.message);
}

await b.sessionClose(s.sessionId).catch(() => {});
b.stop();
console.log("TOOLS_PROBE_DONE");
