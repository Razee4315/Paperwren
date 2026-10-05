import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
	MAX_MERGE_EXPANSION,
	type ParseResult,
	parseWorkbook,
} from "../workbookModel";

function parseAoa(
	rows: unknown[][],
	opts?: { merges?: XLSX.Range[]; cols?: { wpx: number }[] },
) {
	const wb = XLSX.utils.book_new();
	const ws = XLSX.utils.aoa_to_sheet(rows);
	if (opts?.merges) ws["!merges"] = opts.merges;
	if (opts?.cols) ws["!cols"] = opts.cols;
	XLSX.utils.book_append_sheet(wb, ws, "S1");
	return parseWorkbookDirect(wb);
}

/** Run parseWorkbook against an in-memory workbook without round-
 * tripping through a file write. */
function parseWorkbookDirect(wb: XLSX.WorkBook): ParseResult {
	// Reuse the module's parser by stubbing read: parseWorkbook takes
	// the API object; wrap read to return our workbook.
	const stubbed = {
		...XLSX,
		read: () => wb,
	};
	return parseWorkbook(stubbed as typeof XLSX, new ArrayBuffer(0));
}

describe("parseWorkbook (worker model, audit XLS-05)", () => {
	it("emits sparse triples, not one entry per coordinate", () => {
		const result = parseAoa([
			["A1", "B1"],
			["A2", null],
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const sheet = result.sheets[0];
		expect(sheet.rows).toBe(2);
		expect(sheet.cols).toBe(2);
		// Three populated cells only.
		expect(sheet.cells).toHaveLength(3);
		expect(sheet.cells[0]).toEqual([0, 0, { value: "A1" }]);
	});

	it("reads authored column widths", () => {
		const result = parseAoa([["x"]], { cols: [{ wpx: 140 }] });
		if (!result.ok) throw new Error("parse failed");
		expect(result.sheets[0].widths).toEqual([140]);
	});

	it("handles an empty worksheet as a 1x1 sheet with no cells", () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([[]]);
		wb.SheetNames = [];
		wb.Sheets = {};
		XLSX.utils.book_append_sheet(wb, ws, "Blank");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		// The sheet exists but carries no cells; the viewer decides the
		// empty-vs-ready policy from the workbook structure.
		expect(result.sheets[0].cells).toHaveLength(0);
	});

	it("suppresses covered merge cells but keeps the anchor", () => {
		const result = parseAoa(
			[
				["Title", "", "", ""],
				["a", "b", "c", "d"],
			],
			{ merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }] },
		);
		if (!result.ok) throw new Error("parse failed");
		const sheet = result.sheets[0];
		const covered = sheet.cells.filter(([r, c]) => r === 0 && c > 0);
		expect(covered).toHaveLength(0);
		expect(sheet.cells.some(([r, c]) => r === 0 && c === 0)).toBe(true);
		expect(sheet.mergeLimitHit).toBeFalsy();
	});

	it("bounds huge merges without hanging or dropping data", () => {
		// A full-column merge across 200 rows x 500 cols = 100k covered
		// coordinates; the budget keeps the expansion bounded.
		const rows: string[][] = Array.from({ length: 200 }, (_, r) =>
			Array.from({ length: 500 }, (_, c) => `v${r}:${c}`),
		);
		const result = parseAoa(rows, {
			merges: [{ s: { r: 0, c: 0 }, e: { r: 199, c: 499 } }],
		});
		if (!result.ok) throw new Error("parse failed");
		const sheet = result.sheets[0];
		expect(sheet.cells.length).toBeGreaterThan(0);
		expect(MAX_MERGE_EXPANSION).toBeGreaterThanOrEqual(100_000);
	});

	it("skips malformed merges without failing the parse", () => {
		const result = parseAoa([["a", "b"]], {
			merges: [{ s: { r: 5, c: 0 }, e: { r: 9, c: 1 } }],
		});
		if (!result.ok) throw new Error("parse failed");
		expect(result.sheets[0].cells).toHaveLength(2);
	});

	it("shows whole rows up to the cell budget, and says how many", () => {
		const rows: number[][] = Array.from({ length: 900 }, () =>
			Array.from({ length: 500 }, (_, c) => c),
		);
		const result = parseAoa(rows, {
			merges: [{ s: { r: 790, c: 0 }, e: { r: 850, c: 1 } }],
		});
		if (!result.ok) throw new Error("parse failed");
		const [sheet] = result.sheets;
		// 400,000 cells at 500 a row: 800 whole rows.
		expect(sheet.rows).toBe(800);
		expect(sheet.limit).toEqual({ rows: 800 });
		expect(sheet.rowPrefix).toHaveLength(801);
		expect(sheet.cells.every(([r]) => r < 800)).toBe(true);
		expect(sheet.merges).toEqual([{ r0: 790, c0: 0, r1: 799, c1: 1 }]);
	});
});

