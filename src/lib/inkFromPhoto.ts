/**
 * A photo of a signature or a stamp on paper, made into ink on nothing.
 *
 * The paper is found where it is, in light and in shadow: the photo is
 * cut into cells and each cell's brightest pixels are its paper. Every
 * pixel is then read against the paper under it, which also takes away
 * the paper's yellow. What is dark or coloured there is ink; the rest
 * turns clear. A pixel at an ink's edge is part ink and part paper: it
 * takes the colour of the ink beside it and only as much cover as the
 * ink in it, so no paper colour is left round the strokes. Specks far
 * from the ink are dropped.
 */

export interface PixelImage {
	data: Uint8ClampedArray;
	width: number;
	height: number;
}

export interface InkOptions {
	/** From -1 to 1: above 0 more counts as ink (a faint pen), below 0
	 * less (a shadow, a grain in the paper). */
	depth?: number;
	/** One ink: every mark takes this colour, keeping how solid it is.
	 * Without it the ink keeps its own colours. */
	ink?: readonly [number, number, number] | null;
}

/** A cell of the paper map, in pixels. */
const CELL = 32;
/** The share of a cell's pixels that are brighter than its paper. */
const BRIGHT = 0.1;
/** A cell this much darker than the paper round it is under ink. */
const UNDER_INK = 0.8;
/** Specks smaller than this share of the photo, far from ink, go. */
const SPECK = 0.0002;
/** How near a small mark must be to the ink to stay, as a share of the
 * photo's longer side. */
const NEAR = 0.02;

/** "#1a3c8c" as red, green and blue; null when it isn't a colour. */
export function inkRgb(colour: string): [number, number, number] | null {
	const m = /^#([0-9a-f]{6})$/i.exec(colour);
	if (!m) return null;
	const n = Number.parseInt(m[1], 16);
	return [n >> 16, (n >> 8) & 255, n & 255];
}

/** Every mark in the colour given, keeping how solid it is. In place. */
export function oneInk(
	data: Uint8ClampedArray,
	ink: readonly [number, number, number],
): void {
	for (let p = 0; p < data.length; p += 4) {
		if (!data[p + 3]) continue;
		data[p] = ink[0];
		data[p + 1] = ink[1];
		data[p + 2] = ink[2];
	}
}

/**
 * The paper's colour across the photo, one value a channel for each
 * cell, or null when there is no light paper in it at all. Cells under
 * ink take the paper round them.
 */
function paperCells(
	src: Uint8ClampedArray,
	w: number,
	h: number,
	gw: number,
	gh: number,
): Float32Array | null {
	const cells = new Float32Array(gw * gh * 3);
	const missing = new Uint8Array(gw * gh);
	const hist = new Uint32Array(768);
	for (let gy = 0; gy < gh; gy++)
		for (let gx = 0; gx < gw; gx++) {
			hist.fill(0);
			let count = 0;
			const x1 = Math.min(w, gx * CELL + CELL);
			const y1 = Math.min(h, gy * CELL + CELL);
			// Every other pixel each way is enough to find the paper.
			for (let y = gy * CELL; y < y1; y += 2)
				for (
					let p = (y * w + gx * CELL) * 4, end = (y * w + x1) * 4;
					p < end;
					p += 8
				) {
					// Clear pixels read as black: they are not paper.
					if (src[p + 3] < 250) continue;
					hist[src[p]]++;
					hist[256 + src[p + 1]]++;
					hist[512 + src[p + 2]]++;
					count++;
				}
			const cell = gy * gw + gx;
			if (count < 4) {
				missing[cell] = 1;
				continue;
			}
			const top = Math.max(1, Math.round(count * BRIGHT));
			for (let c = 0; c < 3; c++) {
				let seen = 0;
				let v = 255;
				for (; v > 0; v--) {
					seen += hist[c * 256 + v];
					if (seen >= top) break;
				}
				cells[cell * 3 + c] = v;
			}
		}

	// The light paper of the photo as a whole: none, and it is left alone.
	const lums: number[] = [];
	for (let i = 0; i < gw * gh; i++)
		if (!missing[i])
			lums.push((cells[i * 3] + cells[i * 3 + 1] + cells[i * 3 + 2]) / 3);
	if (!lums.length) return null;
	lums.sort((a, b) => a - b);
	if (lums[Math.floor(lums.length * 0.9)] < 96) return null;

	// Cells under a broad mark (a filled logo, bold words) read darker
	// than the paper round them: a closing (the brightest near, then the
	// darkest of those) finds the paper there. Gentle shade is kept.
	const brightest = maxMin(cells, missing, gw, gh, 2, true);
	const closed = maxMin(brightest, null, gw, gh, 2, false);
	for (let i = 0; i < gw * gh; i++) {
		let under = missing[i] === 1;
		for (let c = 0; c < 3 && !under; c++)
			if (cells[i * 3 + c] < closed[i * 3 + c] * UNDER_INK) under = true;
		if (under) for (let c = 0; c < 3; c++) cells[i * 3 + c] = closed[i * 3 + c];
	}
	// A cell with no paper near it at all takes the photo's own.
	const fallback = lums[Math.floor(lums.length * 0.9)];
	for (let i = 0; i < cells.length; i++)
		if (!(cells[i] > 0)) cells[i] = fallback;
	return blur(cells, gw, gh);
}

