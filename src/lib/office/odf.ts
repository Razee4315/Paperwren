/**
 * OpenDocument text (.odt) and presentations (.odp), read from the
 * package's own XML and styles. Spreadsheets (.ods) go through SheetJS.
 *
 *   .odt -> a rich flowing document: character formatting, headings,
 *           alignment, lists, tables (with spans and shading), links
 *           and pictures.
 *   .odp -> real slides in the model the PowerPoint readers produce:
 *           positioned shapes, text with the master's styles, pictures,
 *           tables, backgrounds and speaker notes.
 *
 * Styles resolve through their parent chain and the family defaults,
 * as the format defines. Not covered: page layout of text documents
 * (the text flows to the screen), charts and embedded objects
 * (labelled boxes), gradients (first colour), animations.
 *
 * Uses DOMParser, so this runs on the main thread.
 */

import { unzipSync } from "fflate";
import { startsRtl } from "../bidi";
import type {
	GeomPath,
	Para,
	Run,
	Slide,
	SlideElement,
	TextBody,
} from "../pptx/parse";
import { kids } from "../pptx/xml";
import { listMarker } from "./doc";
import {
	type RichBlock,
	type RichCell,
	type RichDoc,
	type RichMedia,
	type RichPara,
	type RichRun,
	sniffImage,
} from "./model";
import type { RawDeck } from "./ppt";

// ---------- Units ----------

/** An ODF length ("2.5cm", "12pt", "1in") in CSS px. */
export function length(value: string | null | undefined): number | undefined {
	if (!value) return undefined;
	const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px|q)?$/i.exec(value.trim());
	if (!m) return undefined;
	const n = Number(m[1]);
	if (!Number.isFinite(n)) return undefined;
	switch ((m[2] ?? "px").toLowerCase()) {
		case "cm":
			return (n / 2.54) * 96;
		case "mm":
			return (n / 25.4) * 96;
		case "q":
			return (n / 101.6) * 96;
		case "in":
			return n * 96;
		case "pt":
			return (n * 96) / 72;
		case "pc":
			return n * 16;
		default:
			return n;
	}
}

/** Font size in points. Percentages scale `base`. */
function points(value: string | undefined, base?: number): number | undefined {
	if (!value) return undefined;
	if (value.endsWith("%"))
		return base ? (base * Number.parseFloat(value)) / 100 : undefined;
	const px = length(value);
	return px === undefined ? undefined : (px * 72) / 96;
}

// ---------- Package ----------

interface Package {
	content: Document;
	styles: Document | null;
	file(name: string): Uint8Array | undefined;
}

function open(bytes: Uint8Array): Package {
	const files = unzipSync(bytes, {
		filter: (f) =>
			f.name === "content.xml" ||
			f.name === "styles.xml" ||
			f.name === "META-INF/manifest.xml" ||
			/\.(png|jpe?g|gif|bmp|webp)$/i.test(f.name),
	});
	const parse = (name: string): Document | null => {
		const raw = files[name];
		if (!raw) return null;
		const doc = new DOMParser().parseFromString(
			new TextDecoder().decode(raw),
			"application/xml",
		);
		return doc.getElementsByTagName("parsererror").length ? null : doc;
	};
	const manifest = files["META-INF/manifest.xml"];
	if (
		manifest &&
		new TextDecoder().decode(manifest).includes("encryption-data")
	)
		throw new Error("password: encrypted document");
	const content = parse("content.xml");
	if (!content) throw new Error("corrupt: missing content.xml");
	return { content, styles: parse("styles.xml"), file: (name) => files[name] };
}

// ---------- Styles ----------

type PropKind =
	| "text"
	| "paragraph"
	| "graphic"
	| "table-cell"
	| "table-column"
	| "table-row"
	| "drawing-page";

type Bag = Record<string, string>;

/**
 * Style lookup for one document scope. Automatic styles of
 * content.xml and of styles.xml may reuse names ("P1"), so each part
 * gets its own scope over the shared common styles.
 */
class Styles {
	private named = new Map<string, Element>();
	private defaults = new Map<string, Element>();
	private cache = new Map<string, Bag>();

