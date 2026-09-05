import { describe, expect, it } from "vitest";
import {
	ABSOLUTE_MIN_ZOOM,
	MAX_FIT_WIDTH,
	MAX_ZOOM,
	type PageMeta,
	ZOOM_STEP_FACTOR,
	canonicalToDisplay,
	clampManualScale,
	computeOutputScale,
	computePageDisplayBox,
	displayToCanonical,
	displayedSize,
	manualZoomBounds,
	nextFitMode,
	stepScale,
	totalRotation,
} from "../pdfLayout";

// A4 portrait in PDF points.
const A4: PageMeta = { width: 595, height: 842, rotation: 0 };
const BOUNDS = { min: ABSOLUTE_MIN_ZOOM, max: MAX_ZOOM };
const boxParams = (
	over: Partial<Parameters<typeof computePageDisplayBox>[0]>,
) => ({
	page: A4,
	userRotation: 0,
	containerWidth: 360,
	containerHeight: 640,
	fitMode: "width" as const,
	manualScale: 1,
	bounds: BOUNDS,
	...over,
});

describe("computePageDisplayBox", () => {
	it("fit-width fills a phone container exactly", () => {
		const box = computePageDisplayBox(boxParams({}));
		expect(box.width).toBe(360);
		expect(box.height).toBe(Math.round((360 / A4.width) * A4.height));
		expect(box.scale).toBeCloseTo(360 / A4.width, 10);
	});

	it("fit-width never exceeds the readability cap (the CV bug)", () => {
		const box = computePageDisplayBox(
			boxParams({ containerWidth: 1500, containerHeight: 900 }),
		);
		expect(box.width).toBeLessThanOrEqual(MAX_FIT_WIDTH);
		expect(box.width).toBe(MAX_FIT_WIDTH);
	});

	it("phones are unaffected by the cap", () => {
		const box = computePageDisplayBox(boxParams({ containerWidth: 390 }));
		expect(box.width).toBe(390);
	});

	it("fit-page shows the whole page bounded by height", () => {
		const box = computePageDisplayBox(
			boxParams({
				containerWidth: 1500,
				containerHeight: 700,
				fitMode: "page",
			}),
		);
		expect(box.height).toBe(700);
		expect(box.width).toBe(Math.round((700 / A4.height) * A4.width));
	});

	it("fit-page stays within width when the container is narrow", () => {
		const box = computePageDisplayBox(
			boxParams({
				containerWidth: 300,
				containerHeight: 2000,
				fitMode: "page",
			}),
		);
		expect(box.width).toBe(300);
	});

	it("manual mode uses the absolute scale, not a fit multiplier", () => {
		const box = computePageDisplayBox(
			boxParams({ fitMode: "none", manualScale: 0.75 }),
		);
		expect(box.width).toBe(Math.round(A4.width * 0.75));
		expect(box.height).toBe(Math.round(A4.height * 0.75));
		expect(box.scale).toBe(0.75);
	});

	it("clamps manual scale into the provided bounds", () => {
		const box = computePageDisplayBox(
			boxParams({ fitMode: "none", manualScale: 100 }),
		);
		expect(box.width).toBe(Math.round(A4.width * MAX_ZOOM));
	});

	it("survives degenerate containers on first paint", () => {
		const box = computePageDisplayBox(
			boxParams({ containerWidth: 0, containerHeight: 0 }),
		);
		expect(box.width).toBeGreaterThan(0);
		expect(box.height).toBeGreaterThan(0);
	});

	it("survives degenerate page dimensions", () => {
		const box = computePageDisplayBox(
			boxParams({ page: { width: 0, height: 0, rotation: 0 } }),
		);
		expect(box.width).toBeGreaterThan(0);
		expect(box.height).toBeGreaterThan(0);
	});
});

