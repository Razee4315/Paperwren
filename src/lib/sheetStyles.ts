/**
 * What SheetJS Community does not expose about an .xlsx / .xlsm
 * workbook, read straight from the package: cell styling (font
 * emphasis and colour, fills, borders, alignment, wrapping), frozen
 * panes, gridlines, conditional formatting, and the pictures and charts
 * placed on each sheet.
 *
 * Runs inside the parse worker, where there is no DOMParser, so the
 * few elements needed are picked out with bounded regular expressions.
 * Everything here is best-effort: any surprise yields no styling and
 * the grid falls back to the app's neutral look.
 */

import { guardedUnzip } from "./safeZip";

export interface CellStyle {
	font?: string;
	fontSize?: number;
	vertical?: "top" | "center" | "bottom";
	rotation?: number;
	indent?: number;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	/** Authored text colour, "#rrggbb". */
	color?: string;
	/** Solid fill colour, "#rrggbb". */
	fill?: string;
	align?: "left" | "center" | "right";
	wrap?: boolean;
	/** Authored borders per side, each a CSS border value. */
	border?: { t?: string; r?: string; b?: string; l?: string };
}

/** How a conditional rule changes a cell it matches. */
export type CondLook = Pick<
	CellStyle,
	"fill" | "color" | "bold" | "italic" | "underline" | "strike"
>;

/** A cell range in the file's own 0-based rows and columns. */
export interface CellBox {
	r0: number;
	c0: number;
	r1: number;
	c1: number;
}

/** One conditional-formatting rule of a sheet, of the kinds a viewer
 * can judge without a formula engine. */
export type CondRule = {
	ranges: CellBox[];
	priority: number;
	stop?: boolean;
} & (
	| {
			kind: "compare";
			operator: string;
			/** Numbers, or text (unquoted) to compare equal to. */
			values: Array<number | string>;
			look: CondLook;
	  }
	| {
			kind: "text";
			operator: "containsText" | "notContainsText" | "beginsWith" | "endsWith";
			text: string;
			look: CondLook;
	  }
	| {
			kind: "scale";
			/** Two or three stops, lowest first. */
			stops: Array<{
				type: "min" | "max" | "num" | "percent" | "percentile";
				value?: number;
				color: string;
			}>;
	  }
);

/** A cell position plus an offset into the cell, in EMU. */
export interface AnchorPoint {
	col: number;
	row: number;
	colOff: number;
	rowOff: number;
}

/** A picture or chart placed on a sheet, in the file's coordinates. */
export interface SheetAnchor {
	from: AnchorPoint;
	/** Opposite corner, when the object stretches with the cells. */
	to?: AnchorPoint;
	/** Fixed size in EMU, when it does not. */
	ext?: { cx: number; cy: number };
	/** Index into the workbook's media. */
	image?: number;
	/** The chart part's XML, parsed later where there is a DOM. */
	chartXml?: string;
}

export interface WorkbookStyles {
	/** Distinct styles; cells refer to them by index. */
	styles: CellStyle[];
	/** Sheet name -> cell address ("B7") -> index into `styles`. */
	sheets: Map<string, Map<string, number>>;
	/** Sheet name -> rows and columns frozen at the top / left (as
	 * counted in the file, hidden ones included). */
	freeze: Map<string, { rows: number; cols: number }>;
	/** Sheets the file draws without gridlines. */
	gridless: Set<string>;
	/** Sheet name -> its conditional-formatting rules. */
	conditional?: Map<string, CondRule[]>;
	/** Sheet name -> pictures and charts on it. */
	anchors: Map<string, SheetAnchor[]>;
	media: Array<{ bytes: Uint8Array; type: string }>;
	/** Theme accents 1-6 as "#rrggbb", for chart series. */
	accents: string[];
}

/** Bounds: a sheet stuffed with objects must not stall the parse. */
const MAX_ANCHORS = 200;
const MAX_MEDIA_BYTES = 40 * 1024 * 1024;

