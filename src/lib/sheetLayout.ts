/**
 * Pure grid math for the XLSX viewer: column letters and the
 * visible window calculation that keeps 100k-row sheets smooth.
 * Unit-tested: an off-by-one here renders blank columns or drops
 * the last row silently.
 */

export const ROW_HEIGHT = 30;
export const DEFAULT_COL_WIDTH = 96;
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

/** Prefix-summed column offsets for windowing math. */
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

/** Which rows and columns should render for the current scroll
 * position. Rows are a fixed 30px; columns use prefix offsets. */
export function computeVisibleWindow(options: {
	rows: number;
	cols: number;
	colOffsets: number[];
	scrollTop: number;
	scrollLeft: number;
	viewportWidth: number;
	viewportHeight: number;
}): WindowRange {
	const {
		rows,
		cols,
		colOffsets,
		scrollTop,
		scrollLeft,
		viewportWidth,
		viewportHeight,
	} = options;

	const rawR0 = Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN;
	// Clamp the start so a scroll past the end of the sheet can never
	// produce an inverted (empty but nonzero) window.
	const r0 = Math.max(0, Math.min(rawR0, Math.max(0, rows - 1)));
	const rCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
	const r1 = Math.min(rows, r0 + Math.max(0, rCount));

	let c0 = 0;
	const viewLeft = scrollLeft;
	while (
		c0 < cols - 1 &&
		(colOffsets[c0 + 1] ?? 0) + ROW_LABEL_WIDTH < viewLeft
	) {
		c0++;
	}
	c0 = Math.max(0, c0 - OVERSCAN);
	let c1 = c0;
	while (
		c1 < cols &&
		(colOffsets[c1] ?? 0) + ROW_LABEL_WIDTH <
			viewLeft + viewportWidth + OVERSCAN * DEFAULT_COL_WIDTH
	) {
		c1++;
	}
	c1 = Math.min(cols, c1 + OVERSCAN);

	return { r0, r1, c0, c1 };
}
