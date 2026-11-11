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
	const page = (w: number, h: number, ink: Array<[number, number]>) => {
		const data = new Uint8ClampedArray(w * h * 4).fill(255);
		for (const [x, y] of ink)
			data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
		return data;
	};
	it("finds the box around the ink", () => {
		expect(
			inkBox(
				page(20, 30, [
					[3, 4],
					[10, 20],
				]),
				20,
				30,
			),
		).toEqual([3, 4, 11, 21]);
	});
	it("finds nothing on a blank page", () => {
		expect(inkBox(page(20, 30, []), 20, 30)).toBeNull();
	});
});
