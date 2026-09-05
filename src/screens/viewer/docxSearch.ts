/**
 * DOCX reading tools (docs/14 audit DOC-04): a text-node index over
 * the rendered document, substring search with exact ranges, and
 * non-destructive highlighting via the CSS Custom Highlight API —
 * the renderer's innerHTML is never rewritten, so selection, copy,
 * and docx-preview's DOM/styles stay intact.
 */

export interface DocxMatch {
	start: number;
	end: number;
	snippet: string;
}

export interface DocxTextIndex {
	/** Lowercased concatenation of all text nodes. */
	text: string;
	nodes: Array<{ node: Text; start: number; end: number }>;
}

export function buildTextIndex(root: HTMLElement): DocxTextIndex {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let text = "";
	const nodes: DocxTextIndex["nodes"] = [];
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		const value = node.nodeValue ?? "";
		if (value.length === 0) continue;
		nodes.push({
			node,
			start: text.length,
			end: text.length + value.length,
		});
		text += value.toLowerCase();
	}
	return { text, nodes };
}

/** Search all matches (case-insensitive; the index is lowercased). */
export function findMatches(
	index: DocxTextIndex,
	query: string,
	snippetContext = 24,
): DocxMatch[] {
	const matches: DocxMatch[] = [];
	if (query.trim().length === 0) return matches;
	const needle = query.trim().toLowerCase();
	let idx = index.text.indexOf(needle);
	while (idx !== -1 && matches.length < 5000) {
		const start = Math.max(0, idx - snippetContext);
		const end = Math.min(
			index.text.length,
			idx + needle.length + snippetContext,
		);
		matches.push({
			start: idx,
			end: idx + needle.length,
			snippet: `${start > 0 ? "..." : ""}${index.text
				.slice(start, end)
				.replace(/\s+/g, " ")
				.trim()}${end < index.text.length ? "..." : ""}`,
		});
		idx = index.text.indexOf(needle, idx + Math.max(1, needle.length));
	}
	return matches;
}

/** Resolve a match to a live DOM Range (audit DOC-04: non-destructive
 * highlight/navigation). Returns null when the layout changed under
 * the index — callers rebuild the index in that case. */
export function matchToRange(
	index: DocxTextIndex,
	match: DocxMatch,
): Range | null {
	if (typeof CSS !== "undefined" && typeof Range === "undefined") return null;
	const locate = (offset: number): { node: Text; offset: number } | null => {
		let lo = 0;
		let hi = index.nodes.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const entry = index.nodes[mid];
			if (offset < entry.start) hi = mid - 1;
			else if (offset >= entry.end) lo = mid + 1;
			else return { node: entry.node, offset: offset - entry.start };
		}
		return null;
	};
	const from = locate(match.start);
	const to = locate(match.end);
	if (!from || !to) return null;
	try {
		const range = document.createRange();
		range.setStart(from.node, from.offset);
		range.setEnd(to.node, to.offset);
		return range;
	} catch {
		return null;
	}
}
