/**
 * Pure layout math for the PDF viewer (docs/14 audit PDF-02/04/05).
 * Extracted so zoom, fit, rotation, and anchor behaviour is
 * unit-testable.
 *
 * Scale model (audit PDF-02): fit modes (`width`, `page`) resolve an
 * honest per-page absolute scale; manual zoom is one absolute scale
 * for the whole document, never a hidden multiplier of a stale fit.
 * Anchors are stored as canonical ratios of the page's UNROTATED box
 * and converted with the total (intrinsic + user) rotation, so the
 * same text point survives zoom, rotation, resize, and relayout
 * (audit PDF-01/05).
 */

export type FitMode = "width" | "page" | "none";

/** Cap on the width a page occupies in fit-width mode. Without it, a
 * letter-size CV fills a 1500px desktop window and every line of
 * text looks enormous. Phones never reach the cap. Product choice,
 * not a claim of physical accuracy. */
export const MAX_FIT_WIDTH = 760;

/** Absolute maximum manual scale. Larger limits belong with the
 * raster budget work (audit PDF-08). */
export const MAX_ZOOM = 4;

/** Floor of the manual zoom range, unless the document's own fit
 * scale is smaller (audit PDF-02: a wide page fitted to a narrow
 * phone can sit far below the old 0.5 threshold and must stay
 * reachable when converting to manual zoom). */
export const ABSOLUTE_MIN_ZOOM = 0.1;

/** Multiplicative toolbar zoom step (audit PDF-02: a documented
 * ladder instead of an additive step that jumps on small fit
 * scales). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Keep a single rendered page below this many backing-store pixels.
 * Large scanned pages can otherwise allocate hundreds of megabytes at
 * high zoom on a 3x display. */
export const MAX_CANVAS_PIXELS = 12_000_000;

/** Conservative per-edge canvas cap: canvases larger than this fail
 * to allocate on many Android WebViews (audit PDF-08 item 7). */
export const MAX_CANVAS_DIMENSION = 8192;

/** Intrinsic page geometry from pdf.js: unrotated point dimensions
 * plus the page's own /Rotate value. */
export interface PageMeta {
	width: number;
	height: number;
	rotation: number;
}

export interface ZoomBounds {
	min: number;
	max: number;
}

export function totalRotation(page: PageMeta, userRotation: number): number {
	return (((page.rotation + userRotation) % 360) + 360) % 360;
}

/** Point dimensions of the page as displayed, after total rotation. */
export function displayedSize(
	page: PageMeta,
	userRotation: number,
): { width: number; height: number } {
	const swap = totalRotation(page, userRotation) % 180 !== 0;
	return swap
		? { width: page.height, height: page.width }
		: { width: page.width, height: page.height };
}

/** Absolute fit scale of one page. `page` fits the usable height and
 * width; `width` fills the usable width bounded by the comfort cap. */
export function fitScale(params: {
	page: PageMeta;
	userRotation: number;
	containerWidth: number;
	containerHeight: number;
	mode: "width" | "page";
}): number {
	const size = displayedSize(params.page, params.userRotation);
	const w = params.containerWidth > 0 ? params.containerWidth : 600;
	const h = params.containerHeight > 0 ? params.containerHeight : 800;
	const byWidth = w / size.width;
	if (params.mode === "width") {
		return Math.min(byWidth, MAX_FIT_WIDTH / size.width);
	}
	return Math.min(byWidth, h / size.height);
}

/** Smallest honest fit scale anywhere in the document (no cap). The
 * manual-zoom floor must not sit above it, or converting fit ->
 * manual on the smallest page would enlarge it. */
export function smallestFitScale(params: {
	pages: PageMeta[];
	userRotation: number;
	containerWidth: number;
	containerHeight: number;
}): number {
	let smallest = Number.POSITIVE_INFINITY;
	for (const page of params.pages) {
		if (
			!Number.isFinite(page.width) ||
			!Number.isFinite(page.height) ||
			page.width <= 0 ||
			page.height <= 0
		) {
			continue;
		}
		const size = displayedSize(page, params.userRotation);
		const byWidth = params.containerWidth / size.width;
		const byHeight = params.containerHeight / size.height;
		smallest = Math.min(smallest, byWidth, byHeight);
	}
	return Number.isFinite(smallest) ? smallest : 1;
}

