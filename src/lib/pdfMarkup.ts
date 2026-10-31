/**
 * Marking up a PDF: ink, highlights, underlines, struck-out text and
 * notes, written into a new copy as the PDF's own annotations. Other
 * apps can show, list, change or remove them, and each one carries a
 * drawn appearance, so a viewer that draws nothing itself still shows
 * it. Like the other tools this returns new bytes; nothing is changed
 * in place.
 */

import type {
	PDFDocument as Doc,
	PDFDict,
	PDFPage,
	PDFRef,
	PDFString,
} from "@cantoo/pdf-lib";
import { open, pagePoint, shownBox } from "./pdfTools";

const lib = () => import("@cantoo/pdf-lib");

/** A box on a page as shown: fractions of its width and height. */
export interface TextBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** What the reader put on a page. Places are fractions of the page as
 * shown, from the top left; a width is in points. */
export type Markup =
	| {
			kind: "ink";
			page: number;
			points: Array<[number, number]>;
			/** "#rrggbb". */
			color: string;
			width: number;
			/** Drawn see-through, over the words, as a felt pen is. */
			marker?: boolean;
	  }
	| {
			kind: "highlight" | "underline" | "strike";
			page: number;
			/** One box to a line. */
			boxes: TextBox[];
			color: string;
			/** The words marked, for the file's list of comments. */
			text: string;
			/** What the reader wrote about them. */
			note?: string;
	  }
	| { kind: "note"; page: number; x: number; y: number; text: string }
	| {
			kind: "text";
			page: number;
			/** Its box. A height is a share of the page's. */
			x: number;
			y: number;
			w: number;
			h: number;
			/** In points. */
			size: number;
			text: string;
			color: string;
	  }
	| {
			kind: "measure";
			page: number;
			/** Two ends of a line, or the corners of an area. */
			points: Array<[number, number]>;
			closed?: boolean;
			color: string;
	  };

/** See-through felt pen and highlight, as both are drawn on screen. */
export const MARKER_OPACITY = 0.65;
/** Across a note's square, in points. */
export const NOTE_SIZE = 20;
const NOTE_COLOR = "#ffd93b";
/** Show the annotation, and print it. */
const PRINT = 4;
/** PRINT, and keep a note's size and angle at any zoom or turn. */
const PRINT_UPRIGHT = 28;

const n = (value: number) => {
	const text = value.toFixed(2);
	return text.endsWith(".00") ? text.slice(0, -3) : text;
};

const rgb = (hex: string): [number, number, number] => {
	const value = Number.parseInt(hex.replace("#", ""), 16) || 0;
	return [
		((value >> 16) & 255) / 255,
		((value >> 8) & 255) / 255,
		(value & 255) / 255,
	];
};

type Point = [number, number];
type Rect = [number, number, number, number];

function bounds(points: Point[], pad: number): Rect {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	return [
		Math.min(...xs) - pad,
		Math.min(...ys) - pad,
		Math.max(...xs) + pad,
		Math.max(...ys) + pad,
	];
}

/** A stroke as PDF path operators: the curve through the midpoints of
 * its points, the same one drawn on screen. */
export function inkPath(points: Point[]): string {
	const [x0, y0] = points[0];
	const out = [`${n(x0)} ${n(y0)} m`];
	if (points.length === 1) {
		out.push(`${n(x0)} ${n(y0)} l`);
		return out.join("\n");
	}
	let [px, py] = points[0];
	for (let i = 1; i < points.length - 1; i++) {
		const [cx, cy] = points[i];
		const ex = (cx + points[i + 1][0]) / 2;
		const ey = (cy + points[i + 1][1]) / 2;
		// A quadratic curve, in the cubic a PDF path is written with.
		out.push(
			`${n(px + ((cx - px) * 2) / 3)} ${n(py + ((cy - py) * 2) / 3)} ${n(
				ex + ((cx - ex) * 2) / 3,
			)} ${n(ey + ((cy - ey) * 2) / 3)} ${n(ex)} ${n(ey)} c`,
		);
		px = ex;
		py = ey;
	}
	const [lx, ly] = points[points.length - 1];
	out.push(`${n(lx)} ${n(ly)} l`);
	return out.join("\n");
}

/** What a viewer draws for an annotation, in the page's coordinates. */
async function appearance(
	doc: Doc,
	rect: Rect,
	content: string,
	{ opacity = 1, multiply = false }: { opacity?: number; multiply?: boolean },
): Promise<PDFRef> {
	const { context } = doc;
	const stream = context.flateStream(`q\n/G gs\n${content}\nQ\n`, {
		Type: "XObject",
		Subtype: "Form",
		BBox: [...rect],
		Resources: {
			ExtGState: {
				G: {
					Type: "ExtGState",
					ca: opacity,
					CA: opacity,
					BM: multiply ? "Multiply" : "Normal",
				},
			},
		},
	});
	return context.register(stream);
}

