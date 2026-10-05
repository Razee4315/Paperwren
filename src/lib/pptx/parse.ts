/**
 * A lean PPTX reader: turns a presentation into positioned shapes,
 * text, pictures and tables that the Slides viewer lays out with
 * plain HTML/SVG. Scope is deliberately bounded (no animations; chart
 * types the viewer cannot draw render as labelled placeholders).
 * Charts come from chart.ts. Freeform shapes keep their own outlines;
 * pictures keep their crop. SmartArt is drawn from the shapes the
 * authoring app saved for it (the diagram's drawing part), not laid
 * out again; a diagram saved without them shows a labelled box.
 *
 * Inheritance follows PowerPoint's order: master -> layout -> slide
 * for backgrounds, decorative shapes and placeholder geometry, and
 * master text styles -> placeholder list styles -> paragraph -> run
 * for text. Coordinates are converted from EMU to CSS px at 96 dpi.
 */

import { unzipSync } from "fflate";
import { hasRtl, startsRtl } from "../bidi";
import { msg } from "../i18n";
import { bulletGlyph } from "./bullets";
import { type Chart, readChart } from "./chart";
import { path, attrOf, kid, kids, relId } from "./xml";

export type { Chart };

export interface Run {
	text: string;
	size: number; // px
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	color: string;
	font?: string;
	href?: string;
	/** Line break run. */
	br?: boolean;
}

export interface Para {
	runs: Run[];
	align: "left" | "center" | "right" | "justify";
	level: number;
	bullet?: string;
	indent: number; // px
	lineHeight?: number; // multiplier
	spaceBefore: number; // px
	spaceAfter: number; // px
	/** Size used for empty paragraphs so blank lines keep their height. */
	endSize: number;
	/** Right-to-left paragraph (Arabic, Urdu, Hebrew, ...). */
	rtl?: boolean;
}

export interface TextBody {
	paras: Para[];
	anchor: "top" | "middle" | "bottom";
	insets: [number, number, number, number]; // l t r b px
	wrap: boolean;
	vertical: boolean;
}

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
	rot: number;
	flipH: boolean;
	flipV: boolean;
}

/** One outline of a freeform shape, in its own coordinate space. */
export interface GeomPath {
	d: string;
	w: number;
	h: number;
	fill: boolean;
	stroke: boolean;
}

/** A gradient fill, for shapes of any outline. */
export interface Gradient {
	kind: "linear" | "radial";
	/** Degrees clockwise from left-to-right (linear only). */
	angle: number;
	stops: Array<{ at: number; color: string }>;
}

export type SlideElement =
	| (Box & {
			kind: "shape";
			geom: string;
			/** CSS colour; for a gradient, its CSS form (see `gradient`). */
			fill?: string;
			gradient?: Gradient;
			/** Outer shadow as "dx dy blur colour" (CSS drop-shadow). */
			shadow?: string;
			/** Picture fill (blob URL), stretched over the shape. */
			image?: string | null;
			line?: { color: string; width: number; dash: boolean };
			radius?: number;
			/** Freeform outlines (custGeom); replaces the preset `geom`. */
			paths?: GeomPath[];
			text?: TextBody;
	  })
	| (Box & {
			kind: "image";
			src: string | null;
			/** Cropped-away fractions of the source: left, top, right, bottom. */
			crop?: [number, number, number, number];
			/** Picture frame: an ellipse, or a corner radius in px. */
			round?: "ellipse" | number;
			shadow?: string;
	  })
	| (Box & {
			kind: "table";
			cols: number[];
			rows: Array<{
				h: number;
				cells: Array<{
					text: TextBody;
					fill?: string;
					span: number;
					rowSpan: number;
					hidden: boolean;
				}>;
			}>;
			/** Columns run right to left. */
			rtl?: boolean;
	  })
	| (Box & { kind: "chart"; chart: Chart })
	| (Box & { kind: "placeholder"; label: string });

export interface Slide {
	background: string; // CSS background
	elements: SlideElement[];
	notes?: string;
	/** The author hid this slide: a slide show passes over it. */
	hidden?: boolean;
}

export interface Presentation {
	width: number;
	height: number;
	slides: Slide[];
	dispose(): void;
}

const EMU_PER_PX = 9525;
const px = (emu: string | null | undefined) =>
	emu ? Number(emu) / EMU_PER_PX : 0;

// ---------- Colour ----------

type ColorMap = Record<string, string>;

