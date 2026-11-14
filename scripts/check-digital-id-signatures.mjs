// CI checks mathematical integrity and structure. Test certificate trust is irrelevant.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
assert(directory, "Pass the signed sample directory");
const required = [
	"rsa-table",
	"rsa-stream",
	"p256",
	"p384",
	"p521",
	"rsa4096",
	"self-signed",
	"visible",
	"twice-signed",
	"twice-visible",
	"twice-linearized",
	"mixed-existing",
	"mixed-shared",
];
const files = readdirSync(directory)
	.filter((name) => name.endsWith(".pdf"))
	.sort();
for (const name of required)
	assert(files.includes(`${name}.pdf`), `Missing sample ${name}`);
const run = (command, args) => {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		timeout: 60000,
		env: { ...process.env, LC_ALL: "C" },
	});
	if (result.error) throw result.error;
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	assert.equal(result.status, 0, `${command} failed: ${args.join(" ")}`);
	return result.stdout + result.stderr;
};
let signatures = 0;
for (const name of files) {
	const path = join(directory, name);
	const count = [
		...readFileSync(path)
			.toString("latin1")
			.matchAll(/\/ByteRange\b/g),
	].length;
	assert(count > 0, `${name}: no signatures`);
	if (name.startsWith("twice-"))
		assert.equal(count, 2, `${name}: expected both signatures`);
	run("qpdf", ["--check", path]);
	const report = run("pdfsig", ["-nocert", "-no-ocsp", path]);
	const sections = report.split(/Signature #\d+:/).slice(1);
	assert.equal(sections.length, count, `${name}: pdfsig missed a signature`);
	for (const section of sections) {
		assert.match(
			section,
			/Signature Validation:\s*Signature is Valid\./,
			`${name}: invalid signature`,
		);
	}
	assert.match(
		sections[sections.length - 1],
		/Total document signed/,
		`${name}: last signature has incomplete coverage`,
	);
	for (let i = 1; i <= count; i++) {
		const stem = join(directory, `${name.slice(0, -4)}-${i}`);
		const verified = run("openssl", [
			"cms",
			"-verify",
			"-binary",
			"-inform",
			"DER",
			"-in",
			`${stem}.cms`,
			"-content",
			`${stem}.ranges`,
			"-noverify",
			"-out",
			"/dev/null",
		]);
		assert.match(
			verified,
			/CMS Verification successful/,
			`${stem}: CMS was not verified`,
		);
		signatures++;
	}
}
assert.equal(
	readdirSync(directory).filter((name) => name.endsWith(".cms")).length,
	signatures,
	"Unverified CMS samples",
);
process.stdout.write(
	`Verified ${files.length} PDFs and ${signatures} CMS signatures\n`,
);
