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
	"application/epub+zip",
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/bmp",
	"image/svg+xml",
	"image/avif",
	"image/heic",
	"image/heif",
	"image/tiff",
	"application/vnd.comicbook+zip",
	"application/x-cbz",
	"text/vcard",
	"text/x-vcard",
	"text/directory",
	"model/gltf-binary",
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

/** Android 11 and later only let an app see the apps and services it
 * names: the system's text-to-speech, for read aloud, and the camera
 * app the scanner hands "Take a photo" to. This is not a permission. */
const QUERIES = `
    <!-- paperwren:queries -->
    <queries>
        <intent>
            <action android:name="android.intent.action.TTS_SERVICE" />
        </intent>
        <intent>
            <action android:name="android.media.action.IMAGE_CAPTURE" />
        </intent>
    </queries>
`;

/**
 * The scanner's "Take a photo": the WebView's file chooser (wry) hands
 * the job to the phone's camera app, which writes the photo through a
 * FileProvider with the authority "<package>.fileprovider" into the
 * app's own Pictures folder (no storage permission: the folder is the
 * app's). The Tauri template declares that provider; where it does not,
 * this one does. MainActivity clears the photos out again.
 */
const CAMERA_PROVIDER = `
        <!-- paperwren:camera -->
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/paperwren_camera" />
        </provider>
`;
const CAMERA_PATH =
	'<external-files-path name="paperwren_camera" path="Pictures/" />';
const CAMERA_PATHS_XML = `<?xml version="1.0" encoding="utf-8"?>
<paths>
    ${CAMERA_PATH}
</paths>
`;

/** The paths file the camera's FileProvider reads, as the manifest names it. */
function cameraPathsResource(manifest) {
	const at = manifest.search(
		/android:authorities="\$\{applicationId\}\.fileprovider"/,
	);
	if (at === -1) return null;
	const end = manifest.indexOf("</provider>", at);
	const block = manifest.slice(at, end === -1 ? undefined : end);
	return block.match(/android:resource="@xml\/([\w.]+)"/)?.[1] ?? null;
}

/** Make sure the camera's provider can hand out the app's Pictures folder. */
export function reachCameraFolder(paths) {
	const reaches =
		/<external-files-path\b[^>]*path="(\.|Pictures\/?)"/.test(paths) ||
		/<external-path\b[^>]*path="\."/.test(paths);
	if (reaches) return paths;
	if (!paths.includes("</paths>")) return CAMERA_PATHS_XML;
	return paths.replace("</paths>", `    ${CAMERA_PATH}\n</paths>`);
}

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
		"fun speak(text: String, lang: String, rate: Double, token: String)",
		"fun stopSpeaking()",
		"fun volumeKeys(on: Boolean)",
		"fun decodePicture(base64: String, token: String)",
		"__paperwrenDecoded",
		"__paperwrenSpoken",
		"__paperwrenVolumeKey",
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
	if (!src.includes("paperwren:queries")) {
		const at = src.search(/<application\b/);
		if (at === -1) fail("No <application> tag.", src);
		src = `${src.slice(0, at).trimEnd()}\n${QUERIES}    ${src.slice(at)}`;
	}
	if (!src.includes('.fileprovider"')) {
		const end = src.lastIndexOf("</application>");
		if (end === -1) fail("No </application> in manifest.", src);
		src = `${src.slice(0, end).trimEnd()}\n${CAMERA_PROVIDER}    ${src.slice(end)}`;
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
	if (!once.includes("android.intent.action.TTS_SERVICE"))
		fail("Text-to-speech query missing.", once);
	if (!once.includes("android.media.action.IMAGE_CAPTURE"))
		fail("Camera query missing.", once);
	if (cameraPathsResource(once) !== "paperwren_camera")
		fail("Camera FileProvider missing.", once);
	// A template that declares the camera's provider keeps its own.
	const withProvider = hardenManifest(
		sample.replace(
			"</application>",
			'<provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.fileprovider"><meta-data android:resource="@xml/file_paths" /></provider></application>',
		),
	);
	if (withProvider.split('.fileprovider"').length !== 2)
		fail("Camera FileProvider declared twice.", withProvider);
	if (cameraPathsResource(withProvider) !== "file_paths")
		fail("Template's camera paths not found.", withProvider);
	const root = '<paths><external-path name="my_images" path="." /></paths>';
	if (reachCameraFolder(root) !== root)
		fail("Camera paths changed needlessly.");
	if (!reachCameraFolder("<paths>\n</paths>").includes("Pictures/"))
		fail("Camera paths not extended.");
	if (once.indexOf("<queries>") > once.indexOf("<application"))
		fail("<queries> must come before <application>.", once);
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
const manifest = readFileSync(MANIFEST, "utf8");
const cameraResource = cameraPathsResource(manifest);
if (!cameraResource) fail("No camera FileProvider in the manifest.", manifest);
const cameraFile = `${GEN}/res/xml/${cameraResource}.xml`;
writeFileSync(
	cameraFile,
	existsSync(cameraFile)
		? reachCameraFolder(readFileSync(cameraFile, "utf8"))
		: CAMERA_PATHS_XML,
);
console.log(
	"Installed MainActivity.kt, hardened AndroidManifest.xml, declared the share and camera FileProviders.",
);
