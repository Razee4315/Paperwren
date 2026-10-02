import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { SlideElement } from "../pptx/parse";
import { textDeck } from "./deck";
import { listMarker, parseDoc } from "./doc";
import type { RichBlock, RichPara, RichTable } from "./model";
import { length, parseOdp, parseOdt } from "./odf";
import { parsePpt } from "./ppt";

/**
 * The faithful readers for legacy Word / PowerPoint and OpenDocument,
 * against real files from the Apache POI and LibreOffice test corpora
 * (fixtures/legacy, fixtures/odf).
 */

const bytes = (name: string) =>
	new Uint8Array(readFileSync(`fixtures/${name}`));

function lookup(name: string) {
	const cfb = XLSX.CFB.read(bytes(name), { type: "array" });
	return (stream: string) => {
		const e = XLSX.CFB.find(cfb, stream);
		return e?.content ? Uint8Array.from(e.content as ArrayLike<number>) : null;
	};
}

const paras = (blocks: RichBlock[]) =>
	blocks.filter((b): b is RichPara => b.kind === "para");
const textOf = (p: RichPara) => p.runs.map((r) => r.text).join("");
const table = (blocks: RichBlock[]) => {
	const found = blocks.find((b): b is RichTable => b.kind === "table");
	if (!found) throw new Error("no table");
	return found;
};

describe("legacy Word (.doc) as a rich document", () => {
	it("applies the style sheet: headings look like headings", () => {
		const [heading, body] = paras(parseDoc(lookup("sample.doc")).blocks);
		expect(heading.heading).toBe(1);
		expect(heading.runs[0]).toMatchObject({
			text: "Paperwren Legacy Fixture",
			bold: true,
			size: 14,
			color: "#365f91",
			font: "Calibri",
		});
		expect(body.heading).toBeUndefined();
		expect(body.runs[0]).toMatchObject({ size: 11, font: "Cambria" });
	});

	it("keeps run formatting and page breaks", () => {
		const blocks = paras(parseDoc(lookup("legacy/SampleDoc.doc")).blocks);
		const blue = blocks.find((p) => textOf(p).includes("also in blue"));
		expect(blue?.runs[0]).toMatchObject({
			size: 16,
			color: "#548dd4",
			font: "Arial Black",
		});
		expect(blocks.some((p) => p.pageBreak)).toBe(true);
	});

	it("numbers and bullets lists from their definitions", () => {
		const blocks = paras(parseDoc(lookup("legacy/Lists.doc")).blocks);
		const item = (text: string) => blocks.find((p) => textOf(p) === text)?.list;
		expect(item("Unordered list 1")).toEqual({ level: 0, marker: "•" });
		expect(item("Ordered list 1")).toEqual({ level: 0, marker: "1." });
		expect(item("OL 3")).toEqual({ level: 0, marker: "3." });
		expect(blocks.find((p) => textOf(p) === "Heading Level 1")?.heading).toBe(
			1,
		);
	});

	it("builds tables, turning per-row cell edges into column spans", () => {
		const simple = table(parseDoc(lookup("legacy/simple-table.doc")).blocks);
		expect(simple.rows).toHaveLength(2);
		expect(simple.rows[1].map((c) => textOf(paras(c.blocks)[0]))).toEqual([
			"Cell 2,1",
			"Cell 2,2",
			"Cell 2,3",
		]);
		expect(simple.cols).toHaveLength(3);

		const merged = table(parseDoc(lookup("legacy/table-merges.doc")).blocks);
		expect(merged.rows[0].map((c) => c.colSpan ?? 1)).toEqual([3, 2]);
		expect(merged.rows[3]).toHaveLength(1);
		expect(merged.rows[3][0].colSpan).toBe(merged.cols?.length);
	});

	it("links hyperlink fields and hides their field codes", () => {
		const [p] = paras(parseDoc(lookup("legacy/hyperlink.doc")).blocks);
		expect(textOf(p)).toBe("Before text; Hyperlink text; after text");
		expect(p.runs.find((r) => r.href)).toMatchObject({
			text: "Hyperlink text",
			href: "http://testuri.org/",
			underline: true,
		});
	});

	it("extracts inline and floating pictures a browser can show", () => {
		const inline = parseDoc(lookup("legacy/two_images.doc"));
		expect(inline.media.map((m) => m.type)).toEqual([
			"image/jpeg",
			"image/png",
		]);
		const first = paras(inline.blocks)[0].runs[0];
		expect(first.image).toMatchObject({ media: 0, width: 27, height: 27 });

		const floating = parseDoc(lookup("legacy/PngPicture.doc"));
		expect(floating.media).toHaveLength(1);
		expect(floating.media[0].type).toBe("image/png");
		expect(
			paras(floating.blocks).some((p) => p.runs.some((r) => r.image)),
		).toBe(true);
	});

	it("reports locked and too-old files instead of guessing", () => {
		expect(() => parseDoc(lookup("legacy/PasswordProtected.doc"))).toThrow(
			/password/,
		);
		expect(() => parseDoc(lookup("legacy/Word95.doc"))).toThrow();
	});

	it("formats list markers", () => {
		expect(listMarker(0, 12, 0)).toBe("12.");
		expect(listMarker(2, 4, 0)).toBe("iv.");
		expect(listMarker(1, 9, 0)).toBe("IX.");
		expect(listMarker(4, 27, 0)).toBe("aa.");
		expect(listMarker(23, 1, 1)).toBe("◦");
	});
});

