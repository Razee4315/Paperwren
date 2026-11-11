/**
 * Crop margins: a PDF's pages shown without the white around what is
 * printed on them, so a phone's narrow screen holds text, not paper.
 *
 * Each page's printed area is found from a small drawing of it. Every
 * page then shows a box of the same size, as wide and as tall as the
 * widest and tallest printed area of the pages read to learn the
 * document: pdf.js draws every page at one scale, so pages of one size
 * keep the text the same size page after page, and "Fit width" fits
 * them all. Each box sits where that page's side (odd or even, as a
 * book's margins alternate) usually prints, moved to take in all the
 * page prints, so nothing printed is cut. A page of another size than
 * the rest (a fold-out) is cropped on its own. pdf.js reads a page's box
 * from one field of its page object; that is what changes, and changes
 * back. Printing always takes the whole page.
 */

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/** Left, bottom, right, top (a page's own space), or left, top, right,
 * bottom (a drawing's pixels). */
export type Box = [number, number, number, number];

/** A drawing this wide is enough to find the margins. */
const PROBE_WIDTH = 220;
/** Darker than this (of 255) is ink. */
const INK = 232;
/** Kept around what is printed, as a share of the page. */
const PAD = 0.025;
/** Pages read to learn the document's usual printed area. */
const SAMPLES = 8;
/** Pages whose size differs from the document's by more than this
 * share are cropped on their own. */
const OTHER_SIZE = 0.2;

interface WithInfo {
	_pageInfo?: { view: Box };
}

const original = new WeakMap<PDFPageProxy, Box>();

/** Whether this pdf.js lets a page's box be changed. */
export function canCrop(page: PDFPageProxy): boolean {
	const view = (page as unknown as WithInfo)._pageInfo?.view;
	return Array.isArray(view) && view.length === 4;
}

/** A page's own, uncropped box. */
export function fullView(page: PDFPageProxy): Box {
	return original.get(page) ?? (page.view as Box);
}

function setView(page: PDFPageProxy, view: Box) {
	const info = (page as unknown as WithInfo)._pageInfo;
	if (!info) return;
	if (!original.has(page)) original.set(page, [...info.view] as Box);
	info.view = view;
}

/** Run `fn` while the page shows its whole box (to draw it for a probe,
 * or for paper). */
export function whole<T>(page: PDFPageProxy, fn: () => T): T {
	const info = (page as unknown as WithInfo)._pageInfo;
	const cropped = info?.view;
	const full = original.get(page);
	if (!info || !full) return fn();
	info.view = full;
	try {
		return fn();
	} finally {
		info.view = cropped as Box;
	}
}

/**
 * The part of a drawing of a page that is printed on, in its pixels
 * (left, top, right, bottom; right and bottom just past it), or null
 * when nothing is. `data` is RGBA, as a canvas gives it.
 */
export function inkBox(
	data: Uint8ClampedArray,
	width: number,
	height: number,
): Box | null {
	let top = height;
	let left = width;
	let bottom = -1;
	let right = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			// Transparent is paper too.
			if (data[i + 3] < 16) continue;
			if (Math.min(data[i], data[i + 1], data[i + 2]) >= INK) continue;
			if (y < top) top = y;
			if (y > bottom) bottom = y;
			if (x < left) left = x;
			if (x > right) right = x;
		}
	}
	return bottom < 0 ? null : [left, top, right + 1, bottom + 1];
}

/** The box of a page's printed area, in its own space, or null when it
 * prints nothing (a blank page keeps its paper). */
async function printedArea(page: PDFPageProxy): Promise<Box | null> {
	const full = fullView(page);
	const viewport = whole(page, () =>
		page.getViewport({
			scale: PROBE_WIDTH / Math.max(1, full[2] - full[0]),
			rotation: 0,
		}),
	);
	const canvas = document.createElement("canvas");
	canvas.width = Math.ceil(viewport.width);
	canvas.height = Math.ceil(viewport.height);
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return null;
	await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
	const { data, width, height } = ctx.getImageData(
		0,
		0,
		canvas.width,
		canvas.height,
	);
	canvas.width = canvas.height = 0;
	const found = inkBox(data, width, height);
	if (!found) return null;
	const [ax, ay] = viewport.convertToPdfPoint(found[0], found[1]);
	const [bx, by] = viewport.convertToPdfPoint(found[2], found[3]);
	return [
		Math.min(ax, bx),
		Math.min(ay, by),
		Math.max(ax, bx),
		Math.max(ay, by),
	];
}

/** Each side where most of the boxes have it (the middle value, leaning
 * to the smaller box). */
function usualBox(boxes: Box[]): Box | null {
	if (!boxes.length) return null;
	const side = (i: number, grow: 1 | -1) => {
		const values = boxes.map((b) => b[i]).sort((a, b) => a - b);
		const mid =
			grow > 0
				? Math.floor((values.length - 1) / 2)
				: Math.floor(values.length / 2);
		return values[mid];
	};
	// Left and bottom grow downwards, right and top upwards.
	return [side(0, -1), side(1, -1), side(2, 1), side(3, 1)];
}

