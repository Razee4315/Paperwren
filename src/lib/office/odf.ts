/**
 * Text structure from OpenDocument text (.odt) and presentation
 * (.odp) files. Spreadsheets (.ods) go through SheetJS instead.
 * Uses DOMParser, so this runs on the main thread.
 */

import { unzipSync } from "fflate";
import type { Block, Extracted } from "./model";

const TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const DRAW_NS = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0";
const TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";

/** Inline text of a paragraph, honouring <text:s>, <text:tab>, <text:line-break>. */
function inlineText(node: Node): string {
	let out = "";
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			out += child.nodeValue ?? "";
			continue;
		}
		if (!(child instanceof Element)) continue;
		if (child.namespaceURI === TEXT_NS) {
			if (child.localName === "s") {
				out += " ".repeat(Number(child.getAttributeNS(TEXT_NS, "c")) || 1);
				continue;
			}
			if (child.localName === "tab") {
				out += "\t";
				continue;
			}
			if (child.localName === "line-break") {
				out += "\n";
				continue;
			}
			if (child.localName === "note") continue; // footnotes
		}
		out += inlineText(child);
	}
	return out;
}

function collectBlocks(root: Element, blocks: Block[]) {
	for (const el of Array.from(root.children)) {
		if (el.namespaceURI === TEXT_NS && el.localName === "h") {
			const level = Number(el.getAttributeNS(TEXT_NS, "outline-level")) || 1;
			blocks.push({
				kind: "heading",
				level: Math.min(6, level),
				text: inlineText(el),
			});
		} else if (el.namespaceURI === TEXT_NS && el.localName === "p") {
			blocks.push({ kind: "para", text: inlineText(el) });
		} else if (el.namespaceURI === TABLE_NS && el.localName === "table-row") {
			const cells = Array.from(el.children)
				.filter((c) => c.localName === "table-cell")
				.map((c) => inlineText(c).trim());
			if (cells.some(Boolean))
				blocks.push({ kind: "para", text: cells.join("\t") });
		} else {
			collectBlocks(el, blocks);
		}
	}
}

function contentXml(bytes: Uint8Array): Document {
	const files = unzipSync(bytes, { filter: (f) => f.name === "content.xml" });
	const xml = files["content.xml"];
	if (!xml) throw new Error("corrupt: missing content.xml");
	const doc = new DOMParser().parseFromString(
		new TextDecoder().decode(xml),
		"application/xml",
	);
	if (doc.getElementsByTagName("parsererror").length)
		throw new Error("corrupt: bad content.xml");
	return doc;
}

export function extractOdf(
	bytes: Uint8Array,
	format: "odt" | "odp",
): Extracted {
	const doc = contentXml(bytes);
	if (format === "odp") {
		const pages = Array.from(doc.getElementsByTagNameNS(DRAW_NS, "page"));
		const slides = pages.map((page) => {
			const blocks: Block[] = [];
			collectBlocks(page, blocks);
			const nonEmpty = blocks.filter((b) => b.text.trim());
			if (nonEmpty[0])
				nonEmpty[0] = { kind: "heading", level: 2, text: nonEmpty[0].text };
			return nonEmpty;
		});
		return { kind: "slides", slides };
	}
	const blocks: Block[] = [];
	const body = doc.getElementsByTagNameNS(
		"urn:oasis:names:tc:opendocument:xmlns:office:1.0",
		"text",
	)[0];
	collectBlocks(body ?? doc.documentElement, blocks);
	return { kind: "document", blocks };
}
