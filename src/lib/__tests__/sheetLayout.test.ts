import { describe, expect, it } from "vitest";
import {
	DEFAULT_COL_WIDTH,
	HEADER_HEIGHT,
	OVERSCAN,
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
		// The sticky header overlays the top of the scrollport, so the
		// visible body is viewportHeight - HEADER_HEIGHT tall.
		expect(win.r1).toBe(
			Math.ceil((600 - HEADER_HEIGHT) / ROW_HEIGHT) + 2 * OVERSCAN,
		);
		// Columns: the rail overlays ROW_LABEL_WIDTH, so 352px of body
		// covers 4 of the 100px columns plus overscan.
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
		expect(deep.r0).toBe(Math.floor(50000 / ROW_HEIGHT) - OVERSCAN);
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
		// Body-local offsets: column 15 is the first whose box starts at
		// or after the visible left edge; overscan reaches back to 9.
		expect(scrolled.c0).toBe(15 - OVERSCAN);
		expect(atLeft.c0).toBe(0);
		// And the window still covers the right edge of the viewport:
		// visible width = 400 - 48, so the edge sits at x = 1852 inside
		// column 18; the clamped window reaches the last column.
		expect(scrolled.c1).toBe(cols);
	});

	it("includes a column that is partially revealed at the left edge", () => {
		// Unequal widths: [60, 140, ...]. At scrollLeft 100 the first
		// column is fully behind (its right edge is exactly 60? no: 60),
		// the second spans 60..200 and is half visible.
		const offsets = columnOffsets([60, 140, 140]);
		const win = computeVisibleWindow({
			rows: 10,
			cols: 3,
			colOffsets: offsets,
			scrollTop: 0,
			scrollLeft: 100,
			viewportWidth: 400,
			viewportHeight: 300,
		});
		// Column 1 spans 60..200; with overscan the window must still
		// include column 0.
		expect(win.c0).toBe(0);
		expect(win.c1).toBe(3);
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

	it("keeps first and last rows renderable without overscan concealing offsets", () => {
		// Exactly one viewport of content: scrolling to the very bottom
		// must still cover the final row, and the top must include row 0.
		const rows = 20;
		const total = rows * ROW_HEIGHT;
		const atBottom = computeVisibleWindow({
			rows,
			cols,
			colOffsets,
			scrollTop: total - (600 - HEADER_HEIGHT),
			scrollLeft: 0,
			viewportWidth: 400,
			viewportHeight: 600,
		});
		expect(atBottom.r1).toBe(rows);
		const atTop = computeVisibleWindow({
			rows,
			cols,
			colOffsets,
			scrollTop: 0,
			scrollLeft: 0,
			viewportWidth: 400,
			viewportHeight: 600,
		});
		expect(atTop.r0).toBe(0);
	});

	it("survives a zero-size viewport", () => {
		const win = computeVisibleWindow({
			rows: 100,
			cols,
			colOffsets,
			scrollTop: 0,
			scrollLeft: 0,
			viewportWidth: 0,
			viewportHeight: 0,
		});
		expect(win.r0).toBe(0);
		expect(win.c0).toBe(0);
	});
});

describe("row metrics", () => {
	it("keeps rows at a touch-friendly height and labels at 48px", () => {
		expect(ROW_HEIGHT).toBe(30);
		expect(ROW_LABEL_WIDTH).toBe(48);
		expect(HEADER_HEIGHT).toBe(28);
	});
});

describe("variable row heights (audit XLS-04)", () => {
	it("windows rows through prefix sums and clamps at the end", () => {
		// Heights: 40, 30, 60, 30 → prefix [0, 40, 70, 130, 160].
		const rowOffsets = [0, 40, 70, 130, 160];
		const win = computeVisibleWindow({
			rows: 4,
			cols: 5,
			colOffsets: columnOffsets([100, 100, 100, 100, 100]),
			scrollTop: 80,
			scrollLeft: 0,
			viewportWidth: 400,
			viewportHeight: 600,
			rowOffsets,
		});
		// y=80 sits inside row 2 (70..130); overscan reaches back to 0.
		expect(win.r0).toBe(0);
		// The window bottom (80+572=652) is past the last row.
		expect(win.r1).toBe(4);
	});

	it("never yields an empty window mid-scroll with variable heights", () => {
		const rowOffsets = [0];
		let acc = 0;
		const rows = 300;
		for (let r = 0; r < rows; r++) {
			acc += 20 + (r % 5) * 10;
			rowOffsets.push(acc);
		}
		for (let y = 0; y < acc; y += 37) {
			const win = computeVisibleWindow({
				rows,
				cols: 4,
				colOffsets: columnOffsets([100, 100, 100, 100]),
				scrollTop: y,
				scrollLeft: 0,
				viewportWidth: 400,
				viewportHeight: 600,
				rowOffsets,
			});
			expect(win.r1).toBeGreaterThan(win.r0);
		}
	});
});
