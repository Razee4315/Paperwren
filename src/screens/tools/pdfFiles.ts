/**
 * The parts of the PDF tools that need the browser: storing a picture
 * again through a canvas, and reading a file's words through pdf.js.
 */

import { type OcrReader, hasOwnText, wordsOfTable } from "@/lib/ocr";
import { drawPage } from "@/lib/pagePicture";
import type { ReadWord, StoredPicture } from "@/lib/pdfTools";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** A picture at most `side` pixels long as a JPEG, or null where it
 * cannot be drawn. A picture's see-through parts are its PDF mask's
 * business, so a solid white behind it does no harm. */
export async function recodePicture(
	picture: StoredPicture,
	{ side, quality }: { side: number; quality: number },
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
	const scale = Math.min(1, side / Math.max(picture.width, picture.height));
	const width = Math.max(1, Math.round(picture.width * scale));
	const height = Math.max(1, Math.round(picture.height * scale));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.imageSmoothingQuality = "high";
	const source = picture.raw
		? await rawBitmap(picture)
		: await createImageBitmap(
				new Blob([picture.bytes as BlobPart], { type: "image/jpeg" }),
			);
	ctx.drawImage(source, 0, 0, width, height);
	source.close();
	const blob = await new Promise<Blob | null>((done) =>
		canvas.toBlob(done, "image/jpeg", quality),
	);
	return blob
		? { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
		: null;
}

function rawBitmap({ bytes, width, height, channels }: StoredPicture) {
	const rgba = new Uint8ClampedArray(width * height * 4);
	for (let i = 0, from = 0; i < rgba.length; i += 4, from += channels) {
		rgba[i] = bytes[from];
		rgba[i + 1] = bytes[channels === 3 ? from + 1 : from];
		rgba[i + 2] = bytes[channels === 3 ? from + 2 : from];
		rgba[i + 3] = 255;
	}
	return createImageBitmap(new ImageData(rgba, width, height));
}

/** The words of every page, a blank line between pages. */
export async function textOfPdf(doc: PDFDocumentProxy): Promise<string> {
	const pages: string[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const { items } = await (await doc.getPage(n)).getTextContent();
		let text = "";
		for (const item of items) {
			if (!("str" in item)) continue;
			text += item.str + (item.hasEOL ? "\n" : "");
		}
		pages.push(text.trim());
	}
	return pages.join("\n\n");
}

/** Sharp enough for Tesseract at the small print of an ordinary page. */
const READING_DPI = 200;

/**
 * The words on every page that has none of its own, read from a picture
 * of the page as it is shown. A page with text is left out.
 */
export async function readPages(
	doc: PDFDocumentProxy,
	reader: OcrReader,
	onPage: (n: number, total: number) => void,
): Promise<Array<{ page: number; words: ReadWord[] }>> {
	const pages: Array<{ page: number; words: ReadWord[] }> = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		const { items } = await page.getTextContent();
		if (hasOwnText(items as Array<{ str?: string }>)) continue;
		onPage(n, doc.numPages);
		const { bytes, width, height } = await drawPage(page, {
			dpi: READING_DPI,
			type: "image/jpeg",
		});
		const table = await reader.read(bytes);
		pages.push({ page: n - 1, words: wordsOfTable(table, width, height) });
	}
	return pages;
}
