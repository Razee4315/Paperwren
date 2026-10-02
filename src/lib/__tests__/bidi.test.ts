import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasRtl, startsRtl } from "../bidi";
import { parsePptx } from "../pptx/parse";

describe("reading direction", () => {
	it("follows the first strongly-directional character", () => {
		expect(startsRtl("اردو پیشکش")).toBe(true);
		expect(startsRtl("مرحبا world")).toBe(true);
		expect(startsRtl("שלום")).toBe(true);
		expect(startsRtl("Hello مرحبا")).toBe(false);
		// Digits and punctuation are neutral: they decide nothing.
		expect(startsRtl("123 - اردو")).toBe(true);
		expect(startsRtl("2026: results")).toBe(false);
		expect(startsRtl("")).toBe(false);
		expect(startsRtl("12.5%")).toBe(false);
	});

	it("spots right-to-left script anywhere in a string", () => {
		expect(hasRtl("Total (المجموع)")).toBe(true);
		expect(hasRtl("Total")).toBe(false);
	});
});

describe("right-to-left slides", () => {
	const slide = () =>
		parsePptx(
			new Uint8Array(readFileSync("fixtures/viewer-regressions/rtl.pptx")),
		).slides[0];
	const paras = () =>
		slide().elements.flatMap((e) =>
			e.kind === "shape" && e.text ? e.text.paras : [],
		);
	const find = (text: string) => {
		const p = paras().find((x) => x.runs.map((r) => r.text).join("") === text);
		if (!p) throw new Error(`paragraph not found: ${text}`);
		return p;
	};

	it("honours the file's direction flag and aligns to the right", () => {
		const p = find("پہلا نکتہ");
		expect(p.rtl).toBe(true);
		expect(p.align).toBe("right");
	});

	it("detects direction from the text when the file does not say", () => {
		expect(find("مرحبا بالعالم").rtl).toBe(true);
		expect(find("اردو پیشکش").rtl).toBe(true);
		// The title's centring comes from the master and is kept.
		expect(find("اردو پیشکش").align).toBe("center");
	});

	it("leaves left-to-right paragraphs alone", () => {
		const p = find("English stays left to right");
		expect(p.rtl).toBeUndefined();
		expect(p.align).toBe("left");
	});
});