async function attach(
	doc: Doc,
	page: PDFPage,
	subtype: string,
	rect: Rect,
	ap: PDFRef,
	extra: Record<string, unknown>,
	contents?: string,
	style?: PDFString,
) {
	const { PDFHexString, PDFName } = await lib();
	// The literal type does not name what `extra` holds.
	const dict = doc.context.obj({
		Type: "Annot",
		Subtype: subtype,
		Rect: [...rect],
		F: PRINT,
		P: page.ref,
		AP: { N: ap },
		...extra,
	} as never) as unknown as PDFDict;
	if (contents)
		dict.set(PDFName.of("Contents"), PDFHexString.fromText(contents));
	// The default look of its words: a string, which `obj` would not make.
	if (style) dict.set(PDFName.of("DA"), style);
	page.node.addAnnot(doc.context.register(dict));
}

async function addInk(
	doc: Doc,
	page: PDFPage,
	mark: Extract<Markup, { kind: "ink" }>,
) {
	const box = shownBox(page);
	const points = mark.points.map(([u, v]) => pagePoint(box, u, v));
	const rect = bounds(points, mark.width);
	const [r, g, b] = rgb(mark.color);
	const opacity = mark.marker ? MARKER_OPACITY : 1;
	const ap = await appearance(
		doc,
		rect,
		`${n(r)} ${n(g)} ${n(b)} RG\n${n(mark.width)} w\n1 J\n1 j\n${inkPath(points)}\nS`,
		{ opacity, multiply: mark.marker },
	);
	await attach(doc, page, "Ink", rect, ap, {
		C: [r, g, b],
		CA: opacity,
		BS: { W: mark.width, S: "S" },
		InkList: [points.flat()],
	});
}

async function addTextMark(
	doc: Doc,
	page: PDFPage,
	mark: Extract<Markup, { kind: "highlight" | "underline" | "strike" }>,
) {
	if (!mark.boxes.length) return;
	const box = shownBox(page);
	// Each line's corners: top left, top right, bottom left, bottom
	// right, the order a PDF lists them in.
	const lines = mark.boxes.map(
		({ x, y, w, h }) =>
			[
				pagePoint(box, x, y),
				pagePoint(box, x + w, y),
				pagePoint(box, x, y + h),
				pagePoint(box, x + w, y + h),
			] as const,
	);
	const rect = bounds(lines.flat() as Point[], 1);
	const [r, g, b] = rgb(mark.color);
	const highlight = mark.kind === "highlight";
	const paths = lines.map(([tl, tr, bl, br]) => {
		if (highlight)
			return `${n(tl[0])} ${n(tl[1])} m\n${n(tr[0])} ${n(tr[1])} l\n${n(
				br[0],
			)} ${n(br[1])} l\n${n(bl[0])} ${n(bl[1])} l\nh\nf`;
		// Along the line's foot, or through the middle of its letters.
		const share = mark.kind === "underline" ? 0.92 : 0.55;
		const across = (a: Point, c: Point): Point => [
			a[0] + (c[0] - a[0]) * share,
			a[1] + (c[1] - a[1]) * share,
		];
		const [x0, y0] = across(tl, bl);
		const [x1, y1] = across(tr, br);
		const tall = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
		return `${n(Math.max(0.6, tall * 0.07))} w\n${n(x0)} ${n(y0)} m\n${n(x1)} ${n(y1)} l\nS`;
	});
	const ap = await appearance(
		doc,
		rect,
		`${n(r)} ${n(g)} ${n(b)} ${highlight ? "rg" : "RG"}\n${paths.join("\n")}`,
		highlight ? { opacity: MARKER_OPACITY, multiply: true } : {},
	);
	await attach(
		doc,
		page,
		highlight
			? "Highlight"
			: mark.kind === "underline"
				? "Underline"
				: "StrikeOut",
		rect,
		ap,
		{
			C: [r, g, b],
			CA: highlight ? MARKER_OPACITY : 1,
			QuadPoints: lines.flat(2),
		},
		// A note says more than the words it sits on.
		mark.note || mark.text || undefined,
	);
}

async function addNote(
	doc: Doc,
	page: PDFPage,
	mark: Extract<Markup, { kind: "note" }>,
) {
	const [cx, cy] = pagePoint(shownBox(page), mark.x, mark.y);
	const half = NOTE_SIZE / 2;
	const rect: Rect = [cx - half, cy - half, cx + half, cy + half];
	const [r, g, b] = rgb(NOTE_COLOR);
	const [x, y] = rect;
	// A yellow square with three lines of writing.
	const lines = [14, 10, 6]
		.map((at) => `${n(x + 4)} ${n(y + at)} m\n${n(x + 16)} ${n(y + at)} l\nS`)
		.join("\n");
	const ap = await appearance(
		doc,
		rect,
		`${n(r)} ${n(g)} ${n(b)} rg\n0.45 0.36 0.05 RG\n1 w\n${n(x + 0.5)} ${n(
			y + 0.5,
		)} ${NOTE_SIZE - 1} ${NOTE_SIZE - 1} re\nB\n${lines}`,
		{},
	);
	await attach(
		doc,
		page,
		"Text",
		rect,
		ap,
		{ C: [r, g, b], Name: "Comment", F: PRINT_UPRIGHT },
		mark.text,
	);
}

