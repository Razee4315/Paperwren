import { describe, expect, it } from "vitest";
import { type PageMap, toDrawn, toShown } from "../../screens/viewer/pdfMarks";
import { mergeBoxes } from "../../screens/viewer/pdfSelection";
import { snippet } from "../find";
import { areaOf, lengthOf, measureLabel, scaleFrom } from "../measure";
import { linesOfTable, textOfLines } from "../ocr";
import { digitallySigned } from "../pdfTools";
import { asksForSignature, pageAsksForSignature } from "../signatureSpots";
import { layoutText, textHeight } from "../textBox";

const map = (matrix: PageMap["matrix"]): PageMap => ({
	pw: 600,
	ph: 800,
	width: 1200,
	height: 1600,
	matrix,
});

describe("the map from a page to the screen", () => {
	it("goes there and back at twice the size", () => {
		const m = map([2, 0, 0, 2, 0, 0]);
		expect(toDrawn(m, 0.5, 0.25)).toEqual([600, 400]);
		expect(toShown(m, 600, 400)).toEqual([0.5, 0.25]);
	});

	it("goes there and back when the reader has turned the page", () => {
		// A quarter turn clockwise: right on the page is down on the screen.
		const m = { ...map([0, 2, -2, 0, 1600, 0]), width: 1600, height: 1200 };
		const [x, y] = toDrawn(m, 0.25, 0.5);
		const [u, v] = toShown(m, x, y);
		expect(u).toBeCloseTo(0.25);
		expect(v).toBeCloseTo(0.5);
		expect(y).toBeCloseTo(300);
	});

	it("allows for margins cropped away", () => {
		const m = map([2, 0, 0, 2, -100, -200]);
		const [x, y] = toDrawn(m, 0.5, 0.5);
		expect([x, y]).toEqual([500, 600]);
		expect(toShown(m, x, y)).toEqual([0.5, 0.5]);
	});
});

