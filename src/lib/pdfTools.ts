/**
 * The PDF tools: filling in and signing a form, and putting pages
 * together, apart and in order. Each one reads the bytes of one or more
 * PDFs and returns the bytes of a new one; nothing is changed in place,
 * and the reader saves the result as a copy. Built on pdf-lib, loaded
 * only when a tool runs.
 */

import type {
	PDFDocument as Doc,
	PDFFont,
	PDFPage,
	PDFRef,
	PDFRawStream as RawStream,
	SecurityOptions,
} from "@cantoo/pdf-lib";

const lib = () => import("@cantoo/pdf-lib");

/** A place on a page as it is shown, upright: fractions of the shown
 * width and height, from the top left. A page the file turns on its
 * side is shown turned, and so are these. */
export interface Placement {
	/** 0-based. */
	page: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** What the reader put on a page: a picture (a signature, a tick) or a
 * line of text. Text in a script the standard PDF fonts lack is
 * handed over as a picture of it. */
export type Mark = Placement &
	(
		| { kind: "image"; png: Uint8Array }
		| {
				kind: "text";
				text: string;
				/** "#rrggbb". */
				color: string;
		  }
	);

/** A form field's new value, by its full name: text, a ticked box, the
 * chosen option of a list or a group of radio buttons. */
export interface FieldValue {
	name: string;
	value: string | boolean;
}

/** What could not be done, for the reader. */
export class ToolError extends Error {
	constructor(
		readonly reason: "password" | "corrupt" | "locked" | "empty",
		detail?: string,
	) {
		super(detail ?? reason);
	}
}

export async function open(bytes: Uint8Array, password?: string): Promise<Doc> {
	const { PDFDocument } = await lib();
	try {
		return await PDFDocument.load(bytes, {
			password,
			updateMetadata: false,
		});
	} catch (err) {
		const text = String((err as Error)?.message ?? err).toLowerCase();
		if (/password|encrypt/.test(text)) throw new ToolError("password", text);
		throw new ToolError("corrupt", text);
	}
}

const SIGNED = new TextEncoder().encode("/ByteRange");

/** True for a PDF with a digital signature: the mark every signature
 * dictionary carries. A copy rewrites the file, which breaks it. */
export function digitallySigned(bytes: Uint8Array): boolean {
	let at = bytes.indexOf(SIGNED[0]);
	while (at >= 0) {
		let i = 1;
		while (i < SIGNED.length && bytes[at + i] === SIGNED[i]) i++;
		if (i === SIGNED.length) return true;
		at = bytes.indexOf(SIGNED[0], at + 1);
	}
	return false;
}

/** The page's box as shown (pdf.js shows the crop box), and the turn
 * the file gives it, in degrees clockwise. */
export function shownBox(page: PDFPage) {
	const box = page.getCropBox();
	const turn = (((page.getRotation().angle % 360) + 360) % 360) as
		| 0
		| 90
		| 180
		| 270;
	return { ...box, turn };
}

/**
 * Where a point of the page as shown (u across, v down, as fractions)
 * lies in the page's own coordinates (points, from the bottom left of
 * the unturned page). A page turned clockwise by 90° shows its bottom
 * left corner at the top left, and so on round.
 */
export function pagePoint(
	box: { x: number; y: number; width: number; height: number; turn: number },
	u: number,
	v: number,
): [number, number] {
	const { x, y, width: w, height: h } = box;
	switch (box.turn) {
		case 90:
			return [x + v * w, y + u * h];
		case 180:
			return [x + (1 - u) * w, y + v * h];
		case 270:
			return [x + (1 - v) * w, y + (1 - u) * h];
		default:
			return [x + u * w, y + (1 - v) * h];
	}
}

/** The size of the page as shown, in points. */
function shownSize(box: ReturnType<typeof shownBox>): [number, number] {
	return box.turn % 180 ? [box.height, box.width] : [box.width, box.height];
}

const rgbOf = async (hex: string) => {
	const { rgb } = await lib();
	const n = Number.parseInt(hex.replace("#", ""), 16) || 0;
	return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** True when the standard Helvetica can write the text (Latin-1 and
 * the few extra marks of WinAnsi). */
export function standardText(text: string): boolean {
	return /^[ -~ -ÿ–—‘’“”•…€]*$/.test(text);
}

async function drawMark(doc: Doc, mark: Mark, font: () => Promise<PDFFont>) {
	const { degrees } = await lib();
	const page = doc.getPage(mark.page);
	const box = shownBox(page);
	const [shownW, shownH] = shownSize(box);
	// Drawn from the mark's bottom left corner as shown, turned with the
	// page so it reads upright.
	const [x, y] = pagePoint(box, mark.x, mark.y + mark.h);
	const width = mark.w * shownW;
	const height = mark.h * shownH;
	const rotate = degrees(box.turn);
	if (mark.kind === "image") {
		const image = await doc.embedPng(mark.png);
		page.drawImage(image, { x, y, width, height, rotate });
		return;
	}
	const f = await font();
	// The box is the line's height: the size that fills it, nudged so the
	// letters sit on its baseline rather than at its foot.
	const size = Math.max(4, height / 1.2);
	const lift = size * 0.25;
	const turn = (box.turn * Math.PI) / 180;
	page.drawText(mark.text, {
		x: x - Math.sin(turn) * lift,
		y: y + Math.cos(turn) * lift,
		size,
		font: f,
		color: await rgbOf(mark.color),
		rotate,
		maxWidth: Math.max(width, f.widthOfTextAtSize(mark.text, size)),
	});
}

/**
 * Fill in a form's fields and put the marks on its pages. `flatten`
 * makes the fields part of the page, so the copy reads the same
 * everywhere and cannot be changed by mistake.
 */
export async function fillAndSign(
	bytes: Uint8Array,
	{
		password,
		fields = [],
		marks = [],
		flatten = false,
	}: {
		password?: string;
		fields?: FieldValue[];
		marks?: Mark[];
		flatten?: boolean;
	},
): Promise<Uint8Array> {
	const {
		PDFCheckBox,
		PDFDropdown,
		PDFOptionList,
		PDFRadioGroup,
		PDFTextField,
		PDFName,
		PDFBool,
		StandardFonts,
	} = await lib();
	const doc = await open(bytes, password);
	let helvetica: PDFFont | null = null;
	const font = async () => {
		helvetica ??= await doc.embedFont(StandardFonts.Helvetica);
		return helvetica;
	};

	let needsReader = false;
	if (fields.length) {
		const form = doc.getForm();
		for (const { name, value } of fields) {
			const field = form.getFieldMaybe(name);
			if (!field || field.isReadOnly()) continue;
			if (field instanceof PDFTextField) {
				const text = String(value);
				if (!standardText(text)) needsReader = true;
				field.setText(text || undefined);
			} else if (field instanceof PDFCheckBox) {
				if (value) field.check();
				else field.uncheck();
			} else if (field instanceof PDFRadioGroup) {
				if (typeof value === "string" && field.getOptions().includes(value))
					field.select(value);
			} else if (
				field instanceof PDFDropdown ||
				field instanceof PDFOptionList
			) {
				if (typeof value === "string" && field.getOptions().includes(value))
					field.select(value);
			}
		}
		if (needsReader && !flatten) {
			// Text in a script Helvetica lacks: the reader's app draws the
			// fields from their values instead of a drawn appearance.
			form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
		} else {
			try {
				form.updateFieldAppearances(await font());
			} catch {
				form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
				needsReader = true;
			}
			if (flatten && !needsReader) form.flatten();
		}
	}
	for (const mark of marks) await drawMark(doc, mark, font);
	return doc.save({ updateFieldAppearances: false });
}

/** One page of a new document: which file and page it comes from, and
 * how far to turn it (degrees clockwise, on top of its own turn). */
export interface PagePick {
	file: number;
	page: number;
	turn?: number;
}

/**
 * A new document from pages of one or more: merge (every page of each,
 * in turn), extract or split (some pages), delete (all but some),
 * reorder and rotate (the pages in a new order, turned).
 */
export async function buildPdf(
	sources: Array<{ bytes: Uint8Array; password?: string }>,
	picks: PagePick[],
): Promise<Uint8Array> {
	if (!picks.length) throw new ToolError("empty");
	const { PDFDocument, degrees } = await lib();
	const docs = await Promise.all(sources.map((s) => open(s.bytes, s.password)));
	const out = await PDFDocument.create();
	// Pages are copied a file at a time, in one call each, so objects
	// they share (fonts, pictures) are copied once.
	const wanted = docs.map((_, i) => [
		...new Set(picks.filter((p) => p.file === i).map((p) => p.page)),
	]);
	const copied = await Promise.all(
		docs.map((doc, i) =>
			wanted[i].length ? out.copyPages(doc, wanted[i]) : Promise.resolve([]),
		),
	);
	for (const pick of picks) {
		const source = copied[pick.file]?.[wanted[pick.file].indexOf(pick.page)];
		if (!source) continue;
		// The same page twice needs a copy of its own.
		const page = out.getPages().includes(source)
			? (await out.copyPages(docs[pick.file], [pick.page]))[0]
			: source;
		if (pick.turn)
			page.setRotation(
				degrees((((page.getRotation().angle + pick.turn) % 360) + 360) % 360),
			);
		out.addPage(page);
	}
	return out.save();
}

/** How many pages a PDF has. */
export async function pageCount(
	bytes: Uint8Array,
	password?: string,
): Promise<number> {
	return (await open(bytes, password)).getPageCount();
}

/** Pages as "1-3, 5, 8-": 0-based page numbers, in the order typed.
 * Null when it names a page the document does not have, or none. */
export function parsePages(text: string, count: number): number[] | null {
	const out: number[] = [];
	for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
		const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part) ?? /^(\d+)$/.exec(part);
		if (!m) return null;
		const from = Number(m[1] || 1);
		const to = m[2] === undefined ? from : Number(m[2] || count);
		if (from < 1 || to < 1 || from > count || to > count) return null;
		const step = from <= to ? 1 : -1;
		for (let p = from; p !== to + step; p += step) out.push(p - 1);
	}
	return out.length ? out : null;
}

