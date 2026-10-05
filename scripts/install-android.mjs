/**
 * Prepares the generated Android project (run after `tauri android init`):
 *
 * 1. Installs src-tauri/android/MainActivity.kt over the generated
 *    activity. The file is maintained as real Kotlin source instead of
 *    being string-patched into the template.
 * 2. Hardens AndroidManifest.xml: no permissions at all (the Tauri
 *    template adds INTERNET), backup disabled, and "Open with" /
 *    "Share" intent filters for every supported document type.
 * 3. Declares the FileProvider that lets "Share" and "Open in another
 *    app" hand one imported copy to another app (no permission needed),
 *    and writes its path list (res/xml/paperwren_files.xml).
 *
 * Usage:
 *   node scripts/install-android.mjs check   # validate sources only (CI)
 *   node scripts/install-android.mjs         # apply to src-tauri/gen/android
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ACTIVITY_SRC = "src-tauri/android/MainActivity.kt";
const GEN = "src-tauri/gen/android/app/src/main";
const ACTIVITY_DEST = `${GEN}/java/app/paperwren/docs/MainActivity.kt`;
const MANIFEST = `${GEN}/AndroidManifest.xml`;
const PROVIDER_PATHS = `${GEN}/res/xml/paperwren_files.xml`;

/** Only the imports store is ever shareable. */
const PROVIDER_PATHS_XML = `<?xml version="1.0" encoding="utf-8"?>
<paths>
    <files-path name="imports" path="imports/" />
</paths>
`;

const PROVIDER = `
        <!-- paperwren:files -->
        <provider
            android:name=".PaperwrenFiles"
            android:authorities="\${applicationId}.files"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/paperwren_files" />
        </provider>
`;

export const MIME_TYPES = [
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-word.document.macroEnabled.12",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.template",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.ms-excel.sheet.macroEnabled.12",
	"application/vnd.ms-excel.sheet.binary.macroEnabled.12",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.template",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.ms-powerpoint.presentation.macroEnabled.12",
	"application/vnd.openxmlformats-officedocument.presentationml.slideshow",
	"application/vnd.oasis.opendocument.text",
	"application/vnd.oasis.opendocument.spreadsheet",
	"application/vnd.oasis.opendocument.presentation",
	"application/rtf",
	"text/rtf",
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/bmp",
	"text/csv",
	"text/comma-separated-values",
	"text/tab-separated-values",
	"text/markdown",
	"text/plain",
	"application/json",
	"application/xml",
	"text/xml",
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
		"__paperwrenAndroidExtras",
		"__paperwrenNativeError",
		"fun immersive(on: Boolean, landscape: Boolean)",
		"fun systemBars(dark: Boolean)",
		"class PaperwrenFiles : FileProvider()",
		'"$packageName.files"',
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
	if (!src.includes("paperwren:files")) {
		const end = src.lastIndexOf("</application>");
		if (end === -1) fail("No </application> in manifest.", src);
		src = `${src.slice(0, end).trimEnd()}\n${PROVIDER}    ${src.slice(end)}`;
	}
	if (!/launchMode="singleTask"/.test(src)) {
		src = src.replace(
			/(<activity\b[^>]*android:name="\.MainActivity")/,
			'$1\n            android:launchMode="singleTask"',
		);
	}
	return src;
}

/**
 * tao before 0.37 drops the wake-up for IPC replies whenever it lands
 * together with a lifecycle event (the Looper returns the fd event and
 * the wake is lost). On Android that is exactly the moment the file
 * picker closes: the reply sits unread until some later IPC call, so
 * "Open" looks dead until the next tap. Refuse any lockfile that pulls
 * an affected tao back in.
 */
function validateTao(lock) {
	const match = lock.match(/name = "tao"\nversion = "(\d+)\.(\d+)\.(\d+)"/);
	if (!match) fail("tao not found in src-tauri/Cargo.lock.");
	const [major, minor] = [Number(match[1]), Number(match[2])];
	if (major === 0 && minor < 37)
		fail(
			`tao ${match.slice(1).join(".")} loses Android IPC wake-ups; need >= 0.37.`,
		);
}

const mode = process.argv[2] ?? "apply";
const activity = readFileSync(ACTIVITY_SRC, "utf8");
validateActivity(activity);
validateTao(readFileSync("src-tauri/Cargo.lock", "utf8"));

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
	if (!once.includes('android:name=".PaperwrenFiles"'))
		fail("FileProvider missing.", once);
	// Each type appears once per filter (open-with, share), exactly.
	for (const type of MIME_TYPES) {
		const found = once.split(`android:mimeType="${type}"`).length - 1;
		if (found !== 2) fail(`Intent filters list ${type} ${found} times.`, once);
	}
	if (new Set(MIME_TYPES).size !== MIME_TYPES.length)
		fail("MIME_TYPES repeats a type.");
	console.log(
		"Android sources OK: activity validated, manifest patch idempotent, tao >= 0.37.",
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
mkdirSync(`${GEN}/res/xml`, { recursive: true });
writeFileSync(PROVIDER_PATHS, PROVIDER_PATHS_XML);
console.log(
	"Installed MainActivity.kt, hardened AndroidManifest.xml, declared the share FileProvider.",
);
