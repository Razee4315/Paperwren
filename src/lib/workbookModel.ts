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
 * cell style engine, so nothing is invented here. Font emphasis,
 * colours, fills and alignment come only from the file's own style
 * table (see sheetStyles.ts, .xlsx/.xlsm); every other format renders
 * with the app's neutral style.
 * Formulas are never recalculated; a formula without a cached result
 * is flagged, never displayed as undefined.
 */

import type * as XLSXNamespace from "xlsx";
import {
	type CellStyle,
	type WorkbookStyles,
	isDefaultInk,
} from "./sheetStyles";

export type { CellStyle };

type WorkBook = XLSXNamespace.WorkBook;
type CellObject = XLSXNamespace.CellObject;

export interface GridCell {
	value: string;
	/** Index into the result's `styles`; absent for the neutral look. */
	style?: number;
	formula?: string;
	/** The cell holds a formula whose cached result is missing: the
	 * details view must say "No cached result" (audit XLS-04 item 4). */
	noCachedResult?: boolean;
	/** Where the cell's link leads: a web or mail address, or a place
	 * in the workbook ("#Sheet2!A1"). Shown to copy, never followed. */
	link?: string;
	/** The note or comment attached to the cell, as plain text. */
	note?: string;
}

const MAX_NOTE = 4000;

/** A cell's link and note, as SheetJS read them. */
function extras(cell: CellObject): Pick<GridCell, "link" | "note"> {
	const out: Pick<GridCell, "link" | "note"> = {};
	const target = cell.l?.Target;
	if (typeof target === "string" && target.trim())
		out.link = target.trim().slice(0, 2000);
	if (Array.isArray(cell.c) && cell.c.length) {
		const note = cell.c
			.map((comment) => (typeof comment.t === "string" ? comment.t.trim() : ""))
			.filter(Boolean)
			.join("\n");
		if (note) out.note = note.slice(0, MAX_NOTE);
	}
	return out;
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
	/** What a supported boundary cut off (audit XLS-04 item 7): how many
	 * columns and rows are shown of a sheet that has more. The viewer
	 * says so in the reader's language. */
	limit?: { columns?: number; rows?: number };
	/** Rows and columns the file freezes at the top / left, counted in
	 * VISIBLE rows and columns. */
	freeze?: { rows: number; cols: number };
	/** Pictures and charts on the sheet, in sheet pixels. */
	objects?: GridObject[];
}

/** A picture or chart floating over the grid. */
export interface GridObject {
	x: number;
	y: number;
	w: number;
	h: number;
	/** The left edge as a visible column (it may lie past the last
	 * one) plus an offset in px, so the object follows column widths. */
	col: number;
	dx: number;
	/** The right edge likewise, when the object stretches with cells. */
	endCol?: number;
	endDx?: number;
	/** Index into the result's `media`. */
	image?: number;
	/** Chart part XML; drawn where there is a DOM. */
	chartXml?: string;
}

export type ParseResult =
	| {
			ok: true;
			sheets: GridSheet[];
			styles?: CellStyle[];
			media?: Array<{ bytes: Uint8Array; type: string }>;
			/** Theme accents, for charts on sheets. */
			accents?: string[];
	  }
	| { ok: false; reason: "corrupt"; detail?: string };

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
const MAX_COL_WIDTH = 600;
const MIN_ROW_HEIGHT = 20;
const MAX_ROW_HEIGHT = 240;
/** Widest a column is made when its width is worked out from its text. */
const MAX_FITTED_WIDTH = 360;
/** Rows looked at when a width or height is worked out from text. */
const FIT_SAMPLE_ROWS = 500;
/** Average advance of a character in the grid's 13px font, and the
 * height of a line of it. */
const CHAR_PX = 7.2;
const LINE_PX = 18;

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

const num = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);

/** True when the file itself says how wide the column is. */
const hasWidth = (col: RawCol | undefined) =>
	!!col && (num(col.width) || num(col.wch) || num(col.wpx));

/** One tested conversion for every supported width unit (audit
 * XLS-04 item 3). The file's own unit comes first: `width` is in
 * characters of Calibri 11 with the cell padding included, 7 px each
 * (8.43 characters, stored as 9.14, is Excel's 64 px default). `wch`
 * is the same without the padding. The parser's own pixel guess
 * assumes a narrower font and comes last. */
function normalizeWidth(col: RawCol | undefined): number {
	if (!col) return DEFAULT_COL_WIDTH;
	const px = num(col.width)
		? col.width * 7
		: num(col.wch)
			? col.wch * 7 + 5
			: num(col.wpx)
				? col.wpx
				: undefined;
	if (px === undefined) return DEFAULT_COL_WIDTH;
	return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(px)));
}

/** True when the file itself says how tall the row is. */
const hasHeight = (row: RawRow | undefined) =>
	!!row && (num(row.hpt) || num(row.hpx));

