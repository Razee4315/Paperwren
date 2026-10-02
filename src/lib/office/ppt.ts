/**
 * Legacy PowerPoint (.ppt, PowerPoint 97-2003) as real slides: the
 * same model the .pptx reader produces, so one viewer draws both.
 * Format: [MS-PPT] records around an OfficeArt drawing per slide.
 *
 * What is read:
 *   - the persist directory (so the LIVE version of each slide is
 *     used, in the deck's own order, after any number of quick saves),
 *   - slide size, colour schemes, backgrounds (colour or picture),
 *   - shapes with position, rotation, fill and outline; groups,
 *   - text with the master's styles per placeholder type and level,
 *     plus each run's own formatting; bullets, alignment, spacing,
 *   - pictures (PNG/JPEG/GIF) with their crop, speaker notes,
 *   - the master's decorative shapes when a slide follows its master.
 * What is not: EMF/WMF pictures, charts and OLE objects (labelled
 * boxes), gradients and patterns (first colour), animations.
 *
 * Pure byte reading, no DOM: this runs in the parse worker. Pictures
 * come back as bytes; the viewer turns them into blob URLs.
 */

import { startsRtl } from "../bidi";
import { bulletGlyph } from "../pptx/bullets";
import type { Para, Run, Slide, SlideElement, TextBody } from "../pptx/parse";
import {
	type Props,
	RT,
	type Rec,
	children,
	descendants,
	fixed,
	i16,
	i32,
	readBlipStore,
	readProps,
	storedImage,
	u16,
	u32,
} from "./escher";
import type { RichMedia } from "./model";

export type StreamLookup = (name: string) => Uint8Array | null;

/** A parsed deck before its pictures become URLs: image sources and
 * picture backgrounds are "media:<index>" into `media`. */
export interface RawDeck {
	width: number;
	height: number;
	slides: Slide[];
	media: RichMedia[];
}

const utf16 = new TextDecoder("utf-16le");

// [MS-PPT] record types.
const R = {
	document: 0x03e8,
	documentAtom: 0x03e9,
	slide: 0x03ee,
	slideAtom: 0x03ef,
	notes: 0x03f0,
	notesAtom: 0x03f1,
	environment: 0x03f2,
	slidePersist: 0x03f3,
	mainMaster: 0x03f8,
	drawingGroup: 0x040b,
	drawing: 0x040c,
	colorScheme: 0x07f0,
	fontCollection: 0x07d5,
	placeholder: 0x0bc3,
	outlineTextRef: 0x0f9e,
	textHeader: 0x0f9f,
	textChars: 0x0fa0,
	styleTextProp: 0x0fa1,
	masterStyle: 0x0fa3,
	textBytes: 0x0fa8,
	fontEntity: 0x0fb7,
	slideList: 0x0ff0,
	userEdit: 0x0ff5,
	persistDirectory: 0x1772,
} as const;

/** Master units (576 per inch) to CSS px. */
const mu = (v: number) => v / 6;
const emu = (v: number) => v / 9525;

// ---------- Text properties ----------

interface PF {
	bullet?: boolean;
	bulletChar?: string;
	/** Index into the font collection. */
	bulletFont?: number;
	align?: Para["align"];
	lineSpacing?: number;
	spaceBefore?: number;
	spaceAfter?: number;
	leftMargin?: number;
	indent?: number;
	rtl?: boolean;
}

interface CF {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	font?: number;
	/** Points. */
	size?: number;
	/** Raw colour: r, g, b, index (0xFE = literal RGB). */
	color?: number;
}

const ALIGN: Array<Para["align"]> = ["left", "center", "right", "justify"];

