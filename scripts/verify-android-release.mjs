/**
 * Checks a release build against the Play Store rules that a green
 * Gradle build does not prove on its own:
 *
 * 1. The AAB carries native code for arm64-v8a, armeabi-v7a and
 *    x86_64 (32-bit phones and Chromebooks included; Play serves each
 *    device only its own ABI, so this costs users nothing).
 * 2. Every 64-bit .so is 16 KB page aligned (Play requirement for
 *    apps targeting Android 15+): each PT_LOAD segment must have
 *    p_align >= 16384.
 * 3. The APK's manifest requests no permissions (docs/11 section 2),
 *    targets API >= 36, and has a version code (read with aapt2 when
 *    the build tools are available).
 *
 * Usage: node scripts/verify-android-release.mjs <app.aab> <app.apk>
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";

const [aabPath, apkPath] = process.argv.slice(2);
if (!aabPath || !apkPath) {
	console.error("Usage: verify-android-release.mjs <app.aab> <app.apk>");
	process.exit(1);
}

const REQUIRED_ABIS = ["arm64-v8a", "armeabi-v7a", "x86_64"];
const MIN_TARGET_SDK = 36;
const PAGE = 16384;
// The only uses-permission entry allowed: AndroidX defines and uses
// it to protect its own receivers; it grants nothing (docs/11).
const ALLOWED_PERMISSIONS = [
	"app.paperwren.docs.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
];

const problems = [];

/** Smallest PT_LOAD alignment of an ELF shared object, and its class. */
function elfLoadAlign(buf) {
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	if (view.getUint32(0) !== 0x7f454c46) throw new Error("not an ELF file");
	const is64 = buf[4] === 2;
	const le = buf[5] === 1;
	const phoff = is64
		? Number(view.getBigUint64(0x20, le))
		: view.getUint32(0x1c, le);
	const phentsize = view.getUint16(is64 ? 0x36 : 0x2a, le);
	const phnum = view.getUint16(is64 ? 0x38 : 0x2c, le);
	let min = Number.POSITIVE_INFINITY;
	for (let i = 0; i < phnum; i++) {
		const at = phoff + i * phentsize;
		if (view.getUint32(at, le) !== 1) continue; // PT_LOAD
		const align = is64
			? Number(view.getBigUint64(at + 0x30, le))
			: view.getUint32(at + 0x1c, le);
		min = Math.min(min, align);
	}
	return { is64, align: min };
}

// 1 + 2: native libraries in the bundle.
const aab = unzipSync(readFileSync(aabPath), {
	filter: (f) => f.name.endsWith(".so"),
});
const abis = new Set();
for (const [name, bytes] of Object.entries(aab)) {
	const abi = name.split("/").at(-2);
	abis.add(abi);
	const { is64, align } = elfLoadAlign(bytes);
	const note = `${name}: PT_LOAD align ${align}`;
	if (is64 && align < PAGE)
		problems.push(`${note} (needs >= ${PAGE} for 16 KB pages)`);
	else console.log(`ok  ${note}`);
}
for (const abi of REQUIRED_ABIS) {
	if (!abis.has(abi)) problems.push(`AAB has no native code for ${abi}`);
}

// 3: manifest, via aapt2 from the newest installed build tools.
function findAapt2() {
	const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
	if (!home) return null;
	const dir = join(home, "build-tools");
	if (!existsSync(dir)) return null;
	const versions = readdirSync(dir).sort((a, b) =>
		a.localeCompare(b, undefined, { numeric: true }),
	);
	for (const v of versions.reverse()) {
		for (const exe of ["aapt2", "aapt2.exe"]) {
			const p = join(dir, v, exe);
			if (existsSync(p)) return p;
		}
	}
	return null;
}

const aapt2 = findAapt2();
if (!aapt2) {
	console.warn("warn  aapt2 not found: skipping manifest checks");
} else {
	const badging = execFileSync(aapt2, ["dump", "badging", apkPath], {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	const pkg = badging.match(
		/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/,
	);
	const target = badging.match(/targetSdkVersion:'(\d+)'/);
	const perms = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map(
		(m) => m[1],
	);
	if (!pkg) problems.push("aapt2 could not read the package line");
	else console.log(`ok  ${pkg[1]} versionName ${pkg[3]} versionCode ${pkg[2]}`);
	if (!target || Number(target[1]) < MIN_TARGET_SDK)
		problems.push(
			`targetSdkVersion ${target?.[1] ?? "?"} is below Play's ${MIN_TARGET_SDK}`,
		);
	else console.log(`ok  targetSdkVersion ${target[1]}`);
	const extra = perms.filter((p) => !ALLOWED_PERMISSIONS.includes(p));
	if (extra.length) problems.push(`Manifest requests: ${extra.join(", ")}`);
	else console.log("ok  no permissions requested");
}

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);
console.log(`info AAB ${mb(aabPath)} MB, universal APK ${mb(apkPath)} MB`);

if (problems.length) {
	console.error(`\nRelease check failed:\n- ${problems.join("\n- ")}`);
	process.exit(1);
}
console.log("\nRelease bundle meets the Play checks.");
