import { describe, expect, it } from "vitest";
import {
	MAX_FIT_WIDTH,
	MAX_ZOOM,
	MIN_ZOOM,
	clampZoom,
	computePageDisplayBox,
	nextFitMode,
	stepZoom,
} from "../pdfLayout";

// A4 portrait in PDF points.
const A4 = { pageWidth: 595, pageHeight: 842 };

describe("computePageDisplayBox", () => {
	it("fit-width fills a phone container exactly", () => {
		const box = computePageDisplayBox({
			...A4,
			containerWidth: 360,
			containerHeight: 640,
			fitMode: "width",
			zoom: 1,
		});
		expect(box.width).toBe(360);
		expect(box.height).toBe(Math.round((360 / A4.pageWidth) * A4.pageHeight));
	});

	it("fit-width never exceeds the readability cap (the CV bug)", () => {
		// A 1500px desktop window must not blow a CV up to full width.
		const box = computePageDisplayBox({
			...A4,
			containerWidth: 1500,
			containerHeight: 900,
			fitMode: "width",
			zoom: 1,
		});
		expect(box.width).toBeLessThanOrEqual(MAX_FIT_WIDTH);
		// The cap is what binds here.
		expect(box.width).toBe(MAX_FIT_WIDTH);
	});

	it("phones are unaffected by the cap", () => {
		const box = computePageDisplayBox({
			...A4,
			containerWidth: 390,
			containerHeight: 800,
			fitMode: "width",
			zoom: 1,
		});
		expect(box.width).toBe(390);
	});

	it("fit-page shows the whole page bounded by height", () => {
		const box = computePageDisplayBox({
			...A4,
			containerWidth: 1500,
			containerHeight: 700,
			fitMode: "page",
			zoom: 1,
		});
		// Bounded by height: 700/842 is smaller than 1500/595.
		expect(box.height).toBe(700);
		expect(box.width).toBe(Math.round((700 / A4.pageHeight) * A4.pageWidth));
	});

	it("fit-page stays within width when the container is narrow", () => {
		const box = computePageDisplayBox({
			...A4,
			containerWidth: 300,
			containerHeight: 2000,
			fitMode: "page",
			zoom: 1,
		});
		expect(box.width).toBe(300);
	});

	it("none means actual size, one point per pixel", () => {
		const box = computePageDisplayBox({
			...A4,
			containerWidth: 360,
			containerHeight: 640,
			fitMode: "none",
			zoom: 1,
		});
		expect(box.width).toBe(A4.pageWidth);
		expect(box.height).toBe(A4.pageHeight);
	});

	it("zoom multiplies the fit scale and clamps", () => {
		const box = computePageDisplayBox({
			...A4,
			containerWidth: 360,
			containerHeight: 640,
			fitMode: "width",
			zoom: 2,
		});
		expect(box.width).toBe(720);
	});

	it("clamps absurd zoom values", () => {
		const box = computePageDisplayBox({
			...A4,
			containerWidth: 360,
			containerHeight: 640,
			fitMode: "width",
			zoom: 100,
		});
		const expected = Math.round(
			360 * MAX_ZOOM * (A4.pageHeight / A4.pageWidth),
		);
		expect(box.height).toBe(expected);
	});

	it("survives degenerate containers on first paint", () => {
		const box = computePageDisplayBox({
			...A4,
			containerWidth: 0,
			containerHeight: 0,
			fitMode: "width",
			zoom: 1,
		});
		expect(box.width).toBeGreaterThan(0);
		expect(box.height).toBeGreaterThan(0);
	});

	it("survives degenerate page dimensions", () => {
		const box = computePageDisplayBox({
			pageWidth: 0,
			pageHeight: 0,
			containerWidth: 400,
			containerHeight: 700,
			fitMode: "width",
			zoom: 1,
		});
		expect(box.width).toBeGreaterThan(0);
	});
});

describe("nextFitMode", () => {
	it("cycles width -> page -> none -> width", () => {
		expect(nextFitMode("width")).toBe("page");
		expect(nextFitMode("page")).toBe("none");
		expect(nextFitMode("none")).toBe("width");
	});
});

describe("clampZoom and stepZoom", () => {
	it("clamps to the documented bounds", () => {
		expect(clampZoom(0.1)).toBe(MIN_ZOOM);
		expect(clampZoom(10)).toBe(MAX_ZOOM);
		expect(clampZoom(1)).toBe(1);
	});

	it("steps by 0.25 and clamps", () => {
		expect(stepZoom(1, 1)).toBe(1.25);
		expect(stepZoom(1, -1)).toBe(0.75);
		expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
		expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
	});
});
