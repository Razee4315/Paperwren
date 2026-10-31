// @vitest-environment node
import { readFileSync } from "node:fs";
import {
	PDFDocument,
	PDFName,
	PDFNumber,
	type PDFRawStream,
	StandardFonts,
	degrees,
} from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
	addPageNumbers,
	addTextLayer,
	addWatermark,
	buildPdf,
	compressPdf,
	fillAndSign,
	imagesToPdf,
	pageCount,
	pagePoint,
	parsePages,
	protect,
	standardText,
	unlock,
} from "../pdfTools";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
	import.meta.url,
).toString();

/** A PDF of `n` pages, each saying its number; `turns` turns some. */
async function pages(n: number, turns: Record<number, number> = {}) {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	for (let i = 0; i < n; i++) {
		const page = doc.addPage([600, 800]);
		page.drawText(`Page ${i + 1}`, { x: 50, y: 700, size: 24, font });
		if (turns[i]) page.setRotation(degrees(turns[i]));
	}
	return doc.save();
}

/** Each page's words and where they sit on it as shown (fractions from
 * the top left), as pdf.js, the app's own reader, lays them out. */
async function read(bytes: Uint8Array, password?: string) {
	const doc = await pdfjs.getDocument({
		data: bytes.slice(),
		password,
		isEvalSupported: false,
		verbosity: 0,
	}).promise;
	const out: Array<{
		rotate: number;
		words: Array<{ text: string; u: number; v: number }>;
	}> = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		const view = page.getViewport({ scale: 1 });
		const text = await page.getTextContent();
		out.push({
			rotate: page.rotate,
			words: text.items
				.filter(
					(
						i,
					): i is (typeof text.items)[number] & {
						str: string;
						transform: number[];
					} => "str" in i && !!i.str.trim(),
				)
				.map((i) => {
					const [x, y] = view.convertToViewportPoint(
						i.transform[4],
						i.transform[5],
					);
					return { text: i.str, u: x / view.width, v: y / view.height };
				}),
		});
	}
	await doc.destroy();
	return out;
}

describe("where a mark lands", () => {
	const box = { x: 10, y: 20, width: 600, height: 800 };
	it("follows the page's own turn", () => {
		expect(pagePoint({ ...box, turn: 0 }, 0, 0)).toEqual([10, 820]);
		expect(pagePoint({ ...box, turn: 0 }, 1, 1)).toEqual([610, 20]);
		// Turned a quarter clockwise: the bottom left shows at the top left.
		expect(pagePoint({ ...box, turn: 90 }, 0, 0)).toEqual([10, 20]);
		expect(pagePoint({ ...box, turn: 90 }, 1, 0)).toEqual([10, 820]);
		expect(pagePoint({ ...box, turn: 180 }, 0, 0)).toEqual([610, 20]);
		expect(pagePoint({ ...box, turn: 270 }, 0, 0)).toEqual([610, 820]);
	});

	it("puts text where it was placed on every turn of the page", async () => {
		const source = await pages(4, { 1: 90, 2: 180, 3: 270 });
		const marks = [0, 1, 2, 3].map((page) => ({
			page,
			kind: "text" as const,
			text: `Signed ${page}`,
			color: "#1a3c8c",
			x: 0.2,
			y: 0.7,
			w: 0.3,
			h: 0.04,
		}));
		const out = await read(await fillAndSign(source, { marks }));
		for (const [i, page] of out.entries()) {
			const word = page.words.find((w) => w.text === `Signed ${i}`);
			expect(word, `page ${i + 1}`).toBeTruthy();
			// The baseline sits near the foot of the box, at its left.
			expect(word?.u).toBeCloseTo(0.2, 1);
			expect(word?.v).toBeGreaterThan(0.7);
			expect(word?.v).toBeLessThan(0.745);
		}
	});
});

