import { t } from "@/lib/i18n";
import type { ChartColors } from "@/lib/pptx/chart";
import { attrOf, kid } from "@/lib/pptx/xml";
import { fitted } from "@/lib/print";
import { colName } from "@/lib/sheetLayout";
import type { CellStyle, GridCell, GridSheet } from "@/lib/workbookModel";
import type { CSSProperties } from "react";
import s from "./Sheet.module.css";

/** A parsed sheet with its cells indexed for the grid. */
export interface Sheet extends Omit<GridSheet, "cells"> {
	cells: Map<number, GridCell>;
}

export const key = (r: number, c: number) => r * 1024 + c;

/** Looks like a number, as a person would type one (right-aligned). */
export const NUMERIC = /^[-+(]?[$€£¥]?\s?[\d.,]+%?\)?$/;

/** A cell range, corners included. */
export interface Range {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
}

export const rangeOf = (
	a: { r: number; c: number },
	b: { r: number; c: number },
): Range => ({
	r0: Math.min(a.r, b.r),
	c0: Math.min(a.c, b.c),
	r1: Math.max(a.r, b.r),
	c1: Math.max(a.c, b.c),
});

/** "B2" or "B2:D9", in the file's own addresses. */
export function rangeLabel(sheet: Sheet, range: Range): string {
	const at = (r: number, c: number) =>
		`${colName(sheet.colOrigins[c] ?? c)}${(sheet.rowOrigins[r] ?? r) + 1}`;
	const from = at(range.r0, range.c0);
	return range.r0 === range.r1 && range.c0 === range.c1
		? from
		: `${from}:${at(range.r1, range.c1)}`;
}

/** The range as tab-separated text, ready to paste into a sheet. */
export function rangeText(sheet: Sheet, range: Range): string {
	const lines: string[] = [];
	for (let r = range.r0; r <= range.r1; r++) {
		const row: string[] = [];
		for (let c = range.c0; c <= range.c1; c++)
			// A value with a tab or line break would shift the columns.
			row.push(
				(sheet.cells.get(key(r, c))?.value ?? "").replace(/[\t\r\n]+/g, " "),
			);
		lines.push(row.join("\t"));
	}
	return lines.join("\n");
}

/** A displayed value as a number, or null when it is not one.
 * Percentages and "(1,234)" negatives are understood. */
export function toNumber(value: string): number | null {
	if (!NUMERIC.test(value)) return null;
	const negative = value.startsWith("(") || value.startsWith("-");
	const percent = value.includes("%");
	const digits = value.replace(/[^\d.,]/g, "").replace(/,/g, "");
	if (!digits || digits.split(".").length > 2) return null;
	const n = Number(digits);
	if (!Number.isFinite(n)) return null;
	return (negative ? -n : n) / (percent ? 100 : 1);
}

/** Count, sum and average of the numbers in a range, like a
 * spreadsheet's status bar. Bounded so a whole-sheet selection stays
 * instant. */