/** The brightest (or darkest) value within `r` cells, a channel at a
 * time; missing cells are passed over. */
function maxMin(
	cells: Float32Array,
	missing: Uint8Array | null,
	gw: number,
	gh: number,
	r: number,
	max: boolean,
): Float32Array {
	const pick = max ? Math.max : Math.min;
	const start = max ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
	const across = new Float32Array(cells.length);
	for (let gy = 0; gy < gh; gy++)
		for (let gx = 0; gx < gw; gx++)
			for (let c = 0; c < 3; c++) {
				let v = start;
				for (let x = Math.max(0, gx - r); x <= Math.min(gw - 1, gx + r); x++) {
					const i = gy * gw + x;
					if (!missing?.[i]) v = pick(v, cells[i * 3 + c]);
				}
				across[(gy * gw + gx) * 3 + c] = v;
			}
	const out = new Float32Array(cells.length);
	for (let gy = 0; gy < gh; gy++)
		for (let gx = 0; gx < gw; gx++)
			for (let c = 0; c < 3; c++) {
				let v = start;
				for (let y = Math.max(0, gy - r); y <= Math.min(gh - 1, gy + r); y++)
					v = pick(v, across[(y * gw + gx) * 3 + c]);
				out[(gy * gw + gx) * 3 + c] = v;
			}
	return out;
}

/** The cells softened with their neighbours (1-2-1 each way). */
function blur(cells: Float32Array, gw: number, gh: number): Float32Array {
	const across = new Float32Array(cells.length);
	for (let gy = 0; gy < gh; gy++)
		for (let gx = 0; gx < gw; gx++)
			for (let c = 0; c < 3; c++) {
				const at = (x: number) => cells[(gy * gw + x) * 3 + c];
				across[(gy * gw + gx) * 3 + c] =
					(at(Math.max(0, gx - 1)) +
						2 * at(gx) +
						at(Math.min(gw - 1, gx + 1))) /
					4;
			}
	const out = new Float32Array(cells.length);
	for (let gy = 0; gy < gh; gy++)
		for (let gx = 0; gx < gw; gx++)
			for (let c = 0; c < 3; c++) {
				const at = (y: number) => across[(y * gw + gx) * 3 + c];
				out[(gy * gw + gx) * 3 + c] =
					(at(Math.max(0, gy - 1)) +
						2 * at(gy) +
						at(Math.min(gh - 1, gy + 1))) /
					4;
			}
	return out;
}

/** For each pixel along one side, the cell before it and how far it is
 * towards the next one, between the cells' middles. */
function spans(size: number, cells: number) {
	const lower = new Int32Array(size);
	const toward = new Float32Array(size);
	const middle = (i: number) =>
		(i * CELL + Math.min(size, i * CELL + CELL)) / 2;
	for (let x = 0; x < size; x++) {
		const at = x + 0.5;
		let i = Math.min(cells - 1, Math.max(0, Math.floor(at / CELL - 0.5)));
		if (i + 1 < cells && at > middle(i + 1)) i++;
		lower[x] = i;
		if (i + 1 >= cells || at <= middle(i)) toward[x] = 0;
		else toward[x] = (at - middle(i)) / (middle(i + 1) - middle(i));
	}
	return { lower, toward };
}

/** A photo read against its paper: what does not change with Lighter
 * and Darker, worked out once. */
export interface ReadPhoto {
	image: PixelImage;
	/** Each pixel's colour with the paper under it as white, or null when
	 * the photo has no light paper. */
	norm: Uint8Array | null;
	/** How much ink each pixel holds: the more of how dark and how
	 * colourful it is against the paper, 0 to 255. */
	amount: Uint8Array;
}

