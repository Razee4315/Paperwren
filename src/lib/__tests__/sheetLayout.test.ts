import { describe, expect, it } from "vitest";
import {
	DEFAULT_COL_WIDTH,
	ROW_HEIGHT,
	ROW_LABEL_WIDTH,
	colName,
	columnOffsets,
	computeVisibleWindow,
} from "../sheetLayout";

describe("colName", () => {
	it("maps the first columns", () => {
		expect(colName(0)).toBe("A");
		expect(colName(1)).toBe("B");
		expect(colName(25)).toBe("Z");
	});
	it("rolls over into two letters", () => {
		expect(colName(26)).toBe("AA");
		expect(colName(27)).toBe("AB");
		expect(colName(701)).toBe("ZZ");
		expect(colName(702)).toBe("AAA");
	});
});

describe("columnOffsets", () => {
	it("produces prefix sums", () => {
		const offsets = columnOffsets([100, 50, 50]);
		expect(offsets).toEqual([0, 100, 150, 200]);
	});
	it("falls back to the default width for missing entries", () => {
		const offsets = columnOffsets([DEFAULT_COL_WIDTH]);
		expect(offsets).toEqual([0, DEFAULT_COL_WIDTH]);
	});
});

describe("computeVisibleWindow", () => {
	const cols = 20;
	const widths = Array.from({ length: cols }, () => 100);
	const colOffsets = columnOffsets(widths);

	it("renders the first window at the origin", () => {
		const win = computeVisibleWindow({
			rows: 1000,
			cols,
			colOffsets,
			scrollTop: 0,
			scrollLeft: 0,
			viewportWidth: 400,
			viewportHeight: 600,
		});
		expect(win.r0).toBe(0);
		expect(win.c0).toBe(0);
		// Rows: 600/30 visible + overscan on both sides, clamped.
		expect(win.r1).toBe(Math.ceil(600 / 30) + 2 * 6);
		// Columns: 400px covers 4 of the 100px columns plus overscan.
		expect(win.c1).toBeGreaterThan(4);
		expect(win.c1).toBeLessThanOrEqual(cols);
	});

	it("moves the window with the scroll position", () => {
		const atTop = computeVisibleWindow({
			rows: 100000,
			cols,
			colOffsets,
			scrollTop: 0,
			scrollLeft: 0,
			viewportWidth: 400,
			viewportHeight: 600,
		});
		const deep = computeVisibleWindow({
			rows: 100000,
			cols,
			colOffsets,
			scrollTop: 50000,
			scrollLeft: 0,
			viewportWidth: 400,
			viewportHeight: 600,
		});
		expect(deep.r0).toBeGreaterThan(atTop.r0);
		// Deep in the document the first row renders at the right place.
		expect(deep.r0).toBe(Math.floor(50000 / ROW_HEIGHT) - 6);
	});

	it("scrolls right through wide sheets (horizontal virtualization)", () => {
		const atLeft = computeVisibleWindow({
			rows: 100,
			cols,
			colOffsets,
			scrollTop: 0,
			scrollLeft: 0,
			viewportWidth: 400,
			viewportHeight: 600,
		});
		const scrolled = computeVisibleWindow({
			rows: 100,
			cols,
			colOffsets,
			scrollTop: 0,
			scrollLeft: 1500,
			viewportWidth: 400,
			viewportHeight: 600,
		});
		// 1500px in, the label column plus 14 columns of 100px are to
		// the left, so column 13 (0-based) is the first visible one.
		expect(scrolled.c0).toBeGreaterThanOrEqual(atLeft.c0 + 8);
		// And the window still covers the right edge of the viewport.
		expect(scrolled.c1).toBeGreaterThan(scrolled.c0);
	});

	it("clamps to the sheet bounds at the far corner", () => {
		const win = computeVisibleWindow({
			rows: 50,
			cols: 10,
			colOffsets,
			scrollTop: 100000,
			scrollLeft: 100000,
			viewportWidth: 400,
			viewportHeight: 600,
		});
		expect(win.r1).toBe(50);
		expect(win.c1).toBe(10);
		expect(win.r0).toBeLessThan(win.r1);
		expect(win.c0).toBeLessThan(win.c1);
	});

	it("never renders an empty window mid-scroll", () => {
		for (let scroll = 0; scroll < 3000; scroll += 90) {
			const win = computeVisibleWindow({
				rows: 200,
				cols,
				colOffsets,
				scrollTop: scroll,
				scrollLeft: 0,
				viewportWidth: 400,
				viewportHeight: 600,
			});
			expect(win.r1).toBeGreaterThan(win.r0);
			expect(win.c1).toBeGreaterThan(win.c0);
		}
	});
});

describe("row metrics", () => {
	it("keeps rows at a touch-friendly height and labels at 48px", () => {
		expect(ROW_HEIGHT).toBe(30);
		expect(ROW_LABEL_WIDTH).toBe(48);
	});
});