/** A TextPFException at `pos`; returns the position after it. */
function readPF(b: Uint8Array, pos: number, pf: PF): number {
	const mask = u32(b, pos);
	let p = pos + 4;
	if (mask & 0x000f) {
		const flags = u16(b, p);
		if (mask & 0x0001) pf.bullet = (flags & 1) !== 0;
		p += 2;
	}
	if (mask & 0x0080) {
		pf.bulletChar = String.fromCharCode(u16(b, p));
		p += 2;
	}
	if (mask & 0x0010) {
		pf.bulletFont = u16(b, p);
		p += 2;
	}
	if (mask & 0x0040) p += 2; // bullet size
	if (mask & 0x0020) p += 4; // bullet colour
	if (mask & 0x0800) {
		pf.align = ALIGN[u16(b, p)] ?? "left";
		p += 2;
	}
	if (mask & 0x1000) {
		pf.lineSpacing = i16(b, p);
		p += 2;
	}
	if (mask & 0x2000) {
		pf.spaceBefore = i16(b, p);
		p += 2;
	}
	if (mask & 0x4000) {
		pf.spaceAfter = i16(b, p);
		p += 2;
	}
	if (mask & 0x0100) {
		pf.leftMargin = i16(b, p);
		p += 2;
	}
	if (mask & 0x0400) {
		pf.indent = i16(b, p);
		p += 2;
	}
	if (mask & 0x8000) p += 2; // default tab size
	if (mask & 0x100000) p += 2 + u16(b, p) * 4; // tab stops
	if (mask & 0x10000) p += 2; // font alignment
	if (mask & 0xe0000) p += 2; // wrap flags
	if (mask & 0x200000) {
		pf.rtl = u16(b, p) === 1;
		p += 2;
	}
	return p;
}

/** A TextCFException at `pos`; returns the position after it. */
function readCF(b: Uint8Array, pos: number, cf: CF): number {
	const mask = u32(b, pos);
	let p = pos + 4;
	if (mask & 0xffff) {
		const flags = u16(b, p);
		if (mask & 0x0001) cf.bold = (flags & 1) !== 0;
		if (mask & 0x0002) cf.italic = (flags & 2) !== 0;
		if (mask & 0x0004) cf.underline = (flags & 4) !== 0;
		p += 2;
	}
	if (mask & 0x10000) {
		cf.font = u16(b, p);
		p += 2;
	}
	if (mask & 0x200000) p += 2; // East Asian font
	if (mask & 0x400000) p += 2; // ANSI font
	if (mask & 0x800000) p += 2; // symbol font
	if (mask & 0x20000) {
		cf.size = u16(b, p);
		p += 2;
	}
	if (mask & 0x40000) {
		cf.color = u32(b, p);
		p += 4;
	}
	if (mask & 0x80000) p += 2; // superscript position
	return p;
}

type LevelStyle = { pf: PF; cf: CF };
/** Master text styles: text type -> level -> style. */
type MasterStyles = Map<number, LevelStyle[]>;

function readMasterStyle(b: Uint8Array, rec: Rec, into: MasterStyles) {
	const type = rec.inst;
	const levels = u16(b, rec.body);
	let pos = rec.body + 2;
	const out: LevelStyle[] = [];
	for (let l = 0; l < levels && pos + 8 <= rec.end; l++) {
		if (type >= 5) pos += 2; // explicit level number
		const style: LevelStyle = { pf: {}, cf: {} };
		pos = readPF(b, pos, style.pf);
		if (pos + 4 > rec.end) break;
		pos = readCF(b, pos, style.cf);
		out.push(style);
	}
	into.set(type, out);
}

/** Placeholder text types that take their look from title/body. */
const INHERITS: Record<number, number> = { 5: 1, 6: 0, 7: 1, 8: 1 };

interface TextBlock {
	type: number;
	text: string;
	/** StyleTextPropAtom range in the document stream, if any. */
	style?: [number, number];
}

/** The text records in [start, end): header, characters, styles. */
function readTexts(b: Uint8Array, recs: Rec[]): TextBlock[] {
	const out: TextBlock[] = [];
	let current: TextBlock | null = null;
	for (const rec of recs) {
		if (rec.type === R.textHeader) {
			current = { type: u32(b, rec.body), text: "" };
			out.push(current);
		} else if (!current) {
			// Text records before any header: not ours.
		} else if (rec.type === R.textChars) {
			current.text = utf16.decode(b.subarray(rec.body, rec.end));
		} else if (rec.type === R.textBytes) {
			let text = "";
			for (let i = rec.body; i < rec.end; i++)
				text += String.fromCharCode(b[i]);
			current.text = text;
		} else if (rec.type === R.styleTextProp) {
			current.style = [rec.body, rec.end];
		}
	}
	return out;
}

