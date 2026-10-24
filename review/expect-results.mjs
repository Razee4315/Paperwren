// Usage: node review/expect-results.mjs <vitest-json> <expect-json>
// <expect-json> maps a test title to "passed" or "failed". Prints every
// test's outcome and exits 1 if any listed expectation does not hold.
import { readFileSync } from "node:fs";

const [, , resultsPath, expectPath] = process.argv;
const results = JSON.parse(readFileSync(resultsPath, "utf8"));
const expected = JSON.parse(readFileSync(expectPath, "utf8"));
const seen = new Map();
for (const file of results.testResults ?? [])
	for (const t of file.assertionResults ?? []) seen.set(t.title, t.status);
if (seen.size === 0) {
	console.log("No test results: the file did not load.");
	for (const file of results.testResults ?? []) console.log(file.message);
}
let bad = 0;
for (const [title, status] of seen) {
	const want = expected[title];
	const mark = want === undefined ? "  " : want === status ? "OK" : "XX";
	if (mark === "XX") bad++;
	console.log(
		`${mark} ${status.padEnd(7)} ${title}${want ? `  (expected ${want})` : ""}`,
	);
}
for (const title of Object.keys(expected))
	if (!seen.has(title)) {
		console.log(`XX missing ${title}`);
		bad++;
	}
console.log(
	`total ${results.numTotalTests}, passed ${results.numPassedTests}, failed ${results.numFailedTests}`,
);
process.exit(bad ? 1 : 0);
