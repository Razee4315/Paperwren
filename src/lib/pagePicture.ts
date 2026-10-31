/**
 * A PDF page as a picture: drawn on white paper at a given sharpness,
 * turned as asked. The PDF-to-pictures tool and the viewer's "Save page
 * as picture" both use it.
 */

import type { PDFPageProxy } from "pdfjs-dist";

type PageViewport = ReturnType<PDFPageProxy["getViewport"]>;

export interface PagePicture {
	bytes: Uint8Array;
	type: "image/png" | "image/jpeg";
	width: number;
	height: number;
}

/** Longest side drawn, in pixels: a poster at full sharpness would be
 * more than a phone can draw. */
const MAX_SIDE = 5000;

export async function drawPage(
	page: PDFPageProxy,
	{
		dpi,
		type,
		rotation = page.rotate,
		viewportOf = (params) => page.getViewport(params),
		after,
	}: {
		dpi: number;
		type: PagePicture["type"];
		rotation?: number;
		/** How the page's box is measured (the viewer swaps in the whole
		 * page while its margins are cropped on screen). */
		viewportOf?: (params: { scale: number; rotation: number }) => PageViewport;
		/** Draws over the page before it becomes a picture. */
		after?: (ctx: CanvasRenderingContext2D, viewport: PageViewport) => void;
	},
): Promise<PagePicture> {
	const base = viewportOf({ scale: 1, rotation });
	const scale = Math.min(
		dpi / 72,
		MAX_SIDE / Math.max(1, base.width, base.height),
	);
	const viewport = viewportOf({ scale, rotation });
	const canvas = document.createElement("canvas");
	canvas.width = Math.ceil(viewport.width);
	canvas.height = Math.ceil(viewport.height);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("no canvas");
	context.fillStyle = "#fff";
	context.fillRect(0, 0, canvas.width, canvas.height);
	// The "print" intent draws without waiting on animation frames, so a
	// page is drawn even while the app is off screen.
	await page.render({ canvasContext: context, viewport, intent: "print" })
		.promise;
	after?.(context, viewport);
	const blob = await new Promise<Blob | null>((done) =>
		canvas.toBlob(done, type, type === "image/jpeg" ? 0.9 : undefined),
	);
	const { width, height } = canvas;
	canvas.width = canvas.height = 0;
	if (!blob) throw new Error("no picture");
	return {
		bytes: new Uint8Array(await blob.arrayBuffer()),
		type,
		width,
		height,
	};
}

/** The file extension for a picture type ("image/jpeg" -> ".jpg"). */
export function pictureExtension(type: string): string {
	const sub = type.split("/")[1]?.split(/[+;]/)[0] ?? "";
	if (sub === "jpeg") return ".jpg";
	return sub ? `.${sub}` : ".png";
}
