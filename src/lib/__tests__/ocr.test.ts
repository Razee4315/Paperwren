// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cleanPage, hasOwnText, wordsOfTable } from "../ocr";

const row = (
	level: number,
	box: [number, number, number, number],
	conf: number,
	text: string,
) => [level, 1, 1, 1, 1, 1, ...box, conf, text].join("\t");

describe("wordsOfTable", () => {
	it("gives each word its line's height, as fractions of the picture", () => {
		const table = [
			row(4, [100, 200, 300, 40], -1, ""),
			row(5, [100, 210, 100, 25], 96, "Hello"),
			row(5, [220, 200, 180, 40], 91, "world"),
		].join("\n");
		expect(wordsOfTable(table, 1000, 2000)).toEqual([
			{ text: "Hello", x: 0.1, y: 0.1, w: 0.1, h: 0.02, rtl: false },
			{ text: "world", x: 0.22, y: 0.1, w: 0.18, h: 0.02, rtl: false },
		]);
	});

	it("marks right-to-left words", () => {
		const table = [
			row(4, [0, 0, 100, 10], -1, ""),
			row(5, [0, 0, 50, 10], 90, "کتاب"),
			row(5, [60, 0, 40, 10], 90, "2026"),
		].join("\n");
		expect(wordsOfTable(table, 100, 100).map((w) => w.rtl)).toEqual([
			true,
			false,
		]);
	});

	it("leaves out guesses, blanks and broken rows", () => {
		const table = [
			row(4, [0, 0, 100, 10], -1, ""),
			row(5, [0, 0, 50, 10], 12, "smudge"),
			row(5, [0, 0, 50, 10], 95, "   "),
			"not a row",
			"",
		].join("\n");
		expect(wordsOfTable(table, 100, 100)).toEqual([]);
	});
});

describe("hasOwnText", () => {
	it("does not count the short line the scanner prints", () => {
		expect(hasOwnText([{ str: "Scanned with Paperwren" }])).toBe(false);
		expect(hasOwnText([])).toBe(false);
	});

	it("counts a page of text", () => {
		expect(hasOwnText([{ str: "word ".repeat(20) }, {}])).toBe(true);
	});
});

describe("cleanPage", () => {
	/** A page darkening from left to right, with one dark stroke. */
	function shaded(width: number, height: number, strokeAt: number) {
		const rgba = new Uint8ClampedArray(width * height * 4);
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++) {
				const paper = 220 - (x / width) * 110;
				const ink = Math.abs(x - strokeAt) < 2 ? 0.3 : 1;
				const i = (y * width + x) * 4;
				rgba.fill(paper * ink, i, i + 3);
				rgba[i + 3] = 255;
			}
		return rgba;
	}

	it("lifts the shading off the paper and keeps the ink dark", () => {
		const [width, height] = [240, 60];
		const rgba = shaded(width, height, 180);
		const at = (x: number) => rgba[(30 * width + x) * 4];
		cleanPage(rgba, width, height);
		expect(Math.abs(at(40) - at(140))).toBeLessThan(40);
		expect(at(140)).toBeGreaterThan(200);
		expect(at(180)).toBeLessThan(80);
	});

	it("leaves a blank page blank", () => {
		const rgba = new Uint8ClampedArray(40 * 40 * 4).fill(200);
		cleanPage(rgba, 40, 40);
		expect(new Set(rgba.filter((_, i) => i % 4 === 0)).size).toBe(1);
	});
});
