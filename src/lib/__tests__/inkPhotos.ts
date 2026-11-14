/**
 * A made-up phone photo of a signature and a stamp, for the tests of
 * inkFromPhoto: yellowish paper lit unevenly (brighter on the left, a
 * soft shadow at the lower right), grain and noise, a thin blue
 * signature, a red stamp (a ring with words inside it), and specks of
 * dust. With it, what each pixel truly is, so the result can be checked.
 *
 * Ink sits on the paper the way it does on a page: the light falls on
 * the paper and the ink takes its share of it away. A pixel is
 * light × paper × (1 − cover × (1 − ink)), so the ink's own colour is
 * what is left once the paper is taken out.
 */

export const BLUE: [number, number, number] = [28, 58, 160];
export const RED: [number, number, number] = [196, 32, 44];
export const PAPER: [number, number, number] = [240, 228, 192];

export interface InkPhoto {
	data: Uint8ClampedArray;
	width: number;
	height: number;
	/** How much of each pixel the signature covers, 0 to 1. */
	blue: Float32Array;
	/** How much of each pixel the stamp covers. */
	red: Float32Array;
	/** 1 where there is dust. */
	dust: Uint8Array;
}

/** A small repeatable random number, 0 to 1. */
function random(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

/** The distance from (x, y) to the segment from a to b. */
function toSegment(
	x: number,
	y: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
) {
	const dx = bx - ax;
	const dy = by - ay;
	const t = Math.max(
		0,
		Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
	);
	return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

/** Cover of a line `width` wide at distance `d` from its middle. */
const cover = (d: number, width: number) =>
	Math.max(0, Math.min(1, width / 2 + 0.5 - d));

export function inkPhoto(width = 640, height = 480, seed = 7): InkPhoto {
	const n = width * height;
	const blue = new Float32Array(n);
	const red = new Float32Array(n);
	const dust = new Uint8Array(n);
	const s = width / 640;

	// The signature: a wavy line 2 pixels wide, with a loop.
	const points: Array<[number, number]> = [];
	for (let i = 0; i <= 120; i++) {
		const t = i / 120;
		points.push([
			(60 + 300 * t + 18 * Math.sin(t * 25)) * s,
			(120 + 40 * Math.sin(t * 9) - 22 * Math.cos(t * 25)) * s,
		]);
	}
	// The stamp: a ring 7 wide, a ring 2 wide inside it, and words.
	const cx = 430 * s;
	const cy = 300 * s;
	const outer = 110 * s;
	const inner = 96 * s;
	const strokes: Array<[number, number, number, number]> = [];
	for (let letter = 0; letter < 7; letter++) {
		const x = cx - 84 * s + letter * 25 * s;
		const y = cy - 14 * s;
		const tall = 28 * s;
		strokes.push([x, y, x, y + tall]);
		if (letter % 2) strokes.push([x, y + tall, x + 14 * s, y + tall]);
		else strokes.push([x, y, x + 14 * s, y + tall / 2]);
	}
	// A short line of small type under the words, and a full stop.
	for (let i = 0; i < 9; i++) {
		const x = cx - 60 * s + i * 14 * s;
		strokes.push([x, cy + 30 * s, x + 8 * s, cy + 30 * s]);
	}

	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const k = y * width + x;
			const px = x + 0.5;
			const py = y + 0.5;
			let d = Number.POSITIVE_INFINITY;
			for (let i = 1; i < points.length; i++) {
				const [ax, ay] = points[i - 1];
				const [bx, by] = points[i];
				if (Math.abs(px - ax) > 12 * s && Math.abs(px - bx) > 12 * s) continue;
				d = Math.min(d, toSegment(px, py, ax, ay, bx, by));
			}
			blue[k] = cover(d, 2 * s);
			const r = Math.hypot(px - cx, py - cy);
			let c = Math.max(
				cover(Math.abs(r - outer), 7 * s),
				cover(Math.abs(r - inner), 2 * s),
			);
			for (const [ax, ay, bx, by] of strokes)
				c = Math.max(c, cover(toSegment(px, py, ax, ay, bx, by), 3 * s));
			c = Math.max(
				c,
				cover(Math.hypot(px - (cx + 70 * s), py - (cy + 31 * s)), 4 * s),
			);
			red[k] = c;
		}
	// Dust: a few dark specks on the paper, one in the shadow.
	for (const [x, y, size] of [
		[40, 400, 3],
		[300, 40, 2],
		[560, 440, 3],
		[200, 300, 2],
		[600, 90, 2],
	])
		for (let yy = 0; yy < size * s; yy++)
			for (let xx = 0; xx < size * s; xx++)
				dust[Math.round(y * s + yy) * width + Math.round(x * s + xx)] = 1;

	const rand = random(seed);
	const data = new Uint8ClampedArray(n * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const k = y * width + x;
			// Light: brighter on the left, a soft shadow at the lower right.
			const shadow = Math.exp(
				-((x - 0.85 * width) ** 2 + (y - 0.9 * height) ** 2) /
					(2 * (0.22 * width) ** 2),
			);
			const light = (1 - 0.4 * (x / width)) * (1 - 0.35 * shadow);
			// Grain: fibres in the paper, a little light and dark.
			const grain =
				1 +
				0.012 * Math.sin(x * 0.9 + y * 0.13) * Math.sin(y * 0.7 - x * 0.05) +
				0.008 * Math.sin((x + 2 * y) * 0.31);
			for (let ch = 0; ch < 3; ch++) {
				const take =
					(1 - blue[k] * (1 - BLUE[ch] / 255)) *
					(1 - red[k] * (1 - RED[ch] / 255)) *
					(dust[k] ? 0.25 : 1);
				const noise = (rand() + rand() - 1) * 6;
				data[k * 4 + ch] = PAPER[ch] * light * grain * take + noise;
			}
			data[k * 4 + 3] = 255;
		}
	return { data, width, height, blue, red, dust };
}

/** sRGB to CIE Lab (D65). */
export function lab([r, g, b]: readonly number[]): [number, number, number] {
	const lin = (v: number) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const [R, G, B] = [lin(r), lin(g), lin(b)];
	const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
	const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
	const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
	const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** ΔE (CIE 1976) between two sRGB colours. */
export function deltaE(a: readonly number[], b: readonly number[]): number {
	const [l1, a1, b1] = lab(a);
	const [l2, a2, b2] = lab(b);
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export interface InkScore {
	/** Mean and largest cover on the paper (away from ink and dust). */
	paperMean: number;
	paperMax: number;
	/** Mean cover on the paper in the shadow (lower right). */
	shadowMean: number;
	/** Mean cover in the outermost 4 pixels of the photo. */
	borderMean: number;
	/** Mean cover where each ink fully covers the paper. */
	blueCore: number;
	redCore: number;
	/** ΔE of the mean colour where each ink fully covers. */
	blueCoreDE: number;
	redCoreDE: number;
	/** ΔE of the cover-weighted mean colour at each ink's edge. */
	blueEdgeDE: number;
	redEdgeDE: number;
	/** The share of the signature's middle that stays solid. */
	blueKept: number;
	/** The largest cover where there was dust. */
	dustMax: number;
}

/** How a result from `photo` scores. Covers are 0 to 1. */
export function score(photo: InkPhoto, out: Uint8ClampedArray): InkScore {
	const { width: w, height: h, blue, red, dust } = photo;
	const near = new Uint8Array(w * h);
	const margin = 3;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const k = y * w + x;
			if (!(blue[k] > 0 || red[k] > 0 || dust[k])) continue;
			for (
				let yy = Math.max(0, y - margin);
				yy <= Math.min(h - 1, y + margin);
				yy++
			)
				for (
					let xx = Math.max(0, x - margin);
					xx <= Math.min(w - 1, x + margin);
					xx++
				)
					near[yy * w + xx] = 1;
		}
	let paperSum = 0;
	let paperN = 0;
	let paperMax = 0;
	let shadowSum = 0;
	let shadowN = 0;
	let borderSum = 0;
	let borderN = 0;
	let dustMax = 0;
	const core = { blue: [0, 0, 0, 0, 0], red: [0, 0, 0, 0, 0] };
	const edge = { blue: [0, 0, 0, 0], red: [0, 0, 0, 0] };
	let blueMid = 0;
	let blueSolid = 0;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const k = y * w + x;
			const a = out[k * 4 + 3] / 255;
			if (dust[k]) dustMax = Math.max(dustMax, a);
			if (!near[k]) {
				paperSum += a;
				paperN++;
				paperMax = Math.max(paperMax, a);
				if (x > 0.65 * w && y > 0.7 * h) {
					shadowSum += a;
					shadowN++;
				}
				if (x < 4 || y < 4 || x >= w - 4 || y >= h - 4) {
					borderSum += a;
					borderN++;
				}
			}
			for (const [name, map] of [
				["blue", blue],
				["red", red],
			] as const) {
				const other = name === "blue" ? red : blue;
				if (other[k] > 0) continue;
				const c = map[k];
				if (c >= 0.99) {
					const acc = core[name];
					acc[0] += a;
					acc[1]++;
					acc[2] += out[k * 4] * a;
					acc[3] += out[k * 4 + 1] * a;
					acc[4] += out[k * 4 + 2] * a;
				} else if (c > 0.2) {
					const acc = edge[name];
					acc[0] += out[k * 4] * a;
					acc[1] += out[k * 4 + 1] * a;
					acc[2] += out[k * 4 + 2] * a;
					acc[3] += a;
				}
			}
			if (blue[k] >= 0.99) {
				blueMid++;
				if (a > 0.5) blueSolid++;
			}
		}
	const mean = (acc: number[], at: number, weight: number) => [
		acc[at] / weight,
		acc[at + 1] / weight,
		acc[at + 2] / weight,
	];
	return {
		paperMean: paperSum / paperN,
		paperMax,
		shadowMean: shadowSum / Math.max(1, shadowN),
		borderMean: borderSum / Math.max(1, borderN),
		blueCore: core.blue[0] / core.blue[1],
		redCore: core.red[0] / core.red[1],
		blueCoreDE: deltaE(mean(core.blue, 2, core.blue[0]), BLUE),
		redCoreDE: deltaE(mean(core.red, 2, core.red[0]), RED),
		blueEdgeDE: deltaE(mean(edge.blue, 0, edge.blue[3]), BLUE),
		redEdgeDE: deltaE(mean(edge.red, 0, edge.red[3]), RED),
		blueKept: blueSolid / blueMid,
		dustMax,
	};
}