function hexToRgb(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(0, 6), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl([r, g, b]: [number, number, number]): [
	number,
	number,
	number,
] {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h =
		max === rn
			? (gn - bn) / d + (gn < bn ? 6 : 0)
			: max === gn
				? (bn - rn) / d + 2
				: (rn - gn) / d + 4;
	return [h / 6, s, l];
}
function hslToRgb([h, s, l]: [number, number, number]): [
	number,
	number,
	number,
] {
	if (s === 0) return [l * 255, l * 255, l * 255];
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const f = (t: number) => {
		let x = t;
		if (x < 0) x += 1;
		if (x > 1) x -= 1;
		if (x < 1 / 6) return p + (q - p) * 6 * x;
		if (x < 1 / 2) return q;
		if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
		return p;
	};
	return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const PRESET: Record<string, string> = {
	black: "000000",
	white: "FFFFFF",
	red: "FF0000",
	green: "008000",
	blue: "0000FF",
	yellow: "FFFF00",
	gray: "808080",
	grey: "808080",
	orange: "FFA500",
};

class Palette {
	constructor(
		private theme: ColorMap,
		private map: ColorMap,
	) {}

	/** Theme accent 1..6 (wrapping), for chart series without a colour. */
	accent(n: number): string {
		const hex = this.theme[`accent${((n - 1) % 6) + 1}`] ?? "4472C4";
		const [r, g, b] = hexToRgb(hex);
		return `rgb(${r}, ${g}, ${b})`;
	}

	/** Resolve a colour-choice element (solidFill, a:fgClr, ...). */
	resolve(holder: Element | null | undefined): string | undefined {
		if (!holder) return undefined;
		const c = kids(holder).find((e) =>
			[
				"srgbClr",
				"schemeClr",
				"sysClr",
				"prstClr",
				"scrgbClr",
				"hslClr",
			].includes(e.localName),
		);
		if (!c) return undefined;
		let hex = "000000";
		if (c.localName === "srgbClr") hex = attrOf(c, "val") ?? hex;
		else if (c.localName === "sysClr")
			hex =
				attrOf(c, "lastClr") ??
				(attrOf(c, "val") === "window" ? "FFFFFF" : "000000");
		else if (c.localName === "prstClr")
			hex = PRESET[attrOf(c, "val") ?? ""] ?? hex;
		else if (c.localName === "schemeClr") {
			const val = attrOf(c, "val") ?? "tx1";
			const mapped = this.map[val] ?? val;
			hex = this.theme[mapped] ?? this.theme[val] ?? hex;
		}
		let [r, g, b] = hexToRgb(hex);
		let alpha = 1;
		for (const mod of kids(c)) {
			const v = Number(attrOf(mod, "val")) / 100000;
			if (!Number.isFinite(v)) continue;
			if (mod.localName === "alpha") alpha = v;
			else if (mod.localName === "lumMod" || mod.localName === "lumOff") {
				const hsl = rgbToHsl([r, g, b]);
				hsl[2] =
					mod.localName === "lumMod" ? hsl[2] * v : Math.min(1, hsl[2] + v);
				[r, g, b] = hslToRgb(hsl);
			} else if (mod.localName === "tint") {
				r = r + (255 - r) * (1 - v);
				g = g + (255 - g) * (1 - v);
				b = b + (255 - b) * (1 - v);
			} else if (mod.localName === "shade") {
				r *= v;
				g *= v;
				b *= v;
			}
		}
		const to = (n: number) => Math.round(Math.max(0, Math.min(255, n)));
		return alpha < 1
			? `rgba(${to(r)}, ${to(g)}, ${to(b)}, ${alpha.toFixed(3)})`
			: `rgb(${to(r)}, ${to(g)}, ${to(b)})`;
	}

	/** Fill from spPr/tcPr/bgPr: solid, first gradient stop, or none. */
	fill(props: Element | null | undefined): string | undefined | null {
		if (!props) return undefined;
		if (kid(props, "noFill")) return null;
		const solid = kid(props, "solidFill");
		if (solid) return this.resolve(solid);
		const grad = kid(props, "gradFill");
		if (grad) {
			const stops = kids(kid(grad, "gsLst"), "gs");
			const colors = stops.map(
				(s) => `${this.resolve(s)} ${Number(attrOf(s, "pos") ?? 0) / 1000}%`,
			);
			if (colors.length >= 2) {
				const ang = Number(attrOf(kid(grad, "lin"), "ang") ?? 0) / 60000;
				return `linear-gradient(${ang + 90}deg, ${colors.join(", ")})`;
			}
			return stops[0] ? this.resolve(stops[0]) : undefined;
		}
		return undefined;
	}

	/** The gradient in spPr, stop by stop, when it has at least two. */
	gradient(props: Element | null | undefined): Gradient | undefined {
		const grad = kid(props, "gradFill");
		if (!grad) return undefined;
		const stops = kids(kid(grad, "gsLst"), "gs")
			.map((s) => ({
				at: Number(attrOf(s, "pos") ?? 0) / 1000,
				color: this.resolve(s) ?? "rgb(0, 0, 0)",
			}))
			.sort((a, b) => a.at - b.at);
		if (stops.length < 2) return undefined;
		if (kid(grad, "path")) return { kind: "radial", angle: 0, stops };
		return {
			kind: "linear",
			angle: Number(attrOf(kid(grad, "lin"), "ang") ?? 0) / 60000,
			stops,
		};
	}

	/** The outer shadow in spPr's effect list, as a CSS drop-shadow. */
	shadow(props: Element | null | undefined): string | undefined {
		const sh = path(props, "effectLst", "outerShdw");
		if (!sh) return undefined;
		const color = this.resolve(sh);
		if (!color) return undefined;
		const dist = px(attrOf(sh, "dist"));
		const dir = (Number(attrOf(sh, "dir") ?? 0) / 60000) * (Math.PI / 180);
		const round = (n: number) => Math.round(n * 100) / 100;
		return `${round(dist * Math.cos(dir))}px ${round(dist * Math.sin(dir))}px ${round(px(attrOf(sh, "blurRad")))}px ${color}`;
	}
}

// ---------- Package ----------

class Pkg {
	private xmlCache = new Map<string, Document | null>();
	readonly media = new Map<string, string>();
	private mediaWanted = new Set<string>();

	constructor(
		private files: Record<string, Uint8Array>,
		private bytes: Uint8Array,
	) {}

	xml(name: string): Document | null {
		if (this.xmlCache.has(name)) return this.xmlCache.get(name) ?? null;
		const raw = this.files[name];
		let doc: Document | null = null;
		if (raw) {
			doc = new DOMParser().parseFromString(
				new TextDecoder().decode(raw),
				"application/xml",
			);
			if (doc.getElementsByTagName("parsererror").length) doc = null;
		}
		this.xmlCache.set(name, doc);
		return doc;
	}

	rels(
		part: string,
	): Map<string, { target: string; type: string; external: boolean }> {
		const slash = part.lastIndexOf("/");
		const dir = part.slice(0, slash);
		const doc = this.xml(`${dir}/_rels/${part.slice(slash + 1)}.rels`);
		const out = new Map<
			string,
			{ target: string; type: string; external: boolean }
		>();
		if (!doc) return out;
		for (const r of Array.from(doc.getElementsByTagName("Relationship"))) {
			const external = r.getAttribute("TargetMode") === "External";
			const target = r.getAttribute("Target") ?? "";
			out.set(r.getAttribute("Id") ?? "", {
				target: external ? target : resolvePath(dir, target),
				type: r.getAttribute("Type") ?? "",
				external,
			});
		}
		return out;
	}

	wantMedia(name: string): string {
		this.mediaWanted.add(name);
		return name;
	}

	/** Inflate every referenced picture once and mint blob URLs. */
	loadMedia() {
		if (this.mediaWanted.size === 0) return;
		const found = unzipSync(this.bytes, {
			filter: (f) => this.mediaWanted.has(f.name),
		});
		for (const [name, data] of Object.entries(found)) {
			const type = mimeFor(name);
			if (!type) continue;
			this.media.set(
				name,
				URL.createObjectURL(new Blob([data as BlobPart], { type })),
			);
		}
	}
}

function resolvePath(dir: string, target: string): string {
	if (target.startsWith("/")) return target.slice(1);
	const parts = dir ? dir.split("/") : [];
	for (const seg of target.split("/")) {
		if (seg === "..") parts.pop();
		else if (seg !== ".") parts.push(seg);
	}
	return parts.join("/");
}

function mimeFor(name: string): string | null {
	const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
	return (
		{
			png: "image/png",
			jpg: "image/jpeg",
			jpeg: "image/jpeg",
			gif: "image/gif",
			bmp: "image/bmp",
			webp: "image/webp",
			svg: "image/svg+xml",
			tif: "image/tiff",
			tiff: "image/tiff",
		}[ext] ?? null
	);
}

// ---------- Text style cascade ----------

interface Level {
	size?: number;
	bold?: boolean;
	italic?: boolean;
	color?: string;
	font?: string;
	/** Complex-script face, used for right-to-left text. */
	csFont?: string;
	align?: Para["align"];
	rtl?: boolean;
	bullet?: string | null;
	indent?: number;
	lineHeight?: number;
	spaceBefore?: number;
	spaceAfter?: number;
}

type LevelStyles = Level[]; // index 0..8

function readLevel(pPr: Element | null, pal: Palette, fonts: Fonts): Level {
	if (!pPr) return {};
	const out: Level = {};
	const algn = attrOf(pPr, "algn");
	if (algn)
		out.align =
			algn === "ctr"
				? "center"
				: algn === "r"
					? "right"
					: algn === "just" || algn === "dist"
						? "justify"
						: "left";
	const rtl = attrOf(pPr, "rtl");
	if (rtl !== null) out.rtl = rtl === "1" || rtl === "true";
	const marL = attrOf(pPr, "marL");
	if (marL) out.indent = px(marL);
	if (kid(pPr, "buNone")) out.bullet = null;
	const buChar = kid(pPr, "buChar");
	if (buChar)
		out.bullet = bulletGlyph(
			attrOf(buChar, "char") ?? "•",
			attrOf(kid(pPr, "buFont"), "typeface"),
		);
	if (kid(pPr, "buAutoNum")) out.bullet = "#";
	const lnPct = attrOf(path(pPr, "lnSpc", "spcPct"), "val");
	if (lnPct) out.lineHeight = Number(lnPct) / 100000;
	const before = attrOf(path(pPr, "spcBef", "spcPts"), "val");
	if (before) out.spaceBefore = (Number(before) / 100) * (4 / 3);
	const after = attrOf(path(pPr, "spcAft", "spcPts"), "val");
	if (after) out.spaceAfter = (Number(after) / 100) * (4 / 3);
	Object.assign(out, readRun(kid(pPr, "defRPr"), pal, fonts));
	return out;
}

function readRun(rPr: Element | null, pal: Palette, fonts: Fonts): Level {
	if (!rPr) return {};
	const out: Level = {};
	const sz = attrOf(rPr, "sz");
	if (sz) out.size = (Number(sz) / 100) * (4 / 3);
	const b = attrOf(rPr, "b");
	if (b) out.bold = b === "1" || b === "true";
	const i = attrOf(rPr, "i");
	if (i) out.italic = i === "1" || i === "true";
	const color = pal.resolve(kid(rPr, "solidFill"));
	if (color) out.color = color;
	const latin = attrOf(kid(rPr, "latin"), "typeface");
	if (latin) out.font = fonts.map(latin);
	const complex = attrOf(kid(rPr, "cs"), "typeface");
	// Theme references ("+mn-cs") name no face a viewer can load.
	if (complex && !complex.startsWith("+")) out.csFont = complex;
	return out;
}

function readList(
	list: Element | null,
	pal: Palette,
	fonts: Fonts,
): LevelStyles {
	const out: LevelStyles = [];
	if (!list) return out;
	for (let i = 0; i < 9; i++) {
		const lvl = kid(list, `lvl${i + 1}pPr`);
		if (lvl) out[i] = readLevel(lvl, pal, fonts);
	}
	return out;
}

class Fonts {
	constructor(
		private major: string,
		private minor: string,
	) {}
	map(face: string): string {
		if (face === "+mj-lt") return this.major;
		if (face === "+mn-lt") return this.minor;
		return face;
	}
}

// ---------- Shapes ----------

interface Ph {
	type: string;
	idx: string | null;
}

function placeholderOf(sp: Element): Ph | null {
	const nv = kids(sp).find((c) => c.localName.startsWith("nv"));
	const ph = path(nv, "nvPr", "ph");
	if (!ph) return null;
	return { type: attrOf(ph, "type") ?? "body", idx: attrOf(ph, "idx") };
}

function findPlaceholder(tree: Element | null, ph: Ph): Element | null {
	if (!tree) return null;
	const candidates = kids(tree).filter((e) => e.localName === "sp");
	const norm = (t: string) =>
		t === "ctrTitle" ? "title" : t === "subTitle" || t === "obj" ? "body" : t;
	if (ph.idx !== null) {
		const byIdx = candidates.find((sp) => placeholderOf(sp)?.idx === ph.idx);
		if (byIdx) return byIdx;
	}
	return (
		candidates.find(
			(sp) => norm(placeholderOf(sp)?.type ?? "") === norm(ph.type),
		) ?? null
	);
}

function readXfrm(xfrm: Element | null): Box | null {
	if (!xfrm) return null;
	const off = kid(xfrm, "off");
	const ext = kid(xfrm, "ext");
	if (!off || !ext) return null;
	return {
		x: px(attrOf(off, "x")),
		y: px(attrOf(off, "y")),
		w: px(attrOf(ext, "cx")),
		h: px(attrOf(ext, "cy")),
		rot: Number(attrOf(xfrm, "rot") ?? 0) / 60000,
		flipH: attrOf(xfrm, "flipH") === "1",
		flipV: attrOf(xfrm, "flipV") === "1",
	};
}

/** custGeom path lists as SVG path data. Coordinates stay in each
 * path's own space; the viewer maps that onto the shape's box. */
function readPaths(custGeom: Element | null, box: Box): GeomPath[] {
	const out: GeomPath[] = [];
	for (const p of kids(kid(custGeom, "pathLst"), "path")) {
		let d = "";
		let cx = 0;
		let cy = 0;
		const pts = (el: Element) =>
			kids(el, "pt").map(
				(pt) => [Number(attrOf(pt, "x")), Number(attrOf(pt, "y"))] as const,
			);
		const xy = (list: ReadonlyArray<readonly [number, number]>) =>
			list.map(([x, y]) => `${x} ${y}`).join(" ");
		for (const cmd of kids(p)) {
			const list = pts(cmd);
			const last = list[list.length - 1];
			if (list.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)))
				continue; // guide formulas: not evaluated
			switch (cmd.localName) {
				case "moveTo":
					if (last) d += `M${xy(list)}`;
					break;
				case "lnTo":
					if (last) d += `L${xy(list)}`;
					break;
				case "cubicBezTo":
					if (list.length === 3) d += `C${xy(list)}`;
					break;
				case "quadBezTo":
					if (list.length === 2) d += `Q${xy(list)}`;
					break;
				case "arcTo": {
					const wR = Number(attrOf(cmd, "wR"));
					const hR = Number(attrOf(cmd, "hR"));
					const st = (Number(attrOf(cmd, "stAng")) / 60000) * (Math.PI / 180);
					const sw = (Number(attrOf(cmd, "swAng")) / 60000) * (Math.PI / 180);
					if (![wR, hR, st, sw].every(Number.isFinite)) break;
					const ex = cx - wR * Math.cos(st) + wR * Math.cos(st + sw);
					const ey = cy - hR * Math.sin(st) + hR * Math.sin(st + sw);
					d += `A${wR} ${hR} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${ex} ${ey}`;
					cx = ex;
					cy = ey;
					break;
				}
				case "close":
					d += "Z";
					break;
			}
			if (last && cmd.localName !== "arcTo") [cx, cy] = last;
		}
		if (!d.startsWith("M")) continue;
		out.push({
			d,
			// Without its own size a path is drawn in the shape's EMU box.
			w: Number(attrOf(p, "w")) || box.w * EMU_PER_PX || 1,
			h: Number(attrOf(p, "h")) || box.h * EMU_PER_PX || 1,
			fill: attrOf(p, "fill") !== "none",
			stroke: attrOf(p, "stroke") !== "0",
		});
	}
	return out;
}

