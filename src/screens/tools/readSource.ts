/**
 * What the Read text screen reads from: a PDF's pages or one picture.
 * Either can draw a page and say what words it already has.
 */

import { type ReadLine, hasOwnText } from "@/lib/ocr";
import { drawPage } from "@/lib/pagePicture";
import { type PageTextItem, textLines } from "@/lib/pageText";
import { whole } from "@/screens/viewer/pdfCrop";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** A page as a JPEG. */
export interface PagePicture {
	bytes: Uint8Array;
	width: number;
	height: number;
}

export interface ReadSource {
	name: string;
	pages: number;
	/** The page drawn at a sharpness, from 0. */
	picture: (page: number, dpi: number) => Promise<PagePicture>;
	/** The words a page has of its own, or null for a picture of a page. */
	ownLines: (page: number) => Promise<ReadLine[] | null>;
	/** The PDF's bytes, for a searchable copy. */
	pdf?: () => Promise<Uint8Array>;
	password?: string;
}

/** Sharp enough for Tesseract at the small print of an ordinary page. */
export const READING_DPI = 200;
/** Enough to look at. */
export const LOOKING_DPI = 96;
/** The longest side a picture is read at. */
const MAX_SIDE = 3000;
/** A gap this many lines tall starts a paragraph. */
const PARAGRAPH_GAP = 1.6;

export function pdfSource(
	doc: PDFDocumentProxy,
	name: string,
	password?: string,
): ReadSource {
	return {
		name,
		pages: doc.numPages,
		password,
		pdf: () => doc.getData(),
		picture: async (n, dpi) => {
			const page = await doc.getPage(n + 1);
			const { bytes, width, height } = await drawPage(page, {
				dpi,
				type: "image/jpeg",
				// The whole page, whatever the reader has cropped on screen.
				viewportOf: (params) => whole(page, () => page.getViewport(params)),
			});
			return { bytes, width, height };
		},
		ownLines: async (n) => {
			const page = await doc.getPage(n + 1);
			const { items } = await page.getTextContent();
			if (!hasOwnText(items as Array<{ str?: string }>)) return null;
			const lines = textLines(
				items as PageTextItem[],
				whole(page, () => page.getViewport({ scale: 1 })),
			);
			return lines.map((line, i) => {
				const words = line.runs.map(({ text, x, y, w, h, rtl }) => ({
					text,
					x,
					y,
					w,
					h,
					rtl,
				}));
				const x = Math.min(...words.map((w) => w.x));
				const before = lines[i - 1];
				const tall = line.bottom - line.top;
				return {
					text: line.runs
						.map((run) => run.text)
						.join("")
						.trim(),
					words,
					x,
					y: line.top,
					w: Math.max(...words.map((w) => w.x + w.w)) - x,
					h: tall,
					opens: !before || line.top - before.bottom > tall * PARAGRAPH_GAP,
				};
			});
		},
	};
}

/** One picture, as a page. `image` is what is shown of it already, so
 * every format the app can show can be read. */
export async function pictureSource(
	image: HTMLImageElement | ImageBitmap,
	name: string,
): Promise<ReadSource> {
	const [wide, tall] =
		image instanceof HTMLImageElement
			? [image.naturalWidth, image.naturalHeight]
			: [image.width, image.height];
	const scale = Math.min(1, MAX_SIDE / Math.max(wide, tall));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(wide * scale));
	canvas.height = Math.max(1, Math.round(tall * scale));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no canvas");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
	const blob = await new Promise<Blob | null>((done) =>
		canvas.toBlob(done, "image/jpeg", 0.92),
	);
	if (!blob) throw new Error("no picture");
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const picture = { bytes, width: canvas.width, height: canvas.height };
	return {
		name,
		pages: 1,
		picture: async () => picture,
		ownLines: async () => null,
	};
}

/** A picture's bytes as something to read from. */
export async function bytesSource(
	bytes: Uint8Array,
	name: string,
): Promise<ReadSource> {
	const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
	try {
		return await pictureSource(bitmap, name);
	} finally {
		bitmap.close();
	}
}
