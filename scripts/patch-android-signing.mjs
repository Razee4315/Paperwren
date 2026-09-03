/**
 * Patches the generated Android build.gradle.kts with a release
 * signing config (the Tauri template ships none, so release APKs
 * would be unsigned and uninstallable).
 *
 * With no keystore.properties present the release build falls back
 * to the debug key, so CI is never blocked on a signing secret.
 * Test artifacts are named accordingly.
 *
 * Rules followed from hard-won experience:
 * - anchor-patch in place, never rewrite the generated file;
 * - verify structure (markers, brace balance) before writing;
 * - fail loudly with the file content so CI shows the template.
 *
 * Usage: node scripts/patch-android-signing.mjs [path-to-build.gradle.kts]
 */
import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] ?? "src-tauri/gen/android/app/build.gradle.kts";
const original = readFileSync(path, "utf8");
let src = original;

const braces = (s) => {
	let n = 0;
	for (const ch of s) {
		if (ch === "{") n++;
		if (ch === "}") n--;
	}
	return n;
};

if (braces(original) !== 0) {
	console.error(
		`Unbalanced braces in the generated file, aborting:\n${original}`,
	);
	process.exit(1);
}

// 1. Properties import (the template may or may not have it).
if (!/^import java\.util\.Properties$/m.test(src)) {
	src = `import java.util.Properties\n\n${src}`;
}

// 2. A signingConfigs block that reads keystore.properties when
// present and stays harmless when it is not.
if (!/signingConfigs\s*\{/.test(src)) {
	const buildTypesAnchor = src.search(/ {4}buildTypes\s*\{/);
	if (buildTypesAnchor === -1) {
		console.error(`No buildTypes block found, aborting:\n${src}`);
		process.exit(1);
	}
	const signingBlock = `    signingConfigs {
        create("release") {
            val ksProps = Properties()
            val ksFile = rootProject.file("keystore.properties")
            if (ksFile.exists()) {
                ksFile.inputStream().use { ksProps.load(it) }
                keyAlias = ksProps.getProperty("keyAlias")
                keyPassword = ksProps.getProperty("keyPassword")
                storeFile = file(ksProps.getProperty("storeFile"))
                storePassword = ksProps.getProperty("storePassword")
            }
        }
    }

`;
	src =
		src.slice(0, buildTypesAnchor) + signingBlock + src.slice(buildTypesAnchor);
}

// 3. The release build type uses the release config when a
// keystore exists, else the debug key (test-signed artifacts).
if (!/signingConfig\s*=/.test(src)) {
	const releaseAnchor = src.search(/getByName\("release"\)\s*\{/);
	if (releaseAnchor === -1) {
		console.error(`No release build type found, aborting:\n${src}`);
		process.exit(1);
	}
	const openBrace = src.indexOf("{", releaseAnchor);
	const lineEnd = src.indexOf("\n", openBrace);
	const insert = `
        signingConfig = if (rootProject.file("keystore.properties").exists())
            signingConfigs.getByName("release")
        else
            signingConfigs.getByName("debug")`;
	src = src.slice(0, lineEnd) + insert + src.slice(lineEnd);
}

if (braces(src) !== 0) {
	console.error(`Patch left unbalanced braces, aborting:\n${src}`);
	process.exit(1);
}

writeFileSync(path, src);
console.log(
	`Patched ${path} with a release signing config (debug-key fallback).`,
);