const shapeText = (el: SlideElement) =>
	el.kind === "shape" && el.text
		? el.text.paras.map((p) => p.runs.map((r) => r.text).join("")).join("\n")
		: "";

describe("legacy PowerPoint (.ppt) as slides", () => {
	it("reads slide size, order, placeholders and master text styles", () => {
		const deck = parsePpt(lookup("sample.ppt"));
		expect([deck.width, deck.height]).toEqual([960, 720]);
		expect(deck.slides).toHaveLength(3);
		const [title, subtitle] = deck.slides[0].elements;
		expect(shapeText(title)).toBe("Quarterly Review");
		if (title.kind !== "shape" || !title.text) throw new Error("no title");
		// 44pt, centred: both come from the master, not the slide.
		expect(title.text.paras[0].align).toBe("center");
		expect(title.text.paras[0].runs[0].size).toBeCloseTo((44 * 4) / 3);
		expect(title.w).toBeGreaterThan(700);
		expect(shapeText(subtitle)).toBe("Paperwren fixture deck");
	});

	it("keeps run formatting, bullets, levels and filled shapes", () => {
		const els = parsePpt(lookup("sample.ppt")).slides[1].elements;
		const body = els.find((e) => shapeText(e).includes("Churn down"));
		if (body?.kind !== "shape" || !body.text) throw new Error("no body");
		expect(body.text.paras.map((p) => p.level)).toEqual([0, 1]);
		expect(body.text.paras[0].bullet).toBe("•");
		const box = els.find((e) => shapeText(e) === "Green box");
		if (box?.kind !== "shape") throw new Error("no box");
		expect(box.fill).toBe("#1f8a4c");
		expect(box.text?.paras[0].runs[0]).toMatchObject({
			bold: true,
			color: "#ffffff",
		});
	});

	it("reads alignment, colours and fonts of individual runs", () => {
		const deck = parsePpt(
			lookup("legacy/Single_Coloured_Page_With_Fonts_and_Alignments.ppt"),
		);
		const body = deck.slides[0].elements[1];
		if (body.kind !== "shape" || !body.text) throw new Error("no body");
		expect(body.text.paras.map((p) => p.align)).toEqual([
			"left",
			"center",
			"right",
			"left",
		]);
		expect(body.text.paras[2].runs[0].color).toBe("#ff3300");
		expect(body.text.paras[3].runs[0].font).toBe("Times New Roman");
	});

	it("extracts pictures and picture / colour backgrounds", () => {
		const pictures = parsePpt(lookup("legacy/pictures.ppt"));
		expect(pictures.media.map((m) => m.type)).toContain("image/jpeg");
		expect(pictures.slides[0].elements[0]).toMatchObject({
			kind: "image",
			src: "media:0",
		});
		const backgrounds = parsePpt(lookup("legacy/backgrounds.ppt"));
		expect(backgrounds.slides[0].background).toMatch(/^media:\d+$/);
		expect(backgrounds.slides[1].background).toBe("#ff0000");
	});

	it("draws the master's own shapes behind slides that follow it", () => {
		const deck = parsePpt(lookup("legacy/WithMaster.ppt"));
		for (const slide of deck.slides)
			expect(slide.elements.map(shapeText)).toContain(
				"This text comes from the Master Slide",
			);
	});

	it("maps symbol-font bullets to real glyphs and reads notes", () => {
		const boxes = parsePpt(lookup("legacy/with_textbox.ppt")).slides[0]
			.elements;
		const hello = boxes.find((e) => shapeText(e) === "Hello, World!!!");
		expect(hello?.kind === "shape" && hello.text?.paras[0].bullet).toBe("➢");
		expect(parsePpt(lookup("legacy/SampleShow.ppt")).slides[0].notes).toBe(
			"I am the notes of the first slide",
		);
	});

	it("says when a deck is locked", () => {
		expect(() =>
			parsePpt(lookup("legacy/Password_Protected-hello.ppt")),
		).toThrow(/password/);
	});

	it("can still show text when the drawing layer is unreadable", () => {
		const deck = textDeck([
			[
				{ kind: "heading", text: "Title" },
				{ kind: "para", text: "Line" },
			],
		]);
		expect(deck.slides[0].elements.map(shapeText)).toEqual(["Title", "Line"]);
	});
});