interface Context {
	pkg: Pkg;
	pal: Palette;
	fonts: Fonts;
	part: string;
	rels: ReturnType<Pkg["rels"]>;
	/** Placeholder trees of layout and master, for inheritance. */
	layoutTree: Element | null;
	masterTree: Element | null;
	masterStyles: { title: LevelStyles; body: LevelStyles; other: LevelStyles };
	/** Group transform: child space -> slide space. */
	map: (b: Box) => Box;
}

function styleCategory(ph: Ph | null): "title" | "body" | "other" {
	if (!ph) return "other";
	if (ph.type === "title" || ph.type === "ctrTitle") return "title";
	if (["body", "subTitle", "obj"].includes(ph.type)) return "body";
	return "other";
}

function readTextBody(
	txBody: Element | null,
	ctx: Context,
	inherited: LevelStyles[],
	inheritedBodyPr: Element[],
): TextBody | undefined {
	if (!txBody) return undefined;
	const bodyPrs = [kid(txBody, "bodyPr"), ...inheritedBodyPr].filter(
		Boolean,
	) as Element[];
	const bodyAttr = (name: string) => {
		for (const b of bodyPrs) {
			const v = attrOf(b, name);
			if (v !== null) return v;
		}
		return null;
	};
	const anchorVal = bodyAttr("anchor");
	const inset = (name: string, fallback: number) => {
		const v = bodyAttr(name);
		return v === null ? fallback : px(v);
	};
	const autofit = path(kid(txBody, "bodyPr"), "normAutofit");
	const fontScale = autofit
		? Number(attrOf(autofit, "fontScale") ?? 100000) / 100000
		: 1;
	const layers = [
		...inherited,
		readList(kid(txBody, "lstStyle"), ctx.pal, ctx.fonts),
	];

	const paras: Para[] = kids(txBody, "p").map((p) => {
		const pPr = kid(p, "pPr");
		const level = Number(attrOf(pPr, "lvl") ?? 0);
		const merged: Level = {};
		for (const layer of layers) Object.assign(merged, layer[level] ?? {});
		const own = readLevel(pPr, ctx.pal, ctx.fonts);
		// What master and layout say about direction and side, before
		// this paragraph's own settings are layered on top.
		const inheritedRtl = merged.rtl === true;
		const inheritedAlign = merged.align;
		Object.assign(merged, own);
		const baseSize = (merged.size ?? 24) * fontScale;
		const runs: Run[] = [];
		for (const r of kids(p)) {
			if (r.localName === "br") {
				runs.push({ ...runFrom(merged, baseSize), text: "\n", br: true });
				continue;
			}
			if (r.localName !== "r" && r.localName !== "fld") continue;
			const own = readRun(kid(r, "rPr"), ctx.pal, ctx.fonts);
			const style = { ...merged, ...own };
			const link = relId(path(r, "rPr", "hlinkClick"), "id");
			const target = link ? ctx.rels.get(link) : undefined;
			const rPr = kid(r, "rPr");
			const text = kid(r, "t")?.textContent ?? "";
			runs.push({
				...runFrom(style, own.size ? own.size * fontScale : baseSize),
				text,
				// Right-to-left text is set in the complex-script face.
				font: hasRtl(text) ? (style.csFont ?? style.font) : style.font,
				underline:
					!!rPr && attrOf(rPr, "u") !== null && attrOf(rPr, "u") !== "none",
				strike: !!rPr && (attrOf(rPr, "strike") ?? "noStrike") !== "noStrike",
				href:
					target?.external && /^https?:/i.test(target.target)
						? target.target
						: undefined,
			});
		}
		const endSize = readRun(kid(p, "endParaRPr"), ctx.pal, ctx.fonts).size;
		// A flag on the paragraph itself is final. A template's blanket
		// "left-to-right, left-aligned" is not: there the text decides,
		// so Urdu or Arabic typed into an English template still reads
		// from the right.
		const rtl =
			own.rtl ?? (inheritedRtl || startsRtl(runs.map((r) => r.text).join("")));
		const align =
			own.align ??
			(rtl && (!inheritedAlign || inheritedAlign === "left")
				? "right"
				: (inheritedAlign ?? "left"));
		return {
			runs,
			rtl: rtl || undefined,
			align,
			level,
			bullet: merged.bullet ?? undefined,
			indent: merged.indent ?? 0,
			lineHeight: merged.lineHeight,
			spaceBefore: merged.spaceBefore ?? 0,
			spaceAfter: merged.spaceAfter ?? 0,
			endSize: (endSize ?? baseSize / fontScale) * fontScale,
		};
	});

	return {
		paras,
		anchor:
			anchorVal === "ctr" ? "middle" : anchorVal === "b" ? "bottom" : "top",
		insets: [
			inset("lIns", 9.6),
			inset("tIns", 4.8),
			inset("rIns", 9.6),
			inset("bIns", 4.8),
		],
		wrap: bodyAttr("wrap") !== "none",
		vertical: (bodyAttr("vert") ?? "horz").startsWith("vert"),
	};
}

