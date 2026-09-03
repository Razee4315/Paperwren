/**
 * Applies Paperwren's launcher icons to the generated Android
 * project. `tauri android init` always renders the template's own
 * Tauri logo mipmaps and ignores src-tauri/icons, so the generated
 * icons must be overwritten after init (the CLI never does this).
 *
 * Input: the android/ subtree produced by
 *   npx tauri icon assets/brand/app-icon-foreground.svg --output .tauri-icons-android
 * The foreground SVG has the safe-zone padding baked in (the mark
 * is scaled to 60 percent of the canvas) so launcher masks cannot
 * crop the artwork.
 *
 * Also makes the adaptive icon use a color background resource and
 * defines that color exactly once (duplicate resources break the
 * build; a background referenced nowhere shows a transparent tile).
 *
 * Usage: node scripts/patch-android-icons.mjs
 */
import {
	cpSync,
	existsSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

const SRC = ".tauri-icons-android/android";
const DEST = "src-tauri/gen/android/app/src/main/res";

if (!existsSync(SRC)) {
	console.error(`Icon source ${SRC} not found. Run tauri icon first.`);
	process.exit(1);
}
if (!existsSync(DEST)) {
	console.error(
		`Generated res/ not found at ${DEST}. Run tauri android init first.`,
	);
	process.exit(1);
}

// 1. Overwrite the generated icons with ours.
cpSync(SRC, DEST, { recursive: true, force: true });

// 2. Point adaptive icons at a color background and make sure the
// color is defined exactly once.
const anydpi = join(DEST, "mipmap-anydpi-v26");
if (existsSync(anydpi)) {
	for (const file of readdirSync(anydpi)) {
		if (!file.endsWith(".xml")) continue;
		const p = join(anydpi, file);
		let xml = readFileSync(p, "utf8");
		xml = xml.replaceAll(
			"@drawable/ic_launcher_background",
			"@color/ic_launcher_background",
		);
		writeFileSync(p, xml);
	}
}

const valuesDir = join(DEST, "values");
let colorDefined = false;
if (existsSync(valuesDir)) {
	for (const file of readdirSync(valuesDir)) {
		if (!file.endsWith(".xml")) continue;
		if (
			readFileSync(join(valuesDir, file), "utf8").includes(
				"ic_launcher_background",
			)
		) {
			colorDefined = true;
		}
	}
}
if (!colorDefined) {
	writeFileSync(
		join(valuesDir, "ic_launcher_background.xml"),
		`<resources>\n    <color name="ic_launcher_background">#FAE4DA</color>\n</resources>\n`,
	);
	console.log("Wrote values/ic_launcher_background.xml (ember paper).");
}

console.log(`Launcher icons applied from ${SRC} to ${DEST}.`);
