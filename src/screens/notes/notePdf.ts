/**
 * A note as a PDF. Each page is drawn on a canvas, the way text in a
 * script the PDF fonts lack is drawn in Fill & sign, so Urdu and Chinese
 * notes come out the same as English ones. The words are pictures in
 * the copy: it reads and prints as written, but they cannot be selected.
 */

import { type Note, type NoteStroke, SKETCH_WIDTH } from "@/lib/notes";
import { imagesToPdf } from "@/lib/pdfTools";
import { pngBytes } from "@/lib/signatures";
import { curve } from "@/screens/tools/ink";

/** A4 at 150 dots to the inch. */
const WIDTH = 1240;
const HEIGHT = 1754;
const MARGIN = 110;
const TITLE = 46;
const BODY = 30;
const LINE = 44;

const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;

interface Sheet {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
}

function newSheet(): Sheet {
	const canvas = document.createElement("canvas");
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("no canvas");
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, WIDTH, HEIGHT);
	return { canvas, ctx };
}

/** A paragraph as lines that fit, broken at spaces, or anywhere in a
 * word (or a script without spaces) too long for a line. */
export function wrapText(
	text: string,
	width: number,
	measure: (text: string) => number,
): string[] {
	if (!text) return [""];
	const out: string[] = [];
	let line = "";
	for (const word of text.split(/(?<=\s)/)) {
		if (measure(line + word) <= width) {
			line += word;
			continue;
		}
		if (line) out.push(line.trimEnd());
		line = "";
		for (const char of word) {
			if (line && measure(line + char) > width) {
				out.push(line);
				line = "";
			}
			line += char;
		}
	}
	if (line) out.push(line.trimEnd());
	return out;
}

/** One page's share of a sketch: `top` is how far down the sketch this
 * page begins, on a sheet SKETCH_WIDTH across. */
function drawStrokes(
	ctx: CanvasRenderingContext2D,
	strokes: NoteStroke[],
	y: number,
	top: number,
	tall: number,
) {
	const scale = (WIDTH - MARGIN * 2) / SKETCH_WIDTH;
	ctx.save();
	ctx.beginPath();
	ctx.rect(MARGIN, y, WIDTH - MARGIN * 2, tall * scale);
	ctx.clip();
	ctx.translate(MARGIN, y - top * scale);
	ctx.scale(scale, scale);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	for (const stroke of strokes) {
		ctx.strokeStyle = stroke.color;
		ctx.lineWidth = stroke.width;
		ctx.stroke(new Path2D(curve(stroke.points, SKETCH_WIDTH, SKETCH_WIDTH)));
	}
	ctx.restore();
}

export async function noteToPdf(note: Note): Promise<Uint8Array> {
	const family = getComputedStyle(document.body).fontFamily;
	const sheets = [newSheet()];
	let y = MARGIN;
	const top = () => sheets[sheets.length - 1];
	const turn = () => {
		sheets.push(newSheet());
		y = MARGIN;
	};
	const write = (text: string, size: number, bold: boolean, lead: number) => {
		const { ctx } = top();
		const font = `${bold ? "700 " : ""}${size}px ${family}`;
		ctx.font = font;
		for (const line of wrapText(
			text,
			WIDTH - MARGIN * 2,
			(s) => ctx.measureText(s).width,
		)) {
			if (y + lead > HEIGHT - MARGIN) turn();
			const { ctx: page } = top();
			page.font = font;
			page.fillStyle = "#111";
			page.textBaseline = "top";
			const rtl = RTL.test(line);
			page.direction = rtl ? "rtl" : "ltr";
			page.textAlign = rtl ? "right" : "left";
			page.fillText(line, rtl ? WIDTH - MARGIN : MARGIN, y);
			y += lead;
		}
	};
	if (note.title.trim()) {
		write(note.title.trim(), TITLE, true, TITLE * 1.3);
		y += 24;
	}
	const scale = (WIDTH - MARGIN * 2) / SKETCH_WIDTH;
	for (const block of note.blocks) {
		if (block.kind === "text") {
			for (const paragraph of block.text.trimEnd().split("\n"))
				write(paragraph, BODY, false, LINE);
			y += 16;
			continue;
		}
		if (!block.strokes.length) continue;
		// Down to the last ink: the empty sheet below it is not printed.
		const lowest = Math.max(
			...block.strokes.flatMap((s) => s.points.map((p) => p[1])),
		);
		const end = Math.min(block.height, lowest * SKETCH_WIDTH + 40);
		let done = 0;
		while (done < end) {
			if (HEIGHT - MARGIN - y < 80) turn();
			const room = (HEIGHT - MARGIN - y) / scale;
			const tall = Math.min(room, end - done);
			drawStrokes(top().ctx, block.strokes, y, done, tall);
			done += tall;
			y += tall * scale;
		}
		y += 24;
	}
	return imagesToPdf(
		sheets.map(({ canvas }) => ({
			bytes: pngBytes(canvas.toDataURL("image/png")),
			type: "png" as const,
		})),
		"a4",
	);
}