function normalizeHeight(row: RawRow | undefined): number {
	if (!row) return DEFAULT_ROW_HEIGHT;
	// Points are what the file stores: px at 96/72 dpi.
	const px = num(row.hpt)
		? (row.hpt * 96) / 72
		: num(row.hpx)
			? row.hpx
			: undefined;
	if (px === undefined) return DEFAULT_ROW_HEIGHT;
	return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, Math.round(px)));
}

/** Roughly how wide a line of text is in the grid's font. CJK and
 * other wide characters take about two Latin ones. */
function textPx(line: string): number {
	let units = 0;
	for (const ch of line) units += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? 1.8 : 1;
	return units * CHAR_PX;
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
	data: ArrayBuffer | string,
	authored?: WorkbookStyles | null,
): ParseResult {
	let wb: WorkBook;
	try {
		// Text (CSV/TSV) arrives already decoded by the app so its
		// encoding is detected once, consistently with the text viewer.
		// `cellStyles` is what makes the parser keep the file's column
		// widths, row heights and hidden rows and columns; without it
		// every column comes out at the default width.
		wb = XLSX.read(data, {
			type: typeof data === "string" ? "string" : "array",
			cellStyles: true,
		});
	} catch (e) {
		return { ok: false, reason: "corrupt", detail: String(e) };
	}
	// Hidden-sheet metadata lives on the workbook part (audit XLS-04
	// item 6); visible sheets are the default presentation.
	const workbookMeta = (
		wb as { Workbook?: { Sheets?: Array<{ Hidden?: number }> } }
	).Workbook?.Sheets;
	const sheets: GridSheet[] = [];
	// On an unfilled cell "black" only restates the default ink; it
	// must follow the app theme instead of going black on dark.
	const styles = authored?.styles.map((s) => {
		if (s.fill || !isDefaultInk(s.color)) return s;
		const { color: _, ...rest } = s;
		return rest;
	});
	const styled = (i: number | undefined) =>
		i !== undefined && styles && Object.keys(styles[i] ?? {}).length > 0
			? i
			: undefined;

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

		let rows = Math.max(1, rowOrigins.length);
		const cols = Math.max(1, colOrigins.length);
		const rowPrefix: number[] = [0];
		for (let r = 0; r < rows; r++) {
			rowPrefix.push(rowPrefix[r] + (rowHeights[r] ?? DEFAULT_ROW_HEIGHT));
		}

		const limit: NonNullable<GridSheet["limit"]> = {};
		if (range.e.c + 1 > MAX_COLS) limit.columns = MAX_COLS;
		if (range.e.r + 1 > MAX_ROWS) limit.rows = MAX_ROWS;

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

		let cells: Array<[number, number, GridCell]> = [];
		// The first visible row that did not fit the cell budget, if any.
		let cut: number | undefined;
		const sheetStyles = authored?.sheets.get(sheetName);
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
				cut = vr;
				break;
			}
			cells.push([
				vr,
				vc,
				{
					value,
					noCachedResult,
					formula: cell.f ? `=${cell.f}` : undefined,
					style: styled(sheetStyles?.get(key)),
					...extras(cell),
				},
			]);
		}
		// More cells than a phone can hold: the sheet ends, whole rows
		// only, where the budget ran out (files store their cells row by
		// row), and the viewer says how many rows it shows.
		if (cut !== undefined && cut > 0) {
			const end = cut;
			cells = cells.filter(([r]) => r < end);
			rows = end;
			rowOrigins.length = end;
			rowHeights.length = end;
			rowPrefix.length = end + 1;
			for (let i = mergeRanges.length - 1; i >= 0; i--) {
				if (mergeRanges[i].r0 >= end) mergeRanges.splice(i, 1);
				else if (mergeRanges[i].r1 >= end) mergeRanges[i].r1 = end - 1;
			}
			limit.rows = end;
		}

		// Filled cells without a value still paint (header bands,
		// colour-coded blocks). Never at the cost of the cell budget.
		if (sheetStyles && styles && cut === undefined) {
			for (const [key, index] of sheetStyles) {
				if (cells.length >= MAX_POPULATED_CELLS) break;
				if (!styles[index]?.fill || ws[key]) continue;
				const addr = XLSX.utils.decode_cell(key);
				if (addr.r > rowLimit || addr.c > colLimit) continue;
				if (mergeCovered.has(addr.r * 1024 + addr.c)) continue;
				const vr = rowIndexOf.get(addr.r);
				const vc = colIndexOf.get(addr.c);
				if (vr === undefined || vc === undefined) continue;
				cells.push([vr, vc, { value: "", style: index }]);
			}
		}

		// A file that says nothing about its columns (CSV, most
		// OpenDocument sheets) gets each one as wide as its text, within
		// reason, instead of a row of equal boxes that cut everything off.
		const sample = cells.filter(([r]) => r < FIT_SAMPLE_ROWS);
		if (!colOrigins.some((c) => hasWidth(rawCols[c]))) {
			const widest = new Array<number>(cols).fill(0);
			for (const [, c, cell] of sample) {
				for (const line of cell.value.split("\n"))
					widest[c] = Math.max(widest[c], textPx(line));
			}
			for (let c = 0; c < widths.length; c++) {
				if (widest[c] > 0)
					widths[c] = Math.min(
						MAX_FITTED_WIDTH,
						// Never narrower than the default: short columns keep
						// their room, long ones gain it.
						Math.max(DEFAULT_COL_WIDTH, Math.round(widest[c]) + 20),
					);
			}
		}
		// Wrapped text in a row the file gave no height (it was left to
		// fit itself): tall enough for its lines.
		if (styles) {
			let grew = false;
			for (const [r, c, cell] of sample) {
				if (cell.style === undefined || !styles[cell.style]?.wrap) continue;
				if (hasHeight(rawRows[rowOrigins[r]]) || !cell.value) continue;
				const room = Math.max(24, widths[c] - 14);
				let lines = 0;
				for (const line of cell.value.split("\n"))
					lines += Math.max(1, Math.ceil(textPx(line) / room));
				const needed = Math.min(MAX_ROW_HEIGHT, lines * LINE_PX + 10);
				if (needed > rowHeights[r]) {
					rowHeights[r] = needed;
					grew = true;
				}
			}
			if (grew)
				for (let r = 0; r < rows; r++)
					rowPrefix[r + 1] = rowPrefix[r] + rowHeights[r];
		}

		// Frozen panes count rows/columns as the file has them; hidden
		// ones do not take part in the visible grid.
		const frozen = authored?.freeze.get(sheetName);
		const visibleBefore = (origins: number[], limit: number) => {
			let n = 0;
			while (n < origins.length && origins[n] < limit) n++;
			return n;
		};
		const freeze = frozen
			? {
					rows: Math.min(rows - 1, visibleBefore(rowOrigins, frozen.rows)),
					cols: Math.min(cols - 1, visibleBefore(colOrigins, frozen.cols)),
				}
			: undefined;

		// Pictures and charts: cell anchors + EMU offsets -> sheet pixels.
		// An anchor is often past the last used cell (a chart beside the
		// data); the rows and columns out there have the default size.
		const colPrefix: number[] = [0];
		for (let c = 0; c < widths.length; c++)
			colPrefix.push(colPrefix[c] + widths[c]);
		const emu = (v: number) => v / 9525;
		const edge = (
			prefix: number[],
			origins: number[],
			limit: number,
			at: number,
			unit: number,
		) => {
			const inside = visibleBefore(origins, at);
			const beyond = Math.max(0, at - (limit + 1));
			return {
				index: inside + beyond,
				px: (prefix[inside] ?? 0) + beyond * unit,
			};
		};
		const objects: GridObject[] = [];
		for (const anchor of authored?.anchors.get(sheetName) ?? []) {
			const at = (p: {
				col: number;
				row: number;
				colOff: number;
				rowOff: number;
			}) => {
				const col = edge(
					colPrefix,
					colOrigins,
					colLimit,
					p.col,
					DEFAULT_COL_WIDTH,
				);
				const row = edge(
					rowPrefix,
					rowOrigins,
					rowLimit,
					p.row,
					DEFAULT_ROW_HEIGHT,
				);
				return {
					col: col.index,
					dx: emu(p.colOff),
					x: col.px + emu(p.colOff),
					y: row.px + emu(p.rowOff),
				};
			};
			const from = at(anchor.from);
			const to = !anchor.ext && anchor.to ? at(anchor.to) : undefined;
			const w = anchor.ext ? emu(anchor.ext.cx) : to ? to.x - from.x : 0;
			const h = anchor.ext ? emu(anchor.ext.cy) : to ? to.y - from.y : 0;
			if (w < 4 || h < 4) continue;
			objects.push({
				x: Math.round(from.x),
				y: Math.round(from.y),
				w: Math.round(w),
				h: Math.round(h),
				col: from.col,
				dx: Math.round(from.dx),
				endCol: to?.col,
				endDx: to ? Math.round(to.dx) : undefined,
				image: anchor.image,
				chartXml: anchor.chartXml,
			});
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
			limit: limit.columns || limit.rows ? limit : undefined,
			hiddenSheet: hidden || undefined,
			freeze:
				freeze && (freeze.rows > 0 || freeze.cols > 0) ? freeze : undefined,
			objects: objects.length ? objects : undefined,
		});
	}
	return {
		ok: true,
		sheets,
		styles: authored ? styles : undefined,
		media: authored?.media.length ? authored.media : undefined,
		accents: authored?.accents,
	};
}
