// @vitest-environment node
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
	type DrawnPage,
	MOST_TRIES,
	aimFor,
	compressToSize,
	pageSetting,
	parseSize,
	pictureSetting,
	picturesToSize,
	sizeLimit,
} from "../pdfCompress";
import {
	type StoredPicture,
	compressPdf,
	open,
	picturesOf,
	writePictures,
} from "../pdfTools";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
	import.meta.url,
).toString();

/** Bytes that do not pack: as a photo's JPEG is. */
function noise(n: number, seed = 1) {
	const out = new Uint8Array(n);
	let x = seed >>> 0 || 1;
	for (let i = 0; i < n; i++) {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		out[i] = x & 255;
	}
	return out;
}

/** A PDF of `count` pages, each a large photo stored as a JPEG of
 * `size` bytes. */
async function photos(count: number, size: number) {
	const doc = await PDFDocument.create();
	for (let i = 0; i < count; i++) {
		const page = doc.addPage([600, 800]);
		const ref = doc.context.register(
			doc.context.stream(noise(size, i + 1), {
				Type: "XObject",
				Subtype: "Image",
				Width: 2000,
				Height: 1500,
				BitsPerComponent: 8,
				ColorSpace: "DeviceRGB",
				Filter: "DCTDecode",
			}),
		);
		page.node.newXObject("Im", ref);
	}
	return doc.save();
}

/** A stand-in for the canvas: a JPEG as big as one of that many pixels
 * at that quality would be, near enough. */
const recodeAt = (at: number) => async (picture: StoredPicture) => {
	const { side, quality } = pictureSetting(at);
	const scale = Math.min(1, side / Math.max(picture.width, picture.height));
	const width = Math.round(picture.width * scale);
	const height = Math.round(picture.height * scale);
	return {
		bytes: noise(Math.round(width * height * quality * 0.12), width),
		width,
		height,
	};
};

/** A PDF of `n` pages of words only. */
async function words(n: number) {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	for (let i = 0; i < n; i++)
		doc
			.addPage([600, 800])
			.drawText(`Page ${i + 1} of a letter with no pictures`, {
				x: 50,
				y: 700,
				size: 18,
				font,
			});
	return doc.save();
}

async function pdfjsPages(bytes: Uint8Array) {
	const doc = await pdfjs.getDocument({
		data: bytes.slice(),
		isEvalSupported: false,
		verbosity: 0,
	}).promise;
	const text: string[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		text.push(
			(await page.getTextContent()).items
				.map((i) => ("str" in i ? i.str : ""))
				.join(""),
		);
	}
	await doc.destroy();
	return text;
}

describe("aimFor", () => {
	/** A file whose size grows with the setting as a JPEG's does. */
	const sized = (lo: number, hi: number) => {
		const sizes: number[] = [];
		const write = async (at: number) => {
			const length = Math.round(lo + (hi - lo) * at ** 1.7);
			sizes.push(length);
			return { length };
		};
		return { sizes, write };
	};

	it("takes the best setting at once when it fits", async () => {
		const { sizes, write } = sized(10, 100);
		const aim = await aimFor(200, write);
		expect(sizes).toEqual([100]);
		expect(aim.best?.length).toBe(100);
		expect(aim.at).toBe(1);
	});

	it("says how small it can get when nothing fits", async () => {
		const { sizes, write } = sized(340_000, 2_000_000);
		const aim = await aimFor(200_000, write);
		expect(aim.best).toBeNull();
		expect(aim.smallest).toBe(340_000);
		expect(sizes).toHaveLength(2);
	});

	it("finds the largest that fits in a few writes", async () => {
		for (const target of [150_000, 200_000, 500_000, 900_000]) {
			const { sizes, write } = sized(60_000, 1_200_000);
			const aim = await aimFor(target, write);
			expect(sizes.length).toBeLessThanOrEqual(MOST_TRIES);
			const fitting = sizes.filter((n) => n <= target);
			expect(aim.best?.length).toBe(Math.max(...fitting));
			// Close under the target, not merely under it.
			expect(aim.best?.length ?? 0).toBeGreaterThan(target * 0.85);
		}
	});

	it("can start from the smallest", async () => {
		const { sizes, write } = sized(500, 5000);
		const aim = await aimFor(400, write, { from: "smallest" });
		expect(sizes).toEqual([500]);
		expect(aim.best).toBeNull();
		expect(aim.smallest).toBe(500);
	});

	it("tells of each write before it is made", async () => {
		const { write } = sized(60_000, 1_200_000);
		const heard: string[] = [];
		await aimFor(300_000, write, {
			onTry: (n, most) => heard.push(`${n}/${most}`),
		});
		expect(heard[0]).toBe(`1/${MOST_TRIES}`);
		expect(heard.length).toBeLessThanOrEqual(MOST_TRIES);
	});

	it("keeps its settings within bounds", () => {
		expect(pictureSetting(0)).toEqual({ side: 700, quality: 0.3 });
		expect(pictureSetting(1)).toEqual({ side: 2400, quality: 0.85 });
		expect(pageSetting(0).dpi).toBeLessThan(pageSetting(1).dpi);
	});
});

describe("sizes", () => {
	it("aims under a thousand bytes to the kilobyte, and allows 1024", () => {
		expect(sizeLimit(200, "kb")).toEqual({ aim: 200_000, most: 204_800 });
		expect(sizeLimit(2, "mb")).toEqual({ aim: 2_000_000, most: 2_097_152 });
	});

	it("reads a size as typed", () => {
		expect(parseSize("300", "kb")?.aim).toBe(300_000);
		expect(parseSize(" 1.5 ", "mb")?.aim).toBe(1_500_000);
		expect(parseSize("1,5", "mb")?.aim).toBe(1_500_000);
		// Arabic and Persian digits.
		expect(parseSize("٢٠٠", "kb")?.aim).toBe(200_000);
		expect(parseSize("۵۰۰", "kb")?.aim).toBe(500_000);
		for (const wrong of ["", "abc", "0", "0.5", "-3", "1e3", "2 MB"])
			expect(parseSize(wrong, "kb"), wrong).toBeNull();
	});
});

