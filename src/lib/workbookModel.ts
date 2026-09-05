/**
 * Workbook parsing and normalization (docs/14 audit XLS-04 item 1,
 * XLS-05): a typed module that receives the SheetJS API directly —
 * no window globals — and bounds every loop so a hostile or huge
 * workbook can never hang the parser.
 *
 * The renderer ships this module inside a worker; the UI thread only
 * sees the plain, sparse JSON payload. Merges are validated, kept as
 * RANGES (never one entry per covered coordinate), and their
 * covered-cell suppression is bounded (audit XLS-03/XLS-05).
 *
 * Hidden rows/columns are mapped out of the coordinate space: rows
 * and cells arrive in VISIBLE coordinates plus an origin map so the
 * viewer can disclose original addresses (audit XLS-04 item 3).
 *
 * Fidelity policy (audit XLS-04): SheetJS Community does not expose a
 * cell style engine, so font emphasis / fills / alignment are NOT
 * invented here — cells render with the app's neutral style.
 * Formulas are never recalculated; a formula without a cached result
 * is flagged, never displayed as undefined.
 */

import type * as XLSXNamespace from "xlsx";

type WorkBook = XLSXNamespace.WorkBook;
type CellObject = XLSXNamespace.CellObject;

export interface GridCell {
	value: string;
	bold?: boolean;
	italic?: boolean;
	align?: string;
	formula?: string;
	/** The cell holds a formula whose cached result is missing: the
	 * details view must say "No cached result" (audit XLS-04 item 4). */
	noCachedResult?: boolean;
}

export interface MergeRange {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
}

export interface GridSheet {
	name: string;
	/** Visible row/column counts (hidden entries mapped out). */
	rows: number;
	cols: number;
	/** Visible-column widths in px. */
	widths: number[];
	/** Visible-row heights in px. */
	rowHeights: number[];
	/** Prefix sums of rowHeights: rowPrefix[r] is the y of row r;
	 * length rows + 1. */
	rowPrefix: number[];
	/** Sparse triples [visibleRow, visibleCol, cell], zero-based. */
	cells: Array<[number, number, GridCell]>;
	/** Merge ranges in visible coordinates. */
	merges: MergeRange[];
	/** Original 0-based row index of each visible row (addresses). */
	rowOrigins: number[];
	/** Original 0-based column index of each visible column. */
	colOrigins: number[];
	/** Sheet is marked hidden in the workbook (audit XLS-04 item 6). */
	hiddenSheet?: boolean;
	/** True when merge suppression was partially skipped because a
	 * merge exceeded the expansion budget (values are kept). */
	mergeLimitHit?: boolean;
	/** Precise disclosure when the supported boundary truncated
	 * content (audit XLS-04 item 7), e.g. wide/tall sheets. */
	limitNote?: string;
}

export type ParseResult =
	| { ok: true; sheets: GridSheet[] }
	| { ok: false; reason: "corrupt" | "too-large"; detail?: string };

/** Disclosed supported limits (audit XLS-04 item 7: a tested,
 * precisely-identified boundary rather than a silent truncation). */
export const MAX_ROWS = 1_000_000;
export const MAX_COLS = 500;
export const MAX_POPULATED_CELLS = 400_000;
export const MAX_MERGES = 5_000;
export const MAX_MERGE_EXPANSION = 200_000;

export const DEFAULT_COL_WIDTH = 96;
export const DEFAULT_ROW_HEIGHT = 30;
const MIN_COL_WIDTH = 48;
const MAX_COL_WIDTH = 320;
const MIN_ROW_HEIGHT = 20;
const MAX_ROW_HEIGHT = 120;

/** Error-code -> display string for cells stored without a formatted
 * error text (SheetJS stores the numeric code in `v`). */
const ERROR_TEXT: Record<number, string> = {
	0: "#NULL!",
	7: "#DIV/0!",
	15: "#VALUE!",
	23: "#REF!",
	29: "#NAME?",
	36: "#NUM!",
	42: "#N/A",
};

interface RawCol {
	wpx?: number;
	wch?: number;
	width?: number;
	hidden?: boolean;
}
interface RawRow {
	hpx?: number;
	hpt?: number;
	hidden?: boolean;
}

/** One tested conversion for every supported width unit (audit
 * XLS-04 item 3): authored px wins, else character width via the
 * Calibri-11 approximation (px ≈ wch*7 + 5). */