function runFrom(style: Level, size: number): Run {
	return {
		text: "",
		size,
		bold: style.bold ?? false,
		italic: style.italic ?? false,
		underline: false,
		strike: false,
		color: style.color ?? "rgb(0, 0, 0)",
		font: style.font,
	};
}

function readShape(
	sp: Element,
	ctx: Context,
	out: SlideElement[],
	inheritOnly: boolean,
) {
	const ph = placeholderOf(sp);
	if (inheritOnly && ph) return; // layout/master placeholders are templates, not content
	const layoutPh = ph ? findPlaceholder(ctx.layoutTree, ph) : null;
	const masterPh = ph ? findPlaceholder(ctx.masterTree, ph) : null;
	const spPr = kid(sp, "spPr");
	const box =
		readXfrm(kid(spPr, "xfrm")) ??
		readXfrm(path(layoutPh, "spPr", "xfrm")) ??
		readXfrm(path(masterPh, "spPr", "xfrm"));
	if (!box) return;

	const category = styleCategory(ph);
	const inheritedLists = [
		ctx.masterStyles[category],
		readList(path(masterPh, "txBody", "lstStyle"), ctx.pal, ctx.fonts),
		readList(path(layoutPh, "txBody", "lstStyle"), ctx.pal, ctx.fonts),
	];
	const inheritedBodyPr = [
		path(layoutPh, "txBody", "bodyPr"),
		path(masterPh, "txBody", "bodyPr"),
	].filter(Boolean) as Element[];

	// Theme style reference (p:style) supplies default fill/line/font colour.
	const style = kid(sp, "style");
	const styleFill = ctx.pal.resolve(kid(style, "fillRef"));
	const styleLine = ctx.pal.resolve(kid(style, "lnRef"));
	const styleFont = ctx.pal.resolve(kid(style, "fontRef"));
	if (styleFont)
		inheritedLists.push([...Array(9)].map(() => ({ color: styleFont })));

	const fill = ctx.pal.fill(spPr);
	const ln = kid(spPr, "ln");
	const lnFill =
		ln && kid(ln, "noFill")
			? null
			: (ctx.pal.resolve(kid(ln, "solidFill")) ?? styleLine);
	const lnW = ln ? px(attrOf(ln, "w") ?? "12700") : 0.75;
	const geom = attrOf(kid(spPr, "prstGeom"), "prst") ?? "rect";
	const paths = readPaths(kid(spPr, "custGeom"), box);
	const adj = attrOf(path(spPr, "prstGeom", "avLst", "gd"), "fmla");
	const mapped = ctx.map(box);
	const blip = relId(path(spPr, "blipFill", "blip"), "embed");
	const blipRel = blip ? ctx.rels.get(blip) : undefined;

	const text = readTextBody(
		kid(sp, "txBody"),
		ctx,
		inheritedLists,
		inheritedBodyPr,
	);
	// A SmartArt shape says separately where its text sits.
	const textBox = text ? readXfrm(kid(sp, "txXfrm")) : null;

	out.push({
		kind: "shape",
		...mapped,
		geom,
		gradient: ctx.pal.gradient(spPr),
		shadow: ctx.pal.shadow(spPr),
		paths: paths.length ? paths : undefined,
		image:
			blipRel && !blipRel.external && mimeFor(blipRel.target)
				? ctx.pkg.wantMedia(blipRel.target)
				: undefined,
		fill: fill === null ? undefined : (fill ?? (ph ? undefined : styleFill)),
		line:
			lnFill && (ln || style)
				? {
						color: lnFill,
						width: Math.max(0.5, lnW),
						dash:
							!!path(ln, "prstDash") &&
							attrOf(path(ln, "prstDash"), "val") !== "solid",
					}
				: undefined,
		radius:
			geom === "roundRect"
				? Math.min(mapped.w, mapped.h) *
					(adj ? Number(adj.split(" ")[1]) / 100000 : 0.1667)
				: undefined,
		text: textBox ? undefined : text,
	});
	if (textBox)
		out.push({ kind: "shape", ...ctx.map(textBox), geom: "rect", text });
}

