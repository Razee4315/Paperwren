import { describe, expect, it } from "vitest";
import {
	type Sheet,
	key,
	rangeLabel,
	rangeOf,
	rangeStats,
	rangeText,
	styleCss,
	toNumber,
} from "./sheetHelpers";

function sheetOf(rows: string[][]): Sheet {
	const cells = new Map<number, { value: string }>();
	rows.forEach((row, r) =>
		row.forEach((value, c) => {
			if (value) cells.set(key(r, c), { value });
		}),
	);
	const count = rows.length;
	const cols = Math.max(...rows.map((r) => r.length));
	return {
		name: "S",
		rows: count,
		cols,
		widths: Array(cols).fill(96),
		rowHeights: Array(count).fill(30),
		rowPrefix: Array.from({ length: count + 1 }, (_, i) => i * 30),
		cells,
		merges: [],
		rowOrigins: rows.map((_, i) => i),
		// Column C of the file is hidden: the third visible column is D.
		colOrigins: Array.from({ length: cols }, (_, i) => (i < 2 ? i : i + 1)),
	};
}

const sheet = sheetOf([
	["Item", "Qty", "Price"],
	["Pen", "10", "$1.50"],
	["Book\twith tab", "2", "(4.25)"],
	["", "50%", "n/a"],
]);

describe("spreadsheet ranges", () => {
	it("orders a range whichever way it was dragged", () => {
		expect(rangeOf({ r: 3, c: 2 }, { r: 1, c: 0 })).toEqual({
			r0: 1,
			c0: 0,
			r1: 3,
			c1: 2,
		});
	});

	it("labels ranges with the file's own addresses", () => {
		expect(rangeLabel(sheet, { r0: 0, c0: 0, r1: 0, c1: 0 })).toBe("A1");
		// The third visible column is D in the file.
		expect(rangeLabel(sheet, { r0: 1, c0: 1, r1: 3, c1: 2 })).toBe("B2:D4");
	});

	it("copies as tab-separated text that pastes back into a sheet", () => {
		expect(rangeText(sheet, { r0: 0, c0: 0, r1: 2, c1: 2 })).toBe(
			"Item\tQty\tPrice\nPen\t10\t$1.50\nBook with tab\t2\t(4.25)",
		);
	});

	it("reads displayed numbers the way a person would", () => {
		expect(toNumber("1,234.5")).toBe(1234.5);
		expect(toNumber("$1.50")).toBe(1.5);
		expect(toNumber("(4.25)")).toBe(-4.25);
		expect(toNumber("-3")).toBe(-3);
		expect(toNumber("50%")).toBe(0.5);
		expect(toNumber("n/a")).toBeNull();
		expect(toNumber("1.2.3")).toBeNull();
		expect(toNumber("")).toBeNull();
	});

	it("sums and counts only the numbers in a range", () => {
		const stats = rangeStats(sheet, { r0: 0, c0: 0, r1: 3, c1: 2 });
		expect(stats?.count).toBe(5);
		expect(stats?.sum).toBeCloseTo(10 + 1.5 + 2 - 4.25 + 0.5);
		expect(rangeStats(sheet, { r0: 0, c0: 0, r1: 0, c1: 2 })).toBeNull();
	});
});

describe("cell looks", () => {
	it("gives a filled cell its own ink and an unfilled one the theme's", () => {
		expect(styleCss({ fill: "#fff2cc" }).color).toBe("#1b1b1f");
		const plain = styleCss({ color: "#c62828" }) as Record<string, unknown>;
		expect(plain.color).toBeUndefined();
		expect(plain["--ink"]).toBe("#c62828");
	});

	it("draws authored borders on all four sides", () => {
		const css = styleCss({
			border: {
				t: "2px solid #ff0000",
				r: "1px solid #000000",
				b: "1px dashed #00ff00",
				l: "3px double #0000ff",
			},
		});
		expect(css.borderRight).toBe("1px solid #000000");
		expect(css.borderBottom).toBe("1px dashed #00ff00");
		expect(css.boxShadow).toBe(
			"inset 0 2px 0 0 #ff0000, inset 3px 0 0 0 #0000ff",
		);
	});
});

import { rangeValues } from "./sheetHelpers";

describe("chart ranges read from the sheet", () => {
	it("resolves a formula to the cells it names, numbers normalised", () => {
		expect(rangeValues([sheet], "S!$B$2:$B$4")).toEqual(["10", "2", "0.5"]);
		expect(rangeValues([sheet], "'S'!A1")).toEqual(["Item"]);
		// The file's column D is the third visible column.
		expect(rangeValues([sheet], "S!$D$2:$D$3")).toEqual(["1.5", "-4.25"]);
	});

	it("answers null for other sheets and non-range formulas", () => {
		expect(rangeValues([sheet], "Other!A1:A3")).toBeNull();
		expect(rangeValues([sheet], "SUM(A1:A3)")).toBeNull();
	});
});
