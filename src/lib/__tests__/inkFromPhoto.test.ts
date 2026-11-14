import { describe, expect, it } from "vitest";
import { inkFromPhoto, inkRgb, readPhoto } from "../inkFromPhoto";
import { BLUE, RED, deltaE, inkPhoto, score } from "./inkPhotos";

// One made-up phone photo for every test: yellowish paper, light
// falling from the left, a soft shadow at the lower right, grain,
// noise, a thin blue signature, a red stamp with words and dust.
const photo = inkPhoto(640, 480);
const read = readPhoto(photo);
const made = inkFromPhoto(read);
const result = score(photo, made.data);

/** Whether two pictures' pixels are the same (toEqual is slow on
 * large arrays). */
const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

/** The share of the picture that is ink, by how solid it is. */
function coverage(data: Uint8ClampedArray) {
	let sum = 0;
	for (let i = 3; i < data.length; i += 4) sum += data[i];
	return sum / 255 / (data.length / 4);
}

describe("ink from a photo of a signature and a stamp", () => {
	it("makes the paper clear, in light and in shadow, to its edges", () => {
		expect(result.paperMean).toBeLessThan(0.02);
		expect(result.paperMax).toBeLessThan(0.1);
		expect(result.shadowMean).toBeLessThan(0.02);
		// No frame where the photo ends.
		expect(result.borderMean).toBeLessThan(0.01);
	});

	it("keeps the ink solid", () => {
		expect(result.blueCore).toBeGreaterThan(0.9);
		expect(result.redCore).toBeGreaterThan(0.9);
		// The 2-pixel signature keeps its whole length.
		expect(result.blueKept).toBeGreaterThan(0.98);
	});

	it("keeps the ink's own colour, in the middle and at the edges", () => {
		// ΔE under 10 is a difference seen only side by side.
		expect(result.blueCoreDE).toBeLessThan(10);
		expect(result.redCoreDE).toBeLessThan(10);
		expect(result.blueEdgeDE).toBeLessThan(10);
		expect(result.redEdgeDE).toBeLessThan(10);
	});

	it("drops the dust", () => {
		expect(result.dustMax).toBe(0);
	});

	it("keeps a small mark near the ink: the stamp's full stop", () => {
		const { width } = photo;
		const s = width / 640;
		const x = Math.round(500 * s);
		const y = Math.round(331 * s);
		expect(made.data[(y * width + x) * 4 + 3]).toBeGreaterThan(200);
	});

	it("reads more as ink as it goes darker, and less as lighter", () => {
		const covers = [-1, -0.5, 0, 0.5, 1].map((depth) =>
			coverage(inkFromPhoto(read, { depth }).data),
		);
		for (let i = 1; i < covers.length; i++)
			expect(covers[i]).toBeGreaterThan(covers[i - 1]);
		// Reading the photo again or not makes no difference.
		expect(
			same(
				inkFromPhoto(photo, { depth: 0.5 }).data,
				inkFromPhoto(read, { depth: 0.5 }).data,
			),
		).toBe(true);
	});

	it("with one ink, every mark is that ink and as solid as before", () => {
		const ink = inkRgb("#1a3c8c");
		expect(ink).toEqual([0x1a, 0x3c, 0x8c]);
		if (!ink) return;
		const one = inkFromPhoto(read, { ink }).data;
		let wrong = 0;
		let marks = 0;
		for (let p = 0; p < one.length; p += 4) {
			if (one[p + 3] !== made.data[p + 3]) wrong++;
			if (!one[p + 3]) continue;
			marks++;
			if (one[p] !== ink[0] || one[p + 1] !== ink[1] || one[p + 2] !== ink[2])
				wrong++;
		}
		expect(marks).toBeGreaterThan(1000);
		expect(wrong).toBe(0);
	});

	it("does not change the photo it is given", () => {
		const before = photo.data.slice();
		inkFromPhoto(photo, { depth: 1, ink: [0, 0, 0] });
		expect(same(photo.data, before)).toBe(true);
	});

	it("comes out the same every time", () => {
		expect(same(inkFromPhoto(photo).data, made.data)).toBe(true);
	});

	it("keeps a broad mark solid: a filled logo wider than the paper's cells", () => {
		const w = 320;
		const h = 240;
		const data = new Uint8ClampedArray(w * h * 4);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const light = 1 - 0.3 * (x / w);
				const logo = x >= 100 && x < 220 && y >= 60 && y < 180;
				const ink = logo ? RED : [255, 255, 255];
				for (let c = 0; c < 3; c++)
					data[(y * w + x) * 4 + c] = 236 * light * (ink[c] / 255);
				data[(y * w + x) * 4 + 3] = 255;
			}
		const out = inkFromPhoto({ data, width: w, height: h }).data;
		const at = (x: number, y: number) => (y * w + x) * 4;
		expect(out[at(160, 120) + 3]).toBe(255);
		expect(
			deltaE([...out.slice(at(160, 120), at(160, 120) + 3)], RED),
		).toBeLessThan(10);
		expect(out[at(20, 20) + 3]).toBe(0);
		expect(out[at(300, 220) + 3]).toBe(0);
	});

	it("leaves a photo with no light paper in it as it was", () => {
		const data = new Uint8ClampedArray(64 * 64 * 4);
		for (let p = 0; p < data.length; p += 4) data.set([40, 38, 36, 255], p);
		const out = inkFromPhoto({ data, width: 64, height: 64 }).data;
		expect(same(out, data)).toBe(true);
	});

	it("scores its own inks as their colours", () => {
		// A check on the scoring: a colour against itself.
		expect(deltaE(BLUE, BLUE)).toBe(0);
		expect(deltaE(RED, [200, 120, 60])).toBeGreaterThan(10);
	});
});