/** Paper sizes for pictures turned into pages, in points. */
export const PAPER = {
	a4: [595.28, 841.89],
	letter: [612, 792],
} as const;

/**
 * Pictures as pages: each on a page of its own, either the size of the
 * picture or fitted (with a margin) to A4 or Letter, turned to suit.
 * The pictures arrive as JPEG or PNG; anything else is drawn into one
 * of those first, where there is a canvas.
 */
export async function imagesToPdf(
	images: Array<{ bytes: Uint8Array; type: "jpg" | "png" }>,
	paper: "fit" | keyof typeof PAPER = "fit",
): Promise<Uint8Array> {
	if (!images.length) throw new ToolError("empty");
	const { PDFDocument } = await lib();
	const doc = await PDFDocument.create();
	const margin = 24;
	for (const picture of images) {
		const image =
			picture.type === "jpg"
				? await doc.embedJpg(picture.bytes)
				: await doc.embedPng(picture.bytes);
		if (paper === "fit") {
			// 96 pixels to the inch, as a screen shows it.
			const w = (image.width * 72) / 96;
			const h = (image.height * 72) / 96;
			doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
			continue;
		}
		const [a, b] = PAPER[paper];
		const wide = image.width > image.height;
		const [pw, ph] = wide ? [b, a] : [a, b];
		const scale = Math.min(
			(pw - margin * 2) / image.width,
			(ph - margin * 2) / image.height,
		);
		const w = image.width * scale;
		const h = image.height * scale;
		doc.addPage([pw, ph]).drawImage(image, {
			x: (pw - w) / 2,
			y: (ph - h) / 2,
			width: w,
			height: h,
		});
	}
	return doc.save();
}

