/** Reflowable text extracted from formats Paperwren cannot lay out
 * page-faithfully (legacy .doc/.ppt, ODF text/slides, RTF). */

export interface Block {
	kind: "heading" | "para";
	text: string;
	/** Heading level 1-6. */
	level?: number;
}

export type Extracted =
	| { kind: "document"; blocks: Block[] }
	| { kind: "slides"; slides: Block[][] }
	| RichDoc;

/** Split plain text into paragraphs, dropping empty runs. */
export function paragraphs(text: string): Block[] {
	return text
		.split(/\n/)
		.map((line) => line.replace(/[ \t]+$/g, ""))
		.filter(
			(line, i, all) =>
				line.trim() !== "" || (i > 0 && all[i - 1].trim() !== ""),
		)
		.map((line) => ({ kind: "para" as const, text: line }));
}

// ---------- Rich documents ----------
// Legacy Word and OpenDocument text keep their character formatting,
// alignment, lists, tables, pictures and links. Pages are not laid
// out: the text flows to the screen, which is what a phone wants.

export interface RichRun {
	text: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	/** Font size in points. */
	size?: number;
	/** CSS colour. */
	color?: string;
	/** CSS highlight colour behind the text. */
	highlight?: string;
	font?: string;
	script?: "super" | "sub";
	/** http(s) or mailto link. */
	href?: string;
	/** Inline picture: index into the document's media, size in px. */
	image?: { media: number; width: number; height: number };
}

export interface RichPara {
	kind: "para";
	runs: RichRun[];
	align?: "left" | "center" | "right" | "justify";
	/** Heading level 1-6. */
	heading?: number;
	/** Left indent in px. */
	indent?: number;
	/** List item: nesting level (0-based) and the marker to show. */
	list?: { level: number; marker: string };
	/** A page break precedes this paragraph. */
	pageBreak?: boolean;
	/** Right-to-left paragraph. */
	rtl?: boolean;
}

export interface RichCell {
	blocks: RichBlock[];
	colSpan?: number;
	rowSpan?: number;
	/** Width in px, when the file says. */
	width?: number;
	fill?: string;
}

export interface RichTable {
	kind: "table";
	rows: RichCell[][];
	/** Column widths in px, when the file defines a grid. */
	cols?: number[];
}

export type RichBlock = RichPara | RichTable;

export interface RichMedia {
	bytes: Uint8Array;
	type: string;
}

export interface RichDoc {
	kind: "rich";
	blocks: RichBlock[];
	media: RichMedia[];
}

/** Image type from magic bytes; null for formats a browser cannot
 * show (EMF, WMF, PICT, TIFF). */
export function sniffImage(bytes: Uint8Array): string | null {
	const at = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
	if (at(0x89, 0x50, 0x4e, 0x47)) return "image/png";
	if (at(0xff, 0xd8, 0xff)) return "image/jpeg";
	if (at(0x47, 0x49, 0x46, 0x38)) return "image/gif";
	if (at(0x42, 0x4d)) return "image/bmp";
	if (at(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57) return "image/webp";
	return null;
}
