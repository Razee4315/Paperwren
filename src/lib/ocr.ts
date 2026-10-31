/**
 * Reading the words off a picture of a page, on the device: Tesseract,
 * compiled to WebAssembly, runs in a worker of its own and reads the
 * language files that ship with the app. Nothing is fetched from
 * anywhere else.
 */

import { startsRtl } from "./bidi";
import type { Language } from "./i18n";
import type { ReadWord } from "./pdfTools";

/** Tesseract's name for each language the app speaks. */
export const OCR_NAMES: Record<Language, string> = {
	en: "eng",
	ur: "urd",
	ar: "ara",
	zh: "chi_sim",
	hi: "hin",
	es: "spa",
	fr: "fra",
	ru: "rus",
	pt: "por",
};

/** Below this Tesseract is guessing, usually at a picture or a stain. */
const LEAST_SURE = 30;
/** Below this a word is worth a second look. */
export const DOUBTFUL = 65;

const PARAGRAPH = 3;
const LINE = 4;
const WORD = 5;

/** A line of a page, as read: its words, its box and where it falls. */
export interface ReadLine {
	text: string;
	words: ReadWord[];
	x: number;
	y: number;
	w: number;
	h: number;
	/** It starts a paragraph. */
	opens: boolean;
}

/** The box around some words. */
function around(words: ReadWord[]) {
	const x = Math.min(...words.map((w) => w.x));
	const y = Math.min(...words.map((w) => w.y));
	return {
		x,
		y,
		w: Math.max(...words.map((w) => w.x + w.w)) - x,
		h: Math.max(...words.map((w) => w.y + w.h)) - y,
	};
}

/**
 * The lines of Tesseract's table of results, in reading order, as
 * fractions of the picture it was given. Each word takes the height of
 * its line, so a selection runs level across the words.
 */
export function linesOfTable(
	table: string,
	width: number,
	height: number,
): ReadLine[] {
	const lines: ReadLine[] = [];
	let top = 0;
	let tall = 0;
	let words: ReadWord[] = [];
	let opens = true;
	let nextOpens = true;
	const end = () => {
		if (words.length)
			lines.push({
				text: words.map((w) => w.text).join(" "),
				words,
				opens,
				...around(words),
			});
		words = [];
	};
	for (const row of table.split("\n")) {
		const cells = row.split("\t");
		if (cells.length < 12) continue;
		const level = Number(cells[0]);
		const [left, up, wide, high] = cells.slice(6, 10).map(Number);
		if (level === PARAGRAPH) {
			end();
			nextOpens = true;
		} else if (level === LINE) {
			end();
			opens = nextOpens;
			nextOpens = false;
			top = up;
			tall = high;
		}
		const text = cells.slice(11).join("\t").trim();
		const sure = Number(cells[10]);
		if (level !== WORD || !text || sure < LEAST_SURE) continue;
		words.push({
			text,
			x: left / width,
			y: top / height,
			w: wide / width,
			h: tall / height,
			rtl: startsRtl(text),
			sure: Math.round(sure),
		});
	}
	end();
	return lines;
}

/** Lines as plain text, a blank line between paragraphs. */
export function textOfLines(lines: Array<Pick<ReadLine, "text" | "opens">>) {
	let text = "";
	lines.forEach((line, i) => {
		if (i) text += line.opens ? "\n\n" : "\n";
		text += line.text;
	});
	return text;
}

/** The words in Tesseract's table of results, in reading order. */
export function wordsOfTable(
	table: string,
	width: number,
	height: number,
): ReadWord[] {
	return linesOfTable(table, width, height).flatMap((line) => line.words);
}

/** Enough of a page's own text that it is not just a scan with a line
 * printed on it, such as the mark the scanner leaves at the foot. */
const HAS_WORDS = 64;

/** True for a page that already has words of its own to search. */
export function hasOwnText(items: Array<{ str?: string }>): boolean {
	let found = 0;
	for (const item of items) found += item.str?.trim().length ?? 0;
	return found >= HAS_WORDS;
}

/** A box blur of a picture of `width` by `height`, each pixel the mean
 * of those within `reach` of it. */
function blurred(
	grey: Float32Array,
	width: number,
	height: number,
	reach: number,
) {
	const across = new Float32Array(grey.length);
	for (let y = 0; y < height; y++) {
		const row = y * width;
		let sum = 0;
		let count = 0;
		for (let x = 0; x <= Math.min(reach, width - 1); x++) {
			sum += grey[row + x];
			count++;
		}
		for (let x = 0; x < width; x++) {
			across[row + x] = sum / count;
			if (x + reach + 1 < width) {
				sum += grey[row + x + reach + 1];
				count++;
			}
			if (x - reach >= 0) {
				sum -= grey[row + x - reach];
				count--;
			}
		}
	}
	const out = new Float32Array(grey.length);
	for (let x = 0; x < width; x++) {
		let sum = 0;
		let count = 0;
		for (let y = 0; y <= Math.min(reach, height - 1); y++) {
			sum += across[y * width + x];
			count++;
		}
		for (let y = 0; y < height; y++) {
			out[y * width + x] = sum / count;
			if (y + reach + 1 < height) {
				sum += across[(y + reach + 1) * width + x];
				count++;
			}
			if (y - reach >= 0) {
				sum -= across[(y - reach) * width + x];
				count--;
			}
		}
	}
	return out;
}

