/**
 * Pure layout math for the PDF viewer (docs/07 section 2).
 * Extracted so the zoom and fit behaviour is unit-testable.
 */

export type FitMode = "width" | "page" | "none";

/** Hard cap on the width a page occupies in fit-width mode. Without
 * it, a letter-size CV fills a 1500px desktop window and every line
 * of text looks enormous. Phones never reach the cap. */
export const MAX_FIT_WIDTH = 760;

/** Zoom multiplier bounds (pinch and buttons clamp to these). */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;

/** Keep a single rendered page below this many backing-store pixels.
 * Large scanned pages can otherwise allocate hundreds of megabytes at
 * high zoom on a 3x display. */
export const MAX_CANVAS_PIXELS = 12_000_000;

export interface PageGeometry {
	pageWidth: number;
	pageHeight: number;
	containerWidth: number;
	containerHeight: number;
	fitMode: FitMode;
	zoom: number;
}

export interface DisplayBox {
	width: number;
	height: number;
	scale: number;
}

export function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/** Resolve the on-screen box of a page for the current fit mode and
 * zoom. Scales never go negative or infinite; a zero container falls
 * back to a sane 600x800 card so first paint is never degenerate. */
export function computePageDisplayBox(g: PageGeometry): DisplayBox {
	const pw = g.pageWidth > 0 ? g.pageWidth : 612;
	const ph = g.pageHeight > 0 ? g.pageHeight : 792;
	const cw = g.containerWidth > 0 ? g.containerWidth : 600;
	const ch = g.containerHeight > 0 ? g.containerHeight : 800;

	let base: number;
	switch (g.fitMode) {
		case "width":
			// Fill the width, but never past the readability cap.
			base = Math.min(cw / pw, MAX_FIT_WIDTH / pw);
			break;
		case "page":
			// Whole page visible, bounded by height and width.
			base = Math.min(cw / pw, ch / ph);
			break;
		default:
			// Actual size: 1 CSS px per PDF point.
			base = 1;
	}

	const scale = Math.max(0.01, base * clampZoom(g.zoom));
	return {
		width: Math.round(pw * scale),
		height: Math.round(ph * scale),
		scale,
	};
}

/** Next fit mode when the user cycles (button or double-tap):
 * width -> page -> none (actual size) -> width. */
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

/** The zoom step for one press of a zoom button. */
export function stepZoom(current: number, direction: 1 | -1): number {
	if (direction === 1) return clampZoom(current + 0.25);
	return clampZoom(current - 0.25);
}

/** Device-pixel multiplier for a canvas, capped by a pixel budget. */
export function computeOutputScale(
	cssWidth: number,
	cssHeight: number,
	devicePixelRatio: number,
): number {
	const pixels = Math.max(1, cssWidth * cssHeight);
	const budgetScale = Math.sqrt(MAX_CANVAS_PIXELS / pixels);
	return Math.max(0.25, Math.min(3, devicePixelRatio || 1, budgetScale));
}

// ---------- focal zoom anchoring (audit section 6) ----------
//
// The anchor is a point inside a specific page, never a ratio of
// total document scroll: document height changes non-uniformly with
// mixed page sizes, rotation, and late geometry corrections.

export interface ZoomAnchor {
	/** 1-based page number whose content must stay under the point. */
	pageNumber: number;
	/** Position within that page, 0..1 of its width/height. */
	xRatio: number;
	yRatio: number;
	/** Viewport-space point (clientX/Y) that must keep showing it. */
	clientX: number;
	clientY: number;
}

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

/** Build the anchor for a focal client point before zoom changes. */
export function buildZoomAnchor(params: {
	pageRects: Map<number, ClientRectLike>;
	scrollerRect: { left: number; top: number };
	clientX: number;
	clientY: number;
}): ZoomAnchor | null {
	const pageNumber = findAnchorPage(
		params.pageRects,
		params.clientX,
		params.clientY,
	);
	const rect = params.pageRects.get(pageNumber);
	if (!rect || rect.width <= 0 || rect.height <= 0) return null;
	return {
		pageNumber,
		xRatio: (params.clientX - rect.left) / rect.width,
		yRatio: (params.clientY - rect.top) / rect.height,
		clientX: params.clientX,
		clientY: params.clientY,
	};
}

/** Scroll offsets that put the anchored page-local point back under
 * the saved client point after a relayout. Clamped to valid ranges. */
export function computeAnchoredScroll(params: {
	anchor: ZoomAnchor;
	pageRect: ClientRectLike; // client-space rect AFTER the relayout
	scrollerRect: { left: number; top: number };
	scrollLeft: number;
	scrollTop: number;
	clientWidth: number;
	clientHeight: number;
	scrollWidth: number;
	scrollHeight: number;
}): { left: number; top: number } {
	const pageContentX =
		params.pageRect.left -
		params.scrollerRect.left +
		params.scrollLeft +
		params.anchor.xRatio * params.pageRect.width;
	const pageContentY =
		params.pageRect.top -
		params.scrollerRect.top +
		params.scrollTop +
		params.anchor.yRatio * params.pageRect.height;
	const desiredLeft =
		pageContentX - (params.anchor.clientX - params.scrollerRect.left);
	const desiredTop =
		pageContentY - (params.anchor.clientY - params.scrollerRect.top);
	const clamp = (v: number, max: number) =>
		Math.max(0, Math.min(Math.max(0, max), v));
	return {
		left: clamp(desiredLeft, params.scrollWidth - params.clientWidth),
		top: clamp(desiredTop, params.scrollHeight - params.clientHeight),
	};
}