/** The words a scan carries at its foot, unless the reader takes them off. */
export const SCAN_MARK = "Scanned with Paperwren";

/**
 * Scanned pages as a PDF: each page filled by its picture. "fit" gives
 * a page the picture's own shape, as wide as A4 (or as tall, lying
 * down); A4 and Letter fit the picture inside the sheet, turned to suit.
 * `mark` adds a small line of grey words at the foot of each page.
 */
export async function scansToPdf(
	pages: Array<{ bytes: Uint8Array; width: number; height: number }>,
	{
		paper = "fit",
		mark,
	}: { paper?: "fit" | keyof typeof PAPER; mark?: string } = {},
): Promise<Uint8Array> {
	if (!pages.length) throw new ToolError("empty");
	const { PDFDocument, StandardFonts } = await lib();
	const doc = await PDFDocument.create();
	doc.setCreator("Paperwren");
	doc.setProducer("Paperwren");
	const font = mark ? await doc.embedFont(StandardFonts.Helvetica) : null;
	const grey = await rgbOf("#6f6c66");
	for (const scan of pages) {
		const image = await doc.embedJpg(scan.bytes);
		const wide = scan.width > scan.height;
		const short = PAPER.a4[0];
		let pw: number;
		let ph: number;
		if (paper === "fit") {
			const ratio =
				Math.max(scan.width, scan.height) / Math.min(scan.width, scan.height);
			[pw, ph] = wide ? [short * ratio, short] : [short, short * ratio];
		} else {
			const [a, b] = PAPER[paper];
			[pw, ph] = wide ? [b, a] : [a, b];
		}
		const scale = Math.min(pw / scan.width, ph / scan.height);
		const w = scan.width * scale;
		const h = scan.height * scale;
		const page = doc.addPage([pw, ph]);
		page.drawImage(image, {
			x: (pw - w) / 2,
			y: (ph - h) / 2,
			width: w,
			height: h,
		});
		if (font && mark) {
			const size = 7;
			const text = font.widthOfTextAtSize(mark, size);
			page.drawText(mark, {
				x: pw - 10 - text,
				y: 8,
				size,
				font,
				color: grey,
				opacity: 0.85,
			});
		}
	}
	return doc.save();
}