function readPicture(pic: Element, ctx: Context, out: SlideElement[]) {
	const box = readXfrm(path(pic, "spPr", "xfrm"));
	if (!box) return;
	const embed = relId(path(pic, "blipFill", "blip"), "embed");
	const rel = embed ? ctx.rels.get(embed) : undefined;
	const src =
		rel && !rel.external && mimeFor(rel.target)
			? ctx.pkg.wantMedia(rel.target)
			: null;
	const rect = path(pic, "blipFill", "srcRect");
	const side = (name: string) => Number(attrOf(rect, name) ?? 0) / 100000 || 0;
	const crop: [number, number, number, number] = [
		side("l"),
		side("t"),
		side("r"),
		side("b"),
	];
	const cropped =
		crop.some((c) => c !== 0) && crop[0] + crop[2] < 1 && crop[1] + crop[3] < 1;
	const mapped = ctx.map(box);
	const prst = attrOf(path(pic, "spPr", "prstGeom"), "prst");
	out.push({
		kind: "image",
		...mapped,
		src,
		crop: cropped ? crop : undefined,
		shadow: ctx.pal.shadow(kid(pic, "spPr")),
		round:
			prst === "ellipse"
				? "ellipse"
				: prst === "roundRect"
					? Math.min(mapped.w, mapped.h) * 0.1667
					: undefined,
	});
}