describe("a picture set written again", () => {
	it("writes the same pictures each time, from one reading", async () => {
		const bytes = await photos(2, 120_000);
		const set = await picturesOf(await open(bytes));
		expect(set.found).toHaveLength(2);
		const first = await writePictures(set, recodeAt(0.2));
		await writePictures(set, recodeAt(0.9));
		const again = await writePictures(set, recodeAt(0.2));
		// The writer numbers one more object each time; nothing else moves.
		expect(Math.abs(again.length - first.length)).toBeLessThan(8);
		// The same as a fresh compress at that setting.
		const fresh = await compressPdf(bytes, recodeAt(0.2));
		expect(Math.abs(fresh.length - first.length)).toBeLessThan(8);
	});
});

describe("compressToSize", () => {
	it("meets 200 KB for a PDF of photos, as near it as it can", async () => {
		const bytes = await photos(4, 300_000);
		expect(bytes.length).toBeGreaterThan(1_000_000);
		const heard: number[] = [];
		const fitted = await compressToSize(bytes, sizeLimit(200, "kb"), recodeAt, {
			onTry: (n) => heard.push(n),
		});
		expect(fitted.kind).toBe("made");
		if (fitted.kind !== "made") return;
		expect(fitted.bytes.length).toBeLessThanOrEqual(200_000);
		expect(fitted.bytes.length).toBeGreaterThan(150_000);
		expect(fitted.tries).toBeLessThanOrEqual(6);
		expect(heard).toHaveLength(fitted.tries);
		expect((await PDFDocument.load(fitted.bytes)).getPageCount()).toBe(4);
	});

	it("leaves a file that already fits alone", async () => {
		const bytes = await words(2);
		let writes = 0;
		const fitted = await compressToSize(bytes, sizeLimit(500, "kb"), (at) => {
			writes++;
			return recodeAt(at);
		});
		expect(fitted).toEqual({ kind: "fits" });
		expect(writes).toBe(0);
	});

	it("counts a copy within 1024 bytes to the kilobyte as fitting", async () => {
		const bytes = await photos(1, 60_000);
		// What the smallest setting writes, just past the aim.
		const fitted0 = await compressToSize(bytes, { aim: 1, most: 1 }, recodeAt);
		if (fitted0.kind !== "too big") throw new Error("expected too big");
		const near = fitted0.smallest;
		const fitted = await compressToSize(
			bytes,
			{ aim: near - 10, most: near + 10 },
			recodeAt,
		);
		expect(fitted.kind).toBe("made");
	});

	it("says truly how small a PDF of words gets", async () => {
		const bytes = await words(3);
		const fitted = await compressToSize(
			bytes,
			{ aim: 300, most: 300 },
			recodeAt,
		);
		expect(fitted.kind).toBe("too big");
		if (fitted.kind !== "too big") return;
		// No pictures: one write says all there is to say.
		expect(fitted.tries).toBe(1);
		// The number said is the size of a real copy.
		const doc = await open(bytes);
		const { tidyPdf } = await import("../pdfLossless");
		await tidyPdf(doc);
		const copy = await writePictures(await picturesOf(doc), recodeAt(0));
		expect(Math.abs(copy.length - fitted.smallest)).toBeLessThan(8);
		expect(fitted.smallest).toBeGreaterThan(300);
	});
});

describe("picturesToSize", () => {
	const photo = new Uint8Array(readFileSync("fixtures/features/photo.jpg"));
	/** Every page as a picture whose size grows with the setting: the
	 * photo, with as much more after its end as a page would have. */
	const drawer = (pages: number) => {
		const settings: number[] = [];
		const draw = async (at: number): Promise<DrawnPage[]> => {
			settings.push(at);
			const { dpi, quality } = pageSetting(at);
			const extra = Math.round(dpi * dpi * quality * 0.6);
			return Array.from({ length: pages }, () => {
				const bytes = new Uint8Array(photo.length + extra);
				bytes.set(photo);
				return { bytes, width: 200, height: 320, w: 600, h: 800 };
			});
		};
		return { settings, draw };
	};

	it("makes pages of pictures that fit, with no text left", async () => {
		const source = await words(3);
		const { settings, draw } = drawer(3);
		const fitted = await picturesToSize(sizeLimit(40, "kb"), draw);
		expect(fitted.kind).toBe("made");
		if (fitted.kind !== "made") return;
		expect(fitted.bytes.length).toBeLessThanOrEqual(40_000);
		expect(settings.length).toBeLessThanOrEqual(6);
		const before = await pdfjsPages(source);
		const after = await pdfjsPages(fitted.bytes);
		expect(after).toHaveLength(before.length);
		expect(after.every((text) => text === "")).toBe(true);
		const doc = await PDFDocument.load(fitted.bytes);
		expect(doc.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
	});

	it("says so when even the smallest pictures are too big", async () => {
		const { settings, draw } = drawer(3);
		const fitted = await picturesToSize(sizeLimit(5, "kb"), draw);
		expect(fitted.kind).toBe("too big");
		if (fitted.kind !== "too big") return;
		expect(settings).toEqual([0]);
		// The smallest it could make, as made.
		expect(fitted.smallest).toBeGreaterThan(3 * photo.length);
	});
});