function normalizeWidth(col: RawCol | undefined): number {
	if (!col) return DEFAULT_COL_WIDTH;
	if (typeof col.wpx === "number" && Number.isFinite(col.wpx)) {
		return Math.min(
			MAX_COL_WIDTH,
			Math.max(MIN_COL_WIDTH, Math.round(col.wpx)),
		);
	}
	const chars =
		typeof col.wch === "number" && Number.isFinite(col.wch)
			? col.wch
			: typeof col.width === "number" && Number.isFinite(col.width)
				? col.width
				: undefined;
	if (chars !== undefined) {
		return Math.min(
			MAX_COL_WIDTH,
			Math.max(MIN_COL_WIDTH, Math.round(chars * 7 + 5)),
		);
	}
	return DEFAULT_COL_WIDTH;
}

function normalizeHeight(row: RawRow | undefined): number {
	if (row && typeof row.hpx === "number" && Number.isFinite(row.hpx)) {
		return Math.min(
			MAX_ROW_HEIGHT,
			Math.max(MIN_ROW_HEIGHT, Math.round(row.hpx)),
		);
	}
	if (row && typeof row.hpt === "number" && Number.isFinite(row.hpt)) {
		// Points -> px at 96/72 dpi.
		return Math.min(
			MAX_ROW_HEIGHT,
			Math.max(MIN_ROW_HEIGHT, Math.round((row.hpt * 96) / 72)),
		);
	}
	return DEFAULT_ROW_HEIGHT;
}

function cellValue(cell: CellObject): {
	value: string;
	noCachedResult?: boolean;
} {
	const hasCached =
		cell.w !== undefined || (cell.v !== undefined && !(cell.t === "z"));
	let value = "";
	if (cell.t === "n") {
		value = String(cell.w ?? cell.v);
	} else if (cell.t === "b") {
		value = cell.v ? "TRUE" : "FALSE";
	} else if (cell.t === "e") {
		const code = typeof cell.v === "number" ? cell.v : undefined;
		value =
			cell.w ?? (code !== undefined ? ERROR_TEXT[code] : undefined) ?? "#ERROR";
	} else if (cell.w !== undefined) {
		value = cell.w;
	} else if (cell.v !== undefined) {
		value = String(cell.v);
	}
	if (!hasCached && cell.f) {
		return { value: "", noCachedResult: true };
	}
	return { value };
}