	constructor(roots: Array<Element | null | undefined>) {
		// Later roots win: pass common styles first, automatic ones last.
		for (const root of roots)
			for (const el of kids(root)) {
				const family = el.getAttribute("style:family") ?? "";
				if (el.localName === "default-style") this.defaults.set(family, el);
				else if (el.localName === "style")
					this.named.set(`${family}:${el.getAttribute("style:name")}`, el);
				else if (el.localName === "list-style")
					this.named.set(`list:${el.getAttribute("style:name")}`, el);
				else if (el.localName === "fill-image")
					this.named.set(`fill-image:${el.getAttribute("draw:name")}`, el);
				else if (el.localName === "page-layout")
					this.named.set(`page-layout:${el.getAttribute("style:name")}`, el);
			}
	}

	get(family: string, name: string | null | undefined): Element | undefined {
		return name ? this.named.get(`${family}:${name}`) : undefined;
	}

	/** Merged <style:KIND-properties> attributes (by local name) of a
	 * style, its ancestors and the family default; nearest wins. */
	props(family: string, name: string | null | undefined, kind: PropKind): Bag {
		const key = `${family}:${name ?? ""}:${kind}`;
		const hit = this.cache.get(key);
		if (hit) return hit;
		const chain: Element[] = [];
		const seen = new Set<Element>();
		for (
			let el = this.get(family, name);
			el && !seen.has(el) && chain.length < 20;
			el = this.get(
				el.getAttribute("style:family") ?? family,
				el.getAttribute("style:parent-style-name"),
			)
		) {
			chain.unshift(el);
			seen.add(el);
		}
		const fallback = this.defaults.get(family);
		if (fallback) chain.unshift(fallback);
		const out: Bag = {};
		for (const el of chain)
			for (const child of kids(el, `${kind}-properties`))
				for (const a of Array.from(child.attributes))
					out[a.localName] = a.value;
		this.cache.set(key, out);
		return out;
	}
}

function scopes(pkg: Package): { content: Styles; master: Styles } {
	const byName = (doc: Document | null, name: string) =>
		doc
			? kids(doc.documentElement).find((e) => e.localName === name)
			: undefined;
	const common = byName(pkg.styles, "styles");
	return {
		content: new Styles([common, byName(pkg.content, "automatic-styles")]),
		master: new Styles([common, byName(pkg.styles, "automatic-styles")]),
	};
}

// ---------- Text formatting ----------

interface TextFormat {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strike?: boolean;
	size?: number;
	color?: string;
	highlight?: string;
	font?: string;
	script?: "super" | "sub";
}