/** Read each pixel of a photo against the paper under it. */
export function readPhoto(image: PixelImage): ReadPhoto {
	const { width: w, height: h, data: src } = image;
	const n = w * h;
	const gw = Math.ceil(w / CELL);
	const gh = Math.ceil(h / CELL);
	const paper = n ? paperCells(src, w, h, gw, gh) : null;
	const amount = new Uint8Array(paper ? n : 0);
	if (!paper) return { image, norm: null, amount };
	for (let i = 0; i < paper.length; i++) paper[i] = 1 / Math.max(1, paper[i]);
	const norm = new Uint8Array(n * 3);
	const { lower: xl, toward: xt } = spans(w, gw);
	const { lower: yl, toward: yt } = spans(h, gh);
	const row = new Float32Array(gw * 3);
	for (let y = 0; y < h; y++) {
		const g0 = yl[y] * gw * 3;
		const g1 = Math.min(gh - 1, yl[y] + 1) * gw * 3;
		const fy = yt[y];
		for (let i = 0; i < gw * 3; i++)
			row[i] = paper[g0 + i] + (paper[g1 + i] - paper[g0 + i]) * fy;
		for (let x = 0, k = y * w; x < w; x++, k++) {
			const p = k * 4;
			const c0 = xl[x] * 3;
			const c1 = xl[x] + 1 < gw ? c0 + 3 : c0;
			const fx = xt[x];
			let r = src[p] * (row[c0] + (row[c1] - row[c0]) * fx);
			let g = src[p + 1] * (row[c0 + 1] + (row[c1 + 1] - row[c0 + 1]) * fx);
			let b = src[p + 2] * (row[c0 + 2] + (row[c1 + 2] - row[c0 + 2]) * fx);
			if (r > 1) r = 1;
			if (g > 1) g = 1;
			if (b > 1) b = 1;
			const dark = 1 - (0.299 * r + 0.587 * g + 0.114 * b);
			const top = r > g ? (r > b ? r : b) : g > b ? g : b;
			const low = r < g ? (r < b ? r : b) : g < b ? g : b;
			const v = dark > top - low ? dark : top - low;
			const q = k * 3;
			norm[q] = r * 255 + 0.5;
			norm[q + 1] = g * 255 + 0.5;
			norm[q + 2] = b * 255 + 0.5;
			amount[k] = v * 255 + 0.5;
		}
	}
	return { image, norm, amount };
}

/**
 * A photo of a signature or a stamp on paper, made into ink on a clear
 * background: a new picture, the one given is not changed. A picture
 * with no light paper in it comes back as it was. Pass a photo already
 * read (readPhoto) to try Lighter and Darker without reading it again.
 */
export function inkFromPhoto(
	photo: PixelImage | ReadPhoto,
	{ depth = 0, ink = null }: InkOptions = {},
): PixelImage {
	const read = "amount" in photo ? photo : readPhoto(photo);
	const { norm, amount } = read;
	const { width: w, height: h, data: src } = read.image;
	if (!norm) return { data: new Uint8ClampedArray(src), width: w, height: h };
	const n = w * h;
	const out = new Uint8ClampedArray(n * 4);

	// The levels between paper and ink, moved by Lighter and Darker. Paper
	// stays clear; ink takes its colour against white paper.
	const d = Math.max(-1, Math.min(1, depth));
	const lo = (0.14 - 0.08 * d) * 255;
	const hi = (0.38 - 0.16 * d) * 255;
	for (let k = 0, p = 0; k < n; k++, p += 4) {
		const v = amount[k];
		if (v <= lo || !src[p + 3]) continue;
		const t = v >= hi ? 1 : (v - lo) / (hi - lo);
		out[p] = norm[k * 3];
		out[p + 1] = norm[k * 3 + 1];
		out[p + 2] = norm[k * 3 + 2];
		out[p + 3] = t * t * (3 - 2 * t) * src[p + 3] + 0.5;
	}

	// Darker also lets an edge pixel read more solid, Lighter less.
	const on = unmixEdges(out, norm, amount, w, h, 1 + 0.5 * d);
	despeckle(out, on, w, h);
	trimHalo(out, on, w, h);
	if (ink) oneInk(out, ink);
	return { data: out, width: w, height: h };
}

/**
 * A pixel at an ink's edge holds ink and paper. Its colour is the ink
 * beside it (the most inky pixel within two) and its cover is how much
 * of that ink it holds, never more than it read as before. With no ink
 * beside it, the paper is taken out of its own colour.
 */
function unmixEdges(
	out: Uint8ClampedArray,
	norm: Uint8Array,
	amount: Uint8Array,
	w: number,
	h: number,
	boost: number,
): Uint8Array {
	const on = new Uint8Array(w * h);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const k = y * w + x;
			const p = k * 4;
			const a = out[p + 3];
			if (a === 0) continue;
			on[k] = 1;
			let best = -1;
			let most = amount[k];
			for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++)
				for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
					const j = yy * w + xx;
					if (amount[j] > most) {
						most = amount[j];
						best = j;
					}
				}
			const qr = 255 - norm[k * 3];
			const qg = 255 - norm[k * 3 + 1];
			const qb = 255 - norm[k * 3 + 2];
			if (best >= 0 && amount[best] >= amount[k] + 16) {
				// Paper is white here: the pixel is 1 - cover * (1 - ink).
				const ir = 255 - norm[best * 3];
				const ig = 255 - norm[best * 3 + 1];
				const ib = 255 - norm[best * 3 + 2];
				const cover =
					(qr * ir + qg * ig + qb * ib) /
					Math.max(1, ir * ir + ig * ig + ib * ib);
				const solid = Math.min(a, Math.max(0, cover * boost) * 255 + 0.5);
				if (solid < 1) {
					clear(out, p);
					on[k] = 0;
					continue;
				}
				out[p + 3] = solid;
				out[p] = norm[best * 3];
				out[p + 1] = norm[best * 3 + 1];
				out[p + 2] = norm[best * 3 + 2];
			} else if (a < 255) {
				// ink = (pixel - (1 - a) * paper) / a, with white paper.
				const f = 255 / a;
				out[p] = 255 - qr * f;
				out[p + 1] = 255 - qg * f;
				out[p + 2] = 255 - qb * f;
			}
		}
	return on;
}

