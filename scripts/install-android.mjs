/**
 * Prepares the generated Android project (run after `tauri android init`):
 *
 * 1. Installs src-tauri/android/MainActivity.kt over the generated
 *    activity. The file is maintained as real Kotlin source instead of
 *    being string-patched into the template.
 * 2. Hardens AndroidManifest.xml: no permissions at all (the Tauri
 *    template adds INTERNET), backup disabled, and "Open with" /
 *    "Share" intent filters for every supported document type.
 *
 * Usage:
 *   node scripts/install-android.mjs check   # validate sources only (CI)
 *   node scripts/install-android.mjs         # apply to src-tauri/gen/android
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ACTIVITY_SRC = "src-tauri/android/MainActivity.kt";
const GEN = "src-tauri/gen/android/app/src/main";
const ACTIVITY_DEST = `${GEN}/java/app/paperwren/docs/MainActivity.kt`;
const MANIFEST = `${GEN}/AndroidManifest.xml`;

export const MIME_TYPES = [
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.oasis.opendocument.text",
	"application/vnd.oasis.opendocument.spreadsheet",
	"application/vnd.oasis.opendocument.presentation",
	"application/rtf",
	"text/rtf",
	"text/csv",
	"text/comma-separated-values",
	"text/tab-separated-values",
	"text/markdown",
	"text/plain",
];

const data = MIME_TYPES.map(
	(m) => `                <data android:mimeType="${m}" />`,
).join("\n");

const FILTERS = `
            <!-- paperwren:open-with -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
${data}
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
${data}
            </intent-filter>`;

function fail(message, content = "") {
	console.error(message + (content ? `\n---- content ----\n${content}` : ""));
	process.exit(1);
}

function balanced(src) {
	let depth = 0;
	for (const ch of src) {
		if (ch === "{") depth++;
		if (ch === "}") depth--;
		if (depth < 0) return false;
	}
	return depth === 0;
}

function validateActivity(src) {
	const required = [
		"package app.paperwren.docs",
		"class MainActivity : TauriActivity()",
		"override fun onCreate(savedInstanceState: Bundle?)",
		"super.onCreate(savedInstanceState)",
		"override fun onNewIntent(intent: Intent)",
		"__paperwrenOpenFile",
		"__paperwrenHandleBack",
		"__paperwrenAndroid",
	];
	for (const needle of required) {
		if (!src.includes(needle)) fail(`MainActivity.kt is missing: ${needle}`);
	}
	if (!balanced(src)) fail("MainActivity.kt has unbalanced braces.");
}

export function hardenManifest(original) {
	let src = original.replace(/^\s*<uses-permission\b[^>]*\/>\s*\n/gm, "");
	if (/android:allowBackup="true"/.test(src)) {
		src = src.replace(
			'android:allowBackup="true"',
			'android:allowBackup="false"',
		);
	} else if (!/android:allowBackup="false"/.test(src)) {
		if (!/<application\b/.test(src)) fail("No <application> tag.", src);
		src = src.replace(
			/<application\b/,
			'<application\n        android:allowBackup="false"',
		);
	}
	if (!src.includes("paperwren:open-with")) {
		const launcherEnd = src.indexOf("</intent-filter>");
		if (launcherEnd === -1) fail("No launcher intent-filter in manifest.", src);
		const at = launcherEnd + "</intent-filter>".length;
		src = src.slice(0, at) + FILTERS + src.slice(at);
	}
	if (/<uses-permission\b/.test(src))
		fail("Manifest still requests permissions.", src);
	if (!/launchMode="singleTask"/.test(src)) {
		src = src.replace(
			/(<activity\b[^>]*android:name="\.MainActivity")/,
			'$1\n            android:launchMode="singleTask"',
		);
	}
	return src;
}

const mode = process.argv[2] ?? "apply";
const activity = readFileSync(ACTIVITY_SRC, "utf8");
validateActivity(activity);

if (mode === "check") {
	const sample = `<manifest>
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:allowBackup="true">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;
	const once = hardenManifest(sample);
	if (hardenManifest(once) !== once)
		fail("Manifest hardening is not idempotent.", once);
	if (!once.includes('android:launchMode="singleTask"'))
		fail("launchMode missing.", once);
	console.log(
		"Android sources OK: activity validated, manifest patch idempotent.",
	);
	process.exit(0);
}

if (!existsSync(ACTIVITY_DEST) || !existsSync(MANIFEST)) {
	fail("Generated Android project not found. Run `tauri android init` first.");
}
const generated = readFileSync(ACTIVITY_DEST, "utf8");
if (!generated.includes("TauriActivity")) {
	fail(
		"Generated MainActivity no longer extends TauriActivity; review the template.",
		generated,
	);
}
writeFileSync(ACTIVITY_DEST, activity);
writeFileSync(MANIFEST, hardenManifest(readFileSync(MANIFEST, "utf8")));
console.log("Installed MainActivity.kt and hardened AndroidManifest.xml.");
