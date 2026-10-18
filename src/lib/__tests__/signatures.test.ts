import { describe, expect, it } from "vitest";
import {
	clearShare,
	inkBounds,
	inkFromPaper,
	inkFromPicture,
	normalizeSignatures,
} from "../signatures";

const W = 40;
const H = 20;

/** A picture: a dark line across the middle on `paper` (RGBA), or on
 * nothing when `paper` is null. As a canvas reads it back, a clear pixel
 * is (0, 0, 0, 0). */
function picture(
	paper: [number, number, number, number] | null,
	ink: [number, number, number] = [20, 30, 60],
) {
	const data = new Uint8ClampedArray(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			const line = y >= 9 && y <= 11 && x >= 5 && x < 35;
			if (line) data.set([...ink, 255], i);
			else if (paper) data.set(paper, i);
		}
	return data;
}

const solidAt = (data: Uint8ClampedArray, x: number, y: number) =>
	data[(y * W + x) * 4 + 3];

describe("a signature from a picture", () => {
	it("keeps a PNG made with a clear background as it is", () => {
		const data = picture(null);
		const before = data.slice();
		expect(clearShare(data)).toBeGreaterThan(0.5);
		inkFromPicture(data);
		expect(data).toEqual(before);
		expect(inkBounds(data, W, H, 0)).toEqual({ x: 5, y: 9, w: 30, h: 3 });
	});

	it("never wipes the ink of a clear PNG, even taken as paper", () => {
		// The old fault: clear pixels read as black passed for dark paper,
		// so everything, the ink too, was made clear.
		const data = picture(null);
		inkFromPaper(data);
		expect(solidAt(data, 20, 10)).toBe(255);
		expect(inkBounds(data, W, H, 0)).not.toBeNull();
	});

	it("makes white paper clear and keeps the ink", () => {
		const data = picture([255, 255, 255, 255]);
		expect(clearShare(data)).toBe(0);
		inkFromPicture(data);
		expect(solidAt(data, 0, 0)).toBe(0);
		expect(solidAt(data, 20, 10)).toBe(255);
		expect(inkBounds(data, W, H, 0)).toEqual({ x: 5, y: 9, w: 30, h: 3 });
	});

	it("makes a photo's grey paper clear", () => {
		const data = picture([214, 210, 200, 255]);
		inkFromPicture(data);
		expect(solidAt(data, 0, 0)).toBe(0);
		expect(solidAt(data, 20, 10)).toBe(255);
	});

	it("leaves a picture with no light paper alone, rather than empty", () => {
		const data = picture([30, 30, 30, 255], [70, 70, 70]);
		const before = data.slice();
		inkFromPicture(data);
		expect(data).toEqual(before);
	});

	it("keeps only kept pictures that can be used", () => {
		const png = "data:image/png;base64,iVBORw0KGgo=";
		expect(
			normalizeSignatures([
				{ id: "a", src: png, w: 10, h: 4 },
				{ id: "b", src: "data:image/jpeg;base64,xx", w: 10, h: 4 },
				{ id: "c", src: png, w: 0, h: 4 },
				null,
			]).map((s) => s.id),
		).toEqual(["a"]);
	});
});
