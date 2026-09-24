/**
 * UI-flow smoke test — replays the exact message sequence apps/dshdeck-ui sends,
 * against the running host (ws://127.0.0.1:5177/acp).
 */
import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:5177/acp");
const updates = [];
let pass = 0, fail = 0;

function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

function send(type, payload = {}) {
  ws.send(JSON.stringify({ type, payload }));
}

function waitOnce(type, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${type}`)), timeoutMs);
    const onMsg = (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === type) {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve(m);
      } else if (m.type === "session/update") {
        updates.push(m.payload?.update?.sessionUpdate);
      }
    };
    ws.on("message", onMsg);
  });
}

ws.on("open", async () => {
  try {
    // 1. boot
    send("boot", { cwd: "E:\\VibeCodingProject\\DshDeck" });
    const booted = await waitOnce("booted", 40000);
    check("booted", !!booted.payload?.agent?.agentInfo, JSON.stringify(booted.payload).slice(0, 120));

    // 2. session/new (auto after booted, as UI does)
    send("session/new", {});
    const ready = await waitOnce("session/ready", 30000);
    check("session/ready", !!ready.payload?.sessionId, "no sessionId");
    check("configOptions present", Array.isArray(ready.payload?.configOptions) && ready.payload.configOptions.length > 0);

    // 3. prompt (short, model round-trip)
    send("session/prompt", { text: "Say only: PONG" });
    const stop = await waitOnce("prompt/stop", 60000);
    check("prompt/stop", stop.payload?.stopReason === "end_turn", `stopReason=${stop.payload?.stopReason}`);
    check("stream updates received", updates.some((u) => u === "agent_message_chunk"), `updates=[${updates.join(",")}]`);

    // 4. git/diff (this workspace is a git repo)
    send("git/diff", {});
    const diff = await waitOnce("git/diff", 15000);
    check("git/diff ok", diff.payload?.ok === true && diff.payload?.git === true);

    // 5. permission/response for unknown id → graceful error, no crash
    send("permission/response", { id: 9999, allow: true });
    const err = await waitOnce("error", 10000);
    check("permission/response graceful", /pending permission/i.test(err.payload?.message || ""), err.payload?.message);

    console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.log(`FATAL: ${e.message}`);
    process.exit(1);
  }
});

ws.on("error", (e) => { console.log(`WS error: ${e.message}`); process.exit(1); });