describe("workbook meaning (audit XLS-04)", () => {
	it("maps hidden rows and columns out of the visible space", () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([
			["a", "b", "c"],
			["d", "e", "f"],
			["g", "h", "i"],
		]);
		// Hide the second row and second column (0-based index 1).
		ws["!rows"] = [{ hidden: false }, { hidden: true }, { hidden: false }];
		ws["!cols"] = [{}, { hidden: true }, {}];
		XLSX.utils.book_append_sheet(wb, ws, "H");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		const sheet = result.sheets[0];
		expect(sheet.rows).toBe(2);
		expect(sheet.cols).toBe(2);
		expect(sheet.rowOrigins).toEqual([0, 2]);
		expect(sheet.colOrigins).toEqual([0, 2]);
		// Cell "a" stays at visible (0,0); "i" at visible (1,1).
		expect(sheet.cells).toContainEqual([0, 0, { value: "a" }]);
		expect(sheet.cells).toContainEqual([1, 1, { value: "i" }]);
		// The hidden column's value ("b") carries no remnant.
		expect(sheet.cells.some(([, , cell]) => cell.value === "b")).toBe(false);
	});

	it("keeps authored row heights through prefix sums", () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([["a"], ["b"], ["c"]]);
		ws["!rows"] = [{ hpx: 40 }, {}, { hpx: 60 }];
		XLSX.utils.book_append_sheet(wb, ws, "H");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		const sheet = result.sheets[0];
		expect(sheet.rowHeights).toEqual([40, 30, 60]);
		expect(sheet.rowPrefix).toEqual([0, 40, 70, 130]);
	});

	it("converts character widths with one documented rule", () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([["a", "b"]]);
		ws["!cols"] = [{ wch: 10 }, { width: 20 }];
		XLSX.utils.book_append_sheet(wb, ws, "W");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		// `wch` leaves the cell padding out (wch * 7 + 5); the file's own
		// `width` includes it (width * 7).
		expect(result.sheets[0].widths).toEqual([75, 140]);
	});

	it("prefers the file's own width over the parser's pixel guess", () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([["a"]]);
		// What the parser hands back for a column 44 characters wide.
		ws["!cols"] = [{ width: 44, wch: 43.17, wpx: 264 }];
		XLSX.utils.book_append_sheet(wb, ws, "W");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		expect(result.sheets[0].widths).toEqual([308]);
	});

	it("reads a row's height from its points", () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([["a"]]);
		ws["!rows"] = [{ hpt: 48, hpx: 48 }];
		XLSX.utils.book_append_sheet(wb, ws, "H");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		expect(result.sheets[0].rowHeights).toEqual([64]);
	});

	it("fits columns to their text when the file gives no widths", () => {
		const result = parseAoa([
			["id", "A description that is a good deal longer than a default column"],
			["7", "short"],
		]);
		if (!result.ok) throw new Error("parse failed");
		const [id, description] = result.sheets[0].widths;
		// Never narrower than the default, wider for long text, capped.
		expect(id).toBe(96);
		expect(description).toBeGreaterThan(300);
		expect(description).toBeLessThanOrEqual(360);
	});

	it("leaves authored widths alone, even next to long text", () => {
		const result = parseAoa(
			[["id", "A description that is a good deal longer than its column"]],
			{ cols: [{ wpx: 60 }, { wpx: 80 }] },
		);
		if (!result.ok) throw new Error("parse failed");
		expect(result.sheets[0].widths).toEqual([60, 80]);
	});

	it("makes a row tall enough for wrapped text it gives no height", () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([
			["Wrapped text that needs several lines in a narrow column", "x"],
			["plain text that is not wrapped and stays on one line", "y"],
		]);
		ws["!cols"] = [{ wpx: 120 }, { wpx: 60 }];
		XLSX.utils.book_append_sheet(wb, ws, "S1");
		const stubbed = { ...XLSX, read: () => wb } as typeof XLSX;
		const result = parseWorkbook(stubbed, new ArrayBuffer(0), {
			styles: [{ wrap: true }],
			sheets: new Map([["S1", new Map([["A1", 0]])]]),
			freeze: new Map(),
			anchors: new Map(),
			media: [],
			accents: [],
		});
		if (!result.ok) throw new Error("parse failed");
		const [wrapped, plain] = result.sheets[0].rowHeights;
		expect(wrapped).toBeGreaterThan(60);
		expect(plain).toBe(30);
		expect(result.sheets[0].rowPrefix).toEqual([0, wrapped, wrapped + 30]);
	});

	it("labels a formula without a cached result instead of undefined", () => {
		const wb = XLSX.utils.book_new();
		const ws: XLSX.WorkSheet = {};
		ws.A1 = { t: "n", v: 2 };
		// B1 references A1 but carries no cached value (no w, no v).
		ws.B1 = { t: "n", f: "A1*2" };
		ws["!ref"] = "A1:B1";
		XLSX.utils.book_append_sheet(wb, ws, "F");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		const b1 = result.sheets[0].cells.find(([r, c]) => r === 0 && c === 1);
		expect(b1?.[2].noCachedResult).toBe(true);
		expect(b1?.[2].formula).toBe("=A1*2");
		expect(b1?.[2].value).toBe("");
	});

	it("shows distinct error codes for error cells", () => {
		const wb = XLSX.utils.book_new();
		const ws: XLSX.WorkSheet = {};
		// 0x07 = #DIV/0!.
		ws.A1 = { t: "e", v: 0x07 };
		ws["!ref"] = "A1";
		XLSX.utils.book_append_sheet(wb, ws, "E");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		const a1 = result.sheets[0].cells.find(([r, c]) => r === 0 && c === 0);
		expect(a1?.[2].value).toBe("#DIV/0!");
	});

	it("discloses column truncation with a precise note", () => {
		const wb = XLSX.utils.book_new();
		const rows = [["a"]];
		const ws = XLSX.utils.aoa_to_sheet(rows);
		// Claim a range extending past the 500-column cap.
		ws["!ref"] = "A1:SK1";
		XLSX.utils.book_append_sheet(wb, ws, "L");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		expect(result.sheets[0].limit).toEqual({ columns: 500 });
	});
});

