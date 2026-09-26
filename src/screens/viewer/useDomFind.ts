import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { FindState } from "./Shell";

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

/** Case-insensitive search over the text nodes under `root`. */
export function findRanges(root: Node, query: string): Range[] {
	const needle = query.toLocaleLowerCase();
	if (!needle) return [];
	const ranges: Range[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (
		let node = walker.nextNode();
		node && ranges.length < MAX_MATCHES;
		node = walker.nextNode()
	) {
		const text = node.nodeValue?.toLocaleLowerCase() ?? "";
		let at = text.indexOf(needle);
		while (at !== -1 && ranges.length < MAX_MATCHES) {
			const r = document.createRange();
			r.setStart(node, at);
			r.setEnd(node, at + needle.length);
			ranges.push(r);
			at = text.indexOf(needle, at + needle.length);
		}
	}
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
				if (rect.top < view.top + 40 || rect.bottom > view.bottom - 40) {
					box.scrollTop += rect.top - view.top - view.height / 3;
				}
				if (rect.left < view.left || rect.right > view.right) {
					box.scrollLeft += rect.left - view.left - view.width / 3;
				}
			}
		},
		[scroller],
	);

	useEffect(() => {
		if (!open) return;
		const t = window.setTimeout(() => {
			ranges.current = root.current
				? findRanges(root.current, state.query.trim())
				: [];
			const total = ranges.current.length;
			setState((s) => ({ ...s, total, current: total ? 0 : -1 }));
			if (total) show(0);
			else clearHighlights();
		}, 150);
		return () => window.clearTimeout(t);
	}, [open, state.query, root, show]);

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
		start: () => setOpen(true),
		close,
		state,
		setQuery: (query: string) => setState((s) => ({ ...s, query })),
		step,
	};
}
