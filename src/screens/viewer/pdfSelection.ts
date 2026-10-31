/**
 * What the reader selected on a PDF's pages, as places on those pages:
 * one box to a line and the words, a part for each page it runs over.
 * The boxes are taken from the selection itself, so what is marked is
 * what was selected, in any script and either direction.
 */

import type { TextBox } from "@/lib/pdfMarkup";
import { type PageMap, toShown } from "./pdfMarks";

/** The words selected on one page. */
export interface PickedText {
	/** From 0. */
	page: number;
	boxes: TextBox[];
	text: string;
}

/** Rectangles close enough to read as one line become one box; a wide
 * gap on a line is a column, and starts another. */
export function mergeBoxes(rects: TextBox[]): TextBox[] {
	const sorted = rects
		.filter((r) => r.w > 0 && r.h > 0)
		.sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
	const lines: TextBox[][] = [];
	for (const rect of sorted) {
		const middle = rect.y + rect.h / 2;
		const line = lines[lines.length - 1];
		const last = line?.[0];
		if (last && middle >= last.y && middle <= last.y + last.h) line.push(rect);
		else lines.push([rect]);
	}
	const boxes: TextBox[] = [];
	for (const line of lines) {
		line.sort((a, b) => a.x - b.x);
		let now: TextBox | null = null;
		for (const rect of line) {
			if (now && rect.x - (now.x + now.w) <= rect.h * 3) {
				const right = Math.max(now.x + now.w, rect.x + rect.w);
				const top = Math.min(now.y, rect.y);
				const bottom = Math.max(now.y + now.h, rect.y + rect.h);
				now = { x: now.x, y: top, w: right - now.x, h: bottom - top };
				boxes[boxes.length - 1] = now;
			} else {
				now = { ...rect };
				boxes.push(now);
			}
		}
	}
	return boxes;
}

/** A page of the viewer: its element, and where marks go on it. */
export interface PageSpot {
	div: HTMLElement;
	map: PageMap;
}

function shownBox(rect: DOMRect, frame: DOMRect, map: PageMap): TextBox {
	const place = (x: number, y: number) =>
		toShown(
			map,
			((x - frame.left) / frame.width) * map.width,
			((y - frame.top) / frame.height) * map.height,
		);
	const [ax, ay] = place(rect.left, rect.top);
	const [bx, by] = place(rect.right, rect.bottom);
	const x = Math.max(0, Math.min(ax, bx));
	const y = Math.max(0, Math.min(ay, by));
	return {
		x,
		y,
		w: Math.min(1, Math.max(ax, bx)) - x,
		h: Math.min(1, Math.max(ay, by)) - y,
	};
}

/** The selected words of `range`, page by page. */
export function pickRange(
	range: Range,
	root: HTMLElement,
	spotOf: (pageNumber: number) => PageSpot | null,
): PickedText[] {
	const picked: PickedText[] = [];
	for (const pageDiv of root.querySelectorAll<HTMLElement>(".page")) {
		if (!range.intersectsNode(pageDiv)) continue;
		const layer = pageDiv.querySelector(".textLayer");
		const pageNumber = Number(pageDiv.dataset.pageNumber);
		const spot = pageNumber ? spotOf(pageNumber) : null;
		if (!layer || !spot) continue;
		const frame = spot.div.getBoundingClientRect();
		const rects: TextBox[] = [];
		let text = "";
		const walker = document.createTreeWalker(
			layer,
			NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
		);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!range.intersectsNode(node)) continue;
			if (node.nodeName === "BR") text += " ";
			if (node.nodeType !== Node.TEXT_NODE) continue;
			const part = document.createRange();
			part.selectNodeContents(node);
			if (node === range.startContainer) part.setStart(node, range.startOffset);
			if (node === range.endContainer) part.setEnd(node, range.endOffset);
			const words = part.toString();
			if (!words) continue;
			text += words;
			for (const rect of part.getClientRects())
				rects.push(shownBox(rect, frame, spot.map));
		}
		const boxes = mergeBoxes(rects);
		const clean = text.replace(/\s+/g, " ").trim();
		if (boxes.length && clean)
			picked.push({ page: pageNumber - 1, boxes, text: clean });
	}
	return picked;
}
