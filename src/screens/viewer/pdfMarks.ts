/**
 * The reader's marks on a PDF's pages, drawn by the app over what
 * pdf.js draws, so a highlight shows while reading without the file
 * being changed. A mark's places are fractions of the page as shown:
 * its own turn, the whole page. The reader can turn it further or crop
 * its margins, so everything goes through one map.
 */

import { startsRtl } from "@/lib/bidi";
import type { DocMark } from "@/lib/docMarks";
import { MARKER_OPACITY, NOTE_SIZE } from "@/lib/pdfMarkup";
import { LINE_HEIGHT, layoutText, paintText, textFont } from "@/lib/textBox";
import { curve } from "@/screens/tools/ink";
import type { PDFPageProxy } from "pdfjs-dist";
import { whole } from "./pdfCrop";

type Viewport = ReturnType<PDFPageProxy["getViewport"]>;
type Matrix = [number, number, number, number, number, number];

/** From the page as a mark knows it to the page as it is drawn. */
export interface PageMap {
	/** The page as shown, in points. */
	pw: number;
	ph: number;
	/** The page as drawn. */
	width: number;
	height: number;
	/** Points of the page as shown, to pixels of the page as drawn. */
	matrix: Matrix;
}

export function pageMap(page: PDFPageProxy, viewport: Viewport): PageMap {
	const shown = whole(page, () => page.getViewport({ scale: 1 }));
	const at = (x: number, y: number) => {
		const [px, py] = shown.convertToPdfPoint(x, y);
		return viewport.convertToViewportPoint(px, py);
	};
	const [ox, oy] = at(0, 0);
	const [ax, ay] = at(1, 0);
	const [bx, by] = at(0, 1);
	return {
		pw: shown.width,
		ph: shown.height,
		width: viewport.width,
		height: viewport.height,
		matrix: [ax - ox, ay - oy, bx - ox, by - oy, ox, oy],
	};
}

/** A point of the page as drawn, as fractions of the page as shown. */
export function toShown(map: PageMap, x: number, y: number): [number, number] {
	const [a, b, c, d, e, f] = map.matrix;
	const det = a * d - b * c || 1;
	const px = (d * (x - e) - c * (y - f)) / det;
	const py = (a * (y - f) - b * (x - e)) / det;
	return [px / map.pw, py / map.ph];
}

/** A point given as fractions of the page as shown, as drawn. */
export function toDrawn(map: PageMap, u: number, v: number): [number, number] {
	const [a, b, c, d, e, f] = map.matrix;
	const x = u * map.pw;
	const y = v * map.ph;
	return [a * x + c * y + e, b * x + d * y + f];
}

/** The words on a measurement, on a page of `pw` by `ph` points. */
export type MarkLabel = (
	mark: DocMark,
	pw: number,
	ph: number,
) => string | undefined;

const SVG = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(SVG, tag);
	for (const [name, value] of Object.entries(attrs))
		node.setAttribute(name, String(value));
	return node;
}

/** Felt ink and highlights go under the rest, blended with the page. */
const blended = (mark: DocMark) =>
	mark.kind === "highlight" || (mark.kind === "ink" && mark.marker === true);

/** How far down a line of text a mark's stroke runs. */
const lineShare = (kind: "underline" | "strike") =>
	kind === "underline" ? 0.92 : 0.55;

/** The small sign that a highlight has a note on it. */
function noteSign(x: number, y: number) {
	const sign = el("g", {});
	sign.append(
		el("circle", { cx: x, cy: y, r: 3.5, fill: "#ffd93b", stroke: "#735c0d" }),
	);
	return sign;
}