/** Manual zoom range: never below the document's smallest fit scale
 * or 0.1, whichever is smaller; cap stays 4 for this slice. */
export function manualZoomBounds(params: {
	pages: PageMeta[];
	userRotation: number;
	containerWidth: number;
	containerHeight: number;
}): ZoomBounds {
	return {
		min: Math.min(ABSOLUTE_MIN_ZOOM, smallestFitScale(params)),
		max: MAX_ZOOM,
	};
}

/** Clamp a requested manual scale. Never rounds: the exact gesture
 * scale flows through until the percentage is displayed. */
export function clampManualScale(scale: number, bounds: ZoomBounds): number {
	if (!Number.isFinite(scale) || scale <= 0) return bounds.min;
	return Math.min(bounds.max, Math.max(bounds.min, scale));
}

/** One press of a zoom control: multiplicative ladder, clamped. */
export function stepScale(
	current: number,
	direction: 1 | -1,
	bounds: ZoomBounds,
): number {
	const next =
		direction === 1 ? current * ZOOM_STEP_FACTOR : current / ZOOM_STEP_FACTOR;
	return clampManualScale(next, bounds);
}

export interface DisplayBox {
	/** CSS pixel box for layout. */
	width: number;
	height: number;
	/** Absolute display scale (CSS px per PDF point). */
	scale: number;
}

/** Resolve the on-screen box of one page for the current fit mode /
 * manual scale. Scales never go negative or infinite; a zero
 * container falls back to a sane 600x800 card so first paint is
 * never degenerate. */
export function computePageDisplayBox(params: {
	page: PageMeta;
	userRotation: number;
	containerWidth: number;
	containerHeight: number;
	fitMode: FitMode;
	manualScale: number;
	bounds: ZoomBounds;
}): DisplayBox {
	const raw = params.page;
	const page: PageMeta =
		Number.isFinite(raw.width) &&
		Number.isFinite(raw.height) &&
		raw.width > 0 &&
		raw.height > 0
			? raw
			: { width: 612, height: 792, rotation: 0 };
	const size = displayedSize(page, params.userRotation);
	let scale: number;
	switch (params.fitMode) {
		case "width":
			scale = fitScale({
				page,
				userRotation: params.userRotation,
				containerWidth: params.containerWidth,
				containerHeight: params.containerHeight,
				mode: "width",
			});
			break;
		case "page":
			scale = fitScale({
				page,
				userRotation: params.userRotation,
				containerWidth: params.containerWidth,
				containerHeight: params.containerHeight,
				mode: "page",
			});
			break;
		default:
			scale = clampManualScale(params.manualScale, params.bounds);
	}
	return {
		width: Math.round(size.width * scale),
		height: Math.round(size.height * scale),
		scale,
	};
}

/** Next fit mode when the user cycles (button or double-tap):
 * width -> page -> none (manual) -> width. */
export function nextFitMode(current: FitMode): FitMode {
	switch (current) {
		case "width":
			return "page";
		case "page":
			return "none";
		default:
			return "width";
	}
}

/** Device-pixel multiplier for a canvas, bounded by the pixel budget
 * AND the per-edge dimension cap, computed from the ROUNDED raster
 * dimensions (audit PDF-08 item 7). There is deliberately no lower
 * floor of 0.25: on very large CSS pages that floor could push the
 * backing store past the advertised pixel cap. */
export function computeOutputScale(
	cssWidth: number,
	cssHeight: number,
	devicePixelRatio: number,
): number {
	const w = Math.max(1, Math.floor(cssWidth));
	const h = Math.max(1, Math.floor(cssHeight));
	let scale = Math.min(3, devicePixelRatio || 1);
	scale = Math.min(scale, Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));
	scale = Math.min(scale, MAX_CANVAS_DIMENSION / Math.max(w, h));
	// Only guard against a degenerate zero; the caps above may choose
	// any smaller positive scale.
	return Math.max(0.01, scale);
}

// ---------- canonical anchors (audit PDF-01 / PDF-05) ----------
//
// An anchor is a point inside a specific page stored as ratios of the
// page's UNROTATED box (top-left origin, x right, y down). Displayed
// ratios follow from the total rotation, so zooming, rotating, and
// relayout all preserve the same text point without document-wide
// scroll ratios.

export interface CanonicalPoint {
	/** 0..1 across the unrotated page width. */
	x: number;
	/** 0..1 down the unrotated page height. */
	y: number;
}

