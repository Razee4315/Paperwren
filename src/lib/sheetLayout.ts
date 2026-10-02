/**
 * Pure grid math for the XLSX viewer (docs/14 audit XLS-01/02):
 * column letters, prefix offsets, and the visible window calculation
 * that keeps 100k-row sheets smooth.
 *
 * One geometry contract for headers, body cells, selection, resize
 * handles, and window math:
 *   - Column offsets are BODY-LOCAL x coordinates: C[0] = 0.
 *   - Row offsets are BODY-LOCAL y coordinates: R[0] = 0.
 *   - The sticky column-header strip overlays the first HEADER_HEIGHT
 *     px of the scrollport, and the sticky row-label rail overlays
 *     the first ROW_LABEL_WIDTH px. Both are overlays, not layout
 *     offsets, so the visible body region in body-local coordinates
 *     starts exactly at the raw scroller offsets and spans
 *     (viewportWidth - ROW_LABEL_WIDTH) x (viewportHeight - HEADER_HEIGHT).
 *   - Everything positions with border-box dimensions: adjacent
 *     cells share grid lines, headers use the same widths as cells.
 *
 * Unit-tested: an off-by-one here renders blank columns or drops
 * the last row silently.
 */

export const ROW_HEIGHT = 30;
export const DEFAULT_COL_WIDTH = 96;
/** Height of the sticky column-letter strip. */
export const HEADER_HEIGHT = 28;
/** Width of the sticky row-number rail. */
export const ROW_LABEL_WIDTH = 48;
export const OVERSCAN = 6;

/** Spreadsheet column name: 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(index: number): string {
	let name = "";
	let n = index;
	while (n >= 0) {
		name = String.fromCharCode(65 + (n % 26)) + name;
		n = Math.floor(n / 26) - 1;
	}
	return name;
}

/** Prefix-summed column offsets for windowing math. Returns C of
 * length widths.length + 1 where C[c] is the body-local left edge of
 * column c and C[cols] its total width. */
export function columnOffsets(widths: number[]): number[] {
	const offsets = [0];
	for (let c = 0; c < widths.length; c++) {
		offsets.push(offsets[c] + (widths[c] ?? DEFAULT_COL_WIDTH));
	}
	return offsets;
}

export interface WindowRange {
	r0: number;
	r1: number;
	c0: number;
	c1: number;
}

/** Row index r such that rowOffsets[r] <= y < rowOffsets[r+1]
 * (binary search over prefix sums for variable row heights). */
export function rowIndexForY(rowOffsets: number[], y: number): number {
	let lo = 0;
	let hi = rowOffsets.length - 2;
	let ans = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (rowOffsets[mid] <= y) {
			ans = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return Math.max(0, ans);
}

/** Which rows and columns should render for the current scroll
 * position. `scrollTop`/`scrollLeft` are raw scroller offsets and
 * `viewportWidth`/`viewportHeight` the raw scrollport size; the
 * sticky header/rail overlays are subtracted here so every caller
 * shares one convention. Rows are uniform ROW_HEIGHT unless
 * `rowOffsets` (prefix sums, length rows + 1) supplies variable
 * heights (audit XLS-04); columns always use prefix offsets.
 */
export function computeVisibleWindow(options: {
	rows: number;
	cols: number;
	colOffsets: number[];
	scrollTop: number;
	scrollLeft: number;
	viewportWidth: number;
	viewportHeight: number;
	rowOffsets?: number[];
}): WindowRange {
	const {
		rows,
		cols,
		colOffsets,
		scrollTop,
		scrollLeft,
		viewportWidth,
		viewportHeight,
		rowOffsets,
	} = options;

	// The sticky header covers the top of the scrollport; the sticky
	// rail covers the left. Body-local visible ranges start at the raw
	// offsets and lose one overlay dimension each.
	const visibleHeight = Math.max(0, viewportHeight - HEADER_HEIGHT);
	const visibleWidth = Math.max(0, viewportWidth - ROW_LABEL_WIDTH);

	let r0: number;
	let r1: number;
	if (rowOffsets && rowOffsets.length >= rows + 1) {
		r0 = Math.max(0, rowIndexForY(rowOffsets, scrollTop) - OVERSCAN);
		const bottom = rowIndexForY(rowOffsets, scrollTop + visibleHeight);
		r1 = Math.min(rows, bottom + 1 + OVERSCAN);
	} else {
		const rawR0 = Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN;
		// Clamp the start so a scroll past the end of the sheet can
		// never produce an inverted (empty but nonzero) window.
		r0 = Math.max(0, Math.min(rawR0, Math.max(0, rows - 1)));
		const rCount = Math.ceil(visibleHeight / ROW_HEIGHT) + OVERSCAN * 2;
		r1 = Math.min(rows, r0 + Math.max(0, rCount));
	}

	// First column whose right edge passes the visible left.
	let c0 = 0;
	while (c0 < cols - 1 && (colOffsets[c0 + 1] ?? 0) <= scrollLeft) {
		c0++;
	}
	c0 = Math.max(0, c0 - OVERSCAN);
	// First column whose left edge passes the visible right.
	let c1 = c0;
	while (
		c1 < cols &&
		(colOffsets[c1] ?? 0) <
			scrollLeft + visibleWidth + OVERSCAN * DEFAULT_COL_WIDTH
	) {
		c1++;
	}
	c1 = Math.min(cols, c1 + OVERSCAN);

	return { r0, r1, c0, c1 };
}