/** Where page numbers go. */
export type NumberSpot = "bottom-center" | "bottom-right" | "top-right";

/** Page numbers on every page: "1", or "Page 1 of 9" in the words the
 * caller gives ({n} and {total}). */
export async function addPageNumbers(
	bytes: Uint8Array,
	{
		password,
		spot = "bottom-center",
		pattern = "{n}",
		first = 1,
	}: {
		password?: string;
		spot?: NumberSpot;
		pattern?: string;
		first?: number;
	} = {},
): Promise<Uint8Array> {
	const { StandardFonts, degrees } = await lib();
	const doc = await open(bytes, password);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const total = doc.getPageCount();
	const grey = await rgbOf("#444444");
	const size = 10;
	doc.getPages().forEach((page, i) => {
		const raw = pattern
			.replace("{n}", String(first + i))
			.replace("{total}", String(first + total - 1));
		const text = standardText(raw) ? raw : String(first + i);
		const box = shownBox(page);
		const [w, h] = shownSize(box);
		const textW = font.widthOfTextAtSize(text, size);
		const margin = 28;
		const u =
			spot === "bottom-center" ? (w - textW) / 2 / w : (w - margin - textW) / w;
		const v = spot === "top-right" ? (margin + size) / h : (h - margin) / h;
		const [x, y] = pagePoint(box, u, v);
		page.drawText(text, {
			x,
			y,
			size,
			font,
			color: grey,
			rotate: degrees(box.turn),
		});
	});
	return doc.save();
}

/** A word or two across every page, faint and on a slant: "DRAFT",
 * "COPY", "CONFIDENTIAL". Text Helvetica cannot write is refused. */
export async function addWatermark(
	bytes: Uint8Array,
	{
		text,
		password,
		opacity = 0.18,
	}: { text: string; password?: string; opacity?: number },
): Promise<Uint8Array> {
	if (!text.trim() || !standardText(text)) throw new ToolError("empty");
	const { StandardFonts, degrees } = await lib();
	const doc = await open(bytes, password);
	const font = await doc.embedFont(StandardFonts.HelveticaBold);
	const color = await rgbOf("#c0392b");
	for (const page of doc.getPages()) {
		const box = shownBox(page);
		const [w, h] = shownSize(box);
		// As wide as most of the page's diagonal.
		const angle = Math.atan2(h, w);
		const size = Math.min(
			160,
			(Math.hypot(w, h) * 0.7) / Math.max(1, font.widthOfTextAtSize(text, 1)),
		);
		const textW = font.widthOfTextAtSize(text, size);
		// Centred: start half the text back along the slant, and half its
		// height down across it.
		const cu =
			0.5 -
			(Math.cos(angle) * textW) / 2 / w +
			(Math.sin(angle) * size * 0.35) / w;
		const cv =
			0.5 +
			(Math.sin(angle) * textW) / 2 / h +
			(Math.cos(angle) * size * 0.35) / h;
		const [x, y] = pagePoint(box, cu, cv);
		page.drawText(text, {
			x,
			y,
			size,
			font,
			color,
			opacity,
			rotate: degrees(box.turn + (angle * 180) / Math.PI),
		});
	}
	return doc.save();
}

