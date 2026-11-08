import { describe, expect, it } from "vitest";
import { screenStop } from "../screenStep";

describe("screenStop", () => {
	// Pages 1325 tall with a 6 gap, on a screen 755 tall: the desktop
	// window with a page at fit width.
	const tall = [0, 1331, 2662];

	it("goes most of a screen while the next page is out of sight", () => {
		expect(screenStop(0, 755, 1, tall)).toBeCloseTo(679.5);
	});

	it("stops at the top of the next page once it is on the screen", () => {
		expect(screenStop(680, 755, 1, tall)).toBe(1331);
		expect(screenStop(1331, 755, 1, tall)).toBeCloseTo(2010.5);
		expect(screenStop(2011, 755, 1, tall)).toBe(2662);
	});

	it("turns a page at a time when a whole page fits", () => {
		const fit = [0, 746, 1492];
		expect(screenStop(0, 755, 1, fit)).toBe(746);
		expect(screenStop(746, 755, 1, fit)).toBe(1492);
		expect(screenStop(1492, 755, -1, fit)).toBe(746);
		expect(screenStop(746, 755, -1, fit)).toBe(0);
	});

	it("goes up the same way, never past the top of a page", () => {
		expect(screenStop(1331, 755, -1, tall)).toBeCloseTo(651.5);
		expect(screenStop(651, 755, -1, tall)).toBe(0);
		expect(screenStop(2011, 755, -1, tall)).toBe(1331);
	});

	it("does not take a page top just above or below as the next", () => {
		// Ten pixels short of a page's top: that page is the one on show.
		expect(screenStop(1321, 755, 1, tall)).toBeCloseTo(2000.5);
		expect(screenStop(1341, 755, -1, tall)).toBeCloseTo(661.5);
	});

	it("scrolls a screen when there are no pages to stop at", () => {
		expect(screenStop(100, 500, 1, [])).toBe(550);
		expect(screenStop(600, 500, -1, [])).toBe(150);
	});
});