/** Canonical page ratios -> displayed box ratios at `rotation`. */
export function canonicalToDisplay(
	point: CanonicalPoint,
	rotation: number,
): CanonicalPoint {
	const x = Math.min(1, Math.max(0, point.x));
	const y = Math.min(1, Math.max(0, point.y));
	switch (((rotation % 360) + 360) % 360) {
		case 90:
			return { x: 1 - y, y: x };
		case 180:
			return { x: 1 - x, y: 1 - y };
		case 270:
			return { x: y, y: 1 - x };
		default:
			return { x, y };
	}
}

/** Displayed box ratios -> canonical page ratios. Inverse of
 * canonicalToDisplay. */
export function displayToCanonical(
	point: CanonicalPoint,
	rotation: number,
): CanonicalPoint {
	return canonicalToDisplay(point, 360 - (((rotation % 360) + 360) % 360));
}

// ---------- focal zoom anchoring ----------

export interface ClientRectLike {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Pick the page whose rect contains the client point, or the
 * nearest page by center distance when the point sits in the gaps
 * or outside every page (scroller padding). */
export function findAnchorPage(
	pageRects: Map<number, ClientRectLike>,
	clientX: number,
	clientY: number,
): number {
	let best = 0;
	let bestDistance = Number.POSITIVE_INFINITY;
	let contained = 0;
	for (const [pageNumber, rect] of pageRects) {
		if (
			clientX >= rect.left &&
			clientX <= rect.left + rect.width &&
			clientY >= rect.top &&
			clientY <= rect.top + rect.height
		) {
			contained = pageNumber;
			break;
		}
		const dx = clientX - (rect.left + rect.width / 2);
		const dy = clientY - (rect.top + rect.height / 2);
		const distance = dx * dx + dy * dy;
		if (distance < bestDistance) {
			bestDistance = distance;
			best = pageNumber;
		}
	}
	return contained || best;
}

/** Read the visible page rects of the currently mounted page nodes.
 * Only valid while no preview transform is applied. */
export function collectPageRects(
	nodes: Map<number, HTMLElement>,
): Map<number, ClientRectLike> {
	const rects = new Map<number, ClientRectLike>();
	nodes.forEach((node, pageNumber) => {
		rects.set(pageNumber, node.getBoundingClientRect());
	});
	return rects;
}

/** Build a canonical anchor for a focal client point from the page's
 * displayed rect and total rotation. */
export function buildCanonicalAnchor(params: {
	pageNumber: number;
	pageRect: ClientRectLike;
	rotation: number;
	clientX: number;
	clientY: number;
}): CanonicalPoint | null {
	const rect = params.pageRect;
	if (rect.width <= 0 || rect.height <= 0) return null;
	const display = {
		x: (params.clientX - rect.left) / rect.width,
		y: (params.clientY - rect.top) / rect.height,
	};
	return displayToCanonical(display, params.rotation);
}

/** Scroll offsets that put a page's displayed anchor point back under
 * the saved client point after a relayout, clamped to valid ranges.
 * `pageRect` must be measured AFTER the preview transform is removed
 * and the new layout has committed (audit PDF-01). */
export function computeAnchoredScroll(params: {
	anchor: CanonicalPoint; // displayed ratios (already converted)
	pageRect: ClientRectLike; // client-space rect AFTER the relayout
	scrollerRect: { left: number; top: number };
	scrollLeft: number;
	scrollTop: number;
	clientWidth: number;
	clientHeight: number;
	scrollWidth: number;
	scrollHeight: number;
	clientX: number;
	clientY: number;
}): { left: number; top: number } {
	const pageContentX =
		params.pageRect.left -
		params.scrollerRect.left +
		params.scrollLeft +
		params.anchor.x * params.pageRect.width;
	const pageContentY =
		params.pageRect.top -
		params.scrollerRect.top +
		params.scrollTop +
		params.anchor.y * params.pageRect.height;
	const desiredLeft =
		pageContentX - (params.clientX - params.scrollerRect.left);
	const desiredTop = pageContentY - (params.clientY - params.scrollerRect.top);
	const clamp = (v: number, max: number) =>
		Math.max(0, Math.min(Math.max(0, max), v));
	return {
		left: clamp(desiredLeft, params.scrollWidth - params.clientWidth),
		top: clamp(desiredTop, params.scrollHeight - params.clientHeight),
	};
}
