/**
 * Measuring on a page: a line's length or a shape's area, at the size
 * the page prints at, or at the scale the reader gave it by measuring
 * something of a known length. A plan's sheets can differ, so a scale
 * belongs to one page.
 */

import type { PageScale } from "./docMarks";
import { formatNumber, locale } from "./i18n";
import type { Markup } from "./pdfMarkup";

type Measure = Extract<Markup, { kind: "measure" }>;
type Point = [number, number];

export const UNITS = ["mm", "cm", "m", "km", "in", "ft", "yd", "mi"];

const POINTS_PER_INCH = 72;

/** Real paper, in what the reader's country measures it with. */
export function paperScale(): PageScale {
	return /-US$/i.test(locale() ?? "")
		? { perPoint: 1 / POINTS_PER_INCH, unit: "in" }
		: { perPoint: 2.54 / POINTS_PER_INCH, unit: "cm" };
}

/** A line's length along its points, in points of a `pw` by `ph` page. */
export function lengthOf(points: Point[], pw: number, ph: number): number {
	let length = 0;
	for (let i = 1; i < points.length; i++)
		length += Math.hypot(
			(points[i][0] - points[i - 1][0]) * pw,
			(points[i][1] - points[i - 1][1]) * ph,
		);
	return length;
}

/** The area inside a closed shape, in square points. */
export function areaOf(points: Point[], pw: number, ph: number): number {
	let sum = 0;
	points.forEach(([x, y], i) => {
		const [nx, ny] = points[(i + 1) % points.length];
		sum += x * pw * (ny * ph) - nx * pw * (y * ph);
	});
	return Math.abs(sum) / 2;
}

/** The scale that makes `points` long the line of `length` drawn, or
 * null for a length or a line that cannot make one. */
export function scaleFrom(
	points: Point[],
	pw: number,
	ph: number,
	length: number,
	unit: string,
): PageScale | null {
	const drawn = lengthOf(points, pw, ph);
	if (!(drawn > 0) || !Number.isFinite(length) || length <= 0) return null;
	return { perPoint: length / drawn, unit };
}

const figure = (value: number) =>
	formatNumber(value, {
		maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
	});

/** What a measurement comes to, as read: "4.2 m", "20 m²". */
export function measureLabel(
	mark: Measure,
	pw: number,
	ph: number,
	scale: PageScale = paperScale(),
): string {
	if (mark.closed)
		return `${figure(areaOf(mark.points, pw, ph) * scale.perPoint ** 2)} ${scale.unit}²`;
	return `${figure(lengthOf(mark.points, pw, ph) * scale.perPoint)} ${scale.unit}`;
}
