/**
 * Legacy Word (.doc, Word 97-2003) as a rich document: character
 * formatting, alignment, headings, lists, tables, inline pictures and
 * links, read from the binary format described in [MS-DOC].
 *
 * What is read:
 *   - the piece table (text), CHPX/PAPX property runs,
 *   - the style sheet (so "Heading 1" and "Normal" look as defined),
 *   - list definitions (bullets vs numbers per level),
 *   - table rows, cell widths, merges and shading,
 *   - inline pictures stored as PNG/JPEG/GIF/BMP.
 * Floating pictures are shown inline at their anchor.
 * What is not: page geometry, headers/footers, footnotes, drawn
 * shapes and text boxes, EMF/WMF pictures. The text flows to the
 * screen instead of being paginated.
 *
 * Pure byte reading, no DOM: this runs in the parse worker.
 */

import {
	RT,
	children,
	descendants,
	readBlipStore,
	readProps,
	storedImage,
} from "./escher";
import {
	type RichBlock,
	type RichCell,
	type RichDoc,
	type RichMedia,
	type RichPara,
	type RichRun,
	sniffImage,
} from "./model";

export type StreamLookup = (name: string) => Uint8Array | null;

const cp1252 = new TextDecoder("windows-1252");
const utf16 = new TextDecoder("utf-16le");

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const i16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;
const u32 = (b: Uint8Array, o: number) =>
	(b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Twips (1/1440 in) to CSS px. */
const twips = (t: number) => (t / 1440) * 96;

/** The 16 legacy "ico" colours; index 0 is automatic. */
const ICO = [
	undefined,
	"#000000",
	"#0000ff",
	"#00ffff",
	"#00ff00",
	"#ff00ff",
	"#ff0000",
	"#ffff00",
	"#ffffff",
	"#000080",
	"#008080",
	"#008000",
	"#800080",
	"#800000",
	"#808000",
	"#808080",
	"#c0c0c0",
];

// ---------- Property modifiers (sprms) ----------

interface Sprm {
	op: number;
	/** Operand bytes (for variable-size operands: without the length). */
	at: number;
	size: number;
}

/** Walk a grpprl. Malformed tails are dropped, never thrown. */
function sprms(b: Uint8Array, start: number, end: number): Sprm[] {
	const out: Sprm[] = [];
	let pos = start;
	while (pos + 2 <= end) {
		const op = u16(b, pos);
		pos += 2;
		let size: number;
		switch (op >> 13) {
			case 0:
			case 1:
				size = 1;
				break;
			case 2:
			case 4:
			case 5:
				size = 2;
				break;
			case 3:
				size = 4;
				break;
			case 7:
				size = 3;
				break;
			default:
				// Variable: one length byte, except two special cases.
				if (op === 0xd608 || op === 0xd606) {
					size = u16(b, pos) - 1;
					pos += 2;
				} else if (op === 0xc615) {
					size = b[pos];
					pos += 1;
					if (size === 255) return out; // sprmPChgTabs long form: stop
				} else {
					size = b[pos];
					pos += 1;
				}
		}
		if (size < 0 || pos + size > end) break;
		out.push({ op, at: pos, size });
		pos += size;
	}
	return out;
}

interface Chp {
	bold: boolean;
	italic: boolean;
	strike: boolean;
	underline: boolean;
	hidden: boolean;
	deleted: boolean;
	caps: boolean;
	/** Half-points. */
	hps: number;
	color?: string;
	highlight?: string;
	font?: number;
	script?: "super" | "sub";
	special: boolean;
	/** Offset of a picture in the Data stream. */
	pic?: number;
	/** Character style index, applied before the run's own sprms. */
	istd?: number;
	symbol?: number;
}

interface Pap {
	istd: number;
	align?: RichPara["align"];
	inTable: boolean;
	ttp: boolean;
	innerCell: boolean;
	innerTtp: boolean;
	depth: number;
	ilvl: number;
	ilfo: number;
	indent: number;
	pageBreakBefore: boolean;
	rtl: boolean;
	/** Cell edges in twips (itcMac + 1 of them), from sprmTDefTable. */
	edges?: number[];
	/** Per-cell merge flags from sprmTDefTable. */
	cells?: Array<{
		merged: boolean;
		first: boolean;
		vMerged: boolean;
		vRestart: boolean;
	}>;
	shades?: Array<string | undefined>;
}

const baseChp = (): Chp => ({
	bold: false,
	italic: false,
	strike: false,
	underline: false,
	hidden: false,
	deleted: false,
	caps: false,
	hps: 20,
	special: false,
});

const basePap = (): Pap => ({
	istd: 0,
	inTable: false,
	ttp: false,
	innerCell: false,
	innerTtp: false,
	depth: 0,
	ilvl: 0,
	ilfo: 0,
	indent: 0,
	pageBreakBefore: false,
	rtl: false,
});

/** A toggle operand: 0 off, 1 on, 0x80 as the style, 0x81 its opposite. */
const toggle = (operand: number, style: boolean) =>
	operand === 0x80 ? style : operand === 0x81 ? !style : operand !== 0;

const colorRef = (b: Uint8Array, at: number): string | undefined =>
	b[at + 3] === 0xff
		? undefined // cvAuto
		: `#${[b[at], b[at + 1], b[at + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Apply character sprms. `style` is the paragraph style's formatting
 * that toggles are relative to. */
function applyChp(chp: Chp, b: Uint8Array, list: Sprm[], style: Chp) {
	for (const { op, at } of list) {
		const v = b[at];
		switch (op) {
			case 0x0835:
				chp.bold = toggle(v, style.bold);
				break;
			case 0x0836:
				chp.italic = toggle(v, style.italic);
				break;
			case 0x0837:
			case 0x2a53:
				chp.strike = toggle(v, style.strike);
				break;
			case 0x083b:
				chp.caps = toggle(v, style.caps);
				break;
			case 0x083c:
				chp.hidden = toggle(v, style.hidden);
				break;
			case 0x0800:
				chp.deleted = v !== 0;
				break;
			case 0x2a3e:
				chp.underline = v !== 0;
				break;
			case 0x4a43:
				chp.hps = u16(b, at) || chp.hps;
				break;
			case 0x2a42:
				chp.color = ICO[v] ?? undefined;
				break;
			case 0x6870:
				chp.color = colorRef(b, at);
				break;
			case 0x2a0c:
				chp.highlight = v > 0 && v < ICO.length ? ICO[v] : undefined;
				break;
			case 0x4a4f:
				chp.font = u16(b, at);
				break;
			case 0x2a48:
				chp.script = v === 1 ? "super" : v === 2 ? "sub" : undefined;
				break;
			case 0x0855:
				chp.special = v !== 0;
				break;
			case 0x6a03:
				chp.pic = u32(b, at);
				break;
			case 0x4a30:
				chp.istd = u16(b, at);
				break;
			case 0x6a09:
				chp.font = u16(b, at);
				chp.symbol = u16(b, at + 2);
				break;
		}
	}
}

const JC: Array<RichPara["align"]> = ["left", "center", "right", "justify"];

function applyPap(pap: Pap, b: Uint8Array, list: Sprm[]) {
	for (const { op, at, size } of list) {
		const v = b[at];
		switch (op) {
			case 0x2461:
			case 0x2403:
				pap.align = JC[v] ?? pap.align;
				break;
			case 0x2416:
				pap.inTable = v !== 0;
				break;
			case 0x2417:
				pap.ttp = v !== 0;
				break;
			case 0x244b:
				pap.innerCell = v !== 0;
				break;
			case 0x244c:
				pap.innerTtp = v !== 0;
				break;
			case 0x6649:
				pap.depth = u32(b, at);
				break;
			case 0x260a:
				pap.ilvl = v;
				break;
			case 0x460b:
				pap.ilfo = u16(b, at);
				break;
			case 0x840f:
			case 0x845e:
				pap.indent = i16(b, at);
				break;
			case 0x2407:
				pap.pageBreakBefore = v !== 0;
				break;
			case 0x2441:
				pap.rtl = v !== 0;
				break;
			case 0xd608: {
				// sprmTDefTable: itcMac, itcMac + 1 edges, then TC80 per cell.
				const count = v;
				if (count === 0 || 1 + (count + 1) * 2 > size) break;
				const edges: number[] = [];
				for (let i = 0; i <= count; i++) edges.push(i16(b, at + 1 + i * 2));
				const cells: Pap["cells"] = [];
				const tc = at + 1 + (count + 1) * 2;
				for (let i = 0; i < count; i++) {
					const o = tc + i * 20;
					const flags = o + 2 <= at + size ? u16(b, o) : 0;
					cells.push({
						first: (flags & 0x0001) !== 0,
						merged: (flags & 0x0002) !== 0,
						vMerged: (flags & 0x0020) !== 0,
						vRestart: (flags & 0x0040) !== 0,
					});
				}
				pap.edges = edges;
				pap.cells = cells;
				break;
			}
			case 0xd612:
			case 0xd670: {
				// sprmTDefTableShd: one 10-byte SHD (fore, back, pattern) per cell.
				const shades: Array<string | undefined> = [];
				for (let o = at; o + 10 <= at + size; o += 10) {
					const pattern = u16(b, o + 8);
					shades.push(
						pattern === 0xffff
							? undefined
							: pattern === 1
								? colorRef(b, o)
								: colorRef(b, o + 4),
					);
				}
				pap.shades = shades;
				break;
			}
		}
	}
}

// ---------- Tables of property runs ----------

interface Run {
	start: number;
	end: number;
	/** Range of the grpprl inside `source`; istd for paragraphs. */
	from: number;
	to: number;
	istd: number;
}

/** Read every FKP page listed by a PlcfBte{Chpx,Papx}. */
function readRuns(
	word: Uint8Array,
	table: Uint8Array,
	fc: number,
	lcb: number,
	paragraphs: boolean,
): Run[] {
	const runs: Run[] = [];
	if (lcb < 12 || fc + lcb > table.length) return runs;
	const n = Math.floor((lcb - 4) / 8);
	for (let i = 0; i < n; i++) {
		const page = (u32(table, fc + (n + 1) * 4 + i * 4) & 0x3fffff) * 512;
		if (page + 512 > word.length) continue;
		const count = word[page + 511];
		const boxes = page + (count + 1) * 4;
		for (let k = 0; k < count; k++) {
			const start = u32(word, page + k * 4);
			const end = u32(word, page + (k + 1) * 4);
			const offset = word[boxes + k * (paragraphs ? 13 : 1)] * 2;
			let from = 0;
			let to = 0;
			let istd = 0;
			if (offset > 0) {
				let at = page + offset;
				let cb = word[at++];
				if (paragraphs) {
					if (cb === 0) cb = word[at++] * 2;
					else cb = cb * 2 - 1;
					istd = u16(word, at);
					from = at + 2;
					to = Math.min(at + cb, page + 511);
				} else {
					from = at;
					to = Math.min(at + cb, page + 511);
				}
			}
			if (end > start) runs.push({ start, end, from, to, istd });
		}
	}
	runs.sort((a, b) => a.start - b.start);
	return runs;
}

/** The run that covers file offset `fc` (binary search). */
function runAt(runs: Run[], fc: number): Run | undefined {
	let lo = 0;
	let hi = runs.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const r = runs[mid];
		if (fc < r.start) hi = mid - 1;
		else if (fc >= r.end) lo = mid + 1;
		else return r;
	}
	return undefined;
}

// ---------- Style sheet ----------

interface Style {
	/** Built-in style id: 0 Normal, 1-9 Heading 1-9. */
	sti: number;
	paragraph: boolean;
	base: number;
	pap?: [number, number];
	chp?: [number, number];
}

function readStyles(table: Uint8Array, fc: number, lcb: number): Style[] {
	const styles: Style[] = [];
	if (lcb < 4 || fc + lcb > table.length) return styles;
	const end = fc + lcb;
	const cbStshi = u16(table, fc);
	const stshi = fc + 2;
	const count = u16(table, stshi);
	const baseSize = u16(table, stshi + 2);
	let pos = stshi + cbStshi;
	for (let i = 0; i < count && pos + 2 <= end; i++) {
		const cbStd = u16(table, pos);
		const std = pos + 2;
		pos = std + cbStd;
		if (cbStd === 0 || pos > end) {
			styles.push({ sti: 0xfff, paragraph: false, base: 0xfff });
			continue;
		}
		const sti = u16(table, std) & 0x0fff;
		const second = u16(table, std + 2);
		const kind = second & 0x000f;
		const base = second >> 4;
		const cupx = u16(table, std + 4) & 0x000f;
		// Name: length-prefixed UTF-16, null-terminated.
		let at = std + baseSize;
		const nameLength = u16(table, at);
		at += 2 + (nameLength + 1) * 2;
		const style: Style = { sti, paragraph: kind === 1, base };
		for (let k = 0; k < cupx && at + 2 <= pos; k++) {
			if ((at - std) & 1) at++; // UPXs start on even offsets
			const cb = u16(table, at);
			const body = at + 2;
			at = body + cb;
			if (at > pos) break;
			if (kind === 1 && k === 0) style.pap = [body + 2, at];
			else if ((kind === 1 && k === 1) || (kind === 2 && k === 0))
				style.chp = [body, at];
		}
		styles.push(style);
	}
	return styles;
}

// ---------- Lists ----------

/** nfc (number format) of each level, per list. */
function readLists(
	table: Uint8Array,
	fcLst: number,
	lcbLst: number,
	fcLfo: number,
	lcbLfo: number,
): Array<number[] | undefined> {
	const byLfo: Array<number[] | undefined> = [];
	if (lcbLst < 2 || lcbLfo < 4) return byLfo;
	try {
		const count = u16(table, fcLst);
		const lists: Array<{ lsid: number; levels: number }> = [];
		let pos = fcLst + 2;
		for (let i = 0; i < count; i++) {
			lists.push({
				lsid: u32(table, pos),
				levels: table[pos + 26] & 1 ? 1 : 9,
			});
			pos += 28;
		}
		// The LVL structures follow the whole PlfLst.
		const formats = new Map<number, number[]>();
		for (const list of lists) {
			const nfcs: number[] = [];
			for (let l = 0; l < list.levels; l++) {
				nfcs.push(table[pos + 4]);
				const cbChpx = table[pos + 24];
				const cbPapx = table[pos + 25];
				pos += 28 + cbPapx + cbChpx;
				pos += 2 + u16(table, pos) * 2; // number text (xst)
			}
			formats.set(list.lsid, nfcs);
		}
		const lfoCount = u32(table, fcLfo);
		for (let i = 0; i < lfoCount; i++)
			byLfo[i + 1] = formats.get(u32(table, fcLfo + 4 + i * 16));
	} catch {
		// Lists degrade to plain bullets.
	}
	return byLfo;
}

function roman(n: number): string {
	const map: Array<[number, string]> = [
		[1000, "m"],
		[900, "cm"],
		[500, "d"],
		[400, "cd"],
		[100, "c"],
		[90, "xc"],
		[50, "l"],
		[40, "xl"],
		[10, "x"],
		[9, "ix"],
		[5, "v"],
		[4, "iv"],
		[1, "i"],
	];
	let out = "";
	let left = Math.max(1, Math.min(3999, n));
	for (const [value, glyph] of map)
		while (left >= value) {
			out += glyph;
			left -= value;
		}
	return out;
}

const letters = (n: number) => {
	let out = "";
	for (let left = Math.max(1, n); left > 0; left = Math.floor((left - 1) / 26))
		out = String.fromCharCode(97 + ((left - 1) % 26)) + out;
	return out;
};

/** The marker a list level shows for its n-th item. */
export function listMarker(nfc: number | undefined, n: number, level: number) {
	switch (nfc) {
		case 0:
			return `${n}.`;
		case 1:
			return `${roman(n).toUpperCase()}.`;
		case 2:
			return `${roman(n)}.`;
		case 3:
			return `${letters(n).toUpperCase()}.`;
		case 4:
			return `${letters(n)}.`;
		case 22:
			return `${String(n).padStart(2, "0")}.`;
		default:
			return ["•", "◦", "▪"][level % 3];
	}
}

// ---------- Fonts ----------

function readFonts(table: Uint8Array, fc: number, lcb: number): string[] {
	const fonts: string[] = [];
	if (lcb < 4 || fc + lcb > table.length) return fonts;
	const count = u16(table, fc);
	let pos = fc + 4;
	for (let i = 0; i < count && pos < fc + lcb; i++) {
		const cb = table[pos];
		const name = pos + 40;
		let end = name;
		while (end + 1 < pos + 1 + cb && u16(table, end) !== 0) end += 2;
		fonts.push(utf16.decode(table.subarray(name, end)));
		pos += 1 + cb;
	}
	return fonts;
}

// ---------- Pictures ----------

/** The first browser-displayable image inside a PICF's shape data. */
function readPicture(
	data: Uint8Array,
	offset: number,
): { bytes: Uint8Array; type: string; width: number; height: number } | null {
	if (offset + 0x44 > data.length) return null;
	const lcb = u32(data, offset);
	const header = u16(data, offset + 4);
	const end = Math.min(data.length, offset + lcb);
	if (header < 0x2c || offset + header >= end) return null;
	const scaleX = (u16(data, offset + 0x20) || 1000) / 1000;
	const scaleY = (u16(data, offset + 0x22) || 1000) / 1000;
	const width = twips(i16(data, offset + 0x1c)) * scaleX;
	const height = twips(i16(data, offset + 0x1e)) * scaleY;
	// Image payloads sit inside OfficeArt BLIP records after a UID and
	// a tag byte; finding the signature is sturdier than counting them.
	for (let i = offset + header; i + 8 < end; i++) {
		const png =
			data[i] === 0x89 &&
			data[i + 1] === 0x50 &&
			data[i + 2] === 0x4e &&
			data[i + 3] === 0x47;
		const jpeg =
			data[i] === 0xff && data[i + 1] === 0xd8 && data[i + 2] === 0xff;
		if (!png && !jpeg) continue;
		const bytes = data.slice(i, end);
		const type = sniffImage(bytes);
		if (type) return { bytes, type, width, height };
	}
	return null;
}

// ---------- Document ----------

interface Piece {
	cpStart: number;
	chars: number;
	/** File offset of the first character and bytes per character. */
	fc: number;
	wide: boolean;
}

function readPieces(
	word: Uint8Array,
	table: Uint8Array,
	fcClx: number,
	lcbClx: number,
): Piece[] {
	const pieces: Piece[] = [];
	if (lcbClx <= 0 || fcClx + lcbClx > table.length) return pieces;
	let pos = fcClx;
	const end = fcClx + lcbClx;
	while (pos < end && table[pos] === 0x01) pos += 3 + u16(table, pos + 1);
	if (table[pos] !== 0x02) throw new Error("corrupt: no piece table");
	const lcb = u32(table, pos + 1);
	const plc = pos + 5;
	const n = Math.floor((lcb - 4) / 12);
	for (let i = 0; i < n; i++) {
		const cpStart = u32(table, plc + i * 4);
		const cpEnd = u32(table, plc + (i + 1) * 4);
		const raw = u32(table, plc + (n + 1) * 4 + i * 8 + 2);
		const compressed = (raw & 0x40000000) !== 0;
		const fc = compressed ? (raw & 0x3fffffff) / 2 : raw;
		const chars = cpEnd - cpStart;
		if (chars > 0 && fc + chars * (compressed ? 1 : 2) <= word.length)
			pieces.push({ cpStart, chars, fc, wide: !compressed });
	}
	return pieces;
}

interface DocParagraph {
	runs: RichRun[];
	pap: Pap;
	/** 0x0D paragraph, 0x07 cell/row mark, 0x0C page/section break. */
	mark: number;
}

/** Drop the in-text anchors of pictures, footnotes, comments and
 * drawn objects (U+0001, U+0002, U+0005, U+0008). */
function stripAnchors(text: string): string {
	let out = "";
	for (const ch of text) {
		const code = ch.charCodeAt(0);
		if (code !== 1 && code !== 2 && code !== 5 && code !== 8) out += ch;
	}
	return out;
}

const safeHref = (url: string) =>
	/^(https?:|mailto:)/i.test(url) ? url : undefined;

export function parseDoc(stream: StreamLookup): RichDoc {
	const word = stream("WordDocument");
	if (!word || word.length < 0x1aa)
		throw new Error("corrupt: no WordDocument stream");
	if (u16(word, 0) !== 0xa5ec) throw new Error("corrupt: bad FIB");
	const flags = u16(word, 0x0a);
	if (flags & 0x0100) throw new Error("password: encrypted document");
	if (u16(word, 2) < 0x00c1) throw new Error("unsupported: Word 6/95");
	const table = stream(flags & 0x0200 ? "1Table" : "0Table");
	if (!table) throw new Error("corrupt: no table stream");
	// Pictures normally sit in the Data stream; some writers keep them
	// in the main stream instead.
	const data = stream("Data") ?? word;

	const pair = (index: number): [number, number] => [
		u32(word, 0x9a + index * 8),
		u32(word, 0x9e + index * 8),
	];
	const pairCount = u16(word, 0x98);
	const optional = (index: number): [number, number] =>
		index < pairCount && 0xa2 + index * 8 <= word.length ? pair(index) : [0, 0];

	const pieces = readPieces(word, table, ...pair(33));
	const chpRuns = readRuns(word, table, ...pair(12), false);
	const papRuns = readRuns(word, table, ...pair(13), true);
	const styles = readStyles(table, ...pair(1));
	const fonts = readFonts(table, ...pair(15));
	const lists = readLists(table, ...optional(73), ...optional(74));
	const mainEnd = u32(word, 0x4c); // ccpText: the body, before footnotes etc.

	// Style formatting, resolved through the "based on" chain.
	const styleCache = new Map<number, { chp: Chp; pap: Pap }>();
	const resolveStyle = (istd: number, depth = 0): { chp: Chp; pap: Pap } => {
		const cached = styleCache.get(istd);
		if (cached) return cached;
		const style = styles[istd];
		const base =
			style && style.base !== 0xfff && style.base !== istd && depth < 12
				? resolveStyle(style.base, depth + 1)
				: { chp: baseChp(), pap: basePap() };
		const out = { chp: { ...base.chp }, pap: { ...base.pap, istd } };
		if (style?.pap)
			applyPap(out.pap, table, sprms(table, style.pap[0], style.pap[1]));
		if (style?.chp)
			applyChp(
				out.chp,
				table,
				sprms(table, style.chp[0], style.chp[1]),
				base.chp,
			);
		styleCache.set(istd, out);
		return out;
	};

	const media: RichMedia[] = [];
	const mediaAt = new Map<number, RichRun["image"] | null>();
	const picture = (offset: number): RichRun["image"] | null => {
		if (mediaAt.has(offset)) return mediaAt.get(offset) ?? null;
		const pic = readPicture(data, offset);
		const image = pic
			? {
					media: media.push({ bytes: pic.bytes, type: pic.type }) - 1,
					width: Math.round(pic.width),
					height: Math.round(pic.height),
				}
			: null;
		mediaAt.set(offset, image);
		return image;
	};

	// Floating pictures: an anchor character (0x08) at a CP names a
	// shape; the shape names a picture in the drawing's picture store.
	const floating = new Map<number, RichRun["image"] | null>();
	try {
		const [fcSpa, lcbSpa] = optional(40);
		const [fcDgg, lcbDgg] = optional(50);
		if (lcbSpa >= 34 && lcbDgg > 16 && fcDgg + lcbDgg <= table.length) {
			const store = readBlipStore(table, fcDgg, fcDgg + lcbDgg);
			// Drawings follow the first container, each after a one-byte tag.
			const shapes = new Map<number, number>();
			let pos = fcDgg;
			while (pos + 8 <= fcDgg + lcbDgg) {
				const rec = children(table, pos, fcDgg + lcbDgg)[0];
				if (!rec) break;
				for (const sp of descendants(
					table,
					rec.body,
					rec.end,
					RT.spContainer,
				)) {
					const parts = children(table, sp.body, sp.end);
					const head = parts.find((r) => r.type === RT.sp);
					const opt = parts.find((r) => r.type === RT.opt);
					const pib = opt ? readProps(table, opt).values.get(0x0104) : 0;
					if (head && pib) shapes.set(u32(table, head.body), pib);
				}
				pos = rec.end + 1;
			}
			const n = Math.floor((lcbSpa - 4) / 30);
			for (let i = 0; i < n; i++) {
				const spa = fcSpa + (n + 1) * 4 + i * 26;
				const pib = shapes.get(u32(table, spa));
				const found = pib ? storedImage(store[pib - 1], table, word) : null;
				const width = (u32(table, spa + 12) - u32(table, spa + 4)) | 0;
				const height = (u32(table, spa + 16) - u32(table, spa + 8)) | 0;
				floating.set(
					u32(table, fcSpa + i * 4),
					found
						? {
								media: media.push(found) - 1,
								width: Math.round(twips(width)),
								height: Math.round(twips(height)),
							}
						: null,
				);
			}
		}
	} catch {
		// Floating pictures are optional; the text still shows.
	}

	// ---- pass 1: paragraphs with formatted runs ----
	const paragraphs: DocParagraph[] = [];
	let runs: RichRun[] = [];
	// Field state: instruction text is hidden; a HYPERLINK's result links.
	const fields: Array<{
		instruction: string;
		inResult: boolean;
		href?: string;
	}> = [];

	const endParagraph = (markFc: number, mark: number) => {
		const run = runAt(papRuns, markFc);
		const istd = run?.istd ?? 0;
		const pap = { ...resolveStyle(istd).pap, istd };
		if (run && run.to > run.from)
			applyPap(pap, word, sprms(word, run.from, run.to));
		paragraphs.push({ runs, pap, mark });
		runs = [];
	};

	// Character formatting needs the paragraph's style, which is only
	// known at the paragraph mark: collect raw spans, then resolve.
	interface Span {
		text: string;
		run?: Run;
		href?: string;
		image?: RichRun["image"];
	}
	let spans: Span[] = [];
	const flushSpans = (markFc: number) => {
		const para = runAt(papRuns, markFc);
		const style = resolveStyle(para?.istd ?? 0).chp;
		for (const span of spans) {
			const chp: Chp = { ...style };
			if (span.run && span.run.to > span.run.from) {
				const list = sprms(word, span.run.from, span.run.to);
				// A character style applies before the run's own formatting.
				const cs = list.find((s) => s.op === 0x4a30);
				if (cs) {
					const charStyle = styles[u16(word, cs.at)];
					if (charStyle?.chp)
						applyChp(
							chp,
							table,
							sprms(table, charStyle.chp[0], charStyle.chp[1]),
							style,
						);
				}
				applyChp(chp, word, list, style);
			}
			if (chp.hidden || chp.deleted) continue;
			const format: Omit<RichRun, "text"> = {
				bold: chp.bold || undefined,
				italic: chp.italic || undefined,
				underline: chp.underline || undefined,
				strike: chp.strike || undefined,
				size: chp.hps / 2,
				color: chp.color,
				highlight: chp.highlight,
				font: chp.font !== undefined ? fonts[chp.font] : undefined,
				script: chp.script,
				href: span.href,
			};
			if (span.image) {
				runs.push({ ...format, text: "", image: span.image });
				continue;
			}
			if (
				chp.special &&
				chp.pic !== undefined &&
				span.text.includes("\u0001")
			) {
				const image = picture(chp.pic);
				if (image) runs.push({ ...format, text: "", image });
				continue;
			}
			let text = stripAnchors(span.text);
			if (chp.symbol !== undefined && chp.special)
				// Symbol fonts live in the private-use block F0xx.
				text = String.fromCharCode(
					(chp.symbol & 0xff00) === 0xf000 ? chp.symbol & 0xff : chp.symbol,
				);
			if (chp.caps) text = text.toUpperCase();
			if (!text) continue;
			const last = runs[runs.length - 1];
			if (last && !last.image && sameFormat(last, format)) last.text += text;
			else runs.push({ ...format, text });
		}
		spans = [];
	};

	for (const piece of pieces) {
		if (piece.cpStart >= mainEnd) break;
		const chars = Math.min(piece.chars, mainEnd - piece.cpStart);
		const step = piece.wide ? 2 : 1;
		const text = piece.wide
			? utf16.decode(word.subarray(piece.fc, piece.fc + chars * 2))
			: cp1252.decode(word.subarray(piece.fc, piece.fc + chars));
		let i = 0;
		while (i < chars) {
			const fc = piece.fc + i * step;
			const run = runAt(chpRuns, fc);
			// This formatting run ends here, or at the end of the piece.
			const stop = run
				? Math.min(chars, i + Math.ceil((run.end - fc) / step))
				: i + 1;
			let buffer = "";
			const emit = () => {
				if (!buffer) return;
				const field = fields[fields.length - 1];
				if (!fields.some((f) => !f.inResult))
					spans.push({ text: buffer, run, href: field?.href });
				buffer = "";
			};
			const limit = Math.min(chars, Math.max(stop, i + 1));
			for (; i < limit; i++) {
				const code = text.charCodeAt(i);
				const at = piece.fc + i * step;
				if (code === 0x13) {
					emit();
					fields.push({ instruction: "", inResult: false });
				} else if (code === 0x14) {
					emit();
					const field = fields[fields.length - 1];
					if (field) {
						field.inResult = true;
						const link = /HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(
							field.instruction,
						);
						field.href = link ? safeHref(link[1]) : undefined;
					}
				} else if (code === 0x15) {
					emit();
					fields.pop();
				} else if (fields.length && !fields[fields.length - 1].inResult) {
					fields[fields.length - 1].instruction += text[i];
				} else if (code === 0x0d || code === 0x07 || code === 0x0c) {
					emit();
					flushSpans(at);
					endParagraph(at, code);
				} else if (code === 0x08) {
					emit();
					const image = floating.get(piece.cpStart + i);
					if (image) spans.push({ text: "", run, image });
				} else if (code === 0x0b) buffer += "\n";
				else if (code === 0x1e) buffer += "-";
				else if (code === 0x1f) buffer += "";
				else if (code === 0xa0) buffer += " ";
				else if (code === 0x09 || code >= 0x20 || code <= 0x08)
					buffer += text[i];
			}
			emit();
		}
	}
	if (spans.length || runs.length) {
		const last = pieces[pieces.length - 1];
		const at = last ? last.fc + (last.chars - 1) * (last.wide ? 2 : 1) : 0;
		flushSpans(at);
		endParagraph(at, 0x0d);
	}

	// ---- pass 2: headings, lists and tables ----
	const blocks: RichBlock[] = [];
	const counters = new Map<number, number[]>();
	let pendingBreak = false;

	const toBlock = (p: DocParagraph): RichPara => {
		const sti = styles[p.pap.istd]?.sti ?? 0;
		const para: RichPara = {
			kind: "para",
			runs: p.runs,
			align: p.pap.align,
			heading: sti >= 1 && sti <= 9 ? Math.min(6, sti) : undefined,
			indent: p.pap.indent > 0 ? Math.round(twips(p.pap.indent)) : undefined,
			rtl: p.pap.rtl || undefined,
			pageBreak: p.pap.pageBreakBefore || pendingBreak || undefined,
		};
		pendingBreak = false;
		if (p.pap.ilfo > 0 && p.pap.ilfo < 0x07ff && p.runs.length) {
			const level = Math.min(8, p.pap.ilvl);
			const counts = counters.get(p.pap.ilfo) ?? [];
			counts[level] = (counts[level] ?? 0) + 1;
			counts.length = level + 1; // deeper levels restart
			counters.set(p.pap.ilfo, counts);
			para.list = {
				level,
				marker: listMarker(lists[p.pap.ilfo]?.[level], counts[level], level),
			};
			para.indent = undefined;
		}
		return para;
	};

	let cell: RichBlock[] = [];
	let row: RichBlock[][] = [];
	let tableRows: RichCell[][] = [];
	/** Left/right edge (twips) of every cell, row by row. */
	let rowEdges: Array<Array<[number, number]> | null> = [];
	/** Vertical merges still open, by left edge. */
	const open = new Map<number, RichCell>();

	// Word gives each row its own cell edges; that is also how it
	// stores horizontal merges. One shared grid of every edge turns
	// them into column rowEdges.
	const endTable = () => {
		if (tableRows.length) {
			const snap = (t: number) => Math.round(t / 15) * 15;
			const grid = [
				...new Set(rowEdges.flatMap((row) => row?.flat() ?? []).map(snap)),
			].sort((a, b) => a - b);
			if (grid.length > 1 && rowEdges.every(Boolean)) {
				tableRows.forEach((cells, r) =>
					cells.forEach((made, c) => {
						const edge = rowEdges[r]?.[c];
						if (!edge) return;
						const span =
							grid.indexOf(snap(edge[1])) - grid.indexOf(snap(edge[0]));
						made.colSpan = span > 1 ? span : undefined;
					}),
				);
				blocks.push({
					kind: "table",
					rows: tableRows,
					cols: grid
						.slice(1)
						.map((edge, i) => Math.max(4, Math.round(twips(edge - grid[i])))),
				});
			} else blocks.push({ kind: "table", rows: tableRows });
		}
		tableRows = [];
		rowEdges = [];
		open.clear();
	};

	for (const p of paragraphs) {
		const inTable = p.pap.inTable || p.pap.depth > 0;
		if (!inTable) {
			endTable();
			if (p.mark === 0x0c) {
				if (p.runs.length) blocks.push(toBlock(p));
				pendingBreak = true;
				continue;
			}
			blocks.push(toBlock(p));
			continue;
		}
		// Nested tables flatten into their outer cell.
		if (p.pap.innerTtp) continue;
		if (p.mark !== 0x07) {
			if (p.runs.length || !p.pap.innerCell) cell.push(toBlock(p));
			continue;
		}
		if (!p.pap.ttp) {
			if (p.runs.length || cell.length === 0) cell.push(toBlock(p));
			row.push(cell);
			cell = [];
			continue;
		}
		// Row end: apply the row's cell definitions.
		const cells: RichCell[] = [];
		const { edges, cells: defs, shades } = p.pap;
		const known = !!edges && edges.length > row.length;
		const rowSpans: Array<[number, number]> = [];
		row.forEach((content, c) => {
			const def = defs?.[c];
			const left = known && edges ? edges[c] : c;
			const right = known && edges ? edges[c + 1] : c + 1;
			if (def?.merged && !def.first && rowSpans.length) {
				// Old-style horizontal merge: widen the cell before it.
				rowSpans[rowSpans.length - 1][1] = right;
				return;
			}
			const above = open.get(left);
			if (def?.vMerged && !def.vRestart && above) {
				above.rowSpan = (above.rowSpan ?? 1) + 1;
				return;
			}
			const made: RichCell = {
				blocks: content,
				width: known ? Math.max(8, Math.round(twips(right - left))) : undefined,
				fill: shades?.[c],
			};
			if (def?.vMerged && def.vRestart) open.set(left, made);
			else open.delete(left);
			cells.push(made);
			rowSpans.push([left, right]);
		});
		if (cells.length) {
			tableRows.push(cells);
			rowEdges.push(known ? rowSpans : null);
		}
		row = [];
		cell = [];
	}
	endTable();
	// An unterminated row (damaged file) still shows its text.
	for (const content of [...row, cell]) blocks.push(...content);

	// Trailing empty paragraphs are noise.
	while (blocks.length) {
		const last = blocks[blocks.length - 1];
		if (last.kind === "para" && last.runs.length === 0) blocks.pop();
		else break;
	}
	return { kind: "rich", blocks, media };
}

function sameFormat(a: RichRun, b: Omit<RichRun, "text">): boolean {
	return (
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strike === b.strike &&
		a.size === b.size &&
		a.color === b.color &&
		a.highlight === b.highlight &&
		a.font === b.font &&
		a.script === b.script &&
		a.href === b.href
	);
}
