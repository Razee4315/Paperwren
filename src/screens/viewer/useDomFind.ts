import { ANY_MATCH, type FindOptions, matchesIn } from "@/lib/find";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { FindState } from "./Shell";
import { isPaged, reveal } from "./paged";

const MAX_MATCHES = 2000;

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

function clearHighlights() {
	const reg = registry();
	reg?.delete("pw-find");
	reg?.delete("pw-find-active");
}

/** Elements that end a line of text: a match never runs across one. */
const BLOCKS = new Set([
	"P",
	"DIV",
	"LI",
	"TD",
	"TH",
	"TR",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"PRE",
	"BLOCKQUOTE",
	"SECTION",
	"ARTICLE",
	"TABLE",
	"UL",
	"OL",
]);

function blockOf(node: Node, root: Node): Node {
	for (let el = node.parentNode; el && el !== root; el = el.parentNode)
		if (BLOCKS.has((el as Element).tagName)) return el;
	return root;
}

/**
 * Search over the text under `root` (lib/find.ts says what matches). A
 * document splits its words across formatting runs ("Qua" + "rterly"),
 * so each block's text nodes are searched as one string and a match may
 * start in one node and end in another.
 */
export function findRanges(
	root: Node,
	query: string,
	options: FindOptions = ANY_MATCH,
): Range[] {
	if (!query) return [];
	const ranges: Range[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	// The text nodes of the block being read, and where each starts in
	// their joined text.
	let nodes: Node[] = [];
	let starts: number[] = [];
	let text = "";
	let block: Node | null = null;

	/** The node holding the character at `offset` (for an end offset,
	 * the one holding the character before it). */
	const nodeAt = (offset: number, end: boolean) => {
		let i = nodes.length - 1;
		while (i > 0 && (end ? starts[i] >= offset : starts[i] > offset)) i--;
		return i;
	};
	const flush = () => {
		for (const at of matchesIn(
			text,
			query,
			options,
			MAX_MATCHES - ranges.length,
		)) {
			const from = nodeAt(at, false);
			const to = nodeAt(at + query.length, true);
			const r = document.createRange();
			r.setStart(nodes[from], at - starts[from]);
			r.setEnd(nodes[to], at + query.length - starts[to]);
			ranges.push(r);
		}
		nodes = [];
		starts = [];
		text = "";
	};

	for (
		let node = walker.nextNode();
		node && ranges.length < MAX_MATCHES;
		node = walker.nextNode()
	) {
		const value = node.nodeValue ?? "";
		if (!value) continue;
		const owner = blockOf(node, root);
		if (owner !== block) {
			flush();
			block = owner;
		}
		nodes.push(node);
		starts.push(text.length);
		text += value;
	}
	flush();
	return ranges;
}

/**
 * Find-in-page for DOM-rendered documents (Word, slides, text):
 * matches are shown with the CSS Custom Highlight API, so the
 * document's DOM is never mutated.
 */
export function useDomFind(
	root: RefObject<HTMLElement | null>,
	scroller: RefObject<HTMLElement | null>,
) {
	const [open, setOpen] = useState(false);
	const [state, setState] = useState<FindState>({
		query: "",
		total: 0,
		current: -1,
	});
	const ranges = useRef<Range[]>([]);
	const [options, setOptions] = useState<FindOptions>(ANY_MATCH);

	const show = useCallback(
		(index: number) => {
			const reg = registry();
			const r = ranges.current[index];
			if (reg && typeof Highlight !== "undefined") {
				reg.set("pw-find", new Highlight(...ranges.current));
				if (r) reg.set("pw-find-active", new Highlight(r));
			}
			const box = scroller.current;
			if (r && box) {
				const rect = r.getBoundingClientRect();
				const view = box.getBoundingClientRect();
				if (isPaged(box)) reveal(box, rect);
				else {
					if (rect.top < view.top + 40 || rect.bottom > view.bottom - 40) {
						box.scrollTop += rect.top - view.top - view.height / 3;
					}
					if (rect.left < view.left || rect.right > view.right) {
						box.scrollLeft += rect.left - view.left - view.width / 3;
					}
				}
			}
		},
		[scroller],
	);

	useEffect(() => {
		if (!open) return;
		const t = window.setTimeout(() => {
			ranges.current = root.current
				? findRanges(root.current, state.query.trim(), options)
				: [];
			const total = ranges.current.length;
			setState((s) => ({ ...s, total, current: total ? 0 : -1 }));
			if (total) show(0);
			else clearHighlights();
		}, 150);
		return () => window.clearTimeout(t);
	}, [open, state.query, options, root, show]);

	const step = useCallback(
		(dir: 1 | -1) => {
			setState((s) => {
				if (!s.total) return s;
				const current = (s.current + dir + s.total) % s.total;
				show(current);
				return { ...s, current };
			});
		},
		[show],
	);

	const close = useCallback(() => {
		setOpen(false);
		ranges.current = [];
		clearHighlights();
		setState({ query: "", total: 0, current: -1 });
	}, []);

	useEffect(() => clearHighlights, []);

	return {
		open,
		/** Open the find bar, at a text when given one. */
		start: (query?: string) => {
			if (typeof query === "string" && query)
				setState((s) => ({ ...s, query }));
			setOpen(true);
		},
		close,
		state,
		setQuery: (query: string) => setState((s) => ({ ...s, query })),
		step,
		/** Match case, whole words. */
		options,
		setOptions,
	};
}