/** Sheets larger than this keep the neutral look. */
const MAX_SHEET_XML = 80 * 1024 * 1024;

/** Excel's legacy 64-colour palette (indexed colours). */
const INDEXED = (
	"000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF " +
	"000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF " +
	"800000 008000 000080 808000 800080 008080 C0C0C0 808080 " +
	"9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF " +
	"000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF " +
	"00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 " +
	"3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 " +
	"003366 339966 003300 333300 993300 993366 333399 333333"
).split(" ");

/** Office's default theme, for packages without a theme part. */
const DEFAULT_THEME = [
	"FFFFFF",
	"000000",
	"E7E6E6",
	"44546A",
	"4472C4",
	"ED7D31",
	"A5A5A5",
	"FFC000",
	"5B9BD5",
	"70AD47",
];

const attr = (tag: string, name: string): string | undefined =>
	new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

const truthy = (tag: string | undefined) =>
	tag !== undefined && !/\sval="(0|false)"/.test(tag);

function decodeXml(text: string): string {
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_, h) =>
			String.fromCodePoint(Number.parseInt(h, 16)),
		)
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

/** Lighten (tint > 0) or darken (tint < 0) the way Excel does: on
 * the HSL lightness. */
function applyTint(hex: string, tint: number): string {
	const n = Number.parseInt(hex, 16);
	const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
	const max = Math.max(...rgb);
	const min = Math.min(...rgb);
	let l = (max + min) / 2;
	const d = max - min;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	let h = 0;
	if (d !== 0) {
		const [r, g, b] = rgb;
		h =
			max === r
				? ((g - b) / d + 6) % 6
				: max === g
					? (b - r) / d + 2
					: (r - g) / d + 4;
	}
	l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs((h % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] =
		h < 1
			? [c, x, 0]
			: h < 2
				? [x, c, 0]
				: h < 3
					? [0, c, x]
					: h < 4
						? [0, x, c]
						: h < 5
							? [x, 0, c]
							: [c, 0, x];
	return [r, g, b]
		.map((v) =>
			Math.round(Math.min(1, Math.max(0, v + m)) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("");
}

/** A <color>/<fgColor> element as "#rrggbb", or undefined for
 * automatic / unresolvable colours. */
function readColor(
	tag: string | undefined,
	theme: string[],
): string | undefined {
	if (!tag) return undefined;
	let hex: string | undefined;
	const rgb = attr(tag, "rgb");
	const themed = attr(tag, "theme");
	const indexed = attr(tag, "indexed");
	if (rgb && /^[0-9a-f]{6,8}$/i.test(rgb)) hex = rgb.slice(-6);
	else if (themed !== undefined) hex = theme[Number(themed)];
	else if (indexed !== undefined) hex = INDEXED[Number(indexed)];
	if (!hex) return undefined;
	const tint = Number(attr(tag, "tint"));
	if (tint && Number.isFinite(tint))
		hex = applyTint(hex, Math.max(-1, Math.min(1, tint)));
	return `#${hex.toLowerCase()}`;
}

/** The children of <name>...</name>, one string per child element. */
function section(xml: string, name: string, child: string): string[] {
	const body = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(
		xml,
	)?.[1];
	if (!body) return [];
	return (
		body.match(
			new RegExp(`<${child}\\b[^>]*?(?:/>|>[\\s\\S]*?</${child}>)`, "g"),
		) ?? []
	);
}

const tagOf = (xml: string, name: string): string | undefined =>
	new RegExp(`<${name}\\b[^>]*>`).exec(xml)?.[0];

function readTheme(xml: string | undefined): string[] {
	if (!xml) return DEFAULT_THEME;
	const scheme = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(xml)?.[0];
	if (!scheme) return DEFAULT_THEME;
	const pick = (name: string): string | undefined => {
		const el = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(
			scheme,
		)?.[1];
		if (!el) return undefined;
		return (
			/<a:srgbClr\s+val="([0-9a-f]{6})"/i.exec(el)?.[1] ??
			/lastClr="([0-9a-f]{6})"/i.exec(el)?.[1]
		);
	};
	// Spreadsheet theme indices swap the light/dark pairs.
	const order = [
		"lt1",
		"dk1",
		"lt2",
		"dk2",
		"accent1",
		"accent2",
		"accent3",
		"accent4",
		"accent5",
		"accent6",
	];
	return order.map((name, i) => pick(name) ?? DEFAULT_THEME[i]);
}

function readStyleTable(xml: string, theme: string[]): CellStyle[] {
	const fonts = section(xml, "fonts", "font").map((font) => ({
		font: decodeXml(attr(tagOf(font, "name") ?? "", "val") ?? "") || undefined,
		fontSize:
			Number(attr(tagOf(font, "sz") ?? "", "val")) > 0
				? (Number(attr(tagOf(font, "sz") ?? "", "val")) * 4) / 3
				: undefined,
		bold: truthy(tagOf(font, "b")) || undefined,
		italic: truthy(tagOf(font, "i")) || undefined,
		underline:
			(tagOf(font, "u") !== undefined &&
				!/\sval="none"/.test(tagOf(font, "u") ?? "")) ||
			undefined,
		strike: truthy(tagOf(font, "strike")) || undefined,
		color: readColor(tagOf(font, "color"), theme),
	}));
	const fills = section(xml, "fills", "fill").map((fill) => {
		const pattern = tagOf(fill, "patternFill");
		if (!pattern || attr(pattern, "patternType") !== "solid") return undefined;
		return readColor(tagOf(fill, "fgColor"), theme);
	});
	const LINE: Record<string, string> = {
		thin: "1px solid",
		hair: "1px solid",
		medium: "2px solid",
		thick: "3px solid",
		double: "3px double",
		dashed: "1px dashed",
		mediumDashed: "2px dashed",
		dotted: "1px dotted",
		dashDot: "1px dashed",
		mediumDashDot: "2px dashed",
		dashDotDot: "1px dotted",
		mediumDashDotDot: "2px dotted",
		slantDashDot: "2px dashed",
	};
	const borders = section(xml, "borders", "border").map((border) => {
		const side = (names: string[]): string | undefined => {
			for (const name of names) {
				const el = new RegExp(
					`<${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</${name}>)`,
				).exec(border)?.[0];
				const line = el ? LINE[attr(el, "style") ?? ""] : undefined;
				if (el && line)
					return `${line} ${readColor(tagOf(el, "color"), theme) ?? "#000000"}`;
			}
			return undefined;
		};
		const out = {
			t: side(["top"]),
			r: side(["right", "end"]),
			b: side(["bottom"]),
			l: side(["left", "start"]),
		};
		return out.t || out.r || out.b || out.l ? out : undefined;
	});
	return section(xml, "cellXfs", "xf").map((xf) => {
		const head = tagOf(xf, "xf") ?? "";
		const font = fonts[Number(attr(head, "fontId") ?? 0)];
		const alignment = tagOf(xf, "alignment");
		const horizontal = alignment ? attr(alignment, "horizontal") : undefined;
		const style: CellStyle = {
			...font,
			fill: fills[Number(attr(head, "fillId") ?? 0)],
			align:
				horizontal === "center" || horizontal === "centerContinuous"
					? "center"
					: horizontal === "right"
						? "right"
						: horizontal === "left"
							? "left"
							: undefined,
			vertical: ["top", "center", "bottom"].includes(
				attr(alignment ?? "", "vertical") ?? "",
			)
				? (attr(alignment ?? "", "vertical") as CellStyle["vertical"])
				: undefined,
			rotation: Number(attr(alignment ?? "", "textRotation")) || undefined,
			indent: Number(attr(alignment ?? "", "indent")) || undefined,
			wrap:
				(alignment && /^(1|true)$/.test(attr(alignment, "wrapText") ?? "")) ||
				undefined,
			border: borders[Number(attr(head, "borderId") ?? 0)],
		};
		for (const k of Object.keys(style) as Array<keyof CellStyle>)
			if (style[k] === undefined) delete style[k];
		return style;
	});
}

/** The looks conditional rules apply (styles.xml's dxfs). A dxf's
 * solid fill keeps its colour in bgColor, unlike a cell style's. */
function readDxfs(xml: string, theme: string[]): CondLook[] {
	return section(xml, "dxfs", "dxf").map((dxf) => {
		const font = /<font\b[\s\S]*?<\/font>/.exec(dxf)?.[0] ?? "";
		const pattern = tagOf(dxf, "patternFill");
		const look: CondLook = {
			color: readColor(tagOf(font, "color"), theme),
			bold: truthy(tagOf(font, "b")) || undefined,
			italic: truthy(tagOf(font, "i")) || undefined,
			strike: truthy(tagOf(font, "strike")) || undefined,
			underline:
				(tagOf(font, "u") !== undefined &&
					!/\sval="none"/.test(tagOf(font, "u") ?? "")) ||
				undefined,
			fill:
				pattern && attr(pattern, "patternType") === "none"
					? undefined
					: (readColor(tagOf(dxf, "bgColor"), theme) ??
						readColor(tagOf(dxf, "fgColor"), theme)),
		};
		for (const k of Object.keys(look) as Array<keyof CondLook>)
			if (look[k] === undefined) delete look[k];
		return look;
	});
}

/** "B2:D9 F1" as boxes, in 0-based rows and columns. */
export function readBoxes(sqref: string): CellBox[] {
	const col = (letters: string) =>
		[...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
	const out: CellBox[] = [];
	for (const part of sqref.trim().split(/\s+/).slice(0, 64)) {
		const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(
			part,
		);
		if (!m) continue;
		const a = { r: Number(m[2]) - 1, c: col(m[1]) };
		const b = m[3] ? { r: Number(m[4]) - 1, c: col(m[3]) } : a;
		out.push({
			r0: Math.min(a.r, b.r),
			c0: Math.min(a.c, b.c),
			r1: Math.max(a.r, b.r),
			c1: Math.max(a.c, b.c),
		});
	}
	return out;
}

const MAX_RULES = 200;
const COMPARE = new Set([
	"equal",
	"notEqual",
	"greaterThan",
	"lessThan",
	"greaterThanOrEqual",
	"lessThanOrEqual",
	"between",
	"notBetween",
]);

/** A rule's formula when it is a constant: a number or quoted text.
 * Anything else (a cell reference, a function) needs a formula engine,
 * and the rule is left out. */
function constant(formula: string): number | string | undefined {
	const f = decodeXml(formula).trim();
	if (/^-?\d+(\.\d+)?(E[-+]?\d+)?$/i.test(f)) return Number(f);
	const quoted = /^"((?:[^"]|"")*)"$/.exec(f);
	return quoted ? quoted[1].replace(/""/g, '"') : undefined;
}

/** The conditional-formatting rules of one sheet's XML. */
export function readConditional(
	xml: string,
	dxfs: CondLook[],
	theme: string[],
): CondRule[] {
	const rules: CondRule[] = [];
	const blocks =
		xml.match(
			/<conditionalFormatting\b[^>]*>[\s\S]*?<\/conditionalFormatting>/g,
		) ?? [];
	for (const block of blocks) {
		const ranges = readBoxes(
			attr(tagOf(block, "conditionalFormatting") ?? "", "sqref") ?? "",
		);
		if (!ranges.length) continue;
		for (const rule of block.match(
			/<cfRule\b[^>]*?(?:\/>|>[\s\S]*?<\/cfRule>)/g,
		) ?? []) {
			if (rules.length >= MAX_RULES) return rules;
			const head = tagOf(rule, "cfRule") ?? "";
			const type = attr(head, "type");
			const base = {
				ranges,
				priority: Number(attr(head, "priority")) || rules.length + 1,
				stop: /^(1|true)$/.test(attr(head, "stopIfTrue") ?? "") || undefined,
			};
			const look = dxfs[Number(attr(head, "dxfId") ?? -1)];
			if (type === "cellIs" && look) {
				const operator = attr(head, "operator") ?? "";
				const values = (
					rule.match(/<formula>([\s\S]*?)<\/formula>/g) ?? []
				).map((f) => constant(f.replace(/<\/?formula>/g, "")));
				if (
					COMPARE.has(operator) &&
					values.length &&
					values.every((v) => v !== undefined)
				)
					rules.push({
						...base,
						kind: "compare",
						operator,
						values: values as Array<number | string>,
						look,
					});
			} else if (
				(type === "containsText" ||
					type === "notContainsText" ||
					type === "beginsWith" ||
					type === "endsWith") &&
				look
			) {
				const text = decodeXml(attr(head, "text") ?? "");
				if (text)
					rules.push({ ...base, kind: "text", operator: type, text, look });
			} else if (type === "colorScale") {
				const scale =
					/<colorScale\b[\s\S]*?<\/colorScale>/.exec(rule)?.[0] ?? "";
				const points = scale.match(/<cfvo\b[^>]*>/g) ?? [];
				const colors = scale.match(/<color\b[^>]*>/g) ?? [];
				const stops = points.map((point, i) => ({
					type: attr(point, "type") as
						| "min"
						| "max"
						| "num"
						| "percent"
						| "percentile",
					value:
						attr(point, "val") !== undefined
							? constant(attr(point, "val") ?? "")
							: undefined,
					color: readColor(colors[i], theme),
				}));
				if (
					(stops.length === 2 || stops.length === 3) &&
					stops.every(
						(stop) =>
							stop.color &&
							["min", "max", "num", "percent", "percentile"].includes(
								stop.type,
							) &&
							(stop.type === "min" ||
								stop.type === "max" ||
								typeof stop.value === "number"),
					)
				)
					rules.push({
						...base,
						kind: "scale",
						stops: stops.map((stop) => ({
							type: stop.type,
							value: typeof stop.value === "number" ? stop.value : undefined,
							color: stop.color as string,
						})),
					});
			}
		}
	}
	return rules.sort((a, b) => a.priority - b.priority);
}

/** Text colours that only restate "the default ink": on an unfilled
 * cell they must not fight the app theme (black on the dark theme). */
export function isDefaultInk(color: string | undefined): boolean {
	return color === undefined || color === "#000000";
}

/** Relationship id -> package path, for the part at `partPath`. */
function relsOf(
	files: Record<string, Uint8Array>,
	partPath: string,
	decode: (b: Uint8Array) => string,
): Map<string, string> {
	const slash = partPath.lastIndexOf("/");
	const dir = partPath.slice(0, slash);
	const raw = files[`${dir}/_rels/${partPath.slice(slash + 1)}.rels`];
	const out = new Map<string, string>();
	if (!raw) return out;
	for (const rel of decode(raw).match(/<Relationship\b[^>]*>/g) ?? []) {
		const id = attr(rel, "Id");
		const target = attr(rel, "Target");
		if (!id || !target || /TargetMode="External"/.test(rel)) continue;
		if (target.startsWith("/")) {
			out.set(id, target.slice(1));
			continue;
		}
		const parts = dir.split("/");
		for (const seg of target.split("/")) {
			if (seg === "..") parts.pop();
			else if (seg !== ".") parts.push(seg);
		}
		out.set(id, parts.join("/"));
	}
	return out;
}

const IMAGE_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	bmp: "image/bmp",
	webp: "image/webp",
};