/** A text box as a PNG, drawn the way the screen shows it. */
export interface TextPicture {
	png: Uint8Array;
}

/**
 * A text box as a FreeText annotation. Its words are kept as words, so
 * other apps can list and change them. What is shown is a picture of
 * them, laid along the page as it is shown, because the standard PDF
 * fonts cannot write most of the scripts it may be in.
 */
async function addTextBox(
	doc: Doc,
	page: PDFPage,
	mark: Extract<Markup, { kind: "text" }>,
	picture?: TextPicture,
) {
	const box = shownBox(page);
	const corners: Point[] = [
		pagePoint(box, mark.x, mark.y + mark.h),
		pagePoint(box, mark.x + mark.w, mark.y + mark.h),
		pagePoint(box, mark.x, mark.y),
		pagePoint(box, mark.x + mark.w, mark.y),
	];
	const rect = bounds(corners, 0);
	const [r, g, b] = rgb(mark.color);
	const fields = { BS: { W: 0 } };
	const { PDFHexString, PDFName, PDFString } = await lib();
	const style = PDFString.of(
		`/Helv ${n(mark.size)} Tf ${n(r)} ${n(g)} ${n(b)} rg`,
	);
	if (!picture) {
		// Nothing drawn: a viewer makes its own from the words.
		const dict = doc.context.obj({
			Type: "Annot",
			Subtype: "FreeText",
			Rect: [...rect],
			F: PRINT,
			P: page.ref,
			...fields,
		} as never) as unknown as PDFDict;
		dict.set(PDFName.of("Contents"), PDFHexString.fromText(mark.text));
		dict.set(PDFName.of("DA"), style);
		page.node.addAnnot(doc.context.register(dict));
		return;
	}
	const image = await doc.embedPng(picture.png);
	// The picture's unit square, along the box as it is shown.
	const [o, right, up] = corners;
	const ap = doc.context.register(
		doc.context.flateStream(
			`q\n${n(right[0] - o[0])} ${n(right[1] - o[1])} ${n(up[0] - o[0])} ${n(
				up[1] - o[1],
			)} ${n(o[0])} ${n(o[1])} cm\n/Im Do\nQ\n`,
			{
				Type: "XObject",
				Subtype: "Form",
				BBox: [...rect],
				Resources: { XObject: { Im: image.ref } },
			},
		),
	);
	await attach(doc, page, "FreeText", rect, ap, fields, mark.text, style);
}

/**
 * A measurement as a Line or a Polygon annotation, with the distance or
 * area it came to as its comment.
 */
async function addMeasure(
	doc: Doc,
	page: PDFPage,
	mark: Extract<Markup, { kind: "measure" }>,
	label?: string,
) {
	const box = shownBox(page);
	const points = mark.points.map(([u, v]) => pagePoint(box, u, v));
	const rect = bounds(points, 2);
	const [r, g, b] = rgb(mark.color);
	const path = points
		.map(([x, y], i) => `${n(x)} ${n(y)} ${i ? "l" : "m"}`)
		.join("\n");
	const ap = await appearance(
		doc,
		rect,
		`${n(r)} ${n(g)} ${n(b)} RG\n1.2 w\n1 J\n1 j\n${path}${
			mark.closed ? "\nh" : ""
		}\nS`,
		{},
	);
	await attach(
		doc,
		page,
		mark.closed ? "Polygon" : "Line",
		rect,
		ap,
		mark.closed
			? { C: [r, g, b], BS: { W: 1.2 }, Vertices: points.flat() }
			: { C: [r, g, b], BS: { W: 1.2 }, L: points.slice(0, 2).flat() },
		label,
	);
}

/** A copy of the PDF with the marks added, on top of any it already has. */
export async function addMarkup(
	bytes: Uint8Array,
	{
		password,
		marks,
		pictures,
		labels,
	}: {
		password?: string;
		marks: Markup[];
		/** Text boxes, drawn, in the order of those in `marks`. */
		pictures?: Array<TextPicture | undefined>;
		/** What each measurement came to, in the order of those in `marks`. */
		labels?: Array<string | undefined>;
	},
): Promise<Uint8Array> {
	const doc = await open(bytes, password);
	let box = 0;
	let measure = 0;
	for (const mark of marks) {
		const page = doc.getPage(mark.page);
		if (mark.kind === "ink") await addInk(doc, page, mark);
		else if (mark.kind === "note") await addNote(doc, page, mark);
		else if (mark.kind === "text")
			await addTextBox(doc, page, mark, pictures?.[box++]);
		else if (mark.kind === "measure")
			await addMeasure(doc, page, mark, labels?.[measure++]);
		else await addTextMark(doc, page, mark);
	}
	return doc.save({ updateFieldAppearances: false });
}
