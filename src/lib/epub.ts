/**
 * EPUB books: a zip of XHTML chapters, a package file (OPF) that lists
 * and orders them, and a table of contents (EPUB 3's nav document, or
 * EPUB 2's NCX). The chapters are read in their spine order into one
 * flowing document, sanitised, with their links and ids rewritten so a
 * link from one chapter to another lands in the same page.
 *
 * The book's own style sheets are left out: they can reach the network
 * (url()) and are written for a page, not a phone. The text keeps its
 * structure: headings, emphasis, lists, tables, quotes, pictures.
 */

import DOMPurify from "dompurify";
import { guardedUnzip } from "./safeZip";

export interface TocEntry {
	label: string;
	/** The element id it leads to, in the joined document. */
	target: string;
	items: TocEntry[];
}

export interface EpubBook {
	title?: string;
	author?: string;
	language?: string;
	publisher?: string;
	date?: string;
	/** Each chapter's sanitised HTML; its pictures are named by
	 * data-pw-src (a key of `images`). */
	chapters: Array<{ id: string; html: string; dir?: "rtl" | "ltr" }>;
	toc: TocEntry[];
	images: Map<string, { bytes: Uint8Array; type: string }>;
}

export class EpubError extends Error {
	constructor(readonly reason: "drm" | "corrupt") {
		super(reason);
	}
}

const utf8 = new TextDecoder("utf-8");
const XHTML = "application/xhtml+xml";
/** Font obfuscation (IDPF, Adobe): it hides fonts, which are not used
 * here, and is not a lock on the text. */
const FONT_MANGLING = [
	"http://www.idpf.org/2008/embedding",
	"http://ns.adobe.com/pdf/enc#RC",
];

/** The id a chapter's start has in the joined document. */
export const chapterId = (n: number) => `pw-c${n}`;
const anchorId = (n: number, id: string) => `pw-c${n}-${id}`;

/** "OEBPS/text/../images/a.jpg" → "OEBPS/images/a.jpg". */
export function resolvePath(base: string, href: string): string {
	let path = href;
	try {
		path = decodeURIComponent(href);
	} catch {
		// Keep it as written.
	}
	const parts = (
		path.startsWith("/") ? [] : base.split("/").slice(0, -1)
	) as string[];
	for (const part of path.split("/")) {
		if (part === "..") parts.pop();
		else if (part && part !== ".") parts.push(part);
	}
	return parts.join("/");
}

const parseXml = (
	text: string,
	type: DOMParserSupportedType = "application/xml",
) => new DOMParser().parseFromString(text, type);

const failed = (doc: Document) =>
	doc.getElementsByTagName("parsererror").length > 0;

/** Elements by local name, whatever their namespace prefix. */
const byName = (root: Document | Element, name: string): Element[] => [
	...root.getElementsByTagNameNS("*", name),
];

function text(entries: Record<string, Uint8Array>, path: string): string {
	const bytes = entries[path];
	if (!bytes) throw new EpubError("corrupt");
	return utf8.decode(bytes);
}

/** A book that is locked to a store's reader cannot be read. */
function isLocked(entries: Record<string, Uint8Array>): boolean {
	if (entries["META-INF/rights.xml"]) return true;
	const encryption = entries["META-INF/encryption.xml"];
	if (!encryption) return false;
	const doc = parseXml(utf8.decode(encryption));
	return byName(doc, "EncryptedData").some((data) => {
		const method =
			byName(data, "EncryptionMethod")[0]?.getAttribute("Algorithm") ?? "";
		const target =
			byName(data, "CipherReference")[0]?.getAttribute("URI") ?? "";
		const font = /\.(otf|ttf|woff2?)$/i.test(target);
		return !(font && FONT_MANGLING.includes(method));
	});
}

interface Item {
	id: string;
	path: string;
	type: string;
	properties: string;
}

function chapterDocument(source: string): Document {
	const strict = parseXml(source, XHTML);
	return failed(strict) ? parseXml(source, "text/html") : strict;
}

/** Read an EPUB. Throws EpubError: "drm" for a locked book, "corrupt"
 * for one that is not a readable EPUB. */