/** The pictures and charts in a drawing part. */
function readDrawing(
	xml: string,
	rels: Map<string, string>,
	charts: Record<string, Uint8Array>,
	wantMedia: (path: string) => number | undefined,
	decode: (b: Uint8Array) => string,
): SheetAnchor[] {
	const out: SheetAnchor[] = [];
	const anchor =
		/<(?:\w+:)?(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/(?:\w+:)?\1>/g;
	const int = (block: string | undefined, name: string) =>
		Number(
			new RegExp(`<(?:\\w+:)?${name}>(-?\\d+)<`).exec(block ?? "")?.[1] ?? 0,
		);
	const point = (block: string, name: string): AnchorPoint | undefined => {
		const body = new RegExp(
			`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`,
		).exec(block)?.[1];
		return body === undefined
			? undefined
			: {
					col: int(body, "col"),
					row: int(body, "row"),
					colOff: int(body, "colOff"),
					rowOff: int(body, "rowOff"),
				};
	};
	for (
		let m = anchor.exec(xml);
		m && out.length < MAX_ANCHORS;
		m = anchor.exec(xml)
	) {
		const block = m[0];
		const from = point(block, "from");
		if (!from) continue;
		const ext = /<(?:\w+:)?ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(block);
		const placed = {
			from,
			to: point(block, "to"),
			ext: ext ? { cx: Number(ext[1]), cy: Number(ext[2]) } : undefined,
		};
		const chart = /<(?:\w+:)?chart\b[^>]*\br:id="([^"]+)"/.exec(block);
		const blip = /<(?:\w+:)?blip\b[^>]*\br:embed="([^"]+)"/.exec(block);
		if (chart) {
			const part = charts[rels.get(chart[1]) ?? ""];
			if (part) out.push({ ...placed, chartXml: decode(part) });
		} else if (blip) {
			const image = wantMedia(rels.get(blip[1]) ?? "");
			if (image !== undefined) out.push({ ...placed, image });
		}
	}
	return out;
}

