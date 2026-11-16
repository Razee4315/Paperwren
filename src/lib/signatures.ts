/**
 * Signatures the reader made, kept on this device so the next form is
 * signed in a tap. Each is a PNG with a clear background, as a data
 * URL, with its size. Nothing leaves the device.
 */

import {
	type InkOptions,
	type PixelImage,
	type ReadPhoto,
	inkFromPhoto,
	oneInk,
	readPhoto,
} from "./inkFromPhoto";
import { createStoredValue } from "./storedValue";

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

/** Each list is read once, and every change is made to it as it is in
 * the store then (another window may have kept one meanwhile), one
 * change at a time. A change that cannot be written is said, and kept
 * to be tried again. */
const kept = {
	[SIGNATURES_KEY]: createStoredValue<Signature[]>({
		key: SIGNATURES_KEY,
		initial: [],
		normalize: normalizeSignatures,
		shared: true,
	}),
	[STAMPS_KEY]: createStoredValue<Signature[]>({
		key: STAMPS_KEY,
		initial: [],
		normalize: normalizeSignatures,
		shared: true,
	}),
};
type KeptKey = keyof typeof kept;

async function loadKept(key: KeptKey): Promise<Signature[]> {
	const list = kept[key];
	await list.load();
	// What another window kept since.
	list.refresh();
	await list.flush();
	return list.value.get();
}

async function keep(key: KeptKey, picture: Signature): Promise<Signature[]> {
	const list = kept[key];
	await list.load();
	list.edit((was) =>
		[picture, ...was.filter((s) => s.src !== picture.src)].slice(
			0,
			MAX_SIGNATURES,
		),
	);
	await list.flush();
	return list.value.get();
}

async function forget(key: KeptKey, id: string): Promise<Signature[]> {
	const list = kept[key];
	await list.load();
	list.edit((was) => was.filter((s) => s.id !== id));
	await list.flush();
	return list.value.get();
}

/** Forget every one of a kind (Settings). Returns them, for Undo;
 * rejects when that could not be kept (nothing is forgotten then). */
async function forgetAll(key: KeptKey): Promise<Signature[]> {
	let previous: Signature[] = [];
	await kept[key].commit((was) => {
		previous = was;
		return [];
	});
	return previous;
}

/** Put back what forgetAll took a moment ago. */
async function restore(key: KeptKey, previous: Signature[]) {
	await kept[key].commit((was) =>
		[...was, ...previous.filter((s) => !was.some((w) => w.id === s.id))].slice(
			0,
			MAX_SIGNATURES,
		),
	);
}

export const loadSignatures = () => loadKept(SIGNATURES_KEY);
export const keepSignature = (signature: Signature) =>
	keep(SIGNATURES_KEY, signature);
export const forgetSignature = (id: string) => forget(SIGNATURES_KEY, id);
export const forgetAllSignatures = () => forgetAll(SIGNATURES_KEY);
export const restoreSignatures = (previous: Signature[]) =>
	restore(SIGNATURES_KEY, previous);

export const loadStamps = () => loadKept(STAMPS_KEY);
export const keepStamp = (stamp: Signature) => keep(STAMPS_KEY, stamp);
export const forgetStamp = (id: string) => forget(STAMPS_KEY, id);
export const forgetAllStamps = () => forgetAll(STAMPS_KEY);
export const restoreStamps = (previous: Signature[]) =>
	restore(STAMPS_KEY, previous);

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

/** A picture of a signature or a stamp, ready to be made into ink: a
 * PNG made with a clear background as it is, a photo or a scan read
 * against its paper (which is slow, so it is done once). */
export function readPicture(image: PixelImage): PixelImage | ReadPhoto {
	return clearShare(image.data) >= 0.01 ? image : readPhoto(image);
}

/**
 * A picture of a signature or a stamp, made ready to place, as a new
 * picture: one already on a clear background (a PNG made for it) is
 * kept as it is; a photo or a scan has its paper made clear. With one
 * ink, every mark takes that colour.
 */
export function inkFromPicture(
	picture: PixelImage | ReadPhoto,
	options: InkOptions = {},
): PixelImage {
	if ("amount" in picture || clearShare(picture.data) < 0.01)
		return inkFromPhoto(picture, options);
	const data = new Uint8ClampedArray(picture.data);
	if (options.ink) oneInk(data, options.ink);
	return { data, width: picture.width, height: picture.height };
}

/** The bytes of a PNG data URL. */
export function pngBytes(src: string): Uint8Array {
	const raw = atob(src.slice(src.indexOf(",") + 1));
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}
