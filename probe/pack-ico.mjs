/** Pack rendered PNG sizes into a multi-resolution .ico */
import { readFileSync, writeFileSync } from "node:fs";
import pngToIcoMod from "png-to-ico";

const pngToIco = pngToIcoMod.default ?? pngToIcoMod;
const sizes = [256, 64, 48, 32, 16];
const bufs = sizes.map((s) => readFileSync(`src-tauri/icons/_icon-${s}.png`));
const ico = await pngToIco(bufs);
writeFileSync("src-tauri/icons/icon.ico", ico);
console.log("icon.ico written:", ico.length, "bytes");
