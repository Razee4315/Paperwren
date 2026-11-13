import { describe, expect, it } from "vitest";
import { dropIndex, moveTab } from "../../screens/TabStrip";

const row = (...keys: number[]) => keys.map((key) => ({ key }));
const keys = (list: { key: number }[]) => list.map((t) => t.key);

describe("tabs put in another order", () => {
	it("moves a tab to a place, kept within the row", () => {
		expect(keys(moveTab(row(1, 2, 3, 4), 1, 2))).toEqual([2, 3, 1, 4]);
		expect(keys(moveTab(row(1, 2, 3, 4), 4, 0))).toEqual([4, 1, 2, 3]);
		expect(keys(moveTab(row(1, 2, 3), 2, 9))).toEqual([1, 3, 2]);
		expect(keys(moveTab(row(1, 2, 3), 2, -3))).toEqual([2, 1, 3]);
	});

	it("leaves the row as it is when nothing moves", () => {
		const list = row(1, 2, 3);
		expect(moveTab(list, 2, 1)).toBe(list);
		expect(moveTab(list, 7, 0)).toBe(list);
	});

	it("drops a dragged tab where the pointer has passed the others' middles", () => {
		// Three tabs 100 px wide, middles at 50, 150 and 250.
		const mids = [50, 150, 250];
		expect(dropIndex(mids, 0, 60, false)).toBe(0);
		expect(dropIndex(mids, 0, 160, false)).toBe(1);
		expect(dropIndex(mids, 0, 290, false)).toBe(2);
		expect(dropIndex(mids, 2, 120, false)).toBe(1);
		expect(dropIndex(mids, 2, 10, false)).toBe(0);
	});

	it("right to left, the row runs the other way", () => {
		// The first tab is on the right: middles at 250, 150 and 50.
		const mids = [250, 150, 50];
		expect(dropIndex(mids, 0, 240, true)).toBe(0);
		expect(dropIndex(mids, 0, 140, true)).toBe(1);
		expect(dropIndex(mids, 0, 10, true)).toBe(2);
	});
});
