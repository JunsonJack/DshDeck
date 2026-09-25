/** Build white-tile black-whale icon source + rasterizer page for headless Edge. */
import { readFileSync, writeFileSync } from "node:fs";

const whale = readFileSync("apps/dshdeck-ui/assets/deepseek-whale.svg", "utf8");
const d = whale.match(/ d="([^"]+)"/)[1];

const tile = (size) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' width='${size}' height='${size}'>
  <title>DshDeck</title>
  <rect width='256' height='256' rx='58' fill='#FFFFFF'/>
  <g transform='translate(41.6,44.8) scale(7.2)'>
    <path fill='#111111' fill-rule='evenodd' d='${d}'/>
  </g>
</svg>`;

writeFileSync("src-tauri/icons/icon-source.svg", tile(256));
// _raster.html renders the tile at ?s=<px> via tiny inline script
const page = `<!DOCTYPE html><html><head><meta charset='utf-8'>
<style>html,body{margin:0;padding:0;overflow:hidden}</style></head><body>
<div id="host"></div>
<script>
  const s = new URLSearchParams(location.search).get("s") || "256";
  document.getElementById("host").innerHTML = ${JSON.stringify(tile("SIZED"))}.split("SIZED").join(s);
</script>
</body></html>`;
writeFileSync("src-tauri/icons/_raster.html", page);
console.log("written:", d.length, "path chars");