describe("OpenDocument text (.odt)", () => {
	it("reads headings and paragraph formatting from the styles", () => {
		const [heading, body] = paras(parseOdt(bytes("sample.odt")).blocks);
		expect(heading).toMatchObject({ heading: 1 });
		expect(heading.runs[0]).toMatchObject({
			text: "Paperwren Legacy Fixture",
			bold: true,
			color: "#365f91",
		});
		expect(textOf(body)).toContain("lazy dog");
		const bold = paras(parseOdt(bytes("odf/feature_text_bold.odt")).blocks)[0];
		expect(bold.runs[0]).toMatchObject({ text: "Hello World!", bold: true });
	});

	it("collapses formatting white space the way the format defines", () => {
		const blocks = paras(parseOdt(bytes("odf/MadeByLO7.odt")).blocks);
		expect(textOf(blocks[1]).startsWith("Er hörte leise Schritte")).toBe(true);
		expect(textOf(blocks[1])).not.toMatch(/\n|\s{2,}/);
	});

	it("reads tables with spans, column widths and cell shading", () => {
		const merged = table(
			parseOdt(bytes("odf/feature_table_merged-cells.odt")).blocks,
		);
		expect(merged.rows[0][0].colSpan).toBe(2);
		expect(merged.cols).toHaveLength(2);
		const shaded = table(parseOdt(bytes("odf/table_styles_1.odt")).blocks);
		expect(shaded.rows[0][0].fill).toBe("#ffff00");
	});

	it("numbers nested lists with their own prefix and suffix", () => {
		const blocks = paras(parseOdt(bytes("odf/listformat.odt")).blocks);
		expect(blocks.map((p) => [p.list?.level, p.list?.marker])).toEqual([
			[0, ">1<"],
			[1, ">>1<<"],
			[2, ">>1<<"],
			[2, ">>2<<"],
		]);
	});

	it("extracts pictures with their size", () => {
		const doc = parseOdt(bytes("odf/feature_image_jpg.odt"));
		expect(doc.media[0].type).toBe("image/jpeg");
		expect(paras(doc.blocks)[0].runs[0].image).toMatchObject({
			media: 0,
			width: 643,
		});
	});

	it("converts lengths", () => {
		expect(length("2.54cm")).toBeCloseTo(96);
		expect(length("72pt")).toBeCloseTo(96);
		expect(length("1in")).toBe(96);
		expect(length("nonsense")).toBeUndefined();
	});
});

describe("OpenDocument presentations (.odp)", () => {
	it("reads page size, placeholders and inherited text styles", () => {
		const deck = parseOdp(bytes("sample.odp"));
		expect([Math.round(deck.width), Math.round(deck.height)]).toEqual([
			960, 720,
		]);
		expect(deck.slides).toHaveLength(3);
		const title = deck.slides[0].elements[0];
		expect(shapeText(title)).toBe("Quarterly Review");
		if (title.kind !== "shape" || !title.text) throw new Error("no title");
		expect(title.text.paras[0].align).toBe("center");
		expect(title.text.anchor).toBe("middle");
	});

	it("reads list levels, bullets and filled shapes", () => {
		const els = parseOdp(bytes("sample.odp")).slides[1].elements;
		const body = els.find((e) => shapeText(e).includes("Churn down"));
		if (body?.kind !== "shape" || !body.text) throw new Error("no body");
		expect(body.text.paras.map((p) => p.level)).toEqual([0, 1]);
		expect(body.text.paras[0].bullet).toBe("•");
		const box = els.find((e) => shapeText(e) === "Green box");
		expect(box?.kind === "shape" && box.fill).toBe("#1f8a4c");
	});

	it("reads tables instead of their fallback preview picture", () => {
		const [el] = parseOdp(bytes("odf/cellspan.odp")).slides[0].elements;
		if (el.kind !== "table") throw new Error("expected a table");
		expect(el.cols).toHaveLength(4);
		expect(el.rows[0].cells[1].span).toBe(2);
		expect(el.rows[0].cells[2].hidden).toBe(true);
		const [filled] = parseOdp(bytes("odf/Table_with_Cell_Fill.odp")).slides[0]
			.elements;
		expect(filled.kind === "table" && filled.rows[0].cells[0].fill).toBe(
			"#66ffff",
		);
	});

	it("reads backgrounds, pictures and rotated shapes", () => {
		expect(parseOdp(bytes("odf/background.odp")).slides[0].background).toBe(
			"#729fcf",
		);
		const bitmap = parseOdp(bytes("odf/slide-bitmap-background.odp"));
		expect(bitmap.slides[0].background).toMatch(/^media:\d+$/);
		expect(bitmap.media.length).toBeGreaterThan(0);
		const rotated = parseOdp(bytes("odf/rotate_flip.odp")).slides[0].elements;
		expect(rotated.map((e) => Math.round(e.rot))).toEqual([20, -20, 20]);
		expect(new Set(rotated.map((e) => Math.round(e.w)))).toEqual(
			new Set([189]),
		);
	});

	it("maps drawn shapes to their outlines", () => {
		const els = parseOdp(bytes("odf/shapes-test.odp")).slides[0].elements;
		const geoms = els.map((e) => (e.kind === "shape" ? e.geom : e.kind));
		expect(geoms).toContain("roundRect");
		expect(geoms).toContain("ellipse");
		expect(geoms).toContain("triangle");
	});
});