describe("filling a form", () => {
	async function form() {
		const doc = await PDFDocument.create();
		const page = doc.addPage([600, 800]);
		const f = doc.getForm();
		f.createTextField("name").addToPage(page, {
			x: 50,
			y: 700,
			width: 300,
			height: 24,
		});
		f.createCheckBox("agree").addToPage(page, {
			x: 50,
			y: 650,
			width: 16,
			height: 16,
		});
		const pick = f.createDropdown("colour");
		pick.addOptions(["Red", "Green"]);
		pick.addToPage(page, { x: 50, y: 600, width: 120, height: 24 });
		const radio = f.createRadioGroup("size");
		radio.addOptionToPage("S", page, { x: 50, y: 550, width: 16, height: 16 });
		radio.addOptionToPage("L", page, { x: 80, y: 550, width: 16, height: 16 });
		return doc.save();
	}

	it("writes each kind of field", async () => {
		const out = await fillAndSign(await form(), {
			fields: [
				{ name: "name", value: "Ayesha Khan" },
				{ name: "agree", value: true },
				{ name: "colour", value: "Green" },
				{ name: "size", value: "L" },
				{ name: "missing", value: "x" },
			],
		});
		const f = (await PDFDocument.load(out)).getForm();
		expect(f.getTextField("name").getText()).toBe("Ayesha Khan");
		expect(f.getCheckBox("agree").isChecked()).toBe(true);
		expect(f.getDropdown("colour").getSelected()).toEqual(["Green"]);
		expect(f.getRadioGroup("size").getSelected()).toBe("L");
		// pdf.js reads the values back too.
		const doc = await pdfjs.getDocument({ data: out.slice(), verbosity: 0 })
			.promise;
		const values = (await doc.getFieldObjects()) as Record<
			string,
			Array<{ value?: unknown }>
		> | null;
		expect(values?.name?.find((o) => o.value)?.value).toBe("Ayesha Khan");
		await doc.destroy();
	});

	it("flattens on request, and keeps a script Helvetica lacks", async () => {
		const flat = await fillAndSign(await form(), {
			fields: [{ name: "name", value: "Ayesha" }],
			flatten: true,
		});
		expect((await PDFDocument.load(flat)).getForm().getFields()).toHaveLength(
			0,
		);
		expect((await read(flat))[0].words.map((w) => w.text)).toContain("Ayesha");

		const urdu = await fillAndSign(await form(), {
			fields: [{ name: "name", value: "عائشہ خان" }],
		});
		const f = (await PDFDocument.load(urdu)).getForm();
		expect(f.getTextField("name").getText()).toBe("عائشہ خان");
		expect(standardText("عائشہ")).toBe(false);
		expect(standardText("Zoë – café")).toBe(true);
	});
});

describe("pages", () => {
	it("merges, picks, reorders and turns", async () => {
		const a = await pages(3);
		const b = await pages(2);
		const merged = await buildPdf(
			[{ bytes: a }, { bytes: b }],
			[
				{ file: 0, page: 0 },
				{ file: 0, page: 1 },
				{ file: 0, page: 2 },
				{ file: 1, page: 0 },
				{ file: 1, page: 1 },
			],
		);
		expect(await pageCount(merged)).toBe(5);

		const picked = await buildPdf(
			[{ bytes: a }],
			[
				{ file: 0, page: 2, turn: 90 },
				{ file: 0, page: 0 },
				{ file: 0, page: 0 },
			],
		);
		const out = await read(picked);
		expect(out.map((p) => p.words[0]?.text)).toEqual([
			"Page 3",
			"Page 1",
			"Page 1",
		]);
		expect(out.map((p) => p.rotate)).toEqual([90, 0, 0]);
		await expect(buildPdf([{ bytes: a }], [])).rejects.toThrow();
	});

	it("reads page lists as people type them", () => {
		expect(parsePages("1-3, 5", 9)).toEqual([0, 1, 2, 4]);
		expect(parsePages("8-", 9)).toEqual([7, 8]);
		expect(parsePages("3-1", 9)).toEqual([2, 1, 0]);
		expect(parsePages("2 4", 9)).toEqual([1, 3]);
		expect(parsePages("0", 9)).toBeNull();
		expect(parsePages("10", 9)).toBeNull();
		expect(parsePages("a", 9)).toBeNull();
		expect(parsePages("", 9)).toBeNull();
	});

	it("numbers pages, upright on a turned one, and marks them", async () => {
		const numbered = await read(
			await addPageNumbers(await pages(2, { 1: 90 }), {
				pattern: "Page {n} of {total}",
			}),
		);
		for (const [i, page] of numbered.entries()) {
			const label = page.words.find((w) => w.text === `Page ${i + 1} of 2`);
			expect(label, `page ${i + 1}`).toBeTruthy();
			expect(label?.v).toBeGreaterThan(0.9);
			expect(label?.u).toBeGreaterThan(0.35);
			expect(label?.u).toBeLessThan(0.55);
		}
		const marked = await read(
			await addWatermark(await pages(1), { text: "DRAFT" }),
		);
		expect(marked[0].words.map((w) => w.text)).toContain("DRAFT");
		await expect(
			addWatermark(await pages(1), { text: "مسودہ" }),
		).rejects.toThrow();
	});

	it("turns pictures into pages", async () => {
		const png = new Uint8Array(readFileSync("fixtures/sample.png"));
		const fit = await PDFDocument.load(
			await imagesToPdf([{ bytes: png, type: "png" }]),
		);
		expect(fit.getPageCount()).toBe(1);
		const a4 = await PDFDocument.load(
			await imagesToPdf(
				[
					{ bytes: png, type: "png" },
					{ bytes: png, type: "png" },
				],
				"a4",
			),
		);
		expect(a4.getPageCount()).toBe(2);
		const { width, height } = a4.getPage(0).getSize();
		expect(Math.round(Math.min(width, height))).toBe(595);
	});
});