/** Apply a merged text-properties bag on top of `base`. */
function textFormat(bag: Bag, base: TextFormat = {}): TextFormat {
	const out = { ...base };
	const weight = bag["font-weight"];
	if (weight) out.bold = weight === "bold" || Number(weight) >= 600;
	if (bag["font-style"]) out.italic = bag["font-style"] !== "normal";
	if (bag["text-underline-style"])
		out.underline = bag["text-underline-style"] !== "none";
	if (bag["text-line-through-style"])
		out.strike = bag["text-line-through-style"] !== "none";
	const size = points(bag["font-size"], base.size);
	if (size) out.size = size;
	if (bag["use-window-font-color"] === "true") out.color = undefined;
	if (bag.color && /^#[0-9a-f]{6}$/i.test(bag.color)) out.color = bag.color;
	if (bag["background-color"])
		out.highlight = /^#[0-9a-f]{6}$/i.test(bag["background-color"])
			? bag["background-color"]
			: undefined;
	const font = bag["font-name"] ?? bag["font-family"];
	if (font) out.font = font.replace(/^'|'$/g, "");
	const position = bag["text-position"];
	if (position)
		out.script = position.startsWith("super")
			? "super"
			: position.startsWith("sub")
				? "sub"
				: /^-/.test(position)
					? "sub"
					: /^[1-9]/.test(position)
						? "super"
						: undefined;
	return out;
}

/** ODF collapses white space in text like HTML does (real spaces are
 * written as <text:s>): runs become one space, and a space that only
 * follows a line start or another space disappears. */
function collapse(text: string, before: string): string {
	const squeezed = text.replace(/[ \t\r\n]+/g, " ");
	return (before === "" || before.endsWith(" ")) && squeezed.startsWith(" ")
		? squeezed.slice(1)
		: squeezed;
}

const safeHref = (url: string | null) =>
	url && /^(https?:|mailto:)/i.test(url) ? url : undefined;

const ALIGN: Record<string, RichPara["align"]> = {
	start: "left",
	left: "left",
	center: "center",
	end: "right",
	right: "right",
	justify: "justify",
};

/** A list style's marker for `level` (0-based) and item number. */
function markerFor(
	styles: Styles,
	listStyle: string | null,
	level: number,
	n: number,
): string {
	const style = styles.get("list", listStyle);
	const def = kids(style).find(
		(e) => Number(e.getAttribute("text:level")) === level + 1,
	);
	if (def?.localName === "list-level-style-number") {
		const format = def.getAttribute("style:num-format") ?? "1";
		const nfc = { "1": 0, I: 1, i: 2, A: 3, a: 4 }[format];
		if (format === "") return "";
		const marker = listMarker(nfc ?? 0, n, level).replace(/\.$/, "");
		return `${def.getAttribute("style:num-prefix") ?? ""}${marker}${def.getAttribute("style:num-suffix") ?? "."}`;
	}
	if (def?.localName === "list-level-style-bullet") {
		const char = def.getAttribute("text:bullet-char") ?? "•";
		// Private-use bullets come from symbol fonts nobody has.
		const code = char.charCodeAt(0);
		return code >= 0xe000 && code <= 0xf8ff ? "•" : char;
	}
	return ["•", "◦", "▪"][level % 3];
}

// ---------- Text documents ----------

export function parseOdt(bytes: Uint8Array): RichDoc {
	const pkg = open(bytes);
	const styles = scopes(pkg).content;
	const media: RichMedia[] = [];
	const mediaOf = new Map<string, number>();

	const image = (frame: Element): RichRun["image"] | undefined => {
		const img = kids(frame, "image")[0];
		const href = img?.getAttribute("xlink:href") ?? "";
		const data = pkg.file(href.replace(/^\.\//, ""));
		if (!data) return undefined;
		const type = sniffImage(data);
		if (!type) return undefined;
		let index = mediaOf.get(href);
		if (index === undefined) {
			index = media.push({ bytes: data, type }) - 1;
			mediaOf.set(href, index);
		}
		return {
			media: index,
			width: Math.round(length(frame.getAttribute("svg:width")) ?? 0),
			height: Math.round(length(frame.getAttribute("svg:height")) ?? 0),
		};
	};

	/** Inline content of a paragraph as formatted runs. */
	const inline = (
		node: Element,
		format: TextFormat,
		href: string | undefined,
		out: RichRun[],
	) => {
		const push = (text: string) => {
			if (!text) return;
			const last = out[out.length - 1];
			if (last && !last.image && last.href === href && sameFormat(last, format))
				last.text += text;
			else out.push({ ...format, href, text });
		};
		for (const child of Array.from(node.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) {
				push(collapse(child.nodeValue ?? "", out.map((r) => r.text).join("")));
				continue;
			}
			if (!(child instanceof Element)) continue;
			switch (child.localName) {
				case "s":
					push(" ".repeat(Number(child.getAttribute("text:c")) || 1));
					break;
				case "tab":
					push("\t");
					break;
				case "line-break":
					push("\n");
					break;
				case "span":
					inline(
						child,
						textFormat(
							styles.props(
								"text",
								child.getAttribute("text:style-name"),
								"text",
							),
							format,
						),
						href,
						out,
					);
					break;
				case "a":
					inline(
						child,
						format,
						safeHref(child.getAttribute("xlink:href")) ?? href,
						out,
					);
					break;
				case "frame": {
					const picture = image(child);
					if (picture) out.push({ ...format, text: "", image: picture });
					break;
				}
				case "note":
				case "annotation":
				case "annotation-end":
				case "bookmark":
				case "bookmark-start":
				case "bookmark-end":
				case "soft-page-break":
				case "tracked-changes":
					break;
				default:
					inline(child, format, href, out);
			}
		}
	};

	const paragraph = (el: Element, list?: RichPara["list"]): RichPara => {
		const name = el.getAttribute("text:style-name");
		const pp = styles.props("paragraph", name, "paragraph");
		const runs: RichRun[] = [];
		inline(
			el,
			textFormat(styles.props("paragraph", name, "text")),
			undefined,
			runs,
		);
		const level =
			el.localName === "h"
				? Math.min(6, Number(el.getAttribute("text:outline-level")) || 1)
				: undefined;
		const indent = length(pp["margin-left"]);
		return {
			kind: "para",
			runs,
			heading: level,
			align: ALIGN[pp["text-align"] ?? ""],
			indent: !list && indent && indent > 0 ? Math.round(indent) : undefined,
			list,
			pageBreak: pp["break-before"] === "page" || undefined,
			rtl: pp["writing-mode"]?.startsWith("rl") || undefined,
		};
	};

	interface ListState {
		style: string | null;
		level: number;
		counts: number[];
	}

	/** A <text:list>: items in order, nested lists one level deeper. */
	const listOf = (el: Element, out: RichBlock[], parent?: ListState) => {
		const state: ListState = {
			style: el.getAttribute("text:style-name") ?? parent?.style ?? null,
			level: parent ? parent.level + 1 : 0,
			counts: parent?.counts ?? [],
		};
		if (!parent && el.getAttribute("text:continue-numbering") !== "true")
			state.counts[0] = 0;
		for (const item of kids(el)) {
			if (item.localName !== "list-item" && item.localName !== "list-header")
				continue;
			// Only an item's first paragraph carries the marker.
			let first = item.localName === "list-item";
			for (const child of kids(item)) {
				if (child.localName === "list") listOf(child, out, state);
				else if (child.localName === "p" || child.localName === "h") {
					if (first) {
						state.counts[state.level] = (state.counts[state.level] ?? 0) + 1;
						state.counts.length = state.level + 1;
					}
					out.push(
						paragraph(child, {
							level: state.level,
							marker: first
								? markerFor(
										styles,
										state.style,
										state.level,
										state.counts[state.level],
									)
								: "",
						}),
					);
					first = false;
				} else blocksOf(child, out);
			}
		}
	};

	const blocksOf = (root: Element, out: RichBlock[], list?: ListState) => {
		for (const el of kids(root)) {
			switch (el.localName) {
				case "p":
				case "h": {
					// A frame anchored to a paragraph may hold a text box.
					for (const frame of kids(el, "frame"))
						for (const box of kids(frame, "text-box")) blocksOf(box, out);
					out.push(paragraph(el));
					break;
				}
				case "list":
					listOf(el, out, list);
					break;
				case "table": {
					const cols: number[] = [];
					for (const col of el.getElementsByTagNameNS("*", "table-column")) {
						if (
							col.parentElement !== el &&
							col.parentElement?.parentElement !== el
						)
							continue;
						const width = length(
							styles.props(
								"table-column",
								col.getAttribute("table:style-name"),
								"table-column",
							)["column-width"],
						);
						const repeat =
							Number(col.getAttribute("table:number-columns-repeated")) || 1;
						for (let i = 0; i < Math.min(repeat, 64); i++)
							cols.push(Math.round(width ?? 0));
					}
					const rows: RichCell[][] = [];
					const rowEls = kids(el).flatMap((child) =>
						child.localName === "table-row"
							? [child]
							: child.localName === "table-header-rows" ||
									child.localName === "table-rows"
								? kids(child, "table-row")
								: [],
					);
					for (const row of rowEls) {
						const cells: RichCell[] = [];
						for (const cell of kids(row, "table-cell")) {
							const blocks: RichBlock[] = [];
							blocksOf(cell, blocks);
							const fill = styles.props(
								"table-cell",
								cell.getAttribute("table:style-name"),
								"table-cell",
							)["background-color"];
							const colSpan = Number(
								cell.getAttribute("table:number-columns-spanned"),
							);
							const rowSpan = Number(
								cell.getAttribute("table:number-rows-spanned"),
							);
							cells.push({
								blocks,
								colSpan: colSpan > 1 ? colSpan : undefined,
								rowSpan: rowSpan > 1 ? rowSpan : undefined,
								fill: fill && /^#[0-9a-f]{6}$/i.test(fill) ? fill : undefined,
							});
						}
						if (cells.length) rows.push(cells);
					}
					if (rows.length)
						out.push({
							kind: "table",
							rows,
							cols: cols.length && cols.every((w) => w > 0) ? cols : undefined,
						});
					break;
				}
				case "sequence-decls":
				case "forms":
				case "variable-decls":
				case "tracked-changes":
				case "user-field-decls":
					break;
				default:
					// Sections, indexes, text boxes: their content, in order.
					blocksOf(el, out, list);
			}
		}
	};

	const body = pkg.content.getElementsByTagNameNS("*", "text")[0];
	const blocks: RichBlock[] = [];
	blocksOf(body ?? pkg.content.documentElement, blocks);
	while (blocks.length) {
		const last = blocks[blocks.length - 1];
		if (last.kind === "para" && last.runs.length === 0) blocks.pop();
		else break;
	}
	return { kind: "rich", blocks, media };
}

function sameFormat(a: RichRun, b: TextFormat): boolean {
	return (
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.strike === b.strike &&
		a.size === b.size &&
		a.color === b.color &&
		a.highlight === b.highlight &&
		a.font === b.font &&
		a.script === b.script
	);
}

// ---------- Presentations ----------

const GEOM: Record<string, string> = {
	rectangle: "rect",
	"round-rectangle": "roundRect",
	ellipse: "ellipse",
	"isosceles-triangle": "triangle",
	"right-triangle": "rtTriangle",
	diamond: "diamond",
	"right-arrow": "rightArrow",
	"pentagon-right": "homePlate",
	chevron: "chevron",
};

export function parseOdp(bytes: Uint8Array): RawDeck {
	const pkg = open(bytes);
	const scope = scopes(pkg);
	const media: RichMedia[] = [];
	const mediaOf = new Map<string, string | null>();
	const picture = (href: string | null): string | null => {
		if (!href) return null;
		const known = mediaOf.get(href);
		if (known !== undefined) return known;
		const data = pkg.file(href.replace(/^\.\//, ""));
		const type = data ? sniffImage(data) : null;
		const ref =
			data && type ? `media:${media.push({ bytes: data, type }) - 1}` : null;
		mediaOf.set(href, ref);
		return ref;
	};

	// Master pages (styles.xml) carry page size, background and decoration.
	const masterStyles = pkg.styles
		? kids(pkg.styles.documentElement).find(
				(e) => e.localName === "master-styles",
			)
		: undefined;
	const masterPages = new Map<string, Element>();
	for (const m of kids(masterStyles, "master-page"))
		masterPages.set(m.getAttribute("style:name") ?? "", m);
	const pageSize = (master: Element | undefined) => {
		const layout = scope.master.get(
			"page-layout",
			master?.getAttribute("style:page-layout-name"),
		);
		const props = kids(layout, "page-layout-properties")[0];
		return {
			width: length(props?.getAttribute("fo:page-width")) ?? 1058,
			height: length(props?.getAttribute("fo:page-height")) ?? 794,
		};
	};

	const background = (
		styles: Styles,
		name: string | null,
	): string | undefined => {
		const bag = styles.props("drawing-page", name, "drawing-page");
		if (bag.fill === "bitmap") {
			const fillImage = styles.get("fill-image", bag["fill-image-name"]);
			const ref = picture(fillImage?.getAttribute("xlink:href") ?? null);
			if (ref) return ref;
		}
		if (bag.fill === "solid" && bag["fill-color"]) return bag["fill-color"];
		if (bag.fill === "gradient" && bag["fill-color"]) return bag["fill-color"];
		return undefined;
	};

	/** Text of a shape / text box / table cell. */
	const textBody = (
		holder: Element,
		styles: Styles,
		shape: {
			family: string;
			name: string | null;
			cls: string | null;
			master: string;
		},
	): TextBody | undefined => {
		const graphic = styles.props(shape.family, shape.name, "graphic");
		const shapePara = styles.props(shape.family, shape.name, "paragraph");
		const baseFormat = (level: number): TextFormat => {
			let format = textFormat(styles.props(shape.family, shape.name, "text"), {
				size: 18,
			});
			// Outline levels below the first take the master's "-outlineN".
			if (shape.cls === "outline" && level > 0)
				format = textFormat(
					scope.master.props(
						"presentation",
						`${shape.master}-outline${level + 1}`,
						"text",
					),
					format,
				);
			return format;
		};
		const paras: Para[] = [];
		const counts: number[] = [];

		const addPara = (
			p: Element,
			level: number,
			listStyle: string | null | undefined,
			numbered: boolean,
		) => {
			const name = p.getAttribute("text:style-name");
			const pp = {
				...shapePara,
				...styles.props("paragraph", name, "paragraph"),
			};
			const base = textFormat(
				styles.props("paragraph", name, "text"),
				baseFormat(level),
			);
			const runs: Run[] = [];
			const walk = (node: Element, format: TextFormat, href?: string) => {
				const style = (): Omit<Run, "text"> => ({
					size: ((format.size ?? 18) * 4) / 3,
					bold: format.bold ?? false,
					italic: format.italic ?? false,
					underline: format.underline ?? false,
					strike: format.strike ?? false,
					color: format.color ?? "#000000",
					font: format.font,
					href,
				});
				for (const child of Array.from(node.childNodes)) {
					if (child.nodeType === Node.TEXT_NODE) {
						const text = collapse(
							child.nodeValue ?? "",
							runs.map((r) => r.text).join(""),
						);
						if (text) runs.push({ ...style(), text });
						continue;
					}
					if (!(child instanceof Element)) continue;
					if (child.localName === "s")
						runs.push({
							...style(),
							text: " ".repeat(Number(child.getAttribute("text:c")) || 1),
						});
					else if (child.localName === "tab")
						runs.push({ ...style(), text: "\t" });
					else if (child.localName === "line-break")
						runs.push({ ...style(), text: "\n", br: true });
					else if (child.localName === "span")
						walk(
							child,
							textFormat(
								styles.props(
									"text",
									child.getAttribute("text:style-name"),
									"text",
								),
								format,
							),
							href,
						);
					else if (child.localName === "a")
						walk(
							child,
							format,
							safeHref(child.getAttribute("xlink:href")) ?? href,
						);
					else if (
						// Page number / date / footer fields have no stored text.
						!["page-number", "date-time", "footer", "header"].includes(
							child.localName,
						)
					)
						walk(child, format, href);
				}
			};
			walk(p, base);
			const first = runs[0]?.size ?? ((base.size ?? 18) * 4) / 3;
			let bullet: string | undefined;
			if (listStyle !== undefined && numbered && runs.length) {
				counts[level] = (counts[level] ?? 0) + 1;
				counts.length = level + 1;
				bullet =
					markerFor(styles, listStyle, level, counts[level]) || undefined;
			}
			const lineHeight = pp["line-height"]?.endsWith("%")
				? Number.parseFloat(pp["line-height"]) / 100
				: undefined;
			const mode = pp["writing-mode"];
			const rtl = mode
				? mode.startsWith("rl")
				: startsRtl(runs.map((r) => r.text).join(""));
			// "start"/"end" follow the paragraph's direction.
			const side = pp["text-align"];
			paras.push({
				runs,
				rtl: rtl || undefined,
				align:
					side === "start"
						? rtl
							? "right"
							: "left"
						: side === "end"
							? rtl
								? "left"
								: "right"
							: (ALIGN[side ?? ""] ?? (rtl ? "right" : "left")),
				level,
				bullet,
				indent:
					(length(pp["margin-left"]) ?? 0) +
					(bullet ? Math.max(first * 1.1, level * first * 1.2) : 0),
				lineHeight,
				spaceBefore: length(pp["margin-top"]) ?? 0,
				spaceAfter: length(pp["margin-bottom"]) ?? 0,
				endSize: first,
			});
		};

		/** A <text:list> inside a shape: nesting depth is the level. */
		const listIn = (el: Element, depth: number, inherited: string | null) => {
			const style = el.getAttribute("text:style-name") ?? inherited;
			for (const item of kids(el)) {
				if (item.localName !== "list-item" && item.localName !== "list-header")
					continue;
				let first = item.localName === "list-item";
				for (const child of kids(item)) {
					if (child.localName === "list") listIn(child, depth + 1, style);
					else if (child.localName === "p" || child.localName === "h") {
						addPara(child, depth, style, first);
						first = false;
					}
				}
			}
		};
		for (const el of kids(holder)) {
			if (el.localName === "p" || el.localName === "h")
				addPara(el, 0, undefined, false);
			else if (el.localName === "list") listIn(el, 0, null);
		}
		if (!paras.some((p) => p.runs.some((r) => r.text.trim()))) return undefined;

		const anchor = graphic["textarea-vertical-align"];
		const pad = (side: string, fallback: number) =>
			length(graphic[`padding-${side}`]) ?? length(graphic.padding) ?? fallback;
		return {
			paras,
			anchor:
				anchor === "middle" ? "middle" : anchor === "bottom" ? "bottom" : "top",
			insets: [
				pad("left", 9.6),
				pad("top", 4.8),
				pad("right", 9.6),
				pad("bottom", 4.8),
			],
			wrap: graphic["wrap-option"] !== "no-wrap",
			vertical: false,
		};
	};

	/** Position, size and rotation; rotated shapes are stored as a
	 * transform instead of x/y. */
	const placement = (el: Element) => {
		const w = length(el.getAttribute("svg:width")) ?? 0;
		const h = length(el.getAttribute("svg:height")) ?? 0;
		let x = length(el.getAttribute("svg:x")) ?? 0;
		let y = length(el.getAttribute("svg:y")) ?? 0;
		let rot = 0;
		const transform = el.getAttribute("draw:transform");
		if (transform) {
			const angle = Number(
				/rotate\s*\(\s*(-?[\d.eE+-]+)/.exec(transform)?.[1] ?? 0,
			);
			const move = /translate\s*\(\s*(\S+)\s+(\S+?)\s*\)/.exec(transform);
			const tx = length(move?.[1]) ?? 0;
			const ty = length(move?.[2]) ?? 0;
			// The transform turns the box around its own origin, then moves
			// it; the viewer wants the unrotated box and a turn about its centre.
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);
			const cx = tx + (w / 2) * cos + (h / 2) * sin;
			const cy = ty - (w / 2) * sin + (h / 2) * cos;
			x = cx - w / 2;
			y = cy - h / 2;
			rot = (-angle * 180) / Math.PI;
		}
		return { x, y, w, h, rot, flipH: false, flipV: false };
	};

	const readShapes = (
		root: Element,
		styles: Styles,
		master: string,
		out: SlideElement[],
		decorationOnly: boolean,
	) => {
		for (const el of kids(root)) {
			const name = el.localName;
			if (name === "g") {
				// Children of a group already carry page coordinates.
				readShapes(el, styles, master, out, decorationOnly);
				continue;
			}
			if (
				![
					"frame",
					"custom-shape",
					"rect",
					"ellipse",
					"circle",
					"line",
					"connector",
					"path",
					"polygon",
					"polyline",
				].includes(name)
			)
				continue;
			const cls = el.getAttribute("presentation:class");
			if (
				decorationOnly &&
				(cls || el.getAttribute("presentation:placeholder"))
			)
				continue;
			if (el.getAttribute("presentation:placeholder") === "true") continue;
			const presentation = el.getAttribute("presentation:style-name");
			const family = presentation ? "presentation" : "graphic";
			const styleName = presentation ?? el.getAttribute("draw:style-name");
			const graphic = styles.props(family, styleName, "graphic");
			const shape = { family, name: styleName, cls, master };

			const fill =
				graphic.fill === "none"
					? undefined
					: graphic.fill === "solid" || graphic.fill === "gradient"
						? graphic["fill-color"]
						: undefined;
			const line =
				graphic.stroke && graphic.stroke !== "none"
					? {
							color: graphic["stroke-color"] ?? "#000000",
							width: Math.max(0.75, length(graphic["stroke-width"]) ?? 0.75),
							dash: graphic.stroke === "dash",
						}
					: undefined;

			if (name === "line" || name === "connector") {
				const x1 = length(el.getAttribute("svg:x1")) ?? 0;
				const y1 = length(el.getAttribute("svg:y1")) ?? 0;
				const x2 = length(el.getAttribute("svg:x2")) ?? 0;
				const y2 = length(el.getAttribute("svg:y2")) ?? 0;
				out.push({
					kind: "shape",
					x: Math.min(x1, x2),
					y: Math.min(y1, y2),
					w: Math.abs(x2 - x1),
					h: Math.abs(y2 - y1),
					rot: 0,
					flipH: x2 < x1,
					flipV: y2 < y1,
					geom: "line",
					line: line ?? { color: "#000000", width: 0.75, dash: false },
				});
				continue;
			}

			const box = placement(el);
			if (name === "frame") {
				const img = kids(el, "image")[0];
				const table = kids(el, "table")[0];
				const textBox = kids(el, "text-box")[0];
				if (table) {
					const cols = kids(table, "table-column").flatMap((col) => {
						const width =
							length(
								styles.props(
									"table-column",
									col.getAttribute("table:style-name"),
									"table-column",
								)["column-width"],
							) ?? 0;
						const repeat =
							Number(col.getAttribute("table:number-columns-repeated")) || 1;
						return Array.from({ length: Math.min(64, repeat) }, () => width);
					});
					const rows = kids(table, "table-row").map((row) => ({
						h:
							length(
								styles.props(
									"table-row",
									row.getAttribute("table:style-name"),
									"table-row",
								)["row-height"],
							) ?? 0,
						cells: kids(row)
							.filter(
								(c) =>
									c.localName === "table-cell" ||
									c.localName === "covered-table-cell",
							)
							.map((cell) => {
								const cellStyle = cell.getAttribute("table:style-name");
								const cellGraphic = styles.props(
									"table-cell",
									cellStyle,
									"graphic",
								);
								return {
									text: textBody(cell, styles, {
										family: "table-cell",
										name: cellStyle,
										cls: null,
										master,
									}) ?? {
										paras: [],
										anchor: "top" as const,
										insets: [9.6, 4.8, 9.6, 4.8] as [
											number,
											number,
											number,
											number,
										],
										wrap: true,
										vertical: false,
									},
									fill:
										cellGraphic.fill === "solid"
											? cellGraphic["fill-color"]
											: undefined,
									span:
										Number(cell.getAttribute("table:number-columns-spanned")) ||
										1,
									rowSpan:
										Number(cell.getAttribute("table:number-rows-spanned")) || 1,
									hidden: cell.localName === "covered-table-cell",
								};
							}),
					}));
					out.push({ kind: "table", ...box, cols, rows });
				} else if (textBox) {
					const text = textBody(textBox, styles, shape);
					if (text || fill || line)
						out.push({ kind: "shape", ...box, geom: "rect", fill, line, text });
				} else if (img) {
					out.push({
						kind: "image",
						...box,
						src: picture(img.getAttribute("xlink:href")),
					});
				} else if (kids(el, "object")[0] || kids(el, "object-ole")[0]) {
					out.push({ kind: "placeholder", ...box, label: "Embedded object" });
				}
				continue;
			}

			// Drawn shapes.
			let geom = "rect";
			let paths: GeomPath[] | undefined;
			if (name === "ellipse" || name === "circle") geom = "ellipse";
			else if (name === "custom-shape") {
				const type = kids(el, "enhanced-geometry")[0]?.getAttribute(
					"draw:type",
				);
				geom = GEOM[type ?? ""] ?? "rect";
			} else if (name === "path" || name === "polygon" || name === "polyline") {
				const view = (el.getAttribute("svg:viewBox") ?? "")
					.split(/\s+/)
					.map(Number);
				const points = el.getAttribute("draw:points");
				const d =
					el.getAttribute("svg:d") ??
					(points
						? `M${points.trim().replace(/\s+/g, "L")}${name === "polygon" ? "Z" : ""}`
						: null);
				if (d && view.length === 4 && view[2] > 0 && view[3] > 0)
					paths = [
						{
							// Shift the path into its own viewBox origin.
							d: view[0] || view[1] ? `M${-view[0]} ${-view[1]}m0 0${d}` : d,
							w: view[2],
							h: view[3],
							fill: name !== "polyline",
							stroke: true,
						},
					];
			}
			const text = textBody(el, styles, shape);
			if (!fill && !line && !text) continue;
			out.push({
				kind: "shape",
				...box,
				geom,
				paths,
				fill,
				line,
				radius:
					geom === "roundRect" ? Math.min(box.w, box.h) * 0.1667 : undefined,
				text,
			});
		}
	};

	const body = pkg.content.getElementsByTagNameNS("*", "presentation")[0];
	const pages = kids(body, "page");
	if (!body) throw new Error("corrupt: not a presentation");
	const firstMaster = masterPages.get(
		pages[0]?.getAttribute("draw:master-page-name") ?? "",
	);
	const size = pageSize(firstMaster ?? [...masterPages.values()][0]);

	const slides: Slide[] = pages.map((page) => {
		const masterName = page.getAttribute("draw:master-page-name") ?? "";
		const master = masterPages.get(masterName);
		const pageProps = scope.content.props(
			"drawing-page",
			page.getAttribute("draw:style-name"),
			"drawing-page",
		);
		const elements: SlideElement[] = [];
		if (master && pageProps["background-objects-visible"] !== "false")
			readShapes(master, scope.master, masterName, elements, true);
		readShapes(page, scope.content, masterName, elements, false);

		const notes = kids(page, "notes")[0];
		const noteLines: string[] = [];
		for (const frame of kids(notes, "frame")) {
			if (frame.getAttribute("presentation:class") !== "notes") continue;
			for (const p of frame.getElementsByTagNameNS("*", "p"))
				if (p.textContent?.trim()) noteLines.push(p.textContent.trim());
		}
		return {
			background:
				background(scope.content, page.getAttribute("draw:style-name")) ??
				background(
					scope.master,
					master?.getAttribute("draw:style-name") ?? null,
				) ??
				"#ffffff",
			elements,
			notes: noteLines.join("\n") || undefined,
		};
	});

	return { width: size.width, height: size.height, slides, media };
}
