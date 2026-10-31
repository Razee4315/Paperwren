/**
 * A text box on a page: its words laid out to its width, the same way
 * on screen and in a saved copy, and drawn as a picture for the copy.
 */

import { startsRtl } from "./bidi";
import type { Markup, TextPicture } from "./pdfMarkup";

type TextMark = Extract<Markup, { kind: "text" }>;

const FONT = 'system-ui, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif';
export const LINE_HEIGHT = 1.3;
/** Pixels in a saved text box for each point: sharp when zoomed. */
const SHARPNESS = 3;

export const textFont = (size: number) => `${size}px ${FONT}`;

let measurer: CanvasRenderingContext2D | null = null;

function measure(): CanvasRenderingContext2D | null {
	measurer ??= document.createElement("canvas").getContext("2d");
	return measurer;
}

/** The lines `text` falls into at `size` points, `width` points wide. */
export function layoutText(
	text: string,
	size: number,
	width: number,
	widthOf?: (line: string) => number,
): string[] {
	const ctx = widthOf ? null : measure();
	if (ctx) ctx.font = textFont(size);
	const wide = (line: string) =>
		widthOf?.(line) ?? ctx?.measureText(line).width ?? line.length * size * 0.5;
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		let line = "";
		for (const word of paragraph.split(/\s+/).filter(Boolean)) {
			const next = line ? `${line} ${word}` : word;
			if (wide(next) <= width || !line) line = next;
			else {
				lines.push(line);
				line = word;
			}
		}
		lines.push(line);
	}
	return lines;
}

/** How tall a text box is, in points. */
export const textHeight = (lines: string[], size: number) =>
	Math.max(1, lines.length) * size * LINE_HEIGHT;

/** Write a text box's lines from the top left of (0, 0), `width` wide. */
export function paintText(
	ctx: CanvasRenderingContext2D,
	lines: string[],
	size: number,
	width: number,
	color: string,
) {
	ctx.font = textFont(size);
	ctx.fillStyle = color;
	ctx.textBaseline = "top";
	lines.forEach((line, i) => {
		const rtl = startsRtl(line);
		ctx.direction = rtl ? "rtl" : "ltr";
		ctx.textAlign = rtl ? "right" : "left";
		ctx.fillText(line, rtl ? width : 0, i * size * LINE_HEIGHT);
	});
}

/** A text box as a PNG with a clear background. `pw` and `ph` are the
 * page's size in points. */
export async function textPicture(
	mark: TextMark,
	pw: number,
	ph: number,
): Promise<TextPicture | undefined> {
	const width = mark.w * pw;
	const height = mark.h * ph;
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.ceil(width * SHARPNESS));
	canvas.height = Math.max(1, Math.ceil(height * SHARPNESS));
	const ctx = canvas.getContext("2d");
	if (!ctx) return undefined;
	ctx.scale(SHARPNESS, SHARPNESS);
	paintText(
		ctx,
		layoutText(mark.text, mark.size, width),
		mark.size,
		width,
		mark.color,
	);
	const blob = await new Promise<Blob | null>((done) =>
		canvas.toBlob(done, "image/png"),
	);
	return blob ? { png: new Uint8Array(await blob.arrayBuffer()) } : undefined;
}
