import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// tauri-utils 2.10 uses infer 0.22 before the extension. Unlike the
// fixed-offset matchers, PDF searches anywhere in the first 1024 bytes.
// https://github.com/tauri-apps/tauri/issues/16525
const root = path.resolve(process.argv[2] ?? "dist");
const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46]);
let checked = 0;
let failed = false;
async function walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) await walk(file);
		else if (/\.(?:[cm]?js|css|html?)$/i.test(entry.name)) {
			checked++;
			const head = (await readFile(file)).subarray(0, 1024);
			const offset = head.indexOf(pdf);
			if (offset !== -1) {
				console.error(
					`${file}: PDF signature at byte ${offset}; Tauri would serve application/pdf`,
				);
				failed = true;
			}
		}
	}
}
await walk(root);
if (!checked)
	throw new Error(`No script, style or HTML assets found in ${root}`);
if (failed) process.exitCode = 1;
else
	console.log(
		`Checked ${checked} script, style and HTML assets for PDF signatures.`,
	);
