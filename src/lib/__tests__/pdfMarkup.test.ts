import {
	PDFArray,
	PDFDict,
	PDFDocument,
	type PDFHexString,
	PDFName,
	type PDFNumber,
	PDFRawStream,
	degrees,
} from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { type Markup, addMarkup, inkPath } from "../pdfMarkup";

async function blank(turn = 0) {
	const doc = await PDFDocument.create();
	const page = doc.addPage([600, 800]);
	if (turn) page.setRotation(degrees(turn));
	return doc.save();
}

async function annots(bytes: Uint8Array) {
	const doc = await PDFDocument.load(bytes);
	const page = doc.getPage(0);
	const list = page.node.Annots();
	return Array.from({ length: list?.size() ?? 0 }, (_, i) =>
		doc.context.lookup(list?.get(i), PDFDict),
	);
}

const numbers = (dict: PDFDict, key: string) =>
	dict
		.lookup(PDFName.of(key), PDFArray)
		.asArray()
		.map((v) => (v as PDFNumber).asNumber());

const pen: Markup = {
	kind: "ink",
	page: 0,
	points: [
		[0.1, 0.1],
		[0.2, 0.2],
		[0.3, 0.1],
	],
	color: "#c0392b",
	width: 2,
};

describe("addMarkup", () => {
	it("writes ink as an annotation with its own appearance", async () => {
		const [ink] = await annots(
			await addMarkup(await blank(), { marks: [pen] }),
		);
		expect(ink.get(PDFName.of("Subtype"))).toBe(PDFName.of("Ink"));
		const list = ink.lookup(PDFName.of("InkList"), PDFArray);
		const stroke = list.lookup(0, PDFArray).asArray();
		expect((stroke[0] as PDFNumber).asNumber()).toBeCloseTo(60);
		// From the top of the page as shown, to the foot of the page's own.
		expect((stroke[1] as PDFNumber).asNumber()).toBeCloseTo(720);
		const appearance = ink.lookup(PDFName.of("AP"), PDFDict);
		expect(appearance.lookup(PDFName.of("N"))).toBeInstanceOf(PDFRawStream);
	});

	it("keeps the place on a page the file turns", async () => {
		const [ink] = await annots(
			await addMarkup(await blank(90), {
				marks: [{ ...pen, points: [[0, 0]] }],
			}),
		);
		// Turned clockwise, the corner shown at the top left is the
		// page's own bottom left.
		const stroke = ink
			.lookup(PDFName.of("InkList"), PDFArray)
			.lookup(0, PDFArray)
			.asArray();
		expect((stroke[0] as PDFNumber).asNumber()).toBeCloseTo(0);
		expect((stroke[1] as PDFNumber).asNumber()).toBeCloseTo(0);
	});

	it("marks text with quad points and keeps the words", async () => {
		const [mark] = await annots(
			await addMarkup(await blank(), {
				marks: [
					{
						kind: "highlight",
						page: 0,
						color: "#ffd93b",
						text: "سلام world",
						boxes: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.02 }],
					},
				],
			}),
		);
		expect(mark.get(PDFName.of("Subtype"))).toBe(PDFName.of("Highlight"));
		const quad = numbers(mark, "QuadPoints");
		expect(quad).toHaveLength(8);
		expect(quad[0]).toBeCloseTo(60);
		expect(quad[1]).toBeCloseTo(720);
		expect(quad[6]).toBeCloseTo(360);
		expect(quad[7]).toBeCloseTo(704);
		expect(
			(mark.get(PDFName.of("Contents")) as PDFHexString).decodeText(),
		).toBe("سلام world");
	});

	it("names underlined and struck-out text for what it is", async () => {
		const box = { x: 0, y: 0, w: 1, h: 0.1 };
		const marks: Markup[] = [
			{ kind: "underline", page: 0, color: "#000000", text: "", boxes: [box] },
			{ kind: "strike", page: 0, color: "#000000", text: "", boxes: [box] },
		];
		const list = await annots(await addMarkup(await blank(), { marks }));
		expect(list.map((a) => a.get(PDFName.of("Subtype")))).toEqual([
			PDFName.of("Underline"),
			PDFName.of("StrikeOut"),
		]);
	});

	it("adds a note where it was put, and keeps what was there", async () => {
		const note: Markup = {
			kind: "note",
			page: 0,
			x: 0.5,
			y: 0.5,
			text: "Check this",
		};
		const once = await addMarkup(await blank(), { marks: [pen] });
		const list = await annots(await addMarkup(once, { marks: [note] }));
		expect(list).toHaveLength(2);
		const added = list[1];
		expect(added.get(PDFName.of("Subtype"))).toBe(PDFName.of("Text"));
		expect(numbers(added, "Rect")).toEqual([290, 390, 310, 410]);
		expect(
			(added.get(PDFName.of("Contents")) as PDFHexString).decodeText(),
		).toBe("Check this");
	});
});

describe("inkPath", () => {
	it("draws one point as a dot", () => {
		expect(inkPath([[3, 4]])).toBe("3 4 m\n3 4 l");
	});

	it("goes through the middle of each pair of points", () => {
		const path = inkPath([
			[0, 0],
			[10, 0],
			[10, 10],
		]);
		expect(path.split("\n")).toHaveLength(3);
		expect(path).toContain("10 5 c");
		expect(path.endsWith("10 10 l")).toBe(true);
	});
});