export function rangeStats(
	sheet: Sheet,
	range: Range,
): { count: number; sum: number } | null {
	const cells = (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
	let count = 0;
	let sum = 0;
	if (cells <= 20_000) {
		for (let r = range.r0; r <= range.r1; r++)
			for (let c = range.c0; c <= range.c1; c++) {
				const n = toNumber(sheet.cells.get(key(r, c))?.value ?? "");
				if (n !== null) {
					count++;
					sum += n;
				}
			}
	} else {
		// Sparse walk: only the cells that exist.
		for (const [k, cell] of sheet.cells) {
			const r = Math.floor(k / 1024);
			const c = k % 1024;
			if (r < range.r0 || r > range.r1 || c < range.c0 || c > range.c1)
				continue;
			const n = toNumber(cell.value);
			if (n !== null) {
				count++;
				sum += n;
			}
		}
	}
	return count ? { count, sum } : null;
}

/** A border value ("2px solid #000") as an inset shadow on one side,
 * for the top and left edges the grid does not draw itself. */
function insetLine(border: string, side: "t" | "l"): string {
	const width = Number.parseInt(border, 10) || 1;
	const color = border.slice(border.lastIndexOf(" ") + 1);
	return side === "t"
		? `inset 0 ${width}px 0 0 ${color}`
		: `inset ${width}px 0 0 0 ${color}`;
}

/** A cell's authored look as inline CSS. A filled cell carries its
 * own ink (dark unless the file says otherwise) so it reads the same
 * in every app theme; an unfilled one keeps the theme's ink. */
export function styleCss(st: CellStyle): CSSProperties {
	const decoration = [st.underline && "underline", st.strike && "line-through"]
		.filter(Boolean)
		.join(" ");
	const inset = [
		st.border?.t && insetLine(st.border.t, "t"),
		st.border?.l && insetLine(st.border.l, "l"),
	]
		.filter(Boolean)
		.join(", ");
	return {
		fontWeight: st.bold ? 700 : undefined,
		fontStyle: st.italic ? "italic" : undefined,
		textDecoration: decoration || undefined,
		background: st.fill,
		color: st.fill ? (st.color ?? "#1b1b1f") : undefined,
		["--ink" as string]: st.fill ? undefined : st.color,
		justifyContent:
			st.align === "center"
				? "center"
				: st.align === "right"
					? "flex-end"
					: st.align === "left"
						? "flex-start"
						: undefined,
		textAlign: st.align,
		whiteSpace: st.wrap ? "normal" : undefined,
		borderRight: st.border?.r,
		borderBottom: st.border?.b,
		boxShadow: inset || undefined,
	};
}

// ---------- Text measuring (for spill and auto-fit) ----------

let ruler: CanvasRenderingContext2D | null = null;
const measured = new Map<string, number>();

/** Width of `text` in the grid's font, in sheet pixels. */
export function textWidth(text: string, bold: boolean, family: string): number {
	const id = `${bold ? "b" : "n"}${text}`;
	const hit = measured.get(id);
	if (hit !== undefined) return hit;
	ruler ??= document.createElement("canvas").getContext("2d");
	if (!ruler) return text.length * 7;
	ruler.font = `${bold ? 700 : 400} 13px ${family}`;
	const width = ruler.measureText(text).width;
	if (measured.size > 8000) measured.clear();
	measured.set(id, width);
	return width;
}

// ---------- Charts on sheets ----------

/** Column letters to a zero-based index: A -> 0, AA -> 26. */
function colIndex(letters: string): number {
	let n = 0;
	for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1;
}

/**
 * The values of a range formula such as 'Sales'!$B$2:$B$9, read from
 * the workbook's own cells: for charts whose writer stored no cached
 * values. Addresses are the file's; hidden rows and columns are
 * skipped, as a chart skips them.
 */
export function rangeValues(sheets: Sheet[], formula: string): string[] | null {
	const m =
		/^(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(
			formula.trim(),
		);
	if (!m) return null;
	const name = (m[1] ?? m[2]).replace(/''/g, "'");
	const sheet = sheets.find((sh) => sh.name === name);
	if (!sheet) return null;
	const c0 = colIndex(m[3]);
	const r0 = Number(m[4]) - 1;
	const c1 = m[5] ? colIndex(m[5]) : c0;
	const r1 = m[6] ? Number(m[6]) - 1 : r0;
	const out: string[] = [];
	for (let r = 0; r < sheet.rows && out.length < 4000; r++) {
		const row = sheet.rowOrigins[r] ?? r;
		if (row < Math.min(r0, r1) || row > Math.max(r0, r1)) continue;
		for (let c = 0; c < sheet.cols; c++) {
			const col = sheet.colOrigins[c] ?? c;
			if (col < Math.min(c0, c1) || col > Math.max(c0, c1)) continue;
			const value = sheet.cells.get(key(r, c))?.value ?? "";
			const n = toNumber(value);
			out.push(n === null ? value : String(n));
		}
	}
	return out;
}

/** Colours for a sheet chart: literal RGB, or a theme accent. */
export function chartColors(accents: string[]): ChartColors {
	const fallback = [
		"#4472c4",
		"#ed7d31",
		"#a5a5a5",
		"#ffc000",
		"#5b9bd5",
		"#70ad47",
	];
	const accent = (n: number) => accents[(n - 1) % 6] ?? fallback[(n - 1) % 6];
	return {
		accent,
		resolve(holder) {
			const fill = kid(holder, "solidFill");
			const rgb = attrOf(kid(fill, "srgbClr"), "val");
			if (rgb && /^[0-9a-f]{6}$/i.test(rgb)) return `#${rgb}`;
			const scheme = /^accent([1-6])$/.exec(
				attrOf(kid(fill, "schemeClr"), "val") ?? "",
			);
			return scheme ? accent(Number(scheme[1])) : undefined;
		},
	};
}

// ---------- Printing ----------

/** Rows printed per sheet; beyond this the printout says so. */
const PRINT_ROWS = 4000;

/** The grid is windowed, so paper gets a real table of the sheet. */
export function printSheet(
	root: HTMLElement,
	sheet: Sheet,
	widths: number[],
	looks: CSSProperties[],
) {
	const table = document.createElement("table");
	table.className = s.printTable;
	const group = document.createElement("colgroup");
	let total = 0;
	for (const width of widths) {
		const col = document.createElement("col");
		col.style.width = `${width}px`;
		group.appendChild(col);
		total += width;
	}
	table.appendChild(group);
	table.style.width = `${total}px`;
	const covered = new Set<number>();
	const anchors = new Map<number, { rows: number; cols: number }>();
	for (const m of sheet.merges) {
		anchors.set(key(m.r0, m.c0), {
			rows: m.r1 - m.r0 + 1,
			cols: m.c1 - m.c0 + 1,
		});
		for (let r = m.r0; r <= Math.min(m.r1, PRINT_ROWS); r++)
			for (let c = m.c0; c <= m.c1; c++)
				if (r !== m.r0 || c !== m.c0) covered.add(key(r, c));
	}
	const rows = Math.min(sheet.rows, PRINT_ROWS);
	for (let r = 0; r < rows; r++) {
		const tr = document.createElement("tr");
		tr.style.height = `${sheet.rowHeights[r]}px`;
		for (let c = 0; c < sheet.cols; c++) {
			if (covered.has(key(r, c))) continue;
			const td = document.createElement("td");
			const cell = sheet.cells.get(key(r, c));
			const span = anchors.get(key(r, c));
			if (span) {
				td.rowSpan = span.rows;
				td.colSpan = span.cols;
			}
			if (cell) {
				td.textContent = cell.value;
				const look = cell.style !== undefined ? looks[cell.style] : undefined;
				if (look) {
					Object.assign(td.style, {
						fontWeight: look.fontWeight ?? "",
						fontStyle: look.fontStyle ?? "",
						textDecoration: look.textDecoration ?? "",
						background: look.background ?? "",
						color:
							look.color ??
							(look as Record<string, string | undefined>)["--ink"] ??
							"",
						textAlign: look.textAlign ?? "",
					});
				} else if (NUMERIC.test(cell.value)) td.style.textAlign = "right";
			}
			tr.appendChild(td);
		}
		table.appendChild(tr);
	}
	const wrap = fitted(table, total + 2, "pw-sheet", 1);
	const title = document.createElement("p");
	title.className = s.printTitle;
	title.textContent =
		sheet.rows > rows
			? t("{name} (first {shown} of {total} rows)", {
					name: sheet.name,
					shown: rows.toLocaleString(),
					total: sheet.rows.toLocaleString(),
				})
			: sheet.name;
	wrap.prepend(title);
	root.appendChild(wrap);
}