/** What paper comes to once its shading is gone. */
const PAPER = 235;

/**
 * Black words on white paper, in place: a page in grey with its speckle
 * softened, divided by its own broad shading (a shadow, yellowed paper)
 * and stretched to full contrast. Tesseract gives up on a dim, shaded
 * photograph it reads well after this.
 */
export function cleanPage(
	rgba: Uint8ClampedArray,
	width: number,
	height: number,
) {
	const grey = new Float32Array(width * height);
	for (let i = 0; i < grey.length; i++)
		grey[i] =
			rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114;
	const soft = blurred(grey, width, height, 1);
	const paper = blurred(
		soft,
		width,
		height,
		Math.max(8, Math.round(width / 24)),
	);
	let darkest = PAPER;
	for (let i = 0; i < soft.length; i++) {
		soft[i] = Math.min(PAPER, (soft[i] / Math.max(1, paper[i])) * PAPER);
		darkest = Math.min(darkest, soft[i]);
	}
	const span = Math.max(1, PAPER - darkest);
	for (let i = 0; i < soft.length; i++) {
		const value = ((soft[i] - darkest) / span) * 255;
		rgba[i * 4] = value;
		rgba[i * 4 + 1] = value;
		rgba[i * 4 + 2] = value;
		rgba[i * 4 + 3] = 255;
	}
}

export type OcrRequest =
	| { kind: "start"; language: string; data: ArrayBuffer }
	| { kind: "read"; id: number; picture: Uint8Array };

export type OcrReply =
	| { kind: "ready" }
	| { kind: "read"; id: number; table: string }
	/** How far through the page it is, from 0 to 100. */
	| { kind: "progress"; percent: number }
	| { kind: "failed"; id?: number; message: string };

/** One language's reader, for one document. */
export class OcrReader {
	private worker: Worker | null = null;
	private waiting = new Map<
		number,
		{ done: (table: string) => void; fail: (err: Error) => void }
	>();
	private ready: Promise<void> | null = null;
	private refuse: ((err: Error) => void) | null = null;
	private next = 0;
	private stopped = false;
	private watcher: ((share: number) => void) | null = null;

	constructor(private readonly language: Language) {}

	private start(): Promise<void> {
		this.ready ??= (async () => {
			const name = OCR_NAMES[this.language];
			const url = new URL(`ocr/${name}.traineddata`, document.baseURI);
			const answer = await fetch(url);
			if (!answer.ok) throw new Error("no language file");
			const data = await answer.arrayBuffer();
			if (this.stopped) throw new Error("stopped");
			const worker = new Worker(new URL("./ocrWorker.ts", import.meta.url), {
				type: "module",
			});
			this.worker = worker;
			await new Promise<void>((done, fail) => {
				this.refuse = fail;
				worker.onerror = () => fail(new Error("ocr worker failed"));
				worker.onmessage = ({ data: reply }: MessageEvent<OcrReply>) => {
					if (reply.kind === "ready") done();
					else if (reply.kind === "progress")
						this.watcher?.(reply.percent / 100);
					else if (reply.kind === "failed" && reply.id === undefined)
						fail(new Error(reply.message));
					else if (reply.kind === "read") {
						this.waiting.get(reply.id)?.done(reply.table);
						this.waiting.delete(reply.id);
					} else if (reply.kind === "failed" && reply.id !== undefined) {
						this.waiting.get(reply.id)?.fail(new Error(reply.message));
						this.waiting.delete(reply.id);
					}
				};
				const message: OcrRequest = { kind: "start", language: name, data };
				worker.postMessage(message, [data]);
			});
		})();
		return this.ready;
	}

	/** Tesseract's table of what a picture says. `onProgress` hears how
	 * far through it is, from 0 to 1. */
	async read(
		picture: Uint8Array,
		onProgress?: (share: number) => void,
	): Promise<string> {
		if (this.stopped) throw new Error("stopped");
		await this.start();
		const worker = this.worker;
		if (!worker) throw new Error("stopped");
		const id = ++this.next;
		this.watcher = onProgress ?? null;
		return new Promise((done, fail) => {
			this.waiting.set(id, { done, fail });
			const message: OcrRequest = { kind: "read", id, picture };
			worker.postMessage(message);
		});
	}

	/** Stop at once, even in the middle of a page. */
	stop() {
		const stopped = new Error("stopped");
		this.stopped = true;
		this.worker?.terminate();
		this.worker = null;
		this.refuse?.(stopped);
		for (const { fail } of this.waiting.values()) fail(stopped);
		this.waiting.clear();
	}
}