/** A picture inside a PDF, for making smaller: JPEG as it is stored, or
 * raw 8-bit samples. */
export interface StoredPicture {
	bytes: Uint8Array;
	raw: boolean;
	width: number;
	height: number;
	/** Grey or colour. */
	channels: 1 | 3;
}

/** A picture stored again as a colour JPEG, or null to keep it. */
export type Recode = (
	picture: StoredPicture,
) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>;

/** How many colour channels a picture's colour space has: 1 or 3, or
 * null for what a canvas would get wrong (CMYK, palettes, patterns). */
function channelsOf(doc: Doc, space: unknown, names: Names): 1 | 3 | null {
	const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream } = names;
	const value = doc.context.lookup(space as never);
	if (value instanceof PDFName) {
		if (value === PDFName.of("DeviceRGB")) return 3;
		if (value === PDFName.of("DeviceGray")) return 1;
		return null;
	}
	if (!(value instanceof PDFArray) || value.size() < 2) return null;
	if (value.get(0) !== PDFName.of("ICCBased")) return null;
	const profile = doc.context.lookup(value.get(1));
	const dict =
		profile instanceof PDFRawStream
			? profile.dict
			: profile instanceof PDFDict
				? profile
				: null;
	const count = dict?.get(PDFName.of("N"));
	if (!(count instanceof PDFNumber)) return null;
	const n = count.asNumber();
	return n === 1 || n === 3 ? n : null;
}

type Names = Awaited<ReturnType<typeof lib>>;

/** The stream filters pdf-lib can undo for a picture. */
const UNPACKED = [
	"/FlateDecode",
	"/LZWDecode",
	"/ASCII85Decode",
	"/ASCIIHexDecode",
	"/RunLengthDecode",
];

/**
 * A smaller copy: its pictures stored again, each only if that saves
 * something, and the file's structure packed. Masks, CMYK and palette
 * pictures, and anything else a JPEG would change, stay as they are.
 */
export async function compressPdf(
	bytes: Uint8Array,
	recode: Recode,
	{ password }: { password?: string } = {},
): Promise<Uint8Array> {
	const names = await lib();
	const { PDFArray, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } =
		names;
	const doc = await open(bytes, password);
	const { context } = doc;
	const key = (name: string) => PDFName.of(name);
	const images = context
		.enumerateIndirectObjects()
		.filter(
			(entry): entry is [PDFRef, RawStream] =>
				entry[1] instanceof PDFRawStream &&
				entry[1].dict.get(key("Subtype")) === key("Image"),
		);
	// A soft mask is a picture too, and must keep every grey it has.
	const masks = new Set(
		images
			.map(([, image]) => image.dict.get(key("SMask")))
			.filter((mask) => mask !== undefined),
	);
	for (const [ref, image] of images) {
		const { dict } = image;
		if (
			masks.has(ref) ||
			dict.has(key("ImageMask")) ||
			dict.has(key("Decode")) ||
			dict.has(key("DecodeParms")) ||
			dict.lookup(key("Mask")) instanceof PDFArray
		)
			continue;
		const filter = dict.lookup(key("Filter"));
		const filters =
			filter instanceof PDFArray
				? filter.asArray()
				: filter instanceof PDFName
					? [filter]
					: [];
		const jpeg = filters[filters.length - 1] === key("DCTDecode");
		// What wraps a JPEG, or holds a raw picture: both unpacked below.
		const wraps = jpeg ? filters.slice(0, -1) : filters;
		if (
			(!jpeg && !filters.length) ||
			wraps.some((name) => !UNPACKED.includes(String(name)))
		)
			continue;
		const channels = channelsOf(doc, dict.get(key("ColorSpace")), names);
		const width = dict.lookup(key("Width"));
		const height = dict.lookup(key("Height"));
		const bits = dict.lookup(key("BitsPerComponent"));
		if (
			!channels ||
			!(width instanceof PDFNumber) ||
			!(height instanceof PDFNumber) ||
			(bits instanceof PDFNumber && bits.asNumber() !== 8)
		)
			continue;
		let samples: Uint8Array;
		try {
			const unwrapped = dict.clone(context);
			unwrapped.delete(key("Filter"));
			if (wraps.length)
				unwrapped.set(key("Filter"), context.obj(wraps as never));
			// Through the stream's own decryption, for a locked file.
			samples = decodePDFRawStream(
				PDFRawStream.of(unwrapped, image.contents, image.transform),
			).decode();
		} catch {
			continue;
		}
		if (
			!jpeg &&
			samples.length < width.asNumber() * height.asNumber() * channels
		)
			continue;
		const made = await recode({
			bytes: samples,
			raw: !jpeg,
			width: width.asNumber(),
			height: height.asNumber(),
			channels,
		}).catch(() => null);
		// Not worth a generation of JPEG loss for less than a tenth.
		if (!made || made.bytes.length > image.contents.length * 0.9) continue;
		const next = dict.clone(context);
		next.set(key("Filter"), key("DCTDecode"));
		next.set(key("ColorSpace"), key("DeviceRGB"));
		next.set(key("BitsPerComponent"), PDFNumber.of(8));
		next.set(key("Width"), PDFNumber.of(made.width));
		next.set(key("Height"), PDFNumber.of(made.height));
		context.assign(ref, PDFRawStream.of(next, made.bytes));
	}
	return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}