/**
 * Read what SheetJS leaves out of an .xlsx package: cell styles,
 * frozen panes, pictures and charts. Returns null when the file is
 * not an OOXML workbook or carries none of them.
 */
export function readXlsxStyles(bytes: Uint8Array): WorkbookStyles | null {
	try {
		if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
		const text = new TextDecoder();
		const decode = (b: Uint8Array) => text.decode(b);
		// Everything small first: styles, workbook, relationships, and
		// the drawing and chart parts (never the sheets' cell data).
		const meta = guardedUnzip(bytes, {
			filter: (f) =>
				f.name === "xl/styles.xml" ||
				f.name === "xl/workbook.xml" ||
				f.name.endsWith(".rels") ||
				/^xl\/theme\/theme\d*\.xml$/.test(f.name) ||
				(/^xl\/(drawings|charts)\/[^/]+\.xml$/.test(f.name) &&
					f.originalSize < 4 * 1024 * 1024),
		});
		const workbookXml = meta["xl/workbook.xml"];
		if (!workbookXml) return null;
		const themeName = Object.keys(meta).find((n) => n.startsWith("xl/theme/"));
		const theme = readTheme(themeName ? decode(meta[themeName]) : undefined);
		const stylesXml = meta["xl/styles.xml"];
		const table = stylesXml ? readStyleTable(decode(stylesXml), theme) : [];
		const dxfs = stylesXml ? readDxfs(decode(stylesXml), theme) : [];
		// Only styles that change how a cell looks are worth carrying.
		const visible = table.map((s) => Object.keys(s).length > 0);

		const targets = relsOf(meta, "xl/workbook.xml", decode);
		const parts = new Map<string, string>(); // part -> sheet name
		for (const sheet of decode(workbookXml).match(/<sheet\b[^>]*>/g) ?? []) {
			const name = attr(sheet, "name");
			const part = targets.get(attr(sheet, "r:id") ?? "");
			if (name !== undefined && part) parts.set(part, decodeXml(name));
		}

		const sheetFiles = guardedUnzip(bytes, {
			filter: (f) => parts.has(f.name) && f.originalSize <= MAX_SHEET_XML,
		});
		const sheets = new Map<string, Map<string, number>>();
		const freeze = new Map<string, { rows: number; cols: number }>();
		const gridless = new Set<string>();
		const conditional = new Map<string, CondRule[]>();
		const anchors = new Map<string, SheetAnchor[]>();
		// Pictures are inflated once, at the end, for those actually placed.
		const mediaIndex = new Map<string, number>();
		const mediaPaths: string[] = [];
		const wantMedia = (path: string): number | undefined => {
			const type =
				IMAGE_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
			if (!path || !type) return undefined;
			let index = mediaIndex.get(path);
			if (index === undefined) {
				index = mediaPaths.push(path) - 1;
				mediaIndex.set(path, index);
			}
			return index;
		};

		const cellTag = /<c\s[^>]*>/g;
		for (const [part, data] of Object.entries(sheetFiles)) {
			const xml = decode(data);
			const name = parts.get(part) ?? "";
			const cells = new Map<string, number>();
			if (visible.some(Boolean)) {
				cellTag.lastIndex = 0;
				for (let m = cellTag.exec(xml); m; m = cellTag.exec(xml)) {
					const s = / s="(\d+)"/.exec(m[0]);
					if (!s) continue;
					const index = Number(s[1]);
					if (!visible[index]) continue;
					const r = / r="([A-Z]+\d+)"/.exec(m[0]);
					if (r) cells.set(r[1], index);
				}
			}
			if (cells.size) sheets.set(name, cells);

			// The view and its pane sit in the sheet's header, before any
			// cell data.
			const head = xml.slice(0, 20_000);
			const sheetView = /<sheetView\b[^>]*>/.exec(head)?.[0];
			if (sheetView && /\bshowGridLines="(0|false)"/.test(sheetView))
				gridless.add(name);
			const pane = /<pane\b[^>]*>/.exec(head)?.[0];
			// Conditional formatting follows the cell data.
			const tail = xml.indexOf(
				"<conditionalFormatting",
				xml.lastIndexOf("</sheetData>"),
			);
			if (tail >= 0) {
				const rules = readConditional(xml.slice(tail), dxfs, theme);
				if (rules.length) conditional.set(name, rules);
			}
			if (pane && /state="frozen(Split)?"/.test(pane)) {
				const rows = Math.round(Number(attr(pane, "ySplit") ?? 0)) || 0;
				const cols = Math.round(Number(attr(pane, "xSplit") ?? 0)) || 0;
				if (rows > 0 || cols > 0) freeze.set(name, { rows, cols });
			}

			const drawing = /<drawing\b[^>]*\br:id="([^"]+)"/.exec(
				xml.slice(Math.max(0, xml.length - 20_000)),
			)?.[1];
			const drawingPart = drawing
				? relsOf(meta, part, decode).get(drawing)
				: undefined;
			const drawingXml = drawingPart ? meta[drawingPart] : undefined;
			if (drawingPart && drawingXml) {
				const found = readDrawing(
					decode(drawingXml),
					relsOf(meta, drawingPart, decode),
					meta,
					wantMedia,
					decode,
				);
				if (found.length) anchors.set(name, found);
			}
		}

		const media: WorkbookStyles["media"] = [];
		if (mediaPaths.length) {
			const wanted = new Set(mediaPaths);
			let budget = MAX_MEDIA_BYTES;
			const files = guardedUnzip(bytes, {
				filter: (f) => {
					if (!wanted.has(f.name) || f.originalSize > budget) return false;
					budget -= f.originalSize;
					return true;
				},
			});
			for (const path of mediaPaths) {
				const data = files[path];
				media.push({
					bytes: data ?? new Uint8Array(0),
					type: IMAGE_TYPES[
						path.slice(path.lastIndexOf(".") + 1).toLowerCase()
					],
				});
			}
		}

		if (
			!sheets.size &&
			!freeze.size &&
			!gridless.size &&
			!conditional.size &&
			!anchors.size
		)
			return null;
		return {
			styles: table,
			sheets,
			freeze,
			gridless,
			conditional,
			anchors,
			media,
			accents: theme.slice(4, 10).map((hex) => `#${hex.toLowerCase()}`),
		};
	} catch {
		return null;
	}
}
