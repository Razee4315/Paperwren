import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { cleanWordText, extractDoc, extractPpt } from "./legacy";
import type { Extracted } from "./model";
import { extractOdf } from "./odf";
import { extractRtf, rtfToText } from "./rtf";

const bytes = (name: string) =>
	new Uint8Array(readFileSync(`fixtures/${name}`));

function lookup(name: string) {
	const cfb = XLSX.CFB.read(bytes(name), { type: "array" });
	return (stream: string) => {
		const e = XLSX.CFB.find(cfb, stream);
		return e?.content ? Uint8Array.from(e.content as ArrayLike<number>) : null;
	};
}

const allText = (doc: Extracted) =>
	(doc.kind === "document" ? doc.blocks : doc.slides.flat())
		.map((b) => b.text)
		.join("\n");

describe("legacy Word (.doc)", () => {
	it("extracts paragraphs including non-ASCII text", () => {
		const doc = extractDoc(lookup("sample.doc"));
		const text = allText(doc);
		expect(text).toContain("Paperwren Legacy Fixture");
		expect(text).toContain("The quick brown fox jumps over the lazy dog.");
		expect(text).toContain("ünïcödé");
	});
	it("shows field results, not field codes", () => {
		expect(cleanWordText("a\u0013 HYPERLINK x \u0014link\u0015b\r")).toBe(
			"alinkb\n",
		);
	});
});

describe("legacy PowerPoint (.ppt)", () => {
	it("groups text by slide in order", () => {
		const doc = extractPpt(lookup("sample.ppt"));
		expect(doc.kind).toBe("slides");
		if (doc.kind !== "slides") return;
		expect(doc.slides).toHaveLength(3);
		expect(doc.slides[0][0].text).toBe("Quarterly Review");
		expect(doc.slides[1].map((b) => b.text).join(" ")).toContain(
			"Revenue up 12%",
		);
		expect(allText(doc)).not.toContain("Speaker note text");
	});
});

describe("OpenDocument", () => {
	it("reads odt headings and paragraphs", () => {
		const doc = extractOdf(bytes("sample.odt"), "odt");
		expect(doc.kind).toBe("document");
		if (doc.kind !== "document") return;
		expect(doc.blocks.find((b) => b.kind === "heading")?.text).toBe(
			"Paperwren Legacy Fixture",
		);
		expect(allText(doc)).toContain("lazy dog");
	});
	it("reads odp slides", () => {
		const doc = extractOdf(bytes("sample.odp"), "odp");
		if (doc.kind !== "slides") throw new Error("expected slides");
		expect(doc.slides.length).toBe(3);
		expect(allText(doc)).toContain("R2C2");
	});
});

describe("RTF", () => {
	it("extracts text from a real file", () => {
		const text = allText(extractRtf(bytes("sample.rtf")));
		expect(text).toContain("The quick brown fox");
		expect(text).toContain("ünïcödé");
		expect(text).not.toMatch(/\\|fonttbl|Times New Roman;/);
	});
	it("handles escapes, unicode and ignorable groups", () => {
		expect(rtfToText("{\\rtf1{\\*\\gen x}A\\'e9\\u8212?B\\par C\\{\\}}")).toBe(
			"Aé—B\nC{}",
		);
	});
});
