import { describe, expect, it } from "vitest";
import {
	buildZoomAnchor,
	computeAnchoredScroll,
	findAnchorPage,
} from "../pdfLayout";

describe("focal zoom anchoring (audit 6)", () => {
	// A scroller at (0,0) in the viewport, 400x800, content 800x2400.
	const scroller = {
		scrollerRect: { left: 0, top: 0 },
		scrollLeft: 120,
		scrollTop: 500,
		clientWidth: 400,
		clientHeight: 800,
	};

	it("builds a page-local anchor from a focal client point", () => {
		const pageRects = new Map([
			// Page 1 occupies client x 100..300, y 40..740.
			[1, { left: 100, top: 40, width: 200, height: 700 }],
			// Page 2 is clipped below the viewport.
			[2, { left: 100, top: 748, width: 200, height: 700 }],
		]);
		const anchor = buildZoomAnchor({
			pageRects,
			scrollerRect: scroller.scrollerRect,
			clientX: 200,
			clientY: 390,
		});
		// (200,390) is the center of page 1.
		expect(anchor).toEqual({
			pageNumber: 1,
			xRatio: 0.5,
			yRatio: 0.5,
			clientX: 200,
			clientY: 390,
		});
	});

	it("picks the nearest page when the point is in a gap", () => {
		const pageRects = new Map([
			[1, { left: 0, top: 0, width: 400, height: 100 }],
			[2, { left: 0, top: 112, width: 400, height: 60 }],
		]);
		// (200,106) sits in the 12px gap; page 2's center (142) is
		// nearer than page 1's (50).
		expect(findAnchorPage(pageRects, 200, 106)).toBe(2);
	});

	it("puts the anchored point back under the same client point after zoom", () => {
		// Before: page 1 at client (100,40), 200x700. Anchor is its
		// center, client point (200,390). After 2x zoom the page is
		// 400x1400 starting at client (100,40) with the same scroll
		// offsets (before correction).
		const anchor = {
			pageNumber: 1,
			xRatio: 0.5,
			yRatio: 0.5,
			clientX: 200,
			clientY: 390,
		};
		const { left, top } = computeAnchoredScroll({
			anchor,
			pageRect: { left: 100, top: 40, width: 400, height: 1400 },
			...scroller,
			scrollWidth: 800,
			scrollHeight: 2800,
		});
		// Content point of the anchor after zoom:
		// 100 + 0 - ... page content x = (100-0) + 120 + 0.5*400 = 420
		// desired scrollLeft = 420 - (200 - 0) = 220.
		expect(left).toBe(220);
		// page content y = 40 + 500 + 0.5*1400 = 1240; top = 1240-390 = 850.
		expect(top).toBe(850);
	});

	it("clamps to valid scroll ranges on both axes", () => {
		const anchor = {
			pageNumber: 1,
			xRatio: 0,
			yRatio: 0,
			clientX: 0,
			clientY: 0,
		};
		const { left, top } = computeAnchoredScroll({
			anchor,
			pageRect: { left: 0, top: 0, width: 400, height: 700 },
			...scroller,
			scrollWidth: 800,
			scrollHeight: 1400,
		});
		expect(left).toBeGreaterThanOrEqual(0);
		expect(left).toBeLessThanOrEqual(800 - 400);
		expect(top).toBeLessThanOrEqual(1400 - 800);
		expect(top).toBeGreaterThanOrEqual(0);
	});
});
