/**
 * Handwriting, shared by marking up a PDF and by Notes: a stroke is a
 * list of points as fractions of its sheet, kept light, and drawn as a
 * curve through their midpoints.
 */

import type { Markup } from "@/lib/pdfMarkup";

export type InkPoint = [number, number];

/** Points closer than this add weight and nothing to see. */
const NEAR = 0.0012;

/** Add a point to a stroke unless it is on top of the last one. */
export function pushPoint(points: InkPoint[], point: InkPoint) {
	const last = points[points.length - 1];
	if (
		last &&
		Math.abs(last[0] - point[0]) < NEAR &&
		Math.abs(last[1] - point[1]) < NEAR
	)
		return;
	points.push([
		Math.round(point[0] * 10000) / 10000,
		Math.round(point[1] * 10000) / 10000,
	]);
}

/** The stroke as an SVG path, on a sheet of the given size. */
export function curve(points: InkPoint[], w: number, h: number): string {
	if (!points.length) return "";
	const at = (i: number) => [points[i][0] * w, points[i][1] * h];
	const [x0, y0] = at(0);
	if (points.length === 1) return `M${x0} ${y0}l.01 0`;
	let d = `M${x0} ${y0}`;
	for (let i = 1; i < points.length - 1; i++) {
		const [x, y] = at(i);
		const [nx, ny] = at(i + 1);
		d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
	}
	const [lx, ly] = at(points.length - 1);
	return `${d}L${lx} ${ly}`;
}

/** How far a point is from a stroke, in the sheet's own units. */
export function strokeDistance(
	points: InkPoint[],
	u: number,
	v: number,
	w: number,
	h: number,
): number {
	const px = u * w;
	const py = v * h;
	let best = Number.POSITIVE_INFINITY;
	for (let i = 0; i < points.length; i++) {
		const ax = points[i][0] * w;
		const ay = points[i][1] * h;
		const [bx, by] = points[Math.min(i + 1, points.length - 1)];
		const dx = bx * w - ax;
		const dy = by * h - ay;
		const length = dx * dx + dy * dy;
		const along = length
			? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
			: 0;
		best = Math.min(
			best,
			Math.hypot(px - (ax + along * dx), py - (ay + along * dy)),
		);
	}
	return best;
}

/** Whether a point lies on a mark, within `reach` points of it. */
export function markHit(
	mark: Markup,
	u: number,
	v: number,
	pw: number,
	ph: number,
	reach: number,
): boolean {
	if (mark.kind === "ink")
		return strokeDistance(mark.points, u, v, pw, ph) <= mark.width / 2 + reach;
	if (mark.kind === "measure") {
		const points = mark.closed ? [...mark.points, mark.points[0]] : mark.points;
		return strokeDistance(points, u, v, pw, ph) <= 2 + reach;
	}
	if (mark.kind === "note")
		return Math.hypot((u - mark.x) * pw, (v - mark.y) * ph) <= 12 + reach;
	if (mark.kind === "text") {
		const [x, y] = [reach / pw, reach / ph];
		return (
			u >= mark.x - x &&
			u <= mark.x + mark.w + x &&
			v >= mark.y - y &&
			v <= mark.y + mark.h + y
		);
	}
	const x = reach / pw;
	const y = reach / ph;
	return mark.boxes.some(
		(b) =>
			u >= b.x - x && u <= b.x + b.w + x && v >= b.y - y && v <= b.y + b.h + y,
	);
}
