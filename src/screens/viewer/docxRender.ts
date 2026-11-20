/**
 * docx-preview, with two things it gets wrong put right between its
 * reading of the file and its drawing of it.
 *
 * - A table's indent (w:tblInd) is looked for under names Word never
 *   writes ("left", "start"; Word writes "w"), so it is lost. Forms
 *   often pull a wide table into the left margin; without the indent it
 *   starts at the margin and runs off the page's right edge.
 * - A picture kept as EMF shows as a broken image. Most are a wrapper
 *   around one bitmap, which is shown instead (lib/office/emf.ts).
 * - A file with no page settings (some scripts and web exports write
 *   none) shows as a small box around its text. Word gives it its
 *   default page, and so does this.
 */
import { emfPicture } from "@/lib/office/emf";
import { validateZip } from "@/lib/safeZip";
import type { Options } from "docx-preview";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SAFE_HREF = /^(?:https?:|mailto:|tel:|#)/i;
const SAFE_CSS_URL = /^(?:data|blob):/i;
const CSS_URL =
	/url\s*\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*))\s*\)/gi;
const WRAPPER_PREFIX = /^\.docx-wrapper(?=$|[\s>.:[])/;

interface Parsed {
	type?: string;
	cssStyle?: Record<string, string>;
	children?: Parsed[];
}

interface PageProps {
	pageSize?: { width?: string; height?: string; orientation?: string };
	pageMargins?: Record<string, string | undefined>;
}

interface ParsedDocument {
	documentPart?: {
		body?: Parsed & { props?: PageProps };
		_xmlDocument?: Document;
	};
	blobToURL?: (blob: Blob | null, path?: string) => unknown;
}

const child = (el: Element, name: string) =>
	Array.from(el.children).find(
		(c) => c.namespaceURI === W && c.localName === name,
	);

/** Each table's indent from the file's own XML, onto the parsed table,
 * matched in document order. Nothing changes if the two lists differ. */
export function indentTables(doc: ParsedDocument): number {
	const xml = doc.documentPart?._xmlDocument;
	const body = doc.documentPart?.body;
	if (!xml || !body) return 0;
	const sources = Array.from(xml.getElementsByTagNameNS(W, "tbl"));
	const tables: Parsed[] = [];
	const walk = (node: Parsed) => {
		if (node.type === "table") tables.push(node);
		for (const c of node.children ?? []) walk(c);
	};
	walk(body);
	if (!sources.length || tables.length !== sources.length) return 0;
	let moved = 0;
	sources.forEach((source, i) => {
		const props = child(source, "tblPr");
		const ind = props && child(props, "tblInd");
		if (!ind) return;
		const kind = ind.getAttributeNS(W, "type") || "dxa";
		const twips = Number(ind.getAttributeNS(W, "w"));
		if (kind !== "dxa" || !Number.isFinite(twips) || !twips) return;
		const style = tables[i].cssStyle ?? {};
		tables[i].cssStyle = style;
		// Centred, right-aligned and floating tables place themselves;
		// Word ignores the indent for those too.
		if (style["margin-left"] || style["margin-inline-start"] || style.float)
			return;
		style["margin-left"] = `${twips / 20}pt`;
		moved++;
	});
	return moved;
}

/** Where people print on Letter paper; everywhere else uses A4. */
const LETTER = /-(US|CA|MX|PH|CL|CO|VE|GT|CR|PA|DO|PR|SV|NI|HN|BO)$/i;

/** Word's own page for a document that names none: Letter or A4, as
 * the reader's region prints, with inch margins. In points. */
export function defaultPage(locale: string): Required<PageProps> {
	const letter = LETTER.test(locale);
	return {
		pageSize: {
			width: letter ? "612.00pt" : "595.30pt",
			height: letter ? "792.00pt" : "841.90pt",
		},
		pageMargins: {
			left: "72.00pt",
			right: "72.00pt",
			top: "72.00pt",
			bottom: "72.00pt",
			header: "36.00pt",
			footer: "36.00pt",
		},
	};
}

/** The document's page, where the file gives none (or only part of
 * one): Word's default. Returns whether anything was filled in. */
export function fillPage(doc: ParsedDocument, locale: string): boolean {
	const body = doc.documentPart?.body;
	if (!body) return false;
	const props = body.props ?? {};
	body.props = props;
	const page = defaultPage(locale);
	let filled = false;
	if (!props.pageSize?.width) {
		props.pageSize = { ...page.pageSize, ...props.pageSize };
		props.pageSize.width = page.pageSize.width;
		props.pageSize.height ||= page.pageSize.height;
		filled = true;
	}
	if (!props.pageMargins?.left) {
		props.pageMargins = { ...page.pageMargins, ...props.pageMargins };
		for (const [side, length] of Object.entries(page.pageMargins))
			props.pageMargins[side] ||= length;
		filled = true;
	}
	return filled;
}

/** Pictures stored as EMF shown from the bitmap inside, where there
 * is one. */
function showEmf(doc: ParsedDocument) {
	const original = doc.blobToURL;
	if (typeof original !== "function") return;
	doc.blobToURL = function (blob, path) {
		if (!blob || !path || !/\.emf$/i.test(path))
			return original.call(this, blob, path);
		return blob
			.arrayBuffer()
			.then((buffer) => {
				const picture = emfPicture(new Uint8Array(buffer));
				return picture
					? original.call(
							this,
							new Blob([picture.bytes as BlobPart], { type: picture.type }),
						)
					: original.call(this, blob, path);
			})
			.catch(() => original.call(this, blob, path));
	};
}

/** Strip CSS comments outside quoted strings so comment-splitting cannot
 * disguise @import or url(). */
function stripCssComments(css: string): string {
	let out = "";
	let quote = "";
	for (let i = 0; i < css.length; i++) {
		const ch = css[i];
		if (quote) {
			out += ch;
			if (ch === "\\" && i + 1 < css.length) {
				out += css[++i];
			} else if (ch === quote) {
				quote = "";
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			out += ch;
		} else if (ch === "/" && css[i + 1] === "*") {
			const end = css.indexOf("*/", i + 2);
			out += " ";
			if (end < 0) break;
			i = end + 1;
		} else {
			out += ch;
		}
	}
	return out;
}

/** Decode CSS backslash escapes when inspecting identifiers for hidden
 * @import or url() tokens. */
function decodeCssEscapes(text: string): string {
	return text
		.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
			const code = Number.parseInt(hex, 16);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
		})
		.replace(/\\([^\n\r\f0-9a-fA-F])/g, "$1");
}

