import { describe, expect, it } from "vitest";
import { keyboardInset } from "../keyboardInset";

/**
 * The keyboard inset is the difference of viewports applied as
 * padding. The regression that bit real apps: double-subtracting on
 * devices where Android already resizes the layout viewport.
 */

describe("keyboardInset", () => {
	it("is zero when both viewports agree (Android already resized)", () => {
		expect(
			keyboardInset({
				layoutHeight: 915,
				visualHeight: 915,
				offsetTop: 0,
			}),
		).toBe(0);
	});

	it("measures the keyboard exactly when the layout viewport did not shrink", () => {
		expect(
			keyboardInset({
				layoutHeight: 915,
				visualHeight: 515,
				offsetTop: 0,
			}),
		).toBe(400);
	});

	it("accounts for the visual viewport being scrolled down (iOS pan)", () => {
		expect(
			keyboardInset({
				layoutHeight: 915,
				visualHeight: 515,
				offsetTop: 100,
			}),
		).toBe(300);
	});

	it("ignores pinch zoom, which also shrinks the visual viewport", () => {
		expect(
			keyboardInset({
				layoutHeight: 915,
				visualHeight: 300,
				offsetTop: 0,
				scale: 1.5,
			}),
		).toBe(0);
	});

	it("tolerates sub-pixel noise without producing a visible inset", () => {
		expect(
			keyboardInset({
				layoutHeight: 915,
				visualHeight: 914.5,
				offsetTop: 0,
			}),
		).toBe(0);
	});

	it("rounds fractional insets to whole pixels", () => {
		expect(
			keyboardInset({
				layoutHeight: 915,
				visualHeight: 512.4,
				offsetTop: 0,
			}),
		).toBe(403);
	});

	it("returns zero outside the visual viewport API", () => {
		expect(
			keyboardInset({
				layoutHeight: 915,
				visualHeight: undefined,
				offsetTop: 0,
			}),
		).toBe(0);
	});

	it("never returns a negative inset mid-rotation", () => {
		expect(
			keyboardInset({
				layoutHeight: 400,
				visualHeight: 700,
				offsetTop: 0,
			}),
		).toBe(0);
	});
});
