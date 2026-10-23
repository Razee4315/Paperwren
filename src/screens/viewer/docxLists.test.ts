import { readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { counterPairs, pageCounterResets } from "./docxLists";

// What docx-preview computes for fixtures/viewer-regressions/lists.docx:
// a level-0 item sets its level-1 counter back to 0 and counts itself.
const top = (id: number) => ({
	set: `docx-num-${id}-1 0`,
	increment: `docx-num-${id}-0 1`,
});
const sub = (id: number) => ({ set: "none", increment: `docx-num-${id}-1 1` });
const INITIAL =
	"docx-num-1-0 0 docx-num-1-1 0 docx-num-2-0 0 docx-num-2-1 0 docx-num-4-0 0 docx-num-4-1 0";

describe("counterPairs", () => {
	it("reads names with and without numbers", () => {
		expect(counterPairs("none", 0)).toEqual([]);
		expect(counterPairs("a 1 b -2", 0)).toEqual([
			["a", 1],
			["b", -2],
		]);
		expect(counterPairs("a b 3", 1)).toEqual([
			["a", 1],
			["b", 3],
		]);
	});
});

describe("pageCounterResets", () => {
	it("starts the first page at the wrapper's reset", () => {
		expect(pageCounterResets(INITIAL, [[top(1)]])).toEqual([INITIAL]);
	});

	it("carries lists on across a page break", () => {
		const [, second] = pageCounterResets(INITIAL, [
			[top(1), top(1), sub(1), sub(1), top(1), top(2), top(2), top(4), top(4)],
			[top(4)],
		]);
		expect(counterPairs(second, 0)).toEqual([
			["docx-num-1-0", 3],
			// The third item set its sub-level back.
			["docx-num-1-1", 0],
			["docx-num-2-0", 2],
			["docx-num-2-1", 0],
			["docx-num-4-0", 2],
			["docx-num-4-1", 0],
		]);
	});

	it("keeps a nested level counting into the next page", () => {
		const [, second] = pageCounterResets(INITIAL, [[top(1), sub(1)], []]);
		expect(second).toContain("docx-num-1-1 1");
	});

	it("keeps a list's start number", () => {
		const [, second] = pageCounterResets("docx-num-7-0 4 docx-num-7-1 0", [
			[top(7)],
			[],
		]);
		expect(second).toBe("docx-num-7-0 5 docx-num-7-1 0");
	});
});

describe("lists.docx fixture", () => {
	it("holds the lists the test above stands for", () => {
		const file = path.resolve(
			__dirname,
			"../../../fixtures/viewer-regressions/lists.docx",
		);
		const parts = unzipSync(new Uint8Array(readFileSync(file)));
		const doc = new TextDecoder().decode(parts["word/document.xml"]);
		const numbering = new TextDecoder().decode(parts["word/numbering.xml"]);
		expect(doc).toContain('<w:br w:type="page"/>');
		expect(doc.match(/<w:numId w:val="4"\/>/g)).toHaveLength(4);
		expect(numbering).toContain("<w:startOverride");
		expect(numbering).toContain('w:val="bullet"');
	});
});