/** A pixel made clear, colour and all. */
function clear(out: Uint8ClampedArray, p: number) {
	out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
}

/** Pixels that touch, one mark each: its number for every pixel (0 for
 * none) and each mark's size. */
function marks(on: Uint8Array, w: number, h: number) {
	const label = new Int32Array(w * h);
	const sizes = [0];
	const stack = new Int32Array(w * h);
	for (let start = 0; start < w * h; start++) {
		if (!on[start] || label[start]) continue;
		const id = sizes.length;
		let size = 0;
		let top = 0;
		stack[top++] = start;
		label[start] = id;
		while (top) {
			const k = stack[--top];
			size++;
			const x = k % w;
			const left = x > 0 ? -1 : 0;
			const right = x < w - 1 ? 1 : 0;
			const up = k >= w ? -w : 0;
			const down = k < w * h - w ? w : 0;
			for (let dy = up; dy <= down; dy += w)
				for (let dx = left; dx <= right; dx++) {
					const j = k + dy + dx;
					if (on[j] && !label[j]) {
						label[j] = id;
						stack[top++] = j;
					}
				}
		}
		sizes.push(size);
	}
	return { label, sizes };
}

/**
 * Small marks far from the ink (dust, a grain in the paper) are made
 * clear. A small mark near the ink, or near another small mark that is
 * near it (a dot over an i, the letters inside a stamp), stays.
 */
function despeckle(
	out: Uint8ClampedArray,
	on: Uint8Array,
	w: number,
	h: number,
): void {
	const n = w * h;
	const { label, sizes } = marks(on, w, h);
	const least = Math.max(4, Math.round(n * SPECK));
	if (!sizes.some((size) => size >= least)) return;
	if (sizes.every((size, i) => i === 0 || size >= least)) return;
	// Nearness is judged on blocks of that size: marks in blocks that
	// touch are one group, and a group holding a large mark is ink.
	const block = Math.max(4, Math.round(Math.max(w, h) * NEAR));
	const bw = Math.ceil(w / block);
	const bh = Math.ceil(h / block);
	const column = new Int32Array(w);
	for (let x = 0; x < w; x++) column[x] = (x / block) | 0;
	const blocks = new Uint8Array(bw * bh);
	const big = new Uint8Array(bw * bh);
	for (let y = 0, k = 0; y < h; y++) {
		const b0 = ((y / block) | 0) * bw;
		for (let x = 0; x < w; x++, k++) {
			const id = label[k];
			if (!id) continue;
			blocks[b0 + column[x]] = 1;
			if (sizes[id] >= least) big[b0 + column[x]] = 1;
		}
	}
	const groups = marks(blocks, bw, bh);
	const inked = new Uint8Array(groups.sizes.length);
	for (let b = 0; b < bw * bh; b++) if (big[b]) inked[groups.label[b]] = 1;
	for (let y = 0, k = 0; y < h; y++) {
		const b0 = ((y / block) | 0) * bw;
		for (let x = 0; x < w; x++, k++) {
			const id = label[k];
			if (!id || sizes[id] >= least || inked[groups.label[b0 + column[x]]])
				continue;
			clear(out, k * 4);
			on[k] = 0;
		}
	}
}

/** The faint edge round the ink, a pixel wide, is thinned: an edge
 * pixel's cover is squared, so faint ones go and solid ones stay. */
function trimHalo(
	out: Uint8ClampedArray,
	on: Uint8Array,
	w: number,
	h: number,
): void {
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const k = y * w + x;
			if (!on[k]) continue;
			const p = k * 4;
			const a = out[p + 3];
			if (a === 255) continue;
			const edge =
				(x > 0 && !on[k - 1]) ||
				(x < w - 1 && !on[k + 1]) ||
				(y > 0 && !on[k - w]) ||
				(y < h - 1 && !on[k + w]);
			if (!edge) continue;
			const thinned = (a * a) / 255 + 0.5;
			if (thinned < 1) clear(out, p);
			else out[p + 3] = thinned;
		}
}