export function parseWorkbook(
	XLSX: typeof XLSXNamespace,
	data: ArrayBuffer,
): ParseResult {
	let wb: WorkBook;
	try {
		wb = XLSX.read(data, { type: "array" });
	} catch (e) {
		return { ok: false, reason: "corrupt", detail: String(e) };
	}
	// Hidden-sheet metadata lives on the workbook part (audit XLS-04
	// item 6); visible sheets are the default presentation.
	const workbookMeta = (
		wb as { Workbook?: { Sheets?: Array<{ Hidden?: number }> } }
	).Workbook?.Sheets;
	const sheets: GridSheet[] = [];

	for (let si = 0; si < wb.SheetNames.length; si++) {
		const sheetName = wb.SheetNames[si];
		const ws = wb.Sheets[sheetName];
		if (!ws) continue;
		const hidden =
			workbookMeta?.[si]?.Hidden !== undefined && workbookMeta[si].Hidden !== 0;
		const ref = ws["!ref"];
		if (!ref) {
			sheets.push({
				name: sheetName,
				rows: 1,
				cols: 1,
				widths: [DEFAULT_COL_WIDTH],
				rowHeights: [DEFAULT_ROW_HEIGHT],
				rowPrefix: [0, DEFAULT_ROW_HEIGHT],
				cells: [],
				merges: [],
				rowOrigins: [0],
				colOrigins: [0],
				hiddenSheet: hidden || undefined,
			});
			continue;
		}
		const range = XLSX.utils.decode_range(ref);

		// Hidden rows/columns are mapped out; visible coordinates are
		// dense and the origin arrays keep the original addresses.
		const rawRows = (ws["!rows"] ?? []) as RawRow[];
		const rawCols = (ws["!cols"] ?? []) as RawCol[];
		const rowOrigins: number[] = [];
		const rowHeights: number[] = [];
		const rowIndexOf = new Map<number, number>();
		const rowLimit = Math.min(range.e.r, MAX_ROWS - 1);
		for (let r = 0; r <= rowLimit; r++) {
			const raw = rawRows[r];
			if (raw?.hidden) continue;
			rowIndexOf.set(r, rowOrigins.length);
			rowOrigins.push(r);
			rowHeights.push(normalizeHeight(raw));
		}
		const colOrigins: number[] = [];
		const widths: number[] = [];
		const colIndexOf = new Map<number, number>();
		const colLimit = Math.min(range.e.c, MAX_COLS - 1);
		for (let c = 0; c <= colLimit; c++) {
			const raw = rawCols[c];
			if (raw?.hidden) continue;
			colIndexOf.set(c, colOrigins.length);
			colOrigins.push(c);
			widths.push(normalizeWidth(raw));
		}

		const rows = Math.max(1, rowOrigins.length);
		const cols = Math.max(1, colOrigins.length);
		const rowPrefix: number[] = [0];
		for (let r = 0; r < rows; r++) {
			rowPrefix.push(rowPrefix[r] + (rowHeights[r] ?? DEFAULT_ROW_HEIGHT));
		}

		const limitNote =
			range.e.c + 1 > MAX_COLS
				? `Showing the first ${MAX_COLS} columns; the sheet extends to column ${XLSX.utils.encode_col(range.e.c)}.`
				: range.e.r + 1 > MAX_ROWS
					? `Showing the first ${MAX_ROWS.toLocaleString("en-US")} rows.`
					: undefined;

		// Merge ranges: validate, clip to the supported bounds, remap
		// to visible coordinates, and bound the covered-cell
		// suppression. Work scales with merge count and the budget,
		// never with merge area (audit XLS-03/XLS-05).
		const rawMerges = (ws["!merges"] ?? []).slice(0, MAX_MERGES);
		const mergeCovered = new Set<number>();
		const mergeRanges: MergeRange[] = [];
		let expanded = 0;
		let mergeLimitHit = false;
		/** Last VISIBLE index within [from..to], for merge end anchors. */
		const lastVisibleIndex = (
			indexOf: Map<number, number>,
			from: number,
			to: number,
		): number | undefined => {
			for (let i = to; i >= from; i--) {
				const vi = indexOf.get(i);
				if (vi !== undefined) return vi;
			}
			return undefined;
		};
		for (const m of rawMerges) {
			if (!m || !m.s || !m.e) continue;
			const visR0 = rowIndexOf.get(Math.max(0, m.s.r));
			const visC0 = colIndexOf.get(Math.max(0, m.s.c));
			const visR1 = lastVisibleIndex(
				rowIndexOf,
				Math.max(0, m.s.r),
				Math.min(m.e.r, rowLimit),
			);
			const visC1 = lastVisibleIndex(
				colIndexOf,
				Math.max(0, m.s.c),
				Math.min(m.e.c, colLimit),
			);
			if (
				visR0 === undefined ||
				visC0 === undefined ||
				visR1 === undefined ||
				visC1 === undefined ||
				visR1 < visR0 ||
				visC1 < visC0
			) {
				continue; // fully hidden or malformed: skip, don't hang
			}
			const clipped: MergeRange = {
				r0: visR0,
				c0: visC0,
				r1: visR1,
				c1: visC1,
			};
			mergeRanges.push(clipped);
			const area = (visR1 - visR0 + 1) * (visC1 - visC0 + 1);
			if (expanded + area > MAX_MERGE_EXPANSION) {
				mergeLimitHit = true;
				continue;
			}
			for (let r: number = visR0; r <= visR1; r++) {
				for (let c: number = visC0; c <= visC1; c++) {
					if (r === visR0 && c === visC0) continue;
					mergeCovered.add(r * 1024 + c);
				}
			}
			expanded += area;
		}

		const cells: Array<[number, number, GridCell]> = [];
		for (const key of Object.keys(ws)) {
			if (key.startsWith("!")) continue;
			const addr = XLSX.utils.decode_cell(key);
			if (addr.r > rowLimit || addr.c > colLimit) continue;
			if (mergeCovered.has(addr.r * 1024 + addr.c)) continue;
			const vr = rowIndexOf.get(addr.r);
			const vc = colIndexOf.get(addr.c);
			if (vr === undefined || vc === undefined) continue;
			const cell = ws[key] as CellObject | undefined;
			if (!cell) continue;
			const { value, noCachedResult } = cellValue(cell);
			if (cells.length >= MAX_POPULATED_CELLS) {
				return {
					ok: false,
					reason: "too-large",
					detail: `more than ${MAX_POPULATED_CELLS} populated cells`,
				};
			}
			cells.push([
				vr,
				vc,
				{
					value,
					noCachedResult,
					formula: cell.f ? `=${cell.f}` : undefined,
				},
			]);
		}

		sheets.push({
			name: sheetName,
			rows,
			cols,
			widths,
			rowHeights,
			rowPrefix,
			cells,
			merges: mergeRanges,
			rowOrigins,
			colOrigins,
			mergeLimitHit,
			limitNote,
			hiddenSheet: hidden || undefined,
		});
	}
	return { ok: true, sheets };
}
