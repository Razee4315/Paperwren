/**
 * Checks a macOS build for what a green `tauri build` does not prove
 * on its own:
 *
 * 1. Every executable in Paperwren.app carries both arm64 and x86_64,
 *    so the one disk image serves Apple silicon and Intel.
 * 2. The app is signed ad hoc as a whole bundle, with sealed resources
 *    (bundle.macOS.signingIdentity "-" in tauri.macos.conf.json), and
 *    not only by the linker, whose signature covers the executable
 *    alone and none of the bundle's resources.
 * 3. The disk image is there under the name the README gives:
 *    Paperwren_<version>_universal.dmg.
 *
 * It says nothing about whether the app runs: only a Mac does.
 *
 * Usage: node scripts/verify-macos-bundle.mjs <bundle dir>
 * (src-tauri/target/universal-apple-darwin/release/bundle)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [bundleDir] = process.argv.slice(2);
if (!bundleDir) {
	console.error("Usage: verify-macos-bundle.mjs <bundle dir>");
	process.exit(1);
}

const REQUIRED_ARCHS = ["arm64", "x86_64"];
const failures = [];
const fail = (message) => failures.push(message);

const app = join(bundleDir, "macos", "Paperwren.app");
if (!existsSync(app)) {
	console.error(`No app at ${app}`);
	process.exit(1);
}

// 1. Both architectures in every executable.
const macosDir = join(app, "Contents", "MacOS");
const executables = readdirSync(macosDir);
if (executables.length === 0) fail(`No executable in ${macosDir}`);
for (const name of executables) {
	const archs = execFileSync("lipo", ["-archs", join(macosDir, name)], {
		encoding: "utf8",
	})
		.trim()
		.split(/\s+/);
	const missing = REQUIRED_ARCHS.filter((arch) => !archs.includes(arch));
	if (missing.length > 0)
		fail(`${name} lacks ${missing.join(", ")} (has ${archs.join(", ")})`);
	else console.log(`${name}: ${archs.join(", ")}`);
}

// 2. An ad hoc signature over the whole bundle.
const verify = spawnSync(
	"codesign",
	["--verify", "--deep", "--strict", "--verbose=2", app],
	{
		encoding: "utf8",
	},
);
if (verify.status !== 0) fail(`codesign --verify failed:\n${verify.stderr}`);

// codesign writes the description to stderr.
const described = spawnSync("codesign", ["-d", "--verbose=4", app], {
	encoding: "utf8",
});
const description = `${described.stdout}${described.stderr}`;
if (!description.includes("Signature=adhoc"))
	fail("The app is not signed ad hoc");
if (description.includes("linker-signed"))
	fail("The app carries only the linker's signature");
if (!/Sealed Resources version=/.test(description))
	fail("The app's resources are not sealed");
console.log(description.trim());

// 3. The disk image, under the name the README gives.
const { version } = JSON.parse(
	readFileSync("src-tauri/tauri.conf.json", "utf8"),
);
const dmg = join(bundleDir, "dmg", `Paperwren_${version}_universal.dmg`);
if (!existsSync(dmg)) fail(`No disk image at ${dmg}`);
else console.log(`Disk image: ${dmg}`);

if (failures.length > 0) {
	for (const message of failures) console.error(`FAIL: ${message}`);
	process.exit(1);
}
console.log("macOS bundle verified.");
