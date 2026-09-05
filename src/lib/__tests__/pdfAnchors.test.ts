import { describe, expect, it } from "vitest";
import {
	buildCanonicalAnchor,
	canonicalToDisplay,
	computeAnchoredScroll,
	displayToCanonical,
	findAnchorPage,
} from "../pdfLayout";

describe("focal zoom anchoring (docs/14 audit PDF-01)", () => {
	// A scroller at (0,0) in the viewport, 400x800, content 800x2400.
	const scroller = {
		scrollerRect: { left: 0, top: 0 },
		scrollLeft: 120,
		scrollTop: 500,
		clientWidth: 400,
		clientHeight: 800,
	};

	it("picks the nearest page when the point is in a gap", () => {
		const pageRects = new Map([
			[1, { left: 0, top: 0, width: 400, height: 100 }],
			[2, { left: 0, top: 112, width: 400, height: 60 }],
		]);
		// (200,106) sits in the 12px gap; page 2's center (142) is
		// nearer than page 1's (50).
		expect(findAnchorPage(pageRects, 200, 106)).toBe(2);
	});

	it("builds a canonical anchor from a displayed point", () => {
		const anchor = buildCanonicalAnchor({
			pageNumber: 1,
			pageRect: { left: 100, top: 40, width: 200, height: 700 },
			rotation: 0,
			clientX: 200,
			clientY: 390,
		});
		// (200,390) is the center of the page: canonical center.
		expect(anchor).toEqual({ x: 0.5, y: 0.5 });
	});

	it("keeps the same text point across a rotation change", () => {
		// Captured at rotation 0: the point at the displayed center.
		const captured = buildCanonicalAnchor({
			pageNumber: 1,
			pageRect: { left: 0, top: 0, width: 200, height: 400 },
			rotation: 0,
			clientX: 100,
			clientY: 200,
		});
		// After rotating the page 90°, its displayed box is 400x200.
		// The same canonical point must sit at the displayed center
		// again (center maps to center under any rotation).
		const display = canonicalToDisplay(captured ?? { x: 0, y: 0 }, 90);
		expect(display.x).toBeCloseTo(0.5, 12);
		expect(display.y).toBeCloseTo(0.5, 12);
		// Any point captured on screen re-displays to the same on-screen
		// fraction at the rotation it was captured in.
		for (const rotation of [0, 90, 180, 270]) {
			const d = { x: 0.25, y: 0.75 };
			const canonical = displayToCanonical(d, rotation);
			const back = canonicalToDisplay(canonical, rotation);
			expect(back.x).toBeCloseTo(d.x, 12);
			expect(back.y).toBeCloseTo(d.y, 12);
		}
	});

	it("puts the anchored point back under the same client point after zoom", () => {
		// Before: page 1 at client (100,40), 200x700, displayed anchor
		// at its center, client point (200,390). After 2x zoom the page
		// is 400x1400 starting at client (100,40) with the same scroll
		// offsets (before correction).
		const { left, top } = computeAnchoredScroll({
			anchor: { x: 0.5, y: 0.5 },
			pageRect: { left: 100, top: 40, width: 400, height: 1400 },
			...scroller,
			scrollWidth: 800,
			scrollHeight: 2800,
			clientX: 200,
			clientY: 390,
		});
		// Content point of the anchor after zoom:
		// page content x = (100-0) + 120 + 0.5*400 = 420
		// desired scrollLeft = 420 - (200 - 0) = 220.
		expect(left).toBe(220);
		// page content y = 40 + 500 + 0.5*1400 = 1240; top = 1240-390 = 850.
		expect(top).toBe(850);
	});

	it("clamps to valid scroll ranges on both axes", () => {
		const { left, top } = computeAnchoredScroll({
			anchor: { x: 0, y: 0 },
			pageRect: { left: 0, top: 0, width: 400, height: 700 },
			...scroller,
			scrollWidth: 800,
			scrollHeight: 1400,
			clientX: 0,
			clientY: 0,
		});
		expect(left).toBeGreaterThanOrEqual(0);
		expect(left).toBeLessThanOrEqual(800 - 400);
		expect(top).toBeLessThanOrEqual(1400 - 800);
		expect(top).toBeGreaterThanOrEqual(0);
	});
});
