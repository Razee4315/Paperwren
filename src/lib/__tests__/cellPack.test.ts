import { describe, expect, it } from "vitest";
import { CellStore, cellKey, packCells } from "../cellPack";
import type { GridCell } from "../workbookModel";

const cells: Array<[number, number, GridCell]> = [
	[2, 1, { value: "c" }],
	[0, 0, { value: "a", style: 3 }],
	[0, 4, { value: "b", formula: "=A1", link: "https://example.com" }],
	[5, 0, { value: "", style: 0 }],
];

describe("packed cells", () => {
	it("read back as the cells they were", () => {
		const store = new CellStore(packCells(cells));
		expect(store.size).toBe(4);
		expect(store.get(cellKey(0, 0))).toEqual({ value: "a", style: 3 });
		expect(store.get(cellKey(0, 4))).toEqual({
			value: "b",
			formula: "=A1",
			link: "https://example.com",
		});
		expect(store.get(cellKey(2, 1))).toEqual({ value: "c" });
		expect(store.get(cellKey(5, 0))).toEqual({ value: "", style: 0 });
		expect(store.get(cellKey(1, 1))).toBeUndefined();
	});

	it("give the same object for the same cell, and walk them in order", () => {
		const store = new CellStore(packCells(cells));
		expect(store.get(cellKey(2, 1))).toBe(store.get(cellKey(2, 1)));
		expect([...store].map(([k]) => k)).toEqual([
			cellKey(0, 0),
			cellKey(0, 4),
			cellKey(2, 1),
			cellKey(5, 0),
		]);
		expect(new Map(store)).toEqual(
			new Map(cells.map(([r, c, cell]) => [cellKey(r, c), cell])),
		);
	});

	it("keep the later of two cells in one place, as a Map would", () => {
		const store = new CellStore(
			packCells([
				[1, 1, { value: "first", note: "old" }],
				[1, 1, { value: "second" }],
			]),
		);
		expect(store.size).toBe(1);
		expect(store.get(cellKey(1, 1))).toEqual({ value: "second" });
	});

	it("hold a big sheet in plain lists", () => {
		const many: Array<[number, number, GridCell]> = [];
		for (let r = 0; r < 20_000; r++)
			for (let c = 0; c < 10; c++) many.push([r, c, { value: `${r}:${c}` }]);
		const packed = packCells(many);
		expect(packed.rich).toHaveLength(0);
		const store = new CellStore(packed);
		expect(store.get(cellKey(19_999, 9))?.value).toBe("19999:9");
		expect(store.get(cellKey(12_345, 6))?.value).toBe("12345:6");
	});
});
