/**
 * Hardens the generated AndroidManifest.xml for Paperwren's zero
 * permission promise (docs/11):
 *
 * 1. Removes the INTERNET uses-permission that the Tauri template
 *    injects unconditionally. The release app makes no network
 *    calls; everything is bundled. Dev builds keep the permission
 *    because the dev server needs it, so this script runs only in
 *    release CI after `tauri android init`.
 * 2. Disables platform backup so the recents list and settings
 *    never leave the device through Google Drive auto-backup.
 *
 * Idempotent: safe to run twice. Fails loudly if an expected anchor
 * is missing so CI shows the real manifest.
 *
 * Usage: node scripts/patch-android-manifest.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const PATH = "src-tauri/gen/android/app/src/main/AndroidManifest.xml";
let src = readFileSync(PATH, "utf8");

// 1. Drop the INTERNET permission, however the template formatted it.
const internetPermission =
	/^\s*<uses-permission\s+android:name="android\.permission\.INTERNET"\s*\/>\s*\n/gm;
src = src.replace(internetPermission, "");

// 2. Backup off: recents and settings must not ride along with
//    Android auto-backup.
if (/android:allowBackup="false"/.test(src)) {
	// Already hardened.
} else if (/android:allowBackup="true"/.test(src)) {
	src = src.replace('android:allowBackup="true"', 'android:allowBackup="false"');
} else if (/<application\b/.test(src)) {
	src = src.replace(/<application\b/, '<application\n        android:allowBackup="false"');
} else {
	console.error(`No <application> tag found, aborting:\n${src}`);
	process.exit(1);
}

// Structural verification: the release manifest must now request
// nothing at all.
const remaining = src.match(/<uses-permission\b/g) ?? [];
if (remaining.length > 0) {
	console.error(`Manifest still requests permissions:\n${src}`);
	process.exit(1);
}
if (!/android:allowBackup="false"/.test(src)) {
	console.error(`allowBackup flag missing after patch:\n${src}`);
	process.exit(1);
}

writeFileSync(PATH, src);
console.log("Manifest hardened: no permissions, backup disabled.");
