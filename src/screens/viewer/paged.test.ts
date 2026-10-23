import { describe, expect, it } from "vitest";
import { goToRatio, isPaged, jumpTo, readRatio, reveal } from "./paged";

/** A scroller of a given size, with its content's size, at the left of
 * the screen. */
function scroller({
	paged = false,
	width = 400,
	height = 800,
	scrollWidth = 400,
	scrollHeight = 800,
}) {
	const el = document.createElement("div");
	if (paged) el.dataset.flow = "across";
	for (const [key, value] of Object.entries({
		clientWidth: width,
		clientHeight: height,
		scrollWidth,
		scrollHeight,
	}))
		Object.defineProperty(el, key, { value });
	el.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			right: width,
			bottom: height,
			width,
			height,
		}) as DOMRect;
	return el;
}
const rect = (left: number, top = 100, width = 40, height = 20) =>
	({
		left,
		top,
		right: left + width,
		bottom: top + height,
		width,
		height,
	}) as DOMRect;

describe("a document turned page by page", () => {
	it("is told apart from one that scrolls", () => {
		expect(isPaged(scroller({ paged: true }))).toBe(true);
		expect(isPaged(scroller({}))).toBe(false);
		expect(isPaged(null)).toBe(false);
	});

	it("keeps the reader's place as a ratio either way", () => {
		const down = scroller({ scrollHeight: 4800 });
		down.scrollTop = 2000;
		expect(readRatio(down)).toBe(0.5);
		const across = scroller({ paged: true, scrollWidth: 4000 });
		across.scrollLeft = 1800;
		expect(readRatio(across)).toBe(0.5);
	});

	it("lands on the page that holds a place, never between two", () => {
		// Ten pages: a third of the way is the fourth page.
		const across = scroller({ paged: true, scrollWidth: 4000 });
		goToRatio(across, 1 / 3);
		expect(across.scrollLeft).toBe(1200);
		goToRatio(across, 1);
		expect(across.scrollLeft).toBe(3600);
		const down = scroller({ scrollHeight: 1800 });
		goToRatio(down, 0.25);
		expect(down.scrollTop).toBe(250);
	});

	it("turns to the page a found word is on", () => {
		const across = scroller({ paged: true, scrollWidth: 4000 });
		across.scrollLeft = 400;
		// On the screen already: it stays.
		reveal(across, rect(100));
		expect(across.scrollLeft).toBe(400);
		// Two pages on (its left edge 900px into the screen).
		reveal(across, rect(900));
		expect(across.scrollLeft).toBe(1200);
	});

	it("scrolls a found word a third of the way down", () => {
		const down = scroller({ scrollHeight: 5000 });
		down.scrollTop = 1000;
		reveal(down, rect(10, 1200));
		expect(down.scrollTop).toBeCloseTo(1000 + 1200 - 800 / 3);
	});

	it("goes to the page a heading starts on", () => {
		const across = scroller({ paged: true, scrollWidth: 4000 });
		const heading = document.createElement("h2");
		heading.getBoundingClientRect = () => rect(1650);
		jumpTo(across, heading);
		expect(across.scrollLeft).toBe(1600);
	});
});