/** A copy that asks for a password to open. */
export async function protect(
	bytes: Uint8Array,
	userPassword: string,
	{ password }: { password?: string } = {},
): Promise<Uint8Array> {
	if (!userPassword) throw new ToolError("empty");
	const doc = await open(bytes, password);
	const options: SecurityOptions = {
		userPassword,
		// The same password opens it with every right: it is the reader's.
		ownerPassword: userPassword,
		permissions: {
			printing: "highResolution",
			modifying: true,
			copying: true,
			annotating: true,
			fillingForms: true,
			contentAccessibility: true,
			documentAssembly: true,
		},
	};
	doc.encrypt(options);
	return doc.save();
}

/** A copy without the password, for a file the reader can open. */
export async function unlock(
	bytes: Uint8Array,
	password: string,
): Promise<Uint8Array> {
	const doc = await open(bytes, password);
	return doc.save();
}

/** A word read from a page, placed as fractions of the page as shown. */
export interface ReadWord {
	text: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rtl: boolean;
	/** How sure the reader was, out of 100, for words it read itself. */
	sure?: number;
}

/** Tesseract's own font for a text layer (Apache-2.0): every character
 * is the one blank glyph, half an em wide. */
const BLANK_FONT =
	"AAEAAAAKAIAAAwAgT1MvMlbeyJQAAAEoAAAAYGNtYXAACgA0AAABkAAAAB5nbHlmFSJBJAAAAbgAAAAYaGVhZAt48WUAAACsAAAANmhoZWEMAgQCAAAA5AAAACRobXR4BAAAAAAAAYgAAAAIbG9jYQAMAAAAAAGwAAAABm1heHAABAAFAAABCAAAACBuYW1l8usW2gAAAdAAAABLcG9zdAABAAEAAAIcAAAAIAABAAAAAQAAsJRxEF8PPPUEBwgAAAAAAM+a/G4AAAAA1MOn8gAAAAAEAAgAAAAAEAACAAAAAAAAAAEAAAgA//8AAAQAAAAAAAQAAAEAAAAAAAAAAAAAAAAAAAACAAEAAAACAAQAAQAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAwAAAZAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAR09PRwBAAAAAAAAB//8AAAABAAGAAAAAAAAAAAAAAAAAAAABAAAAAAAABAAAAAAAAAIAAQAAAAAAFAADAAAAAAAUAAYACgAAAAAAAAAAAAAAAAAMAAAAAQAAAAAEAAgAAAMAADEhESEEAPwACAAAAAADACoAAAADAAAABQAWAAAAAQAAAAAABQALABYAAwABBAkABQAWAAAAVgBlAHIAcwBpAG8AbgAgADEALgAwVmVyc2lvbiAxLjAAAAEAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAA=";

