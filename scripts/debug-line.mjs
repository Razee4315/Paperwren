// One-off: show the exact emitted Kotlin line for the bridge script.
import { readFileSync } from "node:fs";

const s = readFileSync("scripts/patch-android-openwith.mjs", "utf8");
const lines = s.split("\n");
const idx = lines.findIndex((l) => l.includes(") ? "));
console.log("script line", idx + 1, ":", JSON.stringify(lines[idx]));

// Evaluate the template literal exactly as the runtime would.
const emitted = Function(`"use strict"; return \`${lines[idx]}\`;`)();
console.log("emitted kotlin:", JSON.stringify(emitted));
console.log("col 96 char:", JSON.stringify(emitted[95]));
console.log("col 95-100:", JSON.stringify(emitted.slice(94, 100)));