export function parseEpub(bytes: Uint8Array): EpubBook {
	let entries: Record<string, Uint8Array>;
	try {
		entries = guardedUnzip(bytes);
	} catch {
		throw new EpubError("corrupt");
	}
	if (isLocked(entries)) throw new EpubError("drm");

	const container = parseXml(text(entries, "META-INF/container.xml"));
	const opfPath = byName(container, "rootfile")[0]?.getAttribute("full-path");
	if (!opfPath) throw new EpubError("corrupt");
	const opf = parseXml(text(entries, opfPath));
	if (failed(opf)) throw new EpubError("corrupt");

	// --- what the book says about itself ---
	const meta = (name: string) =>
		byName(opf, name)[0]?.textContent?.replace(/\s+/g, " ").trim() || undefined;
	const book: EpubBook = {
		title: meta("title"),
		author: byName(opf, "creator")
			.map((c) => c.textContent?.trim())
			.filter(Boolean)
			.join(", "),
		language: meta("language"),
		publisher: meta("publisher"),
		date: meta("date"),
		chapters: [],
		toc: [],
		images: new Map(),
	};
	if (!book.author) book.author = undefined;

	// --- the files, and the order they are read in ---
	const items = new Map<string, Item>();
	for (const el of byName(opf, "item")) {
		const id = el.getAttribute("id");
		const href = el.getAttribute("href");
		if (!id || !href) continue;
		items.set(id, {
			id,
			path: resolvePath(opfPath, href),
			type: el.getAttribute("media-type") ?? "",
			properties: el.getAttribute("properties") ?? "",
		});
	}
	const spine = byName(opf, "itemref")
		.map((ref) => items.get(ref.getAttribute("idref") ?? ""))
		.filter(
			(item): item is Item =>
				!!item &&
				(item.type === XHTML || item.type === "text/html") &&
				!!entries[item.path],
		);
	if (!spine.length) throw new EpubError("corrupt");
	const pageDir = byName(opf, "spine")[0]?.getAttribute(
		"page-progression-direction",
	);
	const chapterOf = new Map(spine.map((item, n) => [item.path, n]));
	const types = new Map(
		[...items.values()].map((item) => [item.path, item.type]),
	);

	/** Where a link in `from` leads, as an anchor of the joined document. */
	const target = (from: string, href: string): string | null => {
		const hash = href.indexOf("#");
		const file = hash === -1 ? href : href.slice(0, hash);
		const fragment = hash === -1 ? "" : href.slice(hash + 1);
		const n = file
			? chapterOf.get(resolvePath(from, file))
			: chapterOf.get(from);
		if (n === undefined) return null;
		return fragment ? anchorId(n, fragment) : chapterId(n);
	};

	// --- the chapters ---
	spine.forEach((item, n) => {
		const doc = chapterDocument(text(entries, item.path));
		const body = doc.body ?? byName(doc, "body")[0];
		if (!body) return;
		// A picture on a page of its own is often an SVG around an image.
		for (const svgImage of byName(body, "image")) {
			const href =
				svgImage.getAttribute("href") ??
				svgImage.getAttributeNS("http://www.w3.org/1999/xlink", "href");
			const svg = svgImage.closest("svg");
			if (!href || !svg) continue;
			const img = doc.createElementNS("http://www.w3.org/1999/xhtml", "img");
			img.setAttribute("src", href);
			img.setAttribute("alt", "");
			svg.replaceWith(img);
		}
		for (const el of body.querySelectorAll("[id]"))
			el.setAttribute("id", anchorId(n, el.getAttribute("id") ?? ""));
		for (const a of body.querySelectorAll("a[href]")) {
			const href = a.getAttribute("href") ?? "";
			if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
			const to = target(item.path, href);
			if (to) a.setAttribute("href", `#${to}`);
			else a.removeAttribute("href");
		}
		for (const img of body.querySelectorAll("img[src]")) {
			const path = resolvePath(item.path, img.getAttribute("src") ?? "");
			img.removeAttribute("src");
			const bytes = entries[path];
			if (!bytes) continue;
			img.setAttribute("data-pw-src", path);
			if (!book.images.has(path))
				book.images.set(path, {
					bytes,
					type: types.get(path) || "image/*",
				});
		}
		const html = DOMPurify.sanitize(body.innerHTML, {
			FORBID_TAGS: [
				"style",
				"script",
				"iframe",
				"form",
				"input",
				"button",
				"object",
				"embed",
				"link",
				"meta",
				"base",
				"audio",
				"video",
			],
			FORBID_ATTR: ["style", "class"],
		});
		const dir =
			body.getAttribute("dir") ?? doc.documentElement.getAttribute("dir");
		book.chapters.push({
			id: chapterId(n),
			html,
			dir:
				dir === "rtl" || dir === "ltr"
					? dir
					: pageDir === "rtl"
						? "rtl"
						: undefined,
		});
	});

	// --- the contents ---
	const nav = [...items.values()].find((item) =>
		item.properties.split(/\s+/).includes("nav"),
	);
	if (nav && entries[nav.path]) {
		const doc = chapterDocument(text(entries, nav.path));
		const navs = byName(doc, "nav");
		const toc =
			navs.find((el) =>
				/\btoc\b/.test(
					el.getAttribute("epub:type") ??
						el.getAttributeNS("http://www.idpf.org/2007/ops", "type") ??
						"",
				),
			) ?? navs[0];
		const list = toc ? byName(toc, "ol")[0] : undefined;
		if (list) book.toc = readNavList(list, nav.path, target);
	}
	if (!book.toc.length) {
		const ncxId = byName(opf, "spine")[0]?.getAttribute("toc");
		const ncx =
			(ncxId && items.get(ncxId)) ||
			[...items.values()].find((i) => i.type === "application/x-dtbncx+xml");
		if (ncx && entries[ncx.path]) {
			const doc = parseXml(text(entries, ncx.path));
			const map = byName(doc, "navMap")[0];
			if (map) book.toc = readNavPoints(map, ncx.path, target);
		}
	}
	return book;
}

type Target = (from: string, href: string) => string | null;

function readNavList(list: Element, from: string, target: Target): TocEntry[] {
	const out: TocEntry[] = [];
	for (const li of list.children) {
		if (li.localName !== "li") continue;
		const link = [...li.children].find(
			(c) => c.localName === "a" || c.localName === "span",
		);
		const label = link?.textContent?.replace(/\s+/g, " ").trim() ?? "";
		const href = link?.getAttribute("href");
		const nested = [...li.children].find((c) => c.localName === "ol");
		const items = nested ? readNavList(nested, from, target) : [];
		const to = href ? target(from, href) : (items[0]?.target ?? null);
		if (label && to) out.push({ label, target: to, items });
	}
	return out;
}

function readNavPoints(
	parent: Element,
	from: string,
	target: Target,
): TocEntry[] {
	const out: TocEntry[] = [];
	for (const point of parent.children) {
		if (point.localName !== "navPoint") continue;
		const label =
			byName(point, "text")[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "";
		const src = [...point.children]
			.find((c) => c.localName === "content")
			?.getAttribute("src");
		const to = src ? target(from, src) : null;
		const items = readNavPoints(point, from, target);
		if (label && to) out.push({ label, target: to, items });
	}
	return out;
}