describe("passwords", () => {
	it("locks a copy, and opens it again with the password", async () => {
		const locked = await protect(await pages(2), "wren-42");
		await expect(read(locked)).rejects.toThrow();
		expect((await read(locked, "wren-42")).length).toBe(2);
		const open = await unlock(locked, "wren-42");
		expect((await read(open)).map((p) => p.words[0]?.text)).toEqual([
			"Page 1",
			"Page 2",
		]);
		await expect(unlock(locked, "nope")).rejects.toThrow();
	});
});

describe("compressPdf", () => {
	/** A PDF holding one picture, stored the way `store` says. */
	async function withPicture(
		size: number,
		dict: Record<string, unknown>,
		bytes: Uint8Array,
	) {
		const doc = await PDFDocument.create();
		doc.addPage([100, 100]);
		const ref = doc.context.register(
			doc.context.stream(bytes, {
				Type: "XObject",
				Subtype: "Image",
				Width: size,
				Height: size,
				BitsPerComponent: 8,
				ColorSpace: "DeviceRGB",
				...dict,
			} as never),
		);
		return { bytes: await doc.save(), ref };
	}

	const shrink = async () => ({
		bytes: new Uint8Array(50).fill(7),
		width: 10,
		height: 10,
	});

	it("stores a JPEG again when that saves something", async () => {
		const jpeg = new Uint8Array(5000).fill(1);
		const { bytes, ref } = await withPicture(
			100,
			{ Filter: "DCTDecode" },
			jpeg,
		);
		const seen: boolean[] = [];
		const out = await compressPdf(bytes, async (picture) => {
			seen.push(picture.raw);
			expect(picture.bytes).toEqual(jpeg);
			return shrink();
		});
		expect(seen).toEqual([false]);
		expect(out.length).toBeLessThan(bytes.length);
		const doc = await PDFDocument.load(out);
		const image = doc.context.lookup(ref) as PDFRawStream;
		expect(image.dict.lookup(PDFName.of("Width"))).toEqual(PDFNumber.of(10));
		expect(image.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode"));
	});

	it("reads a JPEG wrapped in another filter", async () => {
		// "Hell" in ASCII85: what reaches the recoder is what it wrapped.
		const wrapped = new TextEncoder().encode("87cUR~>");
		const { bytes } = await withPicture(
			100,
			{ Filter: ["ASCII85Decode", "DCTDecode"] },
			wrapped,
		);
		const seen: string[] = [];
		await compressPdf(bytes, async (picture) => {
			seen.push(new TextDecoder().decode(picture.bytes));
			return null;
		});
		expect(seen).toEqual(["Hell"]);
	});

	it("keeps a picture when the new one is hardly smaller", async () => {
		const jpeg = new Uint8Array(100).fill(1);
		const { bytes, ref } = await withPicture(
			100,
			{ Filter: "DCTDecode" },
			jpeg,
		);
		const out = await compressPdf(bytes, async () => ({
			bytes: new Uint8Array(95),
			width: 10,
			height: 10,
		}));
		const doc = await PDFDocument.load(out);
		const image = doc.context.lookup(ref) as PDFRawStream;
		expect(image.dict.lookup(PDFName.of("Width"))).toEqual(PDFNumber.of(100));
	});

	it("leaves alone what a JPEG would change", async () => {
		const jpeg = new Uint8Array(5000).fill(1);
		const cases: Array<Record<string, unknown>> = [
			{ Filter: "DCTDecode", ColorSpace: "DeviceCMYK" },
			{ Filter: "DCTDecode", ImageMask: true },
			{ Filter: "DCTDecode", Decode: [1, 0, 1, 0, 1, 0] },
			{ Filter: "DCTDecode", Mask: [0, 0, 0, 0, 0, 0] },
			{ Filter: "JBIG2Decode" },
		];
		for (const dict of cases) {
			const { bytes } = await withPicture(100, dict, jpeg);
			const seen: unknown[] = [];
			await compressPdf(bytes, async (picture) => {
				seen.push(picture);
				return null;
			});
			expect(seen).toEqual([]);
		}
	});
});

describe("addTextLayer", () => {
	const word = (text: string, x: number, y: number, rtl = false) => ({
		text,
		x,
		y,
		w: 0.2,
		h: 0.02,
		rtl,
	});
	const blank = async (turn = 0) => {
		const doc = await PDFDocument.create();
		const page = doc.addPage([600, 800]);
		if (turn) page.setRotation(degrees(turn));
		return doc.save();
	};

	it("lays words where they were read, for pdf.js to find", async () => {
		const out = await addTextLayer(await blank(), [
			{ page: 0, words: [word("Hello", 0.1, 0.2), word("world", 0.35, 0.2)] },
		]);
		const [{ words }] = await read(out);
		expect(words.map((w) => w.text.trim())).toEqual(["Hello", "world"]);
		expect(words[0].u).toBeCloseTo(0.1, 2);
		expect(words[0].v).toBeCloseTo(0.22, 1);
	});

	it("reads right-to-left words back in their own order", async () => {
		const text = "کتاب";
		const out = await addTextLayer(await blank(), [
			{ page: 0, words: [word(text, 0.5, 0.2, true)] },
		]);
		const [{ words }] = await read(out);
		expect(words[0].text.trim()).toBe(text);
	});

	it("reads Chinese and Hindi back", async () => {
		const out = await addTextLayer(await blank(), [
			{ page: 0, words: [word("委员会", 0.1, 0.2), word("परिषद", 0.4, 0.2)] },
		]);
		const [{ words }] = await read(out);
		expect(words.map((w) => w.text.trim())).toEqual(["委员会", "परिषद"]);
	});

	it("keeps a real space between words", async () => {
		const out = await addTextLayer(await blank(), [
			{ page: 0, words: [word("परिषद", 0.1, 0.2), word("की", 0.31, 0.2)] },
		]);
		const [{ words }] = await read(out);
		expect(words.map((w) => w.text).join("")).toBe("परिषद की");
	});

	it("puts no space inside a Chinese word", async () => {
		const out = await addTextLayer(await blank(), [
			{ page: 0, words: [word("图", 0.1, 0.2), word("书馆", 0.12, 0.2)] },
		]);
		const [{ words }] = await read(out);
		expect(words.map((w) => w.text).join("")).toBe("图书馆");
	});

	it("follows a page the file turns", async () => {
		const out = await addTextLayer(await blank(90), [
			{ page: 0, words: [word("Turned", 0.1, 0.2)] },
		]);
		const [{ rotate, words }] = await read(out);
		expect(rotate).toBe(90);
		expect(words[0].u).toBeCloseTo(0.1, 1);
		expect(words[0].v).toBeCloseTo(0.2, 1);
	});

	it("draws nothing that can be seen, and leaves other pages alone", async () => {
		const out = await addTextLayer(await pages(2), [
			{ page: 1, words: [word("Hidden", 0.1, 0.2)] },
		]);
		const doc = await pdfjs.getDocument({ data: out.slice(), verbosity: 0 })
			.promise;
		const list = await (await doc.getPage(2)).getOperatorList();
		expect(list.fnArray).toContain(pdfjs.OPS.setTextRenderingMode);
		expect(
			list.argsArray[list.fnArray.indexOf(pdfjs.OPS.setTextRenderingMode)],
		).toEqual([3]);
		const [first, second] = await read(out);
		expect(first.words.map((w) => w.text)).toEqual(["Page 1"]);
		expect(second.words.map((w) => w.text.trim())).toEqual([
			"Page 2",
			"Hidden",
		]);
	});

	it("refuses to make a copy with nothing to add", async () => {
		await expect(
			addTextLayer(await blank(), [{ page: 0, words: [] }]),
		).rejects.toThrow();
	});
});
