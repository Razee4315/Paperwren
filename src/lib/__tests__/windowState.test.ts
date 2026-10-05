import { describe, expect, it } from "vitest";
import { normalizePlace, reachable } from "../windowState";

const screen = { x: 0, y: 0, w: 1920, h: 1080 };

describe("the saved window place", () => {
	it("is read back only when it is whole and of a usable size", () => {
		expect(normalizePlace({ x: 10, y: 20, w: 900, h: 700 })).toEqual({
			x: 10,
			y: 20,
			w: 900,
			h: 700,
			maximized: false,
		});
		expect(
			normalizePlace({ x: 0, y: 0, w: 900, h: 700, maximized: true })
				?.maximized,
		).toBe(true);
		expect(normalizePlace(null)).toBeNull();
		expect(normalizePlace({ x: 0, y: 0, w: 900 })).toBeNull();
		expect(normalizePlace({ x: "0", y: 0, w: 900, h: 700 })).toBeNull();
		// A sliver of a window is not one to come back to.
		expect(normalizePlace({ x: 0, y: 0, w: 40, h: 700 })).toBeNull();
	});

	it("is used only while its title bar can still be reached", () => {
		const at = (x: number, y: number) => ({
			x,
			y,
			w: 1000,
			h: 700,
			maximized: false,
		});
		expect(reachable(at(100, 100), [screen])).toBe(true);
		// Hanging off the right edge, but with a grip left on screen.
		expect(reachable(at(1800, 100), [screen])).toBe(true);
		// On a monitor that is no longer there.
		expect(reachable(at(2500, 100), [screen])).toBe(false);
		expect(reachable(at(2500, 100), [screen, { ...screen, x: 1920 }])).toBe(
			true,
		);
		// Title bar above the top of every screen.
		expect(reachable(at(100, -400), [screen])).toBe(false);
		expect(reachable(at(100, 100), [])).toBe(false);
	});
});