/** Remove quoted strings so backslash checks do not trip on list bullet
 * escapes such as `content: "\2022"`. */
function stripQuoted(text: string): string {
	return text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
}

/** Split a CSS list by a top-level delimiter, respecting strings,
 * parentheses and brackets. */
function splitTopLevel(text: string, sep: string): string[] {
	const parts: string[] = [];
	let start = 0;
	let quote = "";
	let parens = 0;
	let brackets = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === "\\" && i + 1 < text.length) i++;
			else if (ch === quote) quote = "";
			continue;
		}
		if (ch === '"' || ch === "'") quote = ch;
		else if (ch === "(") parens++;
		else if (ch === ")" && parens > 0) parens--;
		else if (ch === "[") brackets++;
		else if (ch === "]" && brackets > 0) brackets--;
		else if (ch === sep && parens === 0 && brackets === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts;
}

/** Sanitize CSS declarations: allow only data: and blob: URLs, and drop
 * declarations hiding external loads behind escapes or image-set(). */
function sanitizeDeclarations(decls: string): string {
	const kept: string[] = [];
	for (const raw of splitTopLevel(decls, ";")) {
		const decl = raw.trim();
		if (!decl) continue;
		const cleaned = decl.replace(
			CSS_URL,
			(
				full,
				dq: string | undefined,
				sq: string | undefined,
				bare: string | undefined,
			) => {
				const target = (dq ?? sq ?? bare ?? "").trim();
				return SAFE_CSS_URL.test(target) ? full : "none";
			},
		);
		const outside = stripQuoted(cleaned);
		const decoded = decodeCssEscapes(outside);
		if (/(?:image-set|-webkit-image-set|expression)\s*\(/i.test(decoded))
			continue;
		if (outside.includes("\\") && /url\s*\(/i.test(decoded)) continue;
		kept.push(cleaned);
	}
	return kept.join("; ");
}

/** Keep every style selector confined to `.docx-wrapper` so a crafted
 * document cannot restyle the surrounding app. */
function scopeSelectors(selectorList: string): string {
	const kept: string[] = [];
	for (const raw of splitTopLevel(selectorList, ",")) {
		const sel = raw.trim();
		if (!sel) continue;
		if (WRAPPER_PREFIX.test(sel)) {
			const tail = sel.slice(".docx-wrapper".length).trimStart();
			if (tail.startsWith("+") || tail.startsWith("~")) continue;
			kept.push(sel);
		} else {
			kept.push(`.docx-wrapper ${sel}`);
		}
	}
	return kept.join(", ");
}

/** Sanitize `<style>` text generated by docx-preview: strip @import,
 * neutralize external url() references, and keep rules inside
 * `.docx-wrapper`. */
export function sanitizeDocxCss(css: string, scope = true): string {
	const text = stripCssComments(css);
	const out: string[] = [];
	let start = 0;
	let quote = "";
	let depth = 0;
	let header = "";
	let bodyStart = 0;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === "\\" && i + 1 < text.length) i++;
			else if (ch === quote) quote = "";
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (depth === 0) {
			if (ch === ";") {
				// Top-level statement rules (@import, @charset, @namespace) are
				// dropped so remote stylesheets can never load.
				start = i + 1;
			} else if (ch === "}") {
				// Stray closing brace from a crafted name or value: discard.
				start = i + 1;
			} else if (ch === "{") {
				header = text.slice(start, i).trim();
				bodyStart = i + 1;
				depth = 1;
			}
		} else if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) {
				const body = text.slice(bodyStart, i);
				start = i + 1;
				if (!header) continue;
				if (header.startsWith("@")) {
					const atName = decodeCssEscapes(header)
						.slice(1)
						.split(/[\s(]/)[0]
						.toLowerCase();
					if (atName === "font-face" || atName === "page") {
						const cleanBody = sanitizeDeclarations(body);
						if (cleanBody) out.push(`${header} { ${cleanBody} }`);
					} else if (
						atName === "media" ||
						atName === "supports" ||
						atName === "layer"
					) {
						const inner = sanitizeDocxCss(body, scope);
						if (inner) out.push(`${header} { ${inner} }`);
					}
				} else {
					const selector = scope ? scopeSelectors(header) : header;
					const cleanBody = sanitizeDeclarations(body);
					if (selector && cleanBody) out.push(`${selector} { ${cleanBody} }`);
				}
			}
		}
	}
	return out.join("\n");
}