/** Each character code stands for itself. */
const SAME_CODES = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfrange
<0000> <FFFF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`;

/** The blank font as a PDF object: any character in UTF-16, drawn with
 * the blank glyph, and read back as itself by search and copy. */
async function embedBlankFont(doc: Doc): Promise<PDFRef> {
	const { PDFString } = await lib();
	const { context } = doc;
	const font = Uint8Array.from(atob(BLANK_FONT), (c) => c.charCodeAt(0));
	// Every one of the 65,536 codes points at glyph 1.
	const glyphs = new Uint8Array(2 << 16);
	for (let i = 1; i < glyphs.length; i += 2) glyphs[i] = 1;
	const face = context.obj({
		Type: "Font",
		Subtype: "CIDFontType2",
		BaseFont: "GlyphLessFont",
		CIDSystemInfo: {
			Registry: PDFString.of("Adobe"),
			Ordering: PDFString.of("Identity"),
			Supplement: 0,
		},
		CIDToGIDMap: context.register(context.flateStream(glyphs)),
		DW: 500,
		FontDescriptor: context.register(
			context.obj({
				Type: "FontDescriptor",
				FontName: "GlyphLessFont",
				Flags: 5,
				FontBBox: [0, 0, 500, 1000],
				ItalicAngle: 0,
				Ascent: 1000,
				Descent: 0,
				CapHeight: 1000,
				StemV: 80,
				FontFile2: context.register(
					context.flateStream(font, { Length1: font.length }),
				),
			}),
		),
	});
	return context.register(
		context.obj({
			Type: "Font",
			Subtype: "Type0",
			BaseFont: "GlyphLessFont",
			Encoding: "Identity-H",
			DescendantFonts: [context.register(face)],
			ToUnicode: context.register(context.flateStream(SAME_CODES)),
		}),
	);
}

/** Ends in a character of a script written without spaces. */
const NO_SPACES = /[　-ヿ㐀-鿿豈-﫿＀-￯]$/;

/** The drawing commands for one word, unseen (text mode 3). */
function wordCommands(
	word: ReadWord,
	box: ReturnType<typeof shownBox>,
	shownW: number,
	shownH: number,
): string {
	const size = word.h * shownH;
	const width = word.w * shownW;
	if (size <= 0 || width <= 0) return "";
	// A file's right-to-left text runs in the order it is drawn, so
	// readers put it back the other way.
	const text = word.rtl ? [...word.text].reverse().join("") : word.text;
	// A real space after it: a reader guessing words from the gaps runs
	// the words of some scripts together. Chinese has none to put back,
	// and one would split a word that search is looking for.
	const spaced = NO_SPACES.test(word.text) ? text : `${text} `;
	let hex = "";
	for (const unit of spaced.split(""))
		hex += unit.charCodeAt(0).toString(16).padStart(4, "0");
	// Stretched so the word covers what it says on the page.
	const stretch = (width / (text.length * size * 0.5)) * 100;
	const [x, y] = pagePoint(box, word.x, word.y + word.h);
	const turn = (box.turn * Math.PI) / 180;
	const n = (value: number) => Number(value.toFixed(3));
	const place = [
		Math.round(Math.cos(turn)),
		Math.round(Math.sin(turn)),
		-Math.round(Math.sin(turn)),
		Math.round(Math.cos(turn)),
		n(x),
		n(y),
	].join(" ");
	return `BT 3 Tr /PwOcr ${n(size)} Tf ${n(stretch)} Tz ${place} Tm <${hex}> Tj ET\n`;
}

/**
 * The same pages with the words read from them laid over each one,
 * unseen, so a scan can be searched, selected and read aloud. What the
 * pages show, and every picture on them, stays as it is.
 */
export async function addTextLayer(
	bytes: Uint8Array,
	pages: Array<{ page: number; words: ReadWord[] }>,
	{ password }: { password?: string } = {},
): Promise<Uint8Array> {
	if (!pages.some((p) => p.words.length)) throw new ToolError("empty");
	const { PDFName } = await lib();
	const doc = await open(bytes, password);
	const { context } = doc;
	const font = await embedBlankFont(doc);
	const name = PDFName.of("PwOcr");
	// Whatever a page leaves set stays inside these, away from the words.
	const opening = context.register(context.flateStream("q\n"));
	const closing = context.register(context.flateStream("Q\n"));
	for (const { page: index, words } of pages) {
		if (!words.length) continue;
		const page = doc.getPage(index);
		const box = shownBox(page);
		const [w, h] = shownSize(box);
		page.node.normalize();
		page.node.setFontDictionary(name, font);
		page.node.wrapContentStreams(opening, closing);
		page.node.addContentStream(
			context.register(
				context.flateStream(
					words.map((word) => wordCommands(word, box, w, h)).join(""),
				),
			),
		);
	}
	return doc.save({ updateFieldAppearances: false });
}
