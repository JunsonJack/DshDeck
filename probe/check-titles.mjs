import { readSessionTitles } from "../packages/dsh-readonly/session-replay.mjs";
const t = readSessionTitles([
  { sessionId: "session-ac37c190-26a3-4028-92a5-2bd99a1a4668", cwd: "E:\VibeCodingProject" },
  { sessionId: "session-3a25bee8-dc7a-4564-955c-c5c0e2d8ac9a", cwd: "E:\MRO(9879)76EE\marketing-web-CSN" },
]);
console.log(JSON.stringify(t, null, 2));