/**
 * SmartArt. The file keeps the diagram as data plus, since Office
 * 2010, the shapes it was last laid out as: a drawing part, named by
 * the data model's `dataModelExt`. Those shapes are drawn as they
 * are, placed inside the frame. False when the file has none.
 */
function readDiagram(
	data: Element | null,
	box: Box,
	ctx: Context,
	out: SlideElement[],
): boolean {
	const model = ctx.rels.get(relId(kid(data, "relIds"), "dm") ?? "");
	const modelDoc = model && !model.external ? ctx.pkg.xml(model.target) : null;
	const named = attrOf(
		modelDoc?.getElementsByTagNameNS("*", "dataModelExt")[0],
		"relId",
	);
	const drawings = [...ctx.rels.values()].filter((r) =>
		r.type.endsWith("/diagramDrawing"),
	);
	const rel =
		(named ? ctx.rels.get(named) : undefined) ??
		(drawings.length === 1 ? drawings[0] : undefined);
	if (!rel || rel.external) return false;
	const tree = kid(ctx.pkg.xml(rel.target)?.documentElement, "spTree");
	if (!tree) return false;
	const before = out.length;
	const parent = ctx.map;
	readTree(
		tree,
		{
			...ctx,
			part: rel.target,
			rels: ctx.pkg.rels(rel.target),
			layoutTree: null,
			masterTree: null,
			// The drawing's coordinates start at the frame's corner.
			map: (b) => parent({ ...b, x: box.x + b.x, y: box.y + b.y }),
		},
		out,
		false,
	);
	return out.length > before;
}

