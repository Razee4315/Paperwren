/**
 * Where the pictures sit on a PDF page, so sepia and dark pages can
 * leave them as they are (global.css, "Page colour"). A page is one bitmap, so the
 * pictures are found where the page draws them: each image is a unit
 * square under the transformation in force when it is painted.
 */

import type { PDFPageProxy } from "pdfjs-dist";

/** A rectangle in the page's own space: [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];
type Matrix = [number, number, number, number, number, number];

/** The drawing operators that matter here (pdf.js's OPS). */
export interface PictureOps {
	save: number;
	restore: number;
	transform: number;
	paintFormXObjectBegin: number;
	paintFormXObjectEnd: number;
	beginGroup: number;
	endGroup: number;
	paintImageXObject: number;
	paintInlineImageXObject: number;
	paintImageXObjectRepeat: number;
}

/** A picture over this share of the page is the page: a scan or a
 * photographed sheet, which reads better turned dark with the rest. */
const WHOLE_PAGE = 0.7;
/** A picture this much of a page, on a page with no words, is a scan. */
const SCAN_SHARE = 0.5;
const MAX_PICTURES = 200;
/** Smaller than this, in points, is an icon or a rule, not a picture. */
const MIN_SIDE = 6;

function multiply(m: Matrix, n: Matrix): Matrix {
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5],
	];
}

function unitSquare(m: Matrix): Box {
	const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
	const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
	return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const isMatrix = (v: unknown): v is Matrix =>
	Array.isArray(v) && v.length === 6 && v.every((n) => Number.isFinite(n));

/**
 * The boxes of the images a page paints, from its operator list. `view`
 * is the page's visible box; a picture covering most of it is left out
 * (see WHOLE_PAGE).
 */
export function picturesIn(
	fnArray: ArrayLike<number>,
	argsArray: ArrayLike<unknown>,
	ops: PictureOps,
	view: Box,
	largest = WHOLE_PAGE,
): Box[] {
	const found: Box[] = [];
	const stack: Matrix[] = [];
	let ctm: Matrix = [1, 0, 0, 1, 0, 0];
	const add = (m: Matrix) => {
		const [x0, y0, x1, y1] = unitSquare(m);
		const box: Box = [
			Math.max(x0, view[0]),
			Math.max(y0, view[1]),
			Math.min(x1, view[2]),
			Math.min(y1, view[3]),
		];
		if (box[2] - box[0] >= MIN_SIDE && box[3] - box[1] >= MIN_SIDE)
			found.push(box);
	};
	for (let i = 0; i < fnArray.length && found.length < MAX_PICTURES; i++) {
		const fn = fnArray[i];
		const args = argsArray[i] as unknown[] | null;
		if (fn === ops.save) stack.push(ctm);
		else if (fn === ops.restore) ctm = stack.pop() ?? ctm;
		else if (fn === ops.transform) {
			if (isMatrix(args)) ctm = multiply(ctm, args);
		} else if (fn === ops.paintFormXObjectBegin) {
			stack.push(ctm);
			if (isMatrix(args?.[0])) ctm = multiply(ctm, args[0]);
		} else if (fn === ops.beginGroup) {
			stack.push(ctm);
			const group = args?.[0] as { matrix?: unknown } | undefined;
			if (isMatrix(group?.matrix)) ctm = multiply(ctm, group.matrix);
		} else if (fn === ops.paintFormXObjectEnd || fn === ops.endGroup) {
			ctm = stack.pop() ?? ctm;
		} else if (
			fn === ops.paintImageXObject ||
			fn === ops.paintInlineImageXObject
		) {
			add(ctm);
		} else if (fn === ops.paintImageXObjectRepeat) {
			const [, scaleX, scaleY, positions] = (args ?? []) as [
				unknown,
				number,
				number,
				number[],
			];
			for (let p = 0; p + 1 < (positions?.length ?? 0); p += 2)
				add(
					multiply(ctm, [scaleX, 0, 0, scaleY, positions[p], positions[p + 1]]),
				);
		}
	}
	const area = (view[2] - view[0]) * (view[3] - view[1]);
	return found.filter(
		(b) => area <= 0 || ((b[2] - b[0]) * (b[3] - b[1])) / area < largest,
	);
}

/** True for a page that is mostly one picture: a scan or a photograph
 * of a page. */
export async function looksScanned(
	page: PDFPageProxy,
	ops: PictureOps,
): Promise<boolean> {
	const list = await page.getOperatorList();
	const view = page.view as Box;
	const area = (view[2] - view[0]) * (view[3] - view[1]);
	return picturesIn(list.fnArray, list.argsArray, ops, view, 2).some(
		(b) => ((b[2] - b[0]) * (b[3] - b[1])) / area >= SCAN_SHARE,
	);
}

/** The pictures of a page, read once per page and kept. */
export async function findPictures(
	page: PDFPageProxy,
	ops: PictureOps,
): Promise<Box[]> {
	const list = await page.getOperatorList();
	return picturesIn(list.fnArray, list.argsArray, ops, page.view as Box);
}

const LAYER = "pw-pictures";

/**
 * Show each picture of a drawn page as it is. The paper's colour is a filter
 * over the page's bitmap, which itself keeps the true colours: each
 * picture is copied from it onto a small canvas above the filter. They
 * are placed in shares of the page, so a zoom stretches them with it
 * until the page is drawn again (and so are they). `rotation` is the
 * page's whole turn, its own and the reader's.
 */
export function placePictures(
	page: PDFPageProxy,
	pageDiv: HTMLElement,
	boxes: Box[],
	rotation: number,
) {
	pageDiv.querySelector(`:scope > .${LAYER}`)?.remove();
	const source = pageDiv.querySelector<HTMLCanvasElement>(
		".canvasWrapper canvas",
	);
	if (!boxes.length || !source?.width) return;
	const layer = document.createElement("div");
	layer.className = LAYER;
	layer.setAttribute("aria-hidden", "true");
	const viewport = page.getViewport({ scale: 1, rotation });
	for (const box of boxes) {
		const [ax, ay, bx, by] = viewport.convertToViewportRectangle(box);
		const x = Math.min(ax, bx) / viewport.width;
		const y = Math.min(ay, by) / viewport.height;
		const w = Math.abs(bx - ax) / viewport.width;
		const h = Math.abs(by - ay) / viewport.height;
		const sx = Math.round(x * source.width);
		const sy = Math.round(y * source.height);
		const sw = Math.max(1, Math.round(w * source.width));
		const sh = Math.max(1, Math.round(h * source.height));
		const copy = document.createElement("canvas");
		copy.className = "pw-picture";
		copy.width = sw;
		copy.height = sh;
		copy.getContext("2d")?.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
		copy.style.left = `${x * 100}%`;
		copy.style.top = `${y * 100}%`;
		copy.style.width = `${w * 100}%`;
		copy.style.height = `${h * 100}%`;
		layer.appendChild(copy);
	}
	pageDiv.appendChild(layer);
}
