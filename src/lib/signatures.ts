/**
 * Signatures the reader made, kept on this device so the next form is
 * signed in a tap. Each is a PNG with a clear background, as a data
 * URL, with its size. Nothing leaves the device.
 */

import { backend } from "./backend";

export interface Signature {
	id: string;
	/** "image/png" data URL. */
	src: string;
	/** Its size in pixels, for its shape. */
	w: number;
	h: number;
	/** Initials rather than a whole signature. */
	initials?: boolean;
}

export const SIGNATURES_KEY = "signatures_v1";
/** Stamps are kept the same way, apart from signatures. */
export const STAMPS_KEY = "stamps_v1";
/** How many are kept: the newest first. */
export const MAX_SIGNATURES = 6;
/** Larger ones are not kept (a photo that was never trimmed). */
export const MAX_SRC = 400_000;

export function normalizeSignatures(raw: unknown): Signature[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter(
			(s): s is Signature =>
				!!s &&
				typeof s.id === "string" &&
				typeof s.src === "string" &&
				s.src.startsWith("data:image/png;base64,") &&
				s.src.length <= MAX_SRC &&
				Number.isFinite(s.w) &&
				Number.isFinite(s.h) &&
				s.w > 0 &&
				s.h > 0,
		)
		.map((s) => ({ ...s, initials: s.initials === true || undefined }))
		.slice(0, MAX_SIGNATURES);
}

async function loadKept(key: string): Promise<Signature[]> {
	return normalizeSignatures(await backend.storeGet(key).catch(() => null));
}

async function keep(key: string, picture: Signature): Promise<Signature[]> {
	const list = [
		picture,
		...(await loadKept(key)).filter((s) => s.src !== picture.src),
	].slice(0, MAX_SIGNATURES);
	await backend.storeSet(key, list).catch(() => {});
	return list;
}

async function forget(key: string, id: string): Promise<Signature[]> {
	const list = (await loadKept(key)).filter((s) => s.id !== id);
	await backend.storeSet(key, list).catch(() => {});
	return list;
}

export const loadSignatures = () => loadKept(SIGNATURES_KEY);
export const keepSignature = (signature: Signature) =>
	keep(SIGNATURES_KEY, signature);
export const forgetSignature = (id: string) => forget(SIGNATURES_KEY, id);

export const loadStamps = () => loadKept(STAMPS_KEY);
export const keepStamp = (stamp: Signature) => keep(STAMPS_KEY, stamp);
export const forgetStamp = (id: string) => forget(STAMPS_KEY, id);

/** The smallest box around what is drawn (alpha above a trace), with
 * a little room, or null when nothing is. */
export function inkBounds(
	data: Uint8ClampedArray,
	width: number,
	height: number,
	pad = 6,
): { x: number; y: number; w: number; h: number } | null {
	let x0 = width;
	let y0 = height;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			if (data[(y * width + x) * 4 + 3] > 16) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
	if (x1 < 0) return null;
	const x = Math.max(0, x0 - pad);
	const y = Math.max(0, y0 - pad);
	return {
		x,
		y,
		w: Math.min(width, x1 + pad + 1) - x,
		h: Math.min(height, y1 + pad + 1) - y,
	};
}

/** The share of a picture that is see-through: a PNG made with a clear
 * background has much of it, a photo has none. */
export function clearShare(data: Uint8ClampedArray): number {
	let clear = 0;
	for (let i = 3; i < data.length; i += 4) if (data[i] < 250) clear++;
	return data.length ? clear / (data.length / 4) : 0;
}

/**
 * A photo of a signature on paper, made into ink on nothing: the paper
 * (light, low in colour) turns clear, the ink keeps its colour and
 * grows more solid the darker it is. Works in place on RGBA pixels.
 * A picture with no light paper in it is left as it is. `depth` moves
 * the line between paper and ink: above 0 more of the page counts as
 * ink (a faint pen), below 0 less (a shadow on the paper).
 */
export function inkFromPaper(data: Uint8ClampedArray, depth = 0): void {
	// The paper's brightness: the brightest tenth of what is solid. Clear
	// pixels read as black, so they would pass for dark paper.
	const levels = new Uint32Array(256);
	let solidCount = 0;
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 250) continue;
		levels[Math.round((data[i] + data[i + 1] + data[i + 2]) / 3)]++;
		solidCount++;
	}
	let seen = 0;
	let paper = 255;
	const top = solidCount / 10;
	for (let v = 255; v >= 0; v--) {
		seen += levels[v];
		if (seen >= top) {
			paper = v;
			break;
		}
	}
	if (!solidCount || paper < 96) return;
	const clear = paper * (0.86 + depth * 0.12);
	const solid = paper * (0.45 + depth * 0.25);
	for (let i = 0; i < data.length; i += 4) {
		const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
		const ink = v >= clear ? 0 : v <= solid ? 1 : (clear - v) / (clear - solid);
		data[i + 3] = Math.round(data[i + 3] * ink);
	}
}

/**
 * A picture of a signature or a stamp, made ready to place: one already
 * on a clear background (a PNG made for it) is kept as it is; a photo or
 * a scan has its paper made clear.
 */
export function inkFromPicture(data: Uint8ClampedArray, depth = 0): void {
	if (clearShare(data) >= 0.01) return;
	inkFromPaper(data, depth);
}

/** The bytes of a PNG data URL. */
export function pngBytes(src: string): Uint8Array {
	const raw = atob(src.slice(src.indexOf(",") + 1));
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}