function shapes(
	mark: DocMark,
	pw: number,
	ph: number,
	label: MarkLabel,
): SVGElement[] {
	if (mark.kind === "ink")
		return [
			el("path", {
				d: curve(mark.points, pw, ph),
				fill: "none",
				stroke: mark.color,
				"stroke-width": mark.width,
				"stroke-linecap": "round",
				"stroke-linejoin": "round",
			}),
		];
	if (mark.kind === "note") {
		const x = mark.x * pw;
		const y = mark.y * ph;
		const half = NOTE_SIZE / 2;
		return [
			el("rect", {
				x: x - half,
				y: y - half,
				width: NOTE_SIZE,
				height: NOTE_SIZE,
				rx: 2,
				fill: "#ffd93b",
				stroke: "#735c0d",
			}),
			...[6, 10, 14].map((at) =>
				el("line", {
					x1: x - 6,
					x2: x + 6,
					y1: y - half + at,
					y2: y - half + at,
					stroke: "#735c0d",
				}),
			),
		];
	}
	if (mark.kind === "text") {
		const left = mark.x * pw;
		const width = mark.w * pw;
		return layoutText(mark.text, mark.size, width).map((line, i) => {
			const rtl = startsRtl(line);
			const text = el("text", {
				x: rtl ? left + width : left,
				y: mark.y * ph + (i + 0.8) * mark.size * LINE_HEIGHT,
				fill: mark.color,
				direction: rtl ? "rtl" : "ltr",
				style: `font:${textFont(mark.size)}`,
			});
			text.textContent = line;
			return text;
		});
	}
	if (mark.kind === "measure") {
		const points = mark.points.map(
			([u, v]) => `${u * pw},${v * ph}`,
		) as string[];
		const line = el(mark.closed ? "polygon" : "polyline", {
			points: points.join(" "),
			fill: mark.closed ? `${mark.color}22` : "none",
			stroke: mark.color,
			"stroke-width": 1.2,
			"stroke-linejoin": "round",
		});
		const dots = mark.points.map(([u, v]) =>
			el("circle", { cx: u * pw, cy: v * ph, r: 2.4, fill: mark.color }),
		);
		const text = label(mark, pw, ph);
		if (!text) return [line, ...dots];
		const middle = mark.points.reduce(
			(sum, [u, v]) => [
				sum[0] + (u * pw) / mark.points.length,
				sum[1] + (v * ph) / mark.points.length,
			],
			[0, 0],
		);
		const caption = el("text", {
			x: middle[0],
			y: middle[1] - 5,
			"text-anchor": "middle",
			fill: mark.color,
			stroke: "#fff",
			"stroke-width": 3,
			"paint-order": "stroke",
			style: `font:600 ${textFont(11)}`,
		});
		caption.textContent = text;
		return [line, ...dots, caption];
	}
	const list: SVGElement[] = [];
	for (const b of mark.boxes) {
		if (mark.kind === "highlight")
			list.push(
				el("rect", {
					x: b.x * pw,
					y: b.y * ph,
					width: b.w * pw,
					height: b.h * ph,
					fill: mark.color,
				}),
			);
		else {
			const y = (b.y + b.h * lineShare(mark.kind)) * ph;
			list.push(
				el("line", {
					x1: b.x * pw,
					x2: (b.x + b.w) * pw,
					y1: y,
					y2: y,
					stroke: mark.color,
					"stroke-width": Math.max(0.6, b.h * ph * 0.07),
				}),
			);
		}
	}
	return list;
}

const UNDER = "pw-marks-under";
const OVER = "pw-marks-over";

function sheet(className: string, map: PageMap): [SVGSVGElement, SVGGElement] {
	const svg = el("svg", {
		class: className,
		viewBox: `0 0 ${map.width} ${map.height}`,
		preserveAspectRatio: "none",
		"aria-hidden": "true",
	});
	const group = el("g", { transform: `matrix(${map.matrix.join(" ")})` });
	svg.append(group);
	return [svg, group];
}

/** Draw a page's marks on a page div, in place of what it had. `pulse`
 * names a mark to draw the eye to. */