describe("fit/manual conversion (audit PDF-02)", () => {
	it("preserves a fit scale far below the old 0.5 threshold", () => {
		// A 1200pt-wide page fitted into 344 CSS px has an honest scale
		// of ~0.287. Converting to manual must keep that scale, not
		// clamp it to 0.5.
		const wide: PageMeta = { width: 1200, height: 800, rotation: 0 };
		const fit = computePageDisplayBox(
			boxParams({
				page: wide,
				containerWidth: 344,
				containerHeight: 800,
			}),
		);
		expect(fit.scale).toBeCloseTo(344 / 1200, 10);
		const manual = computePageDisplayBox(
			boxParams({
				page: wide,
				containerWidth: 344,
				containerHeight: 800,
				fitMode: "none",
				manualScale: fit.scale,
			}),
		);
		// Displayed width preserved within rounding tolerance.
		expect(Math.abs(manual.width - fit.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(manual.height - fit.height)).toBeLessThanOrEqual(1);
	});

	it("the manual minimum never sits above the document's smallest fit scale", () => {
		// A 6000pt-wide page fits to 0.0573 in a 344px container: the
		// floor must drop to that, not stay at 0.1.
		const huge: PageMeta = { width: 6000, height: 4000, rotation: 0 };
		const bounds = manualZoomBounds({
			pages: [huge],
			userRotation: 0,
			containerWidth: 344,
			containerHeight: 800,
		});
		expect(bounds.min).toBeCloseTo(344 / 6000, 10);
		// And converting fit -> manual preserves the displayed width.
		const target = clampManualScale(344 / 6000, bounds);
		expect(target).toBeCloseTo(344 / 6000, 10);
	});

	it("the manual minimum is 0.1 for ordinary documents", () => {
		const bounds = manualZoomBounds({
			pages: [A4],
			userRotation: 0,
			containerWidth: 360,
			containerHeight: 640,
		});
		expect(bounds.min).toBe(ABSOLUTE_MIN_ZOOM);
		expect(bounds.max).toBe(MAX_ZOOM);
	});

	it("mixed portrait/landscape pages each get their own fit scale", () => {
		const portrait: PageMeta = { width: 595, height: 842, rotation: 0 };
		const landscape: PageMeta = { width: 842, height: 595, rotation: 0 };
		const pw = computePageDisplayBox(
			boxParams({ page: portrait, containerWidth: 360, containerHeight: 800 }),
		);
		const lw = computePageDisplayBox(
			boxParams({ page: landscape, containerWidth: 360, containerHeight: 800 }),
		);
		expect(pw.scale).toBeCloseTo(360 / 595, 10);
		expect(lw.scale).toBeCloseTo(360 / 842, 10);
		// Both fill the same width in fit-width mode.
		expect(pw.width).toBe(360);
		expect(lw.width).toBe(360);
	});

	it("a zero-motion pinch can commit its current scale without rounding", () => {
		const exact = 1 / 3;
		expect(clampManualScale(exact, BOUNDS)).toBe(exact);
	});

	it("steps multiply, never add", () => {
		const next = stepScale(0.3, 1, BOUNDS);
		expect(next).toBeCloseTo(0.3 * ZOOM_STEP_FACTOR, 12);
		const prev = stepScale(next, -1, BOUNDS);
		expect(prev).toBeCloseTo(0.3, 12);
	});
});

describe("rotation (audit PDF-05)", () => {
	it("total rotation combines intrinsic and user rotation", () => {
		expect(totalRotation({ ...A4, rotation: 90 }, 90)).toBe(180);
		expect(totalRotation({ ...A4, rotation: 270 }, 180)).toBe(90);
		expect(totalRotation({ ...A4, rotation: 90 }, -90)).toBe(0);
	});

	it("displayed size swaps at 90/270 total rotation", () => {
		expect(displayedSize(A4, 0)).toEqual({ width: 595, height: 842 });
		expect(displayedSize(A4, 90)).toEqual({ width: 842, height: 595 });
		expect(displayedSize({ ...A4, rotation: 90 }, 0)).toEqual({
			width: 842,
			height: 595,
		});
	});

	it("canonical <-> display conversion round-trips at every rotation", () => {
		for (const rotation of [0, 90, 180, 270]) {
			for (const point of [
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
				{ x: 0, y: 1 },
				{ x: 1, y: 1 },
				{ x: 0.25, y: 0.75 },
			]) {
				const display = canonicalToDisplay(point, rotation);
				const back = displayToCanonical(display, rotation);
				expect(back.x).toBeCloseTo(point.x, 12);
				expect(back.y).toBeCloseTo(point.y, 12);
			}
		}
	});

	it("rotating 90 degrees clockwise moves top-left to top-right", () => {
		const display = canonicalToDisplay({ x: 0, y: 0 }, 90);
		expect(display.x).toBeCloseTo(1, 12);
		expect(display.y).toBeCloseTo(0, 12);
	});

	it("fit scales follow the rotated page box", () => {
		// A4 rotated 90° in a 360x800 container: displayed width is 842,
		// so fit-width shrinks accordingly.
		const box = computePageDisplayBox(
			boxParams({
				userRotation: 90,
				containerWidth: 360,
				containerHeight: 800,
			}),
		);
		expect(box.scale).toBeCloseTo(360 / 842, 10);
		expect(box.width).toBe(360);
		expect(box.height).toBe(Math.round((360 / 842) * 595));
	});
});

describe("nextFitMode", () => {
	it("cycles width -> page -> none -> width", () => {
		expect(nextFitMode("width")).toBe("page");
		expect(nextFitMode("page")).toBe("none");
		expect(nextFitMode("none")).toBe("width");
	});
});

describe("computeOutputScale", () => {
	it("caps the backing store by the pixel budget", () => {
		const scale = computeOutputScale(3000, 4000, 3);
		const pixels = 3000 * scale * (4000 * scale);
		expect(pixels).toBeLessThanOrEqual(12_000_000 + 1);
	});
});