function readFrame(frame: Element, ctx: Context, out: SlideElement[]) {
	const box = readXfrm(kid(frame, "xfrm"));
	if (!box) return;
	const data = path(frame, "graphic", "graphicData");
	const tbl = kid(data, "tbl");
	if (!tbl) {
		const uri = attrOf(data, "uri") ?? "";
		const chartRel = ctx.rels.get(relId(kid(data, "chart"), "id") ?? "");
		const chartDoc =
			chartRel && !chartRel.external ? ctx.pkg.xml(chartRel.target) : null;
		if (chartDoc) {
			let chart: Chart | null = null;
			try {
				chart = readChart(chartDoc, {
					resolve: (holder) => ctx.pal.resolve(kid(holder, "solidFill")),
					accent: (n) => ctx.pal.accent(n),
				});
			} catch {
				// An odd chart part must not cost the whole deck.
			}
			if (chart) {
				out.push({ kind: "chart", ...ctx.map(box), chart });
				return;
			}
		}
		if (uri.includes("diagram") && readDiagram(data, box, ctx, out)) return;
		const label = uri.includes("chart")
			? msg("Chart")
			: uri.includes("diagram")
				? msg("Diagram")
				: msg("Embedded object");
		out.push({ kind: "placeholder", ...ctx.map(box), label });
		return;
	}
	const cols = kids(kid(tbl, "tblGrid"), "gridCol").map((c) =>
		px(attrOf(c, "w")),
	);
	const rows = kids(tbl, "tr").map((tr) => ({
		h: px(attrOf(tr, "h")),
		cells: kids(tr, "tc").map((tc) => {
			const text = readTextBody(
				kid(tc, "txBody"),
				ctx,
				[ctx.masterStyles.other],
				[],
			) ?? {
				paras: [],
				anchor: "top" as const,
				insets: [9.6, 4.8, 9.6, 4.8] as [number, number, number, number],
				wrap: true,
				vertical: false,
			};
			const fill = ctx.pal.fill(kid(tc, "tcPr"));
			return {
				text,
				fill: fill ?? undefined,
				span: Number(attrOf(tc, "gridSpan") ?? 1),
				rowSpan: Number(attrOf(tc, "rowSpan") ?? 1),
				hidden: attrOf(tc, "hMerge") === "1" || attrOf(tc, "vMerge") === "1",
			};
		}),
	}));
	const tableRtl = attrOf(kid(tbl, "tblPr"), "rtl");
	out.push({
		kind: "table",
		...ctx.map(box),
		cols,
		rows,
		rtl: tableRtl === "1" || tableRtl === "true" || undefined,
	});
}

function readTree(
	tree: Element | null,
	ctx: Context,
	out: SlideElement[],
	inheritOnly: boolean,
) {
	for (const el of kids(tree)) {
		switch (el.localName) {
			case "sp":
			case "cxnSp":
				readShape(el, ctx, out, inheritOnly);
				break;
			case "pic":
				readPicture(el, ctx, out);
				break;
			case "graphicFrame":
				readFrame(el, ctx, out);
				break;
			case "grpSp": {
				const xfrm = path(el, "grpSpPr", "xfrm");
				const outer = readXfrm(xfrm);
				const chOff = kid(xfrm, "chOff");
				const chExt = kid(xfrm, "chExt");
				if (!outer || !chOff || !chExt) {
					readTree(el, ctx, out, inheritOnly);
					break;
				}
				const cx = px(attrOf(chOff, "x"));
				const cy = px(attrOf(chOff, "y"));
				const sx = outer.w / (px(attrOf(chExt, "cx")) || outer.w || 1);
				const sy = outer.h / (px(attrOf(chExt, "cy")) || outer.h || 1);
				const parent = ctx.map;
				readTree(
					el,
					{
						...ctx,
						map: (b) =>
							parent({
								...b,
								x: outer.x + (b.x - cx) * sx,
								y: outer.y + (b.y - cy) * sy,
								w: b.w * sx,
								h: b.h * sy,
							}),
					},
					out,
					inheritOnly,
				);
				break;
			}
			case "AlternateContent": {
				const fallback = kid(el, "Fallback");
				if (fallback) readTree(fallback, ctx, out, inheritOnly);
				break;
			}
		}
	}
}

function background(cSld: Element | null, ctx: Context): string | undefined {
	const bg = kid(cSld, "bg");
	if (!bg) return undefined;
	const bgPr = kid(bg, "bgPr");
	if (bgPr) {
		const blip = relId(path(bgPr, "blipFill", "blip"), "embed");
		const rel = blip ? ctx.rels.get(blip) : undefined;
		if (rel && !rel.external && mimeFor(rel.target))
			return `media:${ctx.pkg.wantMedia(rel.target)}`;
		return ctx.pal.fill(bgPr) ?? undefined;
	}
	const ref = kid(bg, "bgRef");
	return ref ? ctx.pal.resolve(ref) : undefined;
}

// ---------- Entry ----------

/** The whole deck at once (tests, small files). */
export function parsePptx(bytes: Uint8Array): Presentation {
	const steps = readDeck(bytes);
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
	}
}

/** Let the page breathe: a task boundary that timers' background
 * throttling does not stretch. */
const pause = () =>
	new Promise<void>((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => resolve();
		channel.port2.postMessage(0);
	});

/**
 * The same deck, read without freezing the page: parsing needs the
 * DOM, so it cannot move to a worker, but it hands control back
 * between slides so a long deck opens with the spinner turning and
 * the Back button working. Aborting stops it at the next pause.
 */
export async function parsePptxAsync(
	bytes: Uint8Array,
	signal?: AbortSignal,
): Promise<Presentation> {
	const steps = readDeck(bytes);
	let since = performance.now();
	for (;;) {
		const step = steps.next();
		if (step.done) return step.value;
		if (performance.now() - since < 12) continue;
		await pause();
		if (signal?.aborted) throw new DOMException("aborted", "AbortError");
		since = performance.now();
	}
}

/** Reads the deck, yielding after the archive is open and after each
 * slide. */