/** Sanitize generated `<style>` blocks, inline `style` URLs and `<a href>`
 * links before the rendered DOCX enters the live DOM. */
function sanitizeDocx(root: ParentNode): void {
	const scope = !!root.querySelector(".docx-wrapper");
	for (const style of root.querySelectorAll("style")) {
		style.textContent = sanitizeDocxCss(style.textContent ?? "", scope);
	}
	for (const el of root.querySelectorAll<HTMLElement>("[style]")) {
		const raw = el.getAttribute("style");
		if (raw && /url\s*\(|image-set\s*\(|expression\s*\(|\\/i.test(raw)) {
			el.setAttribute("style", sanitizeDeclarations(raw));
		}
	}
	for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
		const href = (a.getAttribute("href") ?? "").trim();
		if (!SAFE_HREF.test(href)) a.removeAttribute("href");
	}
}

/** docx-preview's renderAsync, with the repairs above. `paper` is false
 * in Reading view, where widths are ignored and an indent would push a
 * table off the screen. */
export async function renderDocx(
	data: ArrayBuffer,
	into: HTMLElement,
	options: Partial<Options>,
	paper: boolean,
): Promise<void> {
	validateZip(new Uint8Array(data));
	const docx = await import("docx-preview");
	const settings = { ...options, keepOrigin: true } as Partial<Options>;
	const doc = (await docx.parseAsync(data, settings)) as ParsedDocument;
	if (paper) {
		indentTables(doc);
		fillPage(doc, navigator.language || "en");
	}
	showEmf(doc);
	const nodes = await docx.renderDocument(doc, settings);
	const fragment = document.createDocumentFragment();
	for (const node of nodes) fragment.appendChild(node);
	sanitizeDocx(fragment);
	into.innerHTML = "";
	into.appendChild(fragment);
}
