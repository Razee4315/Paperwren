// One-off: same escape fix for the result-comparison line.
import { readFileSync, writeFileSync } from "node:fs";

const BQ = String.fromCharCode(92);
const script = readFileSync("scripts/patch-android-openwith.mjs", "utf8");

const current = 'if (result == "' + BQ + '"accepted' + BQ + '") {';
const fixed = 'if (result == "' + BQ + BQ + '"accepted' + BQ + BQ + '") {';

if (!script.includes(current)) {
	console.error("sequence not found");
	process.exit(1);
}
writeFileSync("scripts/patch-android-openwith.mjs", script.replace(current, fixed));
console.log("result compare fixed");