function* readDeck(bytes: Uint8Array): Generator<undefined, Presentation> {
	yield;
	const files = unzipSync(bytes, {
		filter: (f) => f.name.endsWith(".xml") || f.name.endsWith(".rels"),
	});
	yield;
	const pkg = new Pkg(files, bytes);
	const presentation = pkg.xml("ppt/presentation.xml");
	if (!presentation) throw new Error("corrupt: missing presentation.xml");
	const root = presentation.documentElement;
	const size = kid(root, "sldSz");
	const width = px(attrOf(size, "cx")) || 960;
	const height = px(attrOf(size, "cy")) || 540;
	const presRels = pkg.rels("ppt/presentation.xml");
	const slideParts = kids(kid(root, "sldIdLst"), "sldId")
		.map((s) => presRels.get(relId(s, "id") ?? "")?.target)
		.filter((t): t is string => !!t);

	const slides: Slide[] = [];
	const masterCache = new Map<
		string,
		{ doc: Document | null; theme: ColorMap; fonts: Fonts }
	>();

	for (const part of slideParts) {
		const slideDoc = pkg.xml(part);
		if (!slideDoc) continue;
		const rels = pkg.rels(part);
		const layoutPart =
			[...rels.values()].find((r) => r.type.endsWith("/slideLayout"))?.target ??
			"";
		const layoutDoc = pkg.xml(layoutPart);
		const layoutRels = pkg.rels(layoutPart);
		const masterPart =
			[...layoutRels.values()].find((r) => r.type.endsWith("/slideMaster"))
				?.target ?? "";
		let master = masterCache.get(masterPart);
		if (!master) {
			// A deck without a readable master still shows its slides.
			const doc = pkg.xml(masterPart);
			const themePart =
				[...pkg.rels(masterPart).values()].find((r) =>
					r.type.endsWith("/theme"),
				)?.target ?? "";
			const themeDoc = pkg.xml(themePart);
			const theme: ColorMap = {};
			const scheme = themeDoc?.getElementsByTagNameNS("*", "clrScheme")[0];
			for (const c of kids(scheme)) {
				const v = kid(c, "srgbClr") ?? kid(c, "sysClr");
				theme[c.localName] =
					attrOf(v, "val") === "windowText"
						? "000000"
						: (attrOf(v, "lastClr") ?? attrOf(v, "val") ?? "000000");
			}
			const fontScheme = themeDoc?.getElementsByTagNameNS("*", "fontScheme")[0];
			const face = (n: string) =>
				attrOf(path(kid(fontScheme, n), "latin"), "typeface") ?? "Calibri";
			master = {
				doc,
				theme,
				fonts: new Fonts(face("majorFont"), face("minorFont")),
			};
			masterCache.set(masterPart, master);
		}
		const masterRoot = master.doc?.documentElement ?? null;
		const clrMap: ColorMap = {};
		for (const a of Array.from(kid(masterRoot, "clrMap")?.attributes ?? []))
			clrMap[a.localName] = a.value;
		const pal = new Palette(master.theme, clrMap);
		const txStyles = kid(masterRoot, "txStyles");
		const masterStyles = {
			title: readList(kid(txStyles, "titleStyle"), pal, master.fonts),
			body: readList(kid(txStyles, "bodyStyle"), pal, master.fonts),
			other: readList(kid(txStyles, "otherStyle"), pal, master.fonts),
		};
		const slideRoot = slideDoc.documentElement;
		const layoutRoot = layoutDoc?.documentElement ?? null;
		const masterTree = path(masterRoot, "cSld", "spTree");
		const layoutTree = path(layoutRoot, "cSld", "spTree");
		const base = {
			pkg,
			pal,
			fonts: master.fonts,
			layoutTree,
			masterTree,
			masterStyles,
			map: (b: Box) => b,
		};
		const ctxFor = (p: string, r: Context["rels"]): Context => ({
			...base,
			part: p,
			rels: r,
		});

		const elements: SlideElement[] = [];
		const showMaster = (el: Element | null) =>
			attrOf(el, "showMasterSp") !== "0";
		if (showMaster(slideRoot) && showMaster(layoutRoot)) {
			readTree(
				masterTree,
				ctxFor(masterPart, pkg.rels(masterPart)),
				elements,
				true,
			);
		}
		if (showMaster(slideRoot))
			readTree(layoutTree, ctxFor(layoutPart, layoutRels), elements, true);
		const slideCtx = ctxFor(part, rels);
		readTree(path(slideRoot, "cSld", "spTree"), slideCtx, elements, false);

		const bg =
			background(kid(slideRoot, "cSld"), slideCtx) ??
			background(kid(layoutRoot, "cSld"), ctxFor(layoutPart, layoutRels)) ??
			background(
				kid(masterRoot, "cSld"),
				ctxFor(masterPart, pkg.rels(masterPart)),
			) ??
			"#ffffff";

		// Speaker notes, as plain text.
		const notesPart = [...rels.values()].find((r) =>
			r.type.endsWith("/notesSlide"),
		)?.target;
		const notesDoc = notesPart ? pkg.xml(notesPart) : null;
		let notes: string | undefined;
		if (notesDoc) {
			const texts: string[] = [];
			for (const sp of Array.from(notesDoc.getElementsByTagNameNS("*", "sp"))) {
				if (placeholderOf(sp)?.type !== "body") continue;
				for (const p of Array.from(sp.getElementsByTagNameNS("*", "p"))) {
					const line = Array.from(p.getElementsByTagNameNS("*", "t"))
						.map((t) => t.textContent)
						.join("");
					if (line.trim()) texts.push(line);
				}
			}
			notes = texts.join("\n") || undefined;
		}
		slides.push({
			background: bg,
			elements,
			notes,
			// PowerPoint marks a hidden slide show="0" on its root.
			...(attrOf(slideRoot, "show") === "0" ? { hidden: true } : {}),
		});
		yield;
	}

	pkg.loadMedia();
	const resolveSrc = (src: string | null) =>
		src ? (pkg.media.get(src) ?? null) : null;
	for (const slide of slides) {
		if (slide.background.startsWith("media:")) {
			const url = pkg.media.get(slide.background.slice(6));
			slide.background = url
				? `center / 100% 100% no-repeat url("${url}")`
				: "#ffffff";
		}
		for (const el of slide.elements) {
			if (el.kind === "image") el.src = resolveSrc(el.src);
			else if (el.kind === "shape" && el.image)
				el.image = resolveSrc(el.image) ?? undefined;
		}
	}

	return {
		width,
		height,
		slides,
		dispose() {
			for (const url of pkg.media.values()) URL.revokeObjectURL(url);
			pkg.media.clear();
		},
	};
}
