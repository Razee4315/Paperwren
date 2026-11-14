/**
 * Compressing a PDF to fit under a size: the search for the best-looking
 * setting that fits, and pages drawn as pictures for a PDF whose text
 * alone is more than the size allows. The search knows nothing of PDFs:
 * it is handed a way to write the file at a setting from 0 (smallest)
 * to 1 (best) and is told how big each one came out.
 */

import type { PDFRef } from "@cantoo/pdf-lib";
import { tidyPdf } from "./pdfLossless";
import { type Recode, open, picturesOf, writePictures } from "./pdfTools";

const lib = () => import("@cantoo/pdf-lib");

/** A moment for the screen between two writes. */
const pause = () => new Promise<void>((done) => setTimeout(done, 0));

/** The most writes one search makes. */
export const MOST_TRIES = 6;

/** What a search found: the largest write that fits (null when even the
 * smallest does not), and the smallest write it made. */
export interface Aim<T> {
	best: T | null;
	/** The setting the best was written at. */
	at: number;
	least: T | null;
	smallest: number;
	tries: number;
}

/**
 * The best setting whose output is no more than `target`, in at most
 * `most` writes. Output grows with the setting, near enough, so the
 * search is a bisection that guesses from the sizes on each side.
 * `from` says which end to try first: the best one, which may fit at
 * once, or the smallest, which may show at once that nothing will.
 */
export async function aimFor<T extends { length: number }>(
	target: number,
	write: (at: number) => Promise<T>,
	{
		most = MOST_TRIES,
		from = "best",
		onTry,
	}: {
		most?: number;
		from?: "best" | "smallest";
		/** Before each write: its number, from 1, and the most there are. */
		onTry?: (n: number, most: number) => void;
	} = {},
): Promise<Aim<T>> {
	let tries = 0;
	const seen = {
		best: null as T | null,
		at: 0,
		least: null as T | null,
		smallest: Number.POSITIVE_INFINITY,
	};
	const attempt = async (at: number) => {
		tries++;
		onTry?.(tries, most);
		const made = await write(at);
		if (made.length < seen.smallest) {
			seen.least = made;
			seen.smallest = made.length;
		}
		if (made.length <= target && made.length > (seen.best?.length ?? -1)) {
			seen.best = made;
			seen.at = at;
		}
		return made.length;
	};
	const done = (): Aim<T> => ({ ...seen, tries });
	// Each end: where it is and how big it came out, once tried.
	let lo = { at: 0, size: -1 };
	let hi = { at: 1, size: -1 };
	for (const end of from === "best" ? [hi, lo] : [lo, hi]) {
		if (tries >= most) return done();
		end.size = await attempt(end.at);
		if (end === hi && end.size <= target) return done();
		if (end === lo && end.size > target) return done();
	}
	while (tries < most && hi.at - lo.at > 0.02) {
		// Near enough the target is as good as on it.
		if ((seen.best?.length ?? 0) >= target * 0.95) break;
		const span = hi.at - lo.at;
		const guess =
			lo.at +
			(span * (target * 0.97 - lo.size)) / Math.max(1, hi.size - lo.size);
		// Never too near either end, so the gap closes even when output
		// does not grow evenly with the setting.
		const at = Math.min(
			hi.at - span * 0.15,
			Math.max(lo.at + span * 0.15, guess),
		);
		const size = await attempt(at);
		if (size <= target) lo = { at, size };
		else hi = { at, size };
	}
	return done();
}

/** A picture kept in the PDF at a setting from 0 to 1: its longest side
 * and its JPEG quality. */
export function pictureSetting(at: number) {
	return {
		side: Math.round(700 + at * 1700),
		quality: Math.round((0.3 + at * 0.55) * 100) / 100,
	};
}

/** A page drawn as a picture at a setting from 0 to 1: dots to the
 * inch, and JPEG quality. */
export function pageSetting(at: number) {
	return {
		dpi: Math.round(50 + at * 150),
		quality: Math.round((0.35 + at * 0.5) * 100) / 100,
	};
}

/** A page drawn as a JPEG (`width` by `height` pixels), for a page of
 * `w` by `h` points. */
export interface DrawnPage {
	bytes: Uint8Array;
	width: number;
	height: number;
	w: number;
	h: number;
}

/**
 * A PDF of pages that are pictures: each page the size the original
 * was shown at, filled by its picture. Nothing on it can be selected or
 * searched any more.
 */
