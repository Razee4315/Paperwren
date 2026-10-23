/**
 * What read aloud reads: a document's text from the place on show, a
 * piece at a time, each able to show itself (the sentence is marked
 * and kept in view while it is said).
 */

import { pieces, runningText } from "@/lib/speech";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { RefObject } from "react";
import { isPaged, reveal } from "./paged";

export interface SpeechPiece {
	text: string;
	/** The language it is written in, when the document says. */
	lang?: string;
	/** Bring it into view, and mark it. */
	show?: () => void;
}

/** The text to read, from where the reader is. */
export type SpeechSource = () => AsyncGenerator<SpeechPiece>;

// ---------- the marked sentence ----------

interface HighlightRegistry {
	set(name: string, h: unknown): void;
	delete(name: string): void;
}
declare const Highlight: { new (...ranges: Range[]): unknown } | undefined;

function registry(): HighlightRegistry | null {
	const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
	return css?.highlights && typeof Highlight !== "undefined"
		? css.highlights
		: null;
}

export function unmark() {
	registry()?.delete("pw-speech");
}

function mark(range: Range, scroller: HTMLElement | null) {
	const reg = registry();
	if (reg && typeof Highlight !== "undefined")
		reg.set("pw-speech", new Highlight(range));
	if (!scroller) return;
	const rect = range.getBoundingClientRect();
	const view = scroller.getBoundingClientRect();
	if (isPaged(scroller)) {
		if (rect.height) reveal(scroller, rect);
		return;
	}
	if (
		rect.height &&
		(rect.top < view.top + 24 || rect.bottom > view.bottom - 64)
	)
		scroller.scrollTop += rect.top - view.top - view.height / 3;
}

// ---------- documents drawn in the page ----------

/** What ends a stretch of text: a sentence never runs across one. */
const BLOCK =
	"p, li, h1, h2, h3, h4, h5, h6, pre, td, th, blockquote, dt, dd, figcaption, caption, section, article, div";
/** Never read: what is not shown, or is not the document's text. */
const SKIP = "script, style, noscript, [hidden], [aria-hidden='true']";

interface Stretch {
	nodes: Text[];
	starts: number[];
	text: string;
	block: Element;
}

/** The document's text in stretches, in reading order: each stretch the
 * text nodes that share their nearest block. */
function stretches(root: HTMLElement): Stretch[] {
	const out: Stretch[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node.parentElement?.closest(SKIP)
				? NodeFilter.FILTER_REJECT
				: NodeFilter.FILTER_ACCEPT,
	});
	let current: Stretch | null = null;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node.nodeValue ?? "";
		if (!text) continue;
		const block = node.parentElement?.closest(BLOCK) ?? root;
		if (!current || current.block !== block) {
			current = { nodes: [], starts: [], text: "", block };
			out.push(current);
		}
		current.nodes.push(node as Text);
		current.starts.push(current.text.length);
		current.text += text;
	}
	return out.filter((s) => s.text.trim());
}

function rangeIn(stretch: Stretch, from: number, to: number): Range {
	const at = (offset: number, end: boolean) => {
		let i = stretch.nodes.length - 1;
		while (
			i > 0 &&
			(end ? stretch.starts[i] >= offset : stretch.starts[i] > offset)
		)
			i--;
		return i;
	};
	const a = at(from, false);
	const b = at(to, true);
	const range = document.createRange();
	range.setStart(stretch.nodes[a], from - stretch.starts[a]);
	range.setEnd(
		stretch.nodes[b],
		Math.min(to - stretch.starts[b], stretch.nodes[b].length),
	);
	return range;
}

/** Where to begin: the first stretch still on show under the top edge,
 * and in a long text (one stretch) the line there. */
function startAt(list: Stretch[], scroller: HTMLElement): [number, number] {
	const top = scroller.getBoundingClientRect().top + 8;
	for (let i = 0; i < list.length; i++) {
		const s = list[i];
		const range = rangeIn(s, 0, s.text.length);
		const rect = range.getBoundingClientRect();
		if (rect.bottom <= top) continue;
		if (rect.top >= top || s.nodes.length !== 1) return [i, 0];
		// A long text: the line at the top edge, by its height.
		const line = Number.parseFloat(getComputedStyle(s.block).lineHeight) || 20;
		const skip = Math.floor((top - rect.top) / line);
		let offset = 0;
		for (let n = 0; n < skip; n++) {
			const next = s.text.indexOf("\n", offset);
			if (next === -1) break;
			offset = next + 1;
		}
		return [i, offset];
	}
	return [0, 0];
}

/** A document drawn in the page (Word, books, text, slides). */
export function domSpeech(
	scroller: RefObject<HTMLElement | null>,
	content: RefObject<HTMLElement | null>,
): SpeechSource {
	return async function* () {
		const root = content.current;
		const box = scroller.current;
		if (!root || !box) return;
		const list = stretches(root);
		const [first, offset] = startAt(list, box);
		for (let i = first; i < list.length; i++) {
			const stretch = list[i];
			if (!stretch.nodes[0]?.isConnected) return;
			const lang =
				stretch.block.closest("[lang]")?.getAttribute("lang") || undefined;
			const from = i === first ? offset : 0;
			for (const [a, b] of pieces(stretch.text.slice(from))) {
				const start = from + a;
				const end = from + b;
				yield {
					text: stretch.text.slice(start, end),
					lang,
					show: () => {
						if (stretch.nodes[0]?.isConnected)
							mark(rangeIn(stretch, start, end), scroller.current);
					},
				};
			}
		}
	};
}

// ---------- PDF ----------

/** A PDF, page by page from the one on show, which the reading follows. */
export function pdfSpeech(
	doc: PDFDocumentProxy,
	page: () => number,
	goTo: (n: number) => void,
): SpeechSource {
	return async function* () {
		for (let n = Math.max(1, page()); n <= doc.numPages; n++) {
			const content = await (await doc.getPage(n)).getTextContent();
			const lines: string[] = [];
			let line = "";
			for (const item of content.items) {
				if (!("str" in item)) continue;
				line += item.str;
				if (item.hasEOL) {
					lines.push(line);
					line = "";
				}
			}
			if (line) lines.push(line);
			const text = runningText(lines);
			let first = true;
			for (const [a, b] of pieces(text)) {
				const showPage = first;
				first = false;
				yield {
					text: text.slice(a, b),
					show: () => {
						if (showPage && page() !== n) goTo(n);
					},
				};
			}
		}
	};
}
