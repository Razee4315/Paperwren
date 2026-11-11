import { describe, expect, it } from "vitest";
import {
	type Box,
	inkBox,
	placeBox,
	sharedSize,
} from "../../screens/viewer/pdfCrop";

const A4: Box = [0, 0, 595, 842];
const across = (b: Box) => b[2] - b[0];

describe("cropped pages share one size", () => {
	it("is as wide and tall as the widest and tallest area read", () => {
		const size = sharedSize(
			[
				[170, 300, 400, 700],
				[40, 300, 550, 780],
			],
			A4,
		);
		expect(size[0]).toBeCloseTo(510 + 2 * 0.025 * 595);
		expect(size[1]).toBeCloseTo(480 + 2 * 0.025 * 842);
	});

	it("never grows past the page", () => {
		expect(sharedSize([[0, 0, 595, 842]], A4)).toEqual([595, 842]);
	});

	it("gives odd and even pages of a book the same width", () => {
		const size: [number, number] = [260, 600];
		const odd = placeBox(A4, size, [200, 100, 400, 700], [200, 100, 400, 700]);
		const even = placeBox(A4, size, [90, 100, 290, 700], [90, 100, 290, 700]);
		expect(across(odd)).toBe(260);
		expect(across(even)).toBe(260);
		// Each sits where its side prints.
		expect(odd[0]).toBeGreaterThan(even[0]);
	});

	it("moves the box to take in all a page prints, and keeps it on the page", () => {
		const size: [number, number] = [300, 500];
		const box = placeBox(A4, size, [150, 200, 450, 700], [100, 150, 380, 600]);
		expect(box[0]).toBeLessThanOrEqual(100);
		expect(box[1]).toBeLessThanOrEqual(150);
		expect(box[2]).toBeGreaterThanOrEqual(380);
		const edge = placeBox(A4, size, [500, 100, 595, 600], null);
		expect(edge[2]).toBeLessThanOrEqual(595);
		expect(across(edge)).toBe(300);
	});

	it("never cuts a page that prints wider than the rest", () => {
		const box = placeBox(
			A4,
			[250, 500],
			[170, 200, 400, 700],
			[40, 200, 560, 700],
		);
		expect(box[0]).toBeLessThanOrEqual(40);
		expect(box[2]).toBeGreaterThanOrEqual(560);
	});

	it("keeps a blank page at the usual box", () => {
		const box = placeBox(A4, [260, 600], [170, 100, 430, 700], null);
		expect(box).toEqual([170, 100, 430, 700]);
	});
});

describe("the printed part of a drawing", () => {
	/** A drawing `w` by `h` of paper of tone `paper`, with blocks
	 * (left, top, right, bottom) of tone `tone`. */
	const drawing = (
		w: number,
		h: number,
		paper: number,
		blocks: Array<[Box, number]> = [],
	) => {
		const data = new Uint8ClampedArray(w * h * 4).fill(255);
		const set = (x: number, y: number, v: number) =>
			data.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
		for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, paper);
		for (const [[l, t, r, b], tone] of blocks)
			for (let y = t; y < b; y++) for (let x = l; x < r; x++) set(x, y, tone);
		return { data, set };
	};

	it("finds the box around the ink", () => {
		const { data } = drawing(20, 30, 255, [
			[[3, 4, 6, 6], 0],
			[[9, 18, 11, 21], 0],
		]);
		expect(inkBox(data, 20, 30)).toEqual([3, 4, 11, 21]);
	});

	it("finds nothing on a blank page", () => {
		expect(inkBox(drawing(20, 30, 255).data, 20, 30)).toBeNull();
	});

	it("finds the text of a scan: grey paper, a dark edge, a shadow and specks", () => {
		const w = 110;
		const h = 155;
		const { data, set } = drawing(w, h, 214, [
			// The scanner's edge down the left, a shadow along the bottom
			// (the drawing's last line left white, as a canvas leaves it).
			[[0, 0, 4, h], 40],
			[[0, h - 5, w, h - 1], 90],
			[[0, h - 1, w, h], 255],
			// The text.
			[[20, 25, 90, 120], 30],
		]);
		// Lone specks all over, darker than the paper.
		let seed = 7;
		const next = (n: number) => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed % n;
		};
		for (let i = 0; i < 120; i++) set(next(w), next(h - 5), 150);
		const box = inkBox(data, w, h);
		expect(box).not.toBeNull();
		const [l, t, r, b] = box as Box;
		// Close around the text, not the page.
		expect(l).toBeGreaterThanOrEqual(16);
		expect(t).toBeGreaterThanOrEqual(21);
		expect(r).toBeLessThanOrEqual(94);
		expect(b).toBeLessThanOrEqual(124);
		expect(l).toBeLessThanOrEqual(20);
		expect(r).toBeGreaterThanOrEqual(90);
	});

	it("keeps a dark banner on a page made on a computer", () => {
		const { data } = drawing(100, 140, 255, [
			[[0, 0, 100, 12], 40],
			[[20, 30, 80, 120], 0],
		]);
		expect(inkBox(data, 100, 140)).toEqual([0, 0, 100, 120]);
	});

	it("keeps a photo that fills the page", () => {
		const { data } = drawing(100, 140, 200, [[[0, 0, 100, 140], 60]]);
		expect(inkBox(data, 100, 140)).toEqual([0, 0, 100, 140]);
	});
});