export async function picturePages(pages: DrawnPage[]): Promise<Uint8Array> {
	const {
		PDFDocument,
		concatTransformationMatrix,
		drawObject,
		popGraphicsState,
		pushGraphicsState,
	} = await lib();
	const doc = await PDFDocument.create();
	for (const drawn of pages) {
		// The JPEG as it is, not parsed again: it is the canvas's own.
		const ref: PDFRef = doc.context.register(
			doc.context.stream(drawn.bytes, {
				Type: "XObject",
				Subtype: "Image",
				Width: drawn.width,
				Height: drawn.height,
				ColorSpace: "DeviceRGB",
				BitsPerComponent: 8,
				Filter: "DCTDecode",
			}),
		);
		const page = doc.addPage([drawn.w, drawn.h]);
		const name = page.node.newXObject("Page", ref);
		page.pushOperators(
			pushGraphicsState(),
			concatTransformationMatrix(drawn.w, 0, 0, drawn.h, 0, 0),
			drawObject(name),
			popGraphicsState(),
		);
	}
	return doc.save({ useObjectStreams: true });
}

/** What aiming for a size came to: the file already fits and is left
 * alone; a copy that fits; or the smallest any setting made, which is
 * still too big. */
export type Fitted =
	| { kind: "fits" }
	| { kind: "made"; bytes: Uint8Array; tries: number }
	| { kind: "too big"; smallest: number; tries: number };

/** A size to keep under: what is aimed for, and the most allowed. A
 * limit of "200 KB" aims under 200,000 bytes, so the copy passes a
 * check that counts a kilobyte as a thousand bytes; a copy that misses
 * that but is within 200 × 1024 bytes still counts as fitting, as the
 * app (and most computers) count it. */
export interface SizeLimit {
	aim: number;
	most: number;
}

/** A limit of `n` kilobytes or megabytes. */
export function sizeLimit(n: number, unit: "kb" | "mb"): SizeLimit {
	return unit === "kb"
		? { aim: Math.round(n * 1000), most: Math.round(n * 1024) }
		: { aim: Math.round(n * 1e6), most: Math.round(n * 1024 * 1024) };
}

/** A size as typed: digits (Western, Arabic or Persian), with a point
 * or a comma for a fraction. Null for anything else, or under 1 KB. */
export function parseSize(text: string, unit: "kb" | "mb"): SizeLimit | null {
	const plain = text
		.trim()
		.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660))
		.replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
		.replace(/[,\u066b]/, ".");
	if (!/^\d{1,6}(\.\d{1,3})?$/.test(plain)) return null;
	const n = Number(plain);
	if (unit === "kb" ? n < 1 : n < 0.001) return null;
	return sizeLimit(n, unit);
}

/** The result of a search, against a limit. */
function fitted(aim: Aim<Uint8Array>, limit: SizeLimit): Fitted {
	const made = aim.best ?? (aim.smallest <= limit.most ? aim.least : null);
	return made
		? { kind: "made", bytes: made, tries: aim.tries }
		: { kind: "too big", smallest: aim.smallest, tries: aim.tries };
}

/**
 * A copy within `limit`, with its text kept: the PDF tidied as the
 * lossless choice does, then its pictures stored again at the best
 * setting that fits. `recodeAt` stores a picture at a setting from 0 to
 * 1 (see pictureSetting). A PDF already small enough is not touched.
 */
export async function compressToSize(
	bytes: Uint8Array,
	limit: SizeLimit,
	recodeAt: (at: number) => Recode,
	{
		password,
		onTry,
	}: { password?: string; onTry?: (n: number, most: number) => void } = {},
): Promise<Fitted> {
	if (bytes.length <= limit.aim) return { kind: "fits" };
	const doc = await open(bytes, password);
	await tidyPdf(doc);
	const set = await picturesOf(doc);
	const aim = await aimFor(
		limit.aim,
		async (at) => {
			await pause();
			return writePictures(set, recodeAt(at));
		},
		// With no picture to store again, every setting writes the same.
		{ most: set.found.length ? MOST_TRIES : 1, onTry },
	);
	return fitted(aim, limit);
}

/**
 * A copy within `limit` whose pages are pictures: `draw`
 * draws every page at a setting from 0 to 1 (see pageSetting). The
 * smallest setting is tried first, since a file that needs this is
 * likely to need it small.
 */
export async function picturesToSize(
	limit: SizeLimit,
	draw: (at: number) => Promise<DrawnPage[]>,
	{ onTry }: { onTry?: (n: number, most: number) => void } = {},
): Promise<Fitted> {
	const aim = await aimFor(
		limit.aim,
		async (at) => {
			await pause();
			return picturePages(await draw(at));
		},
		{ from: "smallest", onTry },
	);
	return fitted(aim, limit);
}