describe("selected rectangles as lines", () => {
	it("makes one box of a line's runs", () => {
		const boxes = mergeBoxes([
			{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
			{ x: 0.3, y: 0.1, w: 0.2, h: 0.02 },
		]);
		expect(boxes).toHaveLength(1);
		expect(boxes[0].w).toBeCloseTo(0.4);
	});

	it("keeps lines apart", () => {
		const boxes = mergeBoxes([
			{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
			{ x: 0.1, y: 0.13, w: 0.2, h: 0.02 },
		]);
		expect(boxes).toHaveLength(2);
	});

	it("keeps two columns apart", () => {
		const boxes = mergeBoxes([
			{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
			{ x: 0.6, y: 0.1, w: 0.2, h: 0.02 },
		]);
		expect(boxes).toHaveLength(2);
	});

	it("passes over empty rectangles", () => {
		expect(mergeBoxes([{ x: 0.1, y: 0.1, w: 0, h: 0.02 }])).toEqual([]);
	});
});

describe("the words around a match", () => {
	it("shows a little either side", () => {
		expect(snippet("one two three", "two", 4)).toEqual({
			before: "one ",
			match: "two",
			after: " three",
		});
	});

	it("marks where words were left out", () => {
		const text = `${"a".repeat(60)} word ${"b".repeat(120)}`;
		const { before, after } = snippet(text, "word", 61);
		expect(before.startsWith("…")).toBe(true);
		expect(after.endsWith("…")).toBe(true);
	});

	it("falls back on where the engine says it is", () => {
		expect(snippet("abc def", "zzz", 4).match).toBe("def");
	});
});

describe("measuring", () => {
	const square: Array<[number, number]> = [
		[0, 0],
		[0.5, 0],
		[0.5, 0.5],
		[0, 0.5],
	];

	it("measures along a line and inside a shape", () => {
		expect(lengthOf(square.slice(0, 2), 100, 100)).toBe(50);
		expect(areaOf(square, 100, 100)).toBe(2500);
	});

	it("reads 4 m and 20 m² from a 5 m side", () => {
		// A 5 m by 4 m room, 500 by 400 points on a square page of 1000.
		const scale = scaleFrom(
			[
				[0, 0],
				[0.5, 0],
			],
			1000,
			1000,
			5,
			"m",
		);
		expect(scale).not.toBeNull();
		const line = {
			kind: "measure" as const,
			page: 0,
			color: "#000000",
			points: [
				[0, 0],
				[0, 0.4],
			] as Array<[number, number]>,
		};
		const room = {
			...line,
			closed: true,
			points: [
				[0, 0],
				[0.5, 0],
				[0.5, 0.4],
				[0, 0.4],
			] as Array<[number, number]>,
		};
		expect(measureLabel(line, 1000, 1000, scale ?? undefined)).toBe("4 m");
		expect(measureLabel(room, 1000, 1000, scale ?? undefined)).toBe("20 m²");
	});

	it("refuses a scale from nothing", () => {
		const line: Array<[number, number]> = [
			[0.1, 0.1],
			[0.1, 0.1],
		];
		expect(scaleFrom(line, 100, 100, 5, "m")).toBeNull();
		expect(scaleFrom(square, 100, 100, 0, "m")).toBeNull();
		expect(scaleFrom(square, 100, 100, -2, "m")).toBeNull();
		expect(scaleFrom(square, 100, 100, Number.NaN, "m")).toBeNull();
	});
});

const row = (level: number, rest: string) => `${level}\t1\t1\t1\t1\t1\t${rest}`;

describe("lines read from a page", () => {
	const table = [
		row(3, "0\t0\t0\t0\t-1\t"),
		row(4, "100\t100\t500\t40\t-1\t"),
		row(5, "100\t100\t200\t30\t95\tHello"),
		row(5, "320\t100\t200\t30\t40\tworld"),
		row(4, "100\t150\t500\t40\t-1\t"),
		row(5, "100\t150\t200\t30\t90\tagain"),
		row(3, "0\t0\t0\t0\t-1\t"),
		row(4, "100\t300\t500\t40\t-1\t"),
		row(5, "100\t300\t200\t30\t12\tstain"),
		row(5, "320\t300\t200\t30\t90\tNew"),
	].join("\n");

	it("groups words in lines and says where paragraphs begin", () => {
		const lines = linesOfTable(table, 1000, 1000);
		expect(lines.map((l) => l.text)).toEqual(["Hello world", "again", "New"]);
		expect(lines.map((l) => l.opens)).toEqual([true, false, true]);
	});

	it("keeps how sure it was, and passes over a guess", () => {
		const lines = linesOfTable(table, 1000, 1000);
		expect(lines[0].words[1].sure).toBe(40);
		expect(lines[2].words.map((w) => w.text)).toEqual(["New"]);
	});

	it("writes them out with a blank line between paragraphs", () => {
		expect(textOfLines(linesOfTable(table, 1000, 1000))).toBe(
			"Hello world\nagain\n\nNew",
		);
	});
});

describe("a PDF's digital signature", () => {
	const bytes = (text: string) => new TextEncoder().encode(text);

	it("is seen in the file", () => {
		expect(digitallySigned(bytes("%PDF /Sig /ByteRange [0 1 2 3]"))).toBe(true);
	});

	it("is not imagined", () => {
		expect(digitallySigned(bytes("%PDF /Byte /Range /ByteRang"))).toBe(false);
		expect(digitallySigned(new Uint8Array())).toBe(false);
	});
});

describe("a place to sign", () => {
	it("knows a label in any language", () => {
		for (const label of [
			"Signature:",
			"Sign here",
			"Firma",
			"Assinatura do cliente",
			"Подпись",
			"دستخط",
			"签名",
		])
			expect(asksForSignature(label)).toBe(true);
	});

	it("leaves a sentence about signing alone", () => {
		expect(asksForSignature("Digital signature verified")).toBe(false);
		expect(
			asksForSignature(
				"This contract takes effect once its signature page has been returned to us",
			),
		).toBe(false);
		expect(asksForSignature("Designer")).toBe(false);
	});

	it("looks through a page's lines", () => {
		expect(pageAsksForSignature([{ str: "Date" }, { str: "Signature" }])).toBe(
			true,
		);
		expect(pageAsksForSignature([{ str: "Date" }])).toBe(false);
	});
});

describe("a text box's lines", () => {
	const wide = (line: string) => line.length * 10;

	it("wraps to its width", () => {
		expect(layoutText("one two three", 10, 80, wide)).toEqual([
			"one two",
			"three",
		]);
	});

	it("keeps the reader's own line breaks", () => {
		expect(layoutText("one\ntwo", 10, 800, wide)).toEqual(["one", "two"]);
	});

	it("lets a word too long for the box stand alone", () => {
		expect(layoutText("abcdefghijkl", 10, 50, wide)).toEqual(["abcdefghijkl"]);
	});

	it("is as tall as its lines", () => {
		expect(textHeight(["a", "b"], 10)).toBeCloseTo(26);
	});
});
