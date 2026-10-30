/**
 * Where a page's words are, so a highlight can follow them: the lines of
 * text pdf.js reads from a page, and the stretch of them between two
 * points. Letters are placed by their share of a run's width, which is
 * close enough to end a highlight between two of them.
 */

import type { TextBox } from "./pdfMarkup";

/** A run of text on one line, as fractions of the page as shown. */
export interface TextRun extends TextBox {
	text: string;
	rtl: boolean;
}

export interface TextLine {
	runs: TextRun[];
	top: number;
	bottom: number;
}

/** pdf.js's text items, as far as they are read here. */
export interface PageTextItem {
	str?: string;
	width?: number;
	transform?: number[];
	dir?: string;
}

/** A page's viewport at scale 1: its size as shown, and its transform. */
export interface PageView {
	width: number;
	height: number;
	transform: number[];
}

const times = (m: number[], n: number[]) => [
	m[0] * n[0] + m[2] * n[1],
	m[1] * n[0] + m[3] * n[1],
	m[0] * n[2] + m[2] * n[3],
	m[1] * n[2] + m[3] * n[3],
	m[0] * n[4] + m[2] * n[5] + m[4],
	m[1] * n[4] + m[3] * n[5] + m[5],
];

/** The page's lines, in the file's own reading order. Text set at an
 * angle is left out. */
export function textLines(items: PageTextItem[], view: PageView): TextLine[] {
	const lines: TextLine[] = [];
	let last: TextLine | null = null;
	for (const item of items) {
		if (!item.str || !item.transform) continue;
		const [a, b, c, d, e, f] = times(view.transform, item.transform);
		if (Math.abs(b) > Math.abs(a) * 0.02) continue;
		const tall = Math.hypot(c, d);
		const width = item.width ?? 0;
		if (tall <= 0 || width <= 0) continue;
		const run: TextRun = {
			x: e / view.width,
			y: (f - tall * 0.85) / view.height,
			w: width / view.width,
			h: (tall * 1.1) / view.height,
			text: item.str,
			rtl: item.dir === "rtl",
		};
		const near =
			last && Math.abs(last.bottom - (run.y + run.h)) < run.h * 0.5
				? gapTo(last, run) * view.width < tall * 3
				: false;
		if (near && last) {
			last.runs.push(run);
			last.top = Math.min(last.top, run.y);
			last.bottom = Math.max(last.bottom, run.y + run.h);
		} else if (item.str.trim()) {
			last = { runs: [run], top: run.y, bottom: run.y + run.h };
			lines.push(last);
		}
	}
	return lines;
}

const left = (line: TextLine) => Math.min(...line.runs.map((r) => r.x));
const right = (line: TextLine) => Math.max(...line.runs.map((r) => r.x + r.w));

function gapTo(line: TextLine, run: TextRun): number {
	return Math.max(0, run.x - right(line), left(line) - (run.x + run.w));
}

/** The line a point falls on or beside, within a line's height of it. */
function lineAt(lines: TextLine[], u: number, v: number): number {
	let best = -1;
	let bestGap = Number.POSITIVE_INFINITY;
	lines.forEach((line, i) => {
		const tall = line.bottom - line.top;
		const down = Math.max(0, line.top - v, v - line.bottom);
		if (down > tall * 1.5) return;
		const across = Math.max(0, left(line) - u, u - right(line));
		const gap = down * 4 + across;
		if (gap < bestGap) {
			bestGap = gap;
			best = i;
		}
	});
	return best;
}

/** The text between two points: one box to a line, and its words.
 * Null where neither is near any text. */
export function textBetween(
	lines: TextLine[],
	from: [number, number],
	to: [number, number],
): { boxes: TextBox[]; text: string } | null {
	let start = lineAt(lines, from[0], from[1]);
	let end = lineAt(lines, to[0], to[1]);
	if (start < 0 && end < 0) return null;
	if (start < 0) start = end;
	if (end < 0) end = start;
	let [a, b] = [from, to];
	if (start > end || (start === end && a[0] > b[0])) {
		[start, end] = [end, start];
		[a, b] = [b, a];
	}
	const boxes: TextBox[] = [];
	const words: string[] = [];
	for (let i = start; i <= end; i++) {
		const line = lines[i];
		const from_ = i === start ? a[0] : 0;
		const to_ = i === end ? b[0] : 1;
		let x0 = 1;
		let x1 = 0;
		let text = "";
		for (const run of line.runs) {
			const count = run.text.length;
			const first = Math.floor(((from_ - run.x) / run.w) * count);
			const past = Math.ceil(((to_ - run.x) / run.w) * count);
			const lo = Math.max(0, first);
			const hi = Math.min(count, past);
			if (hi <= lo) continue;
			x0 = Math.min(x0, run.x + (lo / count) * run.w);
			x1 = Math.max(x1, run.x + (hi / count) * run.w);
			text += run.rtl
				? run.text.slice(count - hi, count - lo)
				: run.text.slice(lo, hi);
		}
		if (x1 <= x0) continue;
		boxes.push({ x: x0, y: line.top, w: x1 - x0, h: line.bottom - line.top });
		words.push(text.trim());
	}
	return boxes.length ? { boxes, text: words.join(" ") } : null;
}