describe("merge ranges (audit XLS-03)", () => {
	it("retains validated merges as ranges in visible coordinates", () => {
		const result = parseAoa(
			[
				["Title", "", ""],
				["a", "b", "c"],
			],
			{ merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }] },
		);
		if (!result.ok) throw new Error("parse failed");
		expect(result.sheets[0].merges).toEqual([{ r0: 0, c0: 0, r1: 0, c1: 2 }]);
	});

	it("shrinks merges across hidden rows instead of expanding forever", () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([
			["M", ""],
			["", ""],
			["x", "y"],
		]);
		ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }];
		ws["!rows"] = [{}, { hidden: true }, {}];
		XLSX.utils.book_append_sheet(wb, ws, "M");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		expect(result.sheets[0].merges).toEqual([{ r0: 0, c0: 0, r1: 0, c1: 1 }]);
		// The covered interior of the shrunken merge is suppressed.
		expect(
			result.sheets[0].cells.filter(([r, c]) => r === 0 && c === 1),
		).toHaveLength(0);
	});

	it("keeps a cell's link and its note, to show beside the cell", () => {
		const wb = XLSX.utils.book_new();
		const ws = XLSX.utils.aoa_to_sheet([
			["Site", "Total"],
			["plain", 5],
		]);
		ws.A1.l = { Target: "https://example.org/report" };
		ws.B1.c = [
			{ a: "Aisha", t: "Checked against the ledger" },
			{ a: "Ravi", t: "Agreed" },
		];
		XLSX.utils.book_append_sheet(wb, ws, "S1");
		const result = parseWorkbookDirect(wb);
		if (!result.ok) throw new Error("parse failed");
		const cell = (r: number, c: number) =>
			result.sheets[0].cells.find(([row, col]) => row === r && col === c)?.[2];
		expect(cell(0, 0)?.link).toBe("https://example.org/report");
		expect(cell(0, 1)?.note).toBe("Checked against the ledger\nAgreed");
		expect(cell(1, 0)?.link).toBeUndefined();
		expect(cell(1, 0)?.note).toBeUndefined();
	});
});