// ---------- Deck ----------

interface Master {
	styles: MasterStyles;
	scheme: string[];
	/** Shapes drawn behind every slide that follows this master. */
	shapes: SlideElement[];
	background?: string;
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const rgb = (r: number, g: number, bl: number) =>
	`#${hex2(r)}${hex2(g)}${hex2(bl)}`;

export function parsePpt(stream: StreamLookup): RawDeck {
	const doc = stream("PowerPoint Document");
	if (!doc) throw new Error("corrupt: no PowerPoint Document stream");
	const current = stream("Current User");
	const pictures = stream("Pictures");
	// An encrypted deck says so in the Current User record.
	if (
		stream("EncryptedSummary") ||
		(current && current.length >= 16 && u32(current, 12) === 0xf3d1c4df)
	)
		throw new Error("password: encrypted deck");

	// ---- persist directory: object id -> offset of its live version ----
	const persist = new Map<number, number>();
	let documentRef = 0;
	let edit = current && current.length >= 20 ? u32(current, 16) : 0;
	for (
		let guard = 0;
		edit > 0 && edit + 8 + 20 <= doc.length && guard < 200;
		guard++
	) {
		if (u16(doc, edit + 2) !== R.userEdit) break;
		const body = edit + 8;
		const directory = u32(doc, body + 12);
		if (!documentRef) documentRef = u32(doc, body + 16);
		if (u16(doc, directory + 2) === R.persistDirectory) {
			const end = directory + 8 + u32(doc, directory + 4);
			let pos = directory + 8;
			while (pos + 4 <= end) {
				const head = u32(doc, pos);
				const first = head & 0xfffff;
				const count = head >>> 20;
				pos += 4;
				for (let i = 0; i < count && pos + 4 <= end; i++, pos += 4)
					if (!persist.has(first + i)) persist.set(first + i, u32(doc, pos));
			}
		}
		edit = u32(doc, body + 8);
	}

	const recordAt = (offset: number | undefined): Rec | null => {
		if (offset === undefined || offset + 8 > doc.length) return null;
		const head = u16(doc, offset);
		const body = offset + 8;
		const end = body + u32(doc, offset + 4);
		if (end > doc.length) return null;
		return {
			ver: head & 0x0f,
			inst: head >> 4,
			type: u16(doc, offset + 2),
			body,
			end,
		};
	};
	const documentRec =
		recordAt(persist.get(documentRef)) ??
		// No usable directory (damaged file): take the first Document.
		children(doc, 0, doc.length).find((r) => r.type === R.document) ??
		null;
	if (!documentRec || documentRec.type !== R.document)
		throw new Error("corrupt: no document record");
	const top = children(doc, documentRec.body, documentRec.end);

	// ---- document-level facts ----
	const atom = top.find((r) => r.type === R.documentAtom);
	const width = atom ? mu(i32(doc, atom.body)) : 960;
	const height = atom ? mu(i32(doc, atom.body + 4)) : 720;

	const fonts: string[] = [];
	const environment = top.find((r) => r.type === R.environment);
	const otherStyles: MasterStyles = new Map();
	if (environment) {
		for (const rec of descendants(
			doc,
			environment.body,
			environment.end,
			R.fontEntity,
		)) {
			let end = rec.body;
			while (end + 1 < Math.min(rec.end, rec.body + 64) && u16(doc, end) !== 0)
				end += 2;
			fonts[rec.inst] = utf16.decode(doc.subarray(rec.body, end));
		}
		for (const rec of descendants(
			doc,
			environment.body,
			environment.end,
			R.masterStyle,
		))
			readMasterStyle(doc, rec, otherStyles);
	}

	const group = top.find((r) => r.type === R.drawingGroup);
	const store = group ? readBlipStore(doc, group.body, group.end) : [];
	const media: RichMedia[] = [];
	const mediaOf = new Map<number, string | null>();
	const picture = (pib: number): string | null => {
		if (mediaOf.has(pib)) return mediaOf.get(pib) ?? null;
		const found = storedImage(store[pib - 1], doc, pictures);
		const ref = found ? `media:${media.push(found) - 1}` : null;
		mediaOf.set(pib, ref);
		return ref;
	};

	// ---- slide lists: slides, masters, notes ----
	interface Entry {
		ref: number;
		id: number;
		texts: TextBlock[];
	}
	const lists: Record<number, Entry[]> = { 0: [], 1: [], 2: [] };
	for (const list of top.filter((r) => r.type === R.slideList)) {
		const entries = lists[list.inst];
		if (!entries) continue;
		const recs = children(doc, list.body, list.end);
		let from = -1;
		const close = (to: number) => {
			if (from < 0) return;
			const head = recs[from];
			entries.push({
				ref: u32(doc, head.body),
				id: u32(doc, head.body + 12),
				texts: readTexts(doc, recs.slice(from + 1, to)),
			});
		};
		recs.forEach((rec, i) => {
			if (rec.type !== R.slidePersist) return;
			close(i);
			from = i;
		});
		close(recs.length);
	}

	// ---- colours ----
	const readScheme = (rec: Rec | undefined): string[] | undefined => {
		if (!rec || rec.end - rec.body < 32) return undefined;
		const out: string[] = [];
		for (let i = 0; i < 8; i++) {
			const at = rec.body + i * 4;
			out.push(rgb(doc[at], doc[at + 1], doc[at + 2]));
		}
		return out;
	};
	const DEFAULT_SCHEME = [
		"#ffffff",
		"#000000",
		"#808080",
		"#000000",
		"#bbe0e3",
		"#333399",
		"#009999",
		"#99cc00",
	];
	/** Text colour: literal RGB (index 0xFE) or a scheme slot. */
	const textColor = (value: number | undefined, scheme: string[]) => {
		if (value === undefined) return undefined;
		const index = value >>> 24;
		if (index === 0xfe)
			return rgb(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);
		return scheme[index] ?? undefined;
	};
	/** OfficeArt colour: RGB, or a scheme slot when flagged. */
	const artColor = (value: number | undefined, scheme: string[]) => {
		if (value === undefined) return undefined;
		const flags = value >>> 24;
		if (flags & 0x08) return scheme[value & 0xff];
		if (flags & 0xf7) return undefined; // system / palette colours
		return rgb(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);
	};

	// ---- text ----
	const buildText = (
		block: TextBlock,
		styles: MasterStyles,
		scheme: string[],
		props: Props,
		titleLike: boolean,
	): TextBody | undefined => {
		const raw = block.text.replace(/\r$/, "");
		if (!raw.trim()) return undefined;
		const levels =
			styles.get(block.type) ??
			styles.get(INHERITS[block.type] ?? -1) ??
			otherStyles.get(block.type) ??
			otherStyles.get(4) ??
			[];
		// Types 5-8 store only differences from the type they inherit.
		const baseLevels =
			block.type in INHERITS ? (styles.get(INHERITS[block.type]) ?? []) : [];
		const levelStyle = (level: number): LevelStyle => {
			const pick = (list: LevelStyle[]) =>
				list[Math.min(level, list.length - 1)] ?? { pf: {}, cf: {} };
			const base = pick(baseLevels);
			const own = pick(levels);
			return {
				pf: { ...base.pf, ...own.pf },
				cf: { ...base.cf, ...own.cf },
			};
		};

		// Paragraph and character runs, as (length, properties) lists.
		const total = block.text.length + 1;
		const paraRuns: Array<{ count: number; level: number; pf: PF }> = [];
		const charRuns: Array<{ count: number; cf: CF }> = [];
		if (block.style) {
			const [from, to] = block.style;
			let pos = from;
			let seen = 0;
			while (seen < total && pos + 10 <= to) {
				const count = u32(doc, pos);
				const level = u16(doc, pos + 4);
				const pf: PF = {};
				pos = readPF(doc, pos + 6, pf);
				paraRuns.push({ count, level, pf });
				seen += count;
			}
			seen = 0;
			while (seen < total && pos + 8 <= to) {
				const count = u32(doc, pos);
				const cf: CF = {};
				pos = readCF(doc, pos + 4, cf);
				charRuns.push({ count, cf });
				seen += count;
			}
		}

		const paras: Para[] = [];
		let offset = 0; // character offset of the current paragraph
		let paraRun = 0;
		let paraLeft = paraRuns[0]?.count ?? Number.POSITIVE_INFINITY;
		let charRun = 0;
		let charLeft = charRuns[0]?.count ?? Number.POSITIVE_INFINITY;

		for (const line of raw.split("\r")) {
			const run = paraRuns[paraRun];
			const level = Math.min(4, run?.level ?? 0);
			const base = levelStyle(level);
			const pf: PF = { ...base.pf, ...run?.pf };
			const runs: Run[] = [];
			let i = 0;
			const length = line.length + 1; // with the paragraph mark
			while (i < length) {
				const take = Math.min(length - i, charLeft);
				const cf: CF = { ...base.cf, ...charRuns[charRun]?.cf };
				const text = line.slice(i, Math.min(line.length, i + take));
				const sizePt = cf.size ?? (titleLike ? 44 : 18);
				const style = {
					size: (sizePt * 4) / 3,
					bold: cf.bold ?? false,
					italic: cf.italic ?? false,
					underline: cf.underline ?? false,
					strike: false,
					color: textColor(cf.color, scheme) ?? scheme[titleLike ? 3 : 1],
					font: cf.font !== undefined ? fonts[cf.font] : undefined,
				};
				// Vertical tab is a line break inside the paragraph.
				text.split("\u000b").forEach((piece, k) => {
					if (k > 0) runs.push({ ...style, text: "\n", br: true });
					if (piece) runs.push({ ...style, text: piece });
				});
				i += take;
				charLeft -= take;
				if (charLeft <= 0) {
					charRun++;
					charLeft = charRuns[charRun]?.count ?? Number.POSITIVE_INFINITY;
				}
			}
			offset += length;
			paraLeft -= length;
			if (paraLeft <= 0) {
				paraRun++;
				paraLeft = paraRuns[paraRun]?.count ?? Number.POSITIVE_INFINITY;
			}
			const first = runs[0]?.size ?? ((base.cf.size ?? 18) * 4) / 3;
			const spacing = (v: number | undefined) =>
				v === undefined ? 0 : v > 0 ? (v / 100) * first * 1.2 : mu(-v);
			const rtl = pf.rtl ?? startsRtl(line);
			paras.push({
				runs,
				rtl: rtl || undefined,
				align: pf.align ?? (rtl ? "right" : "left"),
				level,
				bullet: pf.bullet
					? bulletGlyph(
							pf.bulletChar ?? "•",
							pf.bulletFont !== undefined ? fonts[pf.bulletFont] : undefined,
						)
					: undefined,
				indent: pf.bullet
					? Math.max(mu(pf.leftMargin ?? 0), first * 1.1)
					: mu(pf.leftMargin ?? 0),
				lineHeight:
					pf.lineSpacing && pf.lineSpacing > 0
						? pf.lineSpacing / 100
						: undefined,
				spaceBefore: spacing(pf.spaceBefore),
				spaceAfter: spacing(pf.spaceAfter),
				endSize: first,
			});
		}
		void offset;

		const anchor = props.values.get(0x0087);
		const inset = (id: number, fallback: number) => {
			const v = props.values.get(id);
			return v === undefined ? fallback : emu(v | 0);
		};
		return {
			paras,
			anchor:
				anchor === undefined
					? titleLike
						? "middle"
						: "top"
					: anchor === 1 || anchor === 4 || anchor === 8
						? "middle"
						: anchor === 2 || anchor === 5 || anchor === 9
							? "bottom"
							: "top",
			insets: [
				inset(0x0081, 9.6),
				inset(0x0082, 4.8),
				inset(0x0083, 9.6),
				inset(0x0084, 4.8),
			],
			wrap: props.values.get(0x0085) !== 2,
			vertical: false,
		};
	};

	// ---- shapes ----
	const GEOM: Record<number, string> = {
		1: "rect",
		2: "roundRect",
		3: "ellipse",
		4: "diamond",
		5: "triangle",
		6: "rtTriangle",
		13: "rightArrow",
		15: "homePlate",
		20: "line",
		32: "straightConnector1",
		55: "chevron",
	};

	interface Frame {
		x: number;
		y: number;
		w: number;
		h: number;
	}
	type Mapper = (f: Frame) => Frame;

	const readShapes = (
		container: Rec,
		context: {
			styles: MasterStyles;
			scheme: string[];
			texts: TextBlock[];
			/** Masters contribute decoration only, never placeholders. */
			decorationOnly: boolean;
		},
		out: SlideElement[],
		map: Mapper,
		depth = 0,
	) => {
		if (depth > 12) return;
		for (const rec of children(doc, container.body, container.end)) {
			if (rec.type === RT.spgrContainer) {
				// The first shape of a group is the group itself: its frame in
				// the parent, and the coordinate box its children use.
				const head = children(doc, rec.body, rec.end)[0];
				let inner = map;
				if (head?.type === RT.spContainer) {
					const parts = children(doc, head.body, head.end);
					const box = parts.find((r) => r.type === RT.spgr);
					const frame = anchorOf(parts);
					if (box && frame && depth > 0) {
						const cx = i32(doc, box.body);
						const cy = i32(doc, box.body + 4);
						const cw = i32(doc, box.body + 8) - cx || 1;
						const ch = i32(doc, box.body + 12) - cy || 1;
						const outer = map(frame);
						inner = (f) => ({
							x: outer.x + ((f.x - mu(cx)) * outer.w) / mu(cw),
							y: outer.y + ((f.y - mu(cy)) * outer.h) / mu(ch),
							w: (f.w * outer.w) / mu(cw),
							h: (f.h * outer.h) / mu(ch),
						});
					}
				}
				readShapes(rec, context, out, inner, depth + 1);
				continue;
			}
			if (rec.type !== RT.spContainer) continue;
			const parts = children(doc, rec.body, rec.end);
			const sp = parts.find((r) => r.type === RT.sp);
			if (!sp) continue;
			const flags = u32(doc, sp.body + 4);
			if (flags & 0x0005) continue; // the group shape / patriarch itself
			if (flags & 0x0008) continue; // deleted
			if (flags & 0x0400) continue; // the background, handled separately
			const frame = anchorOf(parts);
			if (!frame) continue;

			const props: Props = { values: new Map(), data: new Map() };
			for (const part of parts)
				if (part.type === RT.opt || part.type === RT.tertiaryOpt)
					readProps(doc, part, props);
			const value = (id: number) => props.values.get(id);

			const clientData = parts.find((r) => r.type === RT.clientData);
			const placeholder = clientData
				? children(doc, clientData.body, clientData.end).find(
						(r) => r.type === R.placeholder,
					)
				: undefined;
			if (context.decorationOnly && placeholder) continue;

			const box = map(frame);
			const rotation = fixed(value(0x0004) ?? 0);
			const placed = {
				...box,
				rot: rotation,
				flipH: (flags & 0x40) !== 0,
				flipV: (flags & 0x80) !== 0,
			};

			// Text: inline in the shape, or a reference into the slide's
			// outline text (placeholders).
			const textbox = parts.find((r) => r.type === RT.clientTextbox);
			let text: TextBody | undefined;
			if (textbox) {
				const inner = children(doc, textbox.body, textbox.end);
				const ref = inner.find((r) => r.type === R.outlineTextRef);
				const block = ref
					? context.texts[u32(doc, ref.body)]
					: readTexts(doc, inner)[0];
				if (block) {
					const titleLike = block.type === 0 || block.type === 6;
					text = buildText(
						block,
						context.styles,
						context.scheme,
						props,
						titleLike,
					);
				}
			}

			const pib = value(0x0104);
			if (pib || sp.inst === 75) {
				const crop = [0x0102, 0x0100, 0x0103, 0x0101].map((id) =>
					fixed(value(id) ?? 0),
				) as [number, number, number, number];
				out.push({
					kind: "image",
					...placed,
					src: pib ? picture(pib) : null,
					crop: crop.some((c) => c !== 0) ? crop : undefined,
				});
				continue;
			}
			if (flags & 0x10) {
				out.push({ kind: "placeholder", ...placed, label: "Embedded object" });
				continue;
			}

			// Fill and outline. Absent booleans mean "on", except for text
			// boxes, which PowerPoint draws bare.
			const bare = sp.inst === 202 || !!placeholder;
			const fillBools = value(0x01bf);
			const filled =
				fillBools !== undefined && fillBools & 0x100000
					? (fillBools & 0x10) !== 0
					: !bare;
			const lineBools = value(0x01ff);
			const lined =
				lineBools !== undefined && lineBools & 0x80000
					? (lineBools & 0x8) !== 0
					: !bare;
			const fillType = value(0x0180) ?? 0;
			const fillPicture =
				filled && (fillType === 2 || fillType === 3) && value(0x0186)
					? picture(value(0x0186) ?? 0)
					: null;
			const fill = filled
				? (artColor(value(0x0181), context.scheme) ??
					(value(0x0181) === undefined ? context.scheme[4] : undefined))
				: undefined;
			const stroke = lined
				? (artColor(value(0x01c0), context.scheme) ?? context.scheme[1])
				: undefined;
			if (!fill && !stroke && !text && !fillPicture) continue;
			const geom = GEOM[sp.inst] ?? "rect";
			out.push({
				kind: "shape",
				...placed,
				geom,
				fill,
				image: fillPicture ?? undefined,
				line: stroke
					? {
							color: stroke,
							width: Math.max(0.5, emu(value(0x01cb) ?? 9525)),
							dash: (value(0x01ce) ?? 0) !== 0,
						}
					: undefined,
				radius:
					geom === "roundRect" ? Math.min(box.w, box.h) * 0.1667 : undefined,
				text,
			});
		}
	};

	/** A shape's frame in px: client anchor (slide) or child anchor (group). */
	const anchorOf = (parts: Rec[]): Frame | null => {
		const child = parts.find((r) => r.type === RT.childAnchor);
		if (child && child.end - child.body >= 16) {
			const l = i32(doc, child.body);
			const t = i32(doc, child.body + 4);
			return {
				x: mu(l),
				y: mu(t),
				w: mu(i32(doc, child.body + 8) - l),
				h: mu(i32(doc, child.body + 12) - t),
			};
		}
		const client = parts.find((r) => r.type === RT.clientAnchor);
		if (!client) return null;
		if (client.end - client.body >= 16) {
			const t = i32(doc, client.body);
			const l = i32(doc, client.body + 4);
			return {
				x: mu(l),
				y: mu(t),
				w: mu(i32(doc, client.body + 8) - l),
				h: mu(i32(doc, client.body + 12) - t),
			};
		}
		if (client.end - client.body >= 8) {
			const t = i16(doc, client.body);
			const l = i16(doc, client.body + 2);
			return {
				x: mu(l),
				y: mu(t),
				w: mu(i16(doc, client.body + 4) - l),
				h: mu(i16(doc, client.body + 6) - t),
			};
		}
		return null;
	};

	/** The background shape's fill as a CSS background. */
	const backgroundOf = (drawing: Rec | undefined, scheme: string[]) => {
		if (!drawing) return undefined;
		const dg = children(doc, drawing.body, drawing.end).find(
			(r) => r.type === RT.dgContainer,
		);
		if (!dg) return undefined;
		const shape = children(doc, dg.body, dg.end).find(
			(r) => r.type === RT.spContainer,
		);
		if (!shape) return undefined;
		const props: Props = { values: new Map(), data: new Map() };
		for (const part of children(doc, shape.body, shape.end))
			if (part.type === RT.opt) readProps(doc, part, props);
		const type = props.values.get(0x0180) ?? 0;
		const pib = props.values.get(0x0186);
		if ((type === 2 || type === 3) && pib) {
			const ref = picture(pib);
			if (ref) return ref;
		}
		return artColor(props.values.get(0x0181), scheme) ?? scheme[0];
	};

	const drawingShapes = (
		drawing: Rec | undefined,
		context: Parameters<typeof readShapes>[1],
	): SlideElement[] => {
		const out: SlideElement[] = [];
		if (!drawing) return out;
		const dg = children(doc, drawing.body, drawing.end).find(
			(r) => r.type === RT.dgContainer,
		);
		if (dg) readShapes(dg, context, out, (f) => f);
		return out;
	};

	// ---- masters ----
	const masters = new Map<number, Master>();
	const masterOf = (id: number, depth = 0): Master | undefined => {
		const known = masters.get(id);
		if (known) return known;
		const entry = lists[1].find((e) => e.id === id);
		const rec = recordAt(entry ? persist.get(entry.ref) : undefined);
		if (!rec || depth > 3) return undefined;
		const parts = children(doc, rec.body, rec.end);
		// A title master is a slide that follows the main master.
		const slideAtom = parts.find((r) => r.type === R.slideAtom);
		const parent =
			rec.type === R.slide && slideAtom
				? masterOf(u32(doc, slideAtom.body + 12), depth + 1)
				: undefined;
		const styles: MasterStyles = new Map(parent?.styles);
		for (const part of parts)
			if (part.type === R.masterStyle) readMasterStyle(doc, part, styles);
		const scheme =
			readScheme(parts.filter((r) => r.type === R.colorScheme).pop()) ??
			parent?.scheme ??
			DEFAULT_SCHEME;
		const drawing = parts.find((r) => r.type === R.drawing);
		const master: Master = {
			styles,
			scheme,
			background: backgroundOf(drawing, scheme) ?? parent?.background,
			shapes: drawingShapes(drawing, {
				styles,
				scheme,
				texts: [],
				decorationOnly: true,
			}),
		};
		masters.set(id, master);
		return master;
	};

	// ---- notes, by the slide they belong to ----
	const notesOf = new Map<number, string>();
	for (const entry of lists[2]) {
		const rec = recordAt(persist.get(entry.ref));
		if (!rec || rec.type !== R.notes) continue;
		const parts = children(doc, rec.body, rec.end);
		const notesAtom = parts.find((r) => r.type === R.notesAtom);
		if (!notesAtom) continue;
		const lines: string[] = [];
		for (const box of descendants(doc, rec.body, rec.end, RT.clientTextbox))
			for (const block of readTexts(doc, children(doc, box.body, box.end)))
				if (block.type === 2 && block.text.trim())
					lines.push(block.text.replace(/\r/g, "\n").trim());
		if (lines.length) notesOf.set(u32(doc, notesAtom.body), lines.join("\n"));
	}

	// ---- slides ----
	const slides: Slide[] = [];
	for (const entry of lists[0]) {
		const rec = recordAt(persist.get(entry.ref));
		if (!rec || rec.type !== R.slide) continue;
		const parts = children(doc, rec.body, rec.end);
		const slideAtom = parts.find((r) => r.type === R.slideAtom);
		const masterId = slideAtom ? u32(doc, slideAtom.body + 12) : 0;
		const follow = slideAtom ? u16(doc, slideAtom.body + 20) : 0x7;
		const master = masterOf(masterId) ?? masterOf(lists[1][0]?.id ?? 0);
		const scheme =
			(follow & 0x2
				? undefined
				: readScheme(parts.filter((r) => r.type === R.colorScheme).pop())) ??
			master?.scheme ??
			DEFAULT_SCHEME;
		const drawing = parts.find((r) => r.type === R.drawing);
		const own = drawingShapes(drawing, {
			styles: master?.styles ?? new Map(),
			scheme,
			texts: entry.texts,
			decorationOnly: false,
		});
		slides.push({
			background:
				(follow & 0x4 ? master?.background : backgroundOf(drawing, scheme)) ??
				master?.background ??
				scheme[0],
			elements: [...(follow & 0x1 ? (master?.shapes ?? []) : []), ...own],
			notes: notesOf.get(entry.id),
		});
	}
	if (!slides.length && !lists[0].length)
		throw new Error("corrupt: no slides found");

	return { width: width || 960, height: height || 720, slides, media };
}
