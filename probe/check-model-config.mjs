import { readModelConfig } from "../packages/dsh-readonly/model-config.mjs";
import { readSessionTitles } from "../packages/dsh-readonly/session-replay.mjs";

const r = readModelConfig("acp");
console.log("ok:", r.ok, "providers:", r.providers.length);
for (const p of r.providers) {
  console.log(` - ${p.key} (${p.displayName}) models=${p.models.length} active=${p.models.filter((m) => m.active).length}`);
}
console.log("defaults:", JSON.stringify(r.defaults));

const t = readSessionTitles([
  { sessionId: "6da13459-4025-4e82-8572-7620f7b56e6b", cwd: "E:\\VibeCodingProject\\DshDeck" },
]);
console.log("titles:", JSON.stringify(t).slice(0, 120));
