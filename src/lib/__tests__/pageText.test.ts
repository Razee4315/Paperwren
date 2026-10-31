import { describe, expect, it } from "vitest";
import { type PageTextItem, textBetween, textLines } from "../pageText";

/** A 100 by 100 page, with its top at y = 0. */
const view = { width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100] };

/** Text at x, with its baseline y from the top of the page. */
const item = (str: string, x: number, y: number, width: number) => ({
	str,
	width,
	transform: [10, 0, 0, 10, x, 100 - y],
});

const page: PageTextItem[] = [
	item("Hello world", 10, 20, 44),
	item("second line", 10, 40, 44),
	item("third", 10, 60, 20),
];

describe("textLines", () => {
	it("keeps runs of one line together", () => {
		const lines = textLines(
			[item("one", 10, 20, 12), item("two", 24, 20, 12)],
			view,
		);
		expect(lines).toHaveLength(1);
		expect(lines[0].runs).toHaveLength(2);
	});

	it("does not join two columns into a line", () => {
		const lines = textLines(
			[item("left", 10, 20, 16), item("right", 70, 20, 20)],
			view,
		);
		expect(lines).toHaveLength(2);
	});

	it("leaves out text set at an angle", () => {
		const slanted = {
			str: "up",
			width: 10,
			transform: [0, 10, -10, 0, 50, 50],
		};
		expect(textLines([slanted], view)).toHaveLength(0);
	});

	it("does not start a line on blank space", () => {
		expect(textLines([item("  ", 10, 20, 8)], view)).toHaveLength(0);
	});
});

describe("textBetween", () => {
	const lines = textLines(page, view);

	it("takes the letters between two points of a line", () => {
		const found = textBetween(lines, [0.105, 0.17], [0.3, 0.17]);
		expect(found?.text).toBe("Hello");
		expect(found?.boxes).toHaveLength(1);
	});

	it("runs to the end of a line and from the start of the last", () => {
		const found = textBetween(lines, [0.34, 0.17], [0.22, 0.57]);
		expect(found?.boxes).toHaveLength(3);
		expect(found?.text).toBe("world second line thi");
	});

	it("reads the same dragged backwards", () => {
		const forward = textBetween(lines, [0.34, 0.17], [0.3, 0.37]);
		const backward = textBetween(lines, [0.3, 0.37], [0.34, 0.17]);
		expect(backward).toEqual(forward);
	});

	it("finds nothing far from any text", () => {
		expect(textBetween(lines, [0.5, 0.95], [0.6, 0.97])).toBeNull();
	});
});
