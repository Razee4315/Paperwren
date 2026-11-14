/**
 * The part of the PDF tools that needs the browser: storing a picture
 * again through a canvas, and drawing pages as pictures.
 */

import { drawPage } from "@/lib/pagePicture";
import type { DrawnPage } from "@/lib/pdfCompress";
import type { StoredPicture } from "@/lib/pdfTools";
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

/**
 * Every page of a PDF drawn as a JPEG, at `dpi` dots to the inch and
 * the JPEG quality given, in grey if asked: the pages of a copy whose
 * text is pictures. `onPage` hears of each page before it is drawn.
 */
export async function drawPages(
	doc: PDFDocumentProxy,
	{ dpi, quality, grey }: { dpi: number; quality: number; grey: boolean },
	onPage?: (n: number, total: number) => void,
): Promise<DrawnPage[]> {
	const out: DrawnPage[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		onPage?.(n, doc.numPages);
		const sheet = await doc.getPage(n);
		const { width: w, height: h } = sheet.getViewport({
			scale: 1,
			rotation: sheet.rotate,
		});
		// No more than about 16 million pixels, as PDF to pictures draws.
		const most = 72 * Math.sqrt(16e6 / Math.max(1, w * h));
		const drawn = await drawPage(sheet, {
			dpi: Math.min(dpi, most),
			type: "image/jpeg",
			quality,
			after: grey ? toGrey : undefined,
		});
		sheet.cleanup();
		out.push({
			bytes: drawn.bytes,
			width: drawn.width,
			height: drawn.height,
			w,
			h,
		});
	}
	return out;
}

/** The canvas in shades of grey: a JPEG of it keeps almost nothing for
 * colour. */
function toGrey(ctx: CanvasRenderingContext2D) {
	const { width, height } = ctx.canvas;
	const image = ctx.getImageData(0, 0, width, height);
	const px = image.data;
	for (let i = 0; i < px.length; i += 4) {
		const y = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
		px[i] = px[i + 1] = px[i + 2] = y;
	}
	ctx.putImageData(image, 0, 0);
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