const across = (b: Box) => b[2] - b[0];
const down = (b: Box) => b[3] - b[1];

/** The printed area with a little paper around it, inside the page. */
function padded(area: Box, page: Box): Box {
	const dx = across(page) * PAD;
	const dy = down(page) * PAD;
	return [
		Math.max(page[0], area[0] - dx),
		Math.max(page[1], area[1] - dy),
		Math.min(page[2], area[2] + dx),
		Math.min(page[3], area[3] + dy),
	];
}

/** The size every page's box takes: the widest and the tallest of the
 * printed areas read, with a little paper around, no larger than the
 * page. */
export function sharedSize(areas: Box[], page: Box): [number, number] {
	let w = 0;
	let h = 0;
	for (const area of areas) {
		w = Math.max(w, across(area));
		h = Math.max(h, down(area));
	}
	return [
		Math.min(across(page), w + 2 * PAD * across(page)),
		Math.min(down(page), h + 2 * PAD * down(page)),
	];
}

/**
 * Where a page's box goes: `size` across and down, centred where its
 * side usually prints (`usual`), then moved as little as needed to take
 * in what this page prints (`area`), and kept on the page. A page that
 * prints wider or taller than `size` (one not read to learn the
 * document) gets a box large enough for it: what is printed is never
 * cut. All three are in the page's own space.
 */
export function placeBox(
	page: Box,
	size: [number, number],
	usual: Box | null,
	area: Box | null,
): Box {
	const around = usual ?? area;
	if (!around) return page;
	const place = (axis: 0 | 1, len: number) => {
		const lo = page[axis];
		const hi = page[axis + 2];
		let start = (around[axis] + around[axis + 2]) / 2 - len / 2;
		if (area) {
			start = Math.min(start, area[axis]);
			start = Math.max(start, area[axis + 2] - len);
		}
		return Math.min(hi - len, Math.max(lo, start));
	};
	const w = Math.min(across(page), Math.max(size[0], area ? across(area) : 0));
	const h = Math.min(down(page), Math.max(size[1], area ? down(area) : 0));
	const x = place(0, w);
	const y = place(1, h);
	return [x, y, x + w, y + h];
}

/** Whether a page is of another size than the document's (a fold-out
 * among A4 pages). */
const otherSize = (page: Box, sheet: Box) =>
	Math.abs(across(page) - across(sheet)) > OTHER_SIZE * across(sheet) ||
	Math.abs(down(page) - down(sheet)) > OTHER_SIZE * down(sheet);

/**
 * Crop a document's pages. Pages are cropped as pdf.js asks for them
 * (its page objects are kept, so each is measured once); `stop` puts
 * every page back as it was. `trimmed` says whether the pages lose
 * anything worth the name.
 */
export async function cropPages(
	doc: PDFDocumentProxy,
): Promise<{ stop: () => void; trimmed: boolean }> {
	const own = doc.getPage.bind(doc);
	const areas = new Map<number, Promise<Box | null>>();
	const measure = (n: number) => {
		let area = areas.get(n);
		if (!area) {
			area = own(n)
				.then(printedArea)
				.catch(() => null);
			areas.set(n, area);
		}
		return area;
	};
	// The usual printed area of odd and of even pages, from pages the
	// size of the first: one of another size sets nothing for the rest.
	const count = doc.numPages;
	const sheet = fullView(await own(1));
	const picks = new Set<number>([1, 2, 3, 4]);
	for (let i = 1; i <= SAMPLES; i++)
		picks.add(Math.max(1, Math.round((count * i) / (SAMPLES + 1))));
	const seen: [Box[], Box[]] = [[], []];
	for (const n of [...picks].filter((n) => n <= count)) {
		const area = await measure(n);
		const page = fullView(await own(n));
		if (area && !otherSize(page, sheet)) seen[n % 2].push(area);
	}
	const usual = [usualBox(seen[0]), usualBox(seen[1])];
	const size = sharedSize([...seen[0], ...seen[1]], sheet);
	const touched = new Set<PDFPageProxy>();
	const crop = async (page: PDFPageProxy, n: number) => {
		const area = await measure(n);
		if (!canCrop(page)) return page;
		const full = fullView(page);
		const common = usual[n % 2] ?? usual[(n + 1) % 2];
		setView(
			page,
			otherSize(full, sheet)
				? area
					? padded(area, full)
					: full
				: placeBox(
						full,
						size,
						common && padded(common, full),
						area && padded(area, full),
					),
		);
		touched.add(page);
		return page;
	};
	const patched = (n: number) => own(n).then((page) => crop(page, n));
	(doc as { getPage: typeof doc.getPage }).getPage = patched;
	return {
		// All but the whole page: nothing to take away.
		trimmed: size[0] < across(sheet) * 0.97 || size[1] < down(sheet) * 0.97,
		stop() {
			// The document's own method, on its prototype, shows again.
			Reflect.deleteProperty(doc, "getPage");
			for (const page of touched) {
				const full = original.get(page);
				if (full) setView(page, full);
			}
		},
	};
}