export function paintMarks(
	pageDiv: HTMLElement,
	marks: DocMark[],
	map: PageMap,
	{
		pulse,
		label = () => undefined,
	}: { pulse?: string | null; label?: MarkLabel },
) {
	for (const old of pageDiv.querySelectorAll(
		`:scope > .${UNDER}, :scope > .${OVER}`,
	))
		old.remove();
	if (!marks.length) return;
	const [under, underGroup] = sheet(UNDER, map);
	const [over, overGroup] = sheet(OVER, map);
	let hasUnder = false;
	let hasOver = false;
	for (const mark of marks) {
		const group = el("g", {});
		group.setAttribute("data-mark", mark.id);
		if (pulse === mark.id) group.classList.add("pw-mark-pulse");
		group.append(...shapes(mark, map.pw, map.ph, label));
		if (blended(mark)) {
			underGroup.append(group);
			hasUnder = true;
		} else {
			overGroup.append(group);
			hasOver = true;
		}
		if ("note" in mark && mark.note && mark.boxes.length) {
			const last = mark.boxes[mark.boxes.length - 1];
			overGroup.append(
				noteSign((last.x + last.w) * map.pw, last.y * map.ph - 1),
			);
			hasOver = true;
		}
	}
	if (hasUnder) pageDiv.append(under);
	if (hasOver) pageDiv.append(over);
}

/** Draw a page's marks into a picture of it (paper, a saved picture). */
export function drawMarks(
	ctx: CanvasRenderingContext2D,
	marks: DocMark[],
	map: PageMap,
	label: MarkLabel = () => undefined,
) {
	const { pw, ph } = map;
	ctx.save();
	ctx.transform(...map.matrix);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	const inkOf = (mark: Extract<DocMark, { kind: "ink" }>) => {
		ctx.strokeStyle = mark.color;
		ctx.lineWidth = mark.width;
		ctx.stroke(new Path2D(curve(mark.points, pw, ph)));
	};
	ctx.globalCompositeOperation = "multiply";
	ctx.globalAlpha = MARKER_OPACITY;
	for (const mark of marks) {
		if (mark.kind === "highlight") {
			ctx.fillStyle = mark.color;
			for (const b of mark.boxes)
				ctx.fillRect(b.x * pw, b.y * ph, b.w * pw, b.h * ph);
		} else if (mark.kind === "ink" && mark.marker) inkOf(mark);
	}
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	for (const mark of marks) {
		if (mark.kind === "ink" && !mark.marker) inkOf(mark);
		else if (mark.kind === "underline" || mark.kind === "strike") {
			ctx.strokeStyle = mark.color;
			for (const b of mark.boxes) {
				const y = (b.y + b.h * lineShare(mark.kind)) * ph;
				ctx.lineWidth = Math.max(0.6, b.h * ph * 0.07);
				ctx.beginPath();
				ctx.moveTo(b.x * pw, y);
				ctx.lineTo((b.x + b.w) * pw, y);
				ctx.stroke();
			}
		} else if (mark.kind === "text") {
			const width = mark.w * pw;
			ctx.save();
			ctx.translate(mark.x * pw, mark.y * ph);
			paintText(
				ctx,
				layoutText(mark.text, mark.size, width),
				mark.size,
				width,
				mark.color,
			);
			ctx.restore();
		} else if (mark.kind === "measure") {
			ctx.strokeStyle = mark.color;
			ctx.lineWidth = 1.2;
			ctx.beginPath();
			mark.points.forEach(([u, v], i) => {
				if (i) ctx.lineTo(u * pw, v * ph);
				else ctx.moveTo(u * pw, v * ph);
			});
			if (mark.closed) ctx.closePath();
			ctx.stroke();
			const text = label(mark, pw, ph);
			if (text) {
				const [x, y] = mark.points.reduce(
					(sum, [u, v]) => [
						sum[0] + (u * pw) / mark.points.length,
						sum[1] + (v * ph) / mark.points.length,
					],
					[0, 0],
				);
				ctx.font = `600 ${textFont(11)}`;
				ctx.textAlign = "center";
				ctx.fillStyle = mark.color;
				ctx.fillText(text, x, y - 5);
			}
		} else if (mark.kind === "note") {
			const half = NOTE_SIZE / 2;
			ctx.fillStyle = "#ffd93b";
			ctx.strokeStyle = "#735c0d";
			ctx.lineWidth = 1;
			const x = mark.x * pw;
			const y = mark.y * ph;
			ctx.fillRect(x - half, y - half, NOTE_SIZE, NOTE_SIZE);
			ctx.strokeRect(x - half, y - half, NOTE_SIZE, NOTE_SIZE);
		}
	}
	ctx.restore();
}
