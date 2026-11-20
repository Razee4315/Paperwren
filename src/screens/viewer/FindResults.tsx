import { type FindOptions, snippet } from "@/lib/find";
import { t, tn } from "@/lib/i18n";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
	EventBus,
	PDFFindController,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { useLayoutEffect, useRef, useState } from "react";
import s from "./PdfView.module.css";

interface PageResult {
	page: number;
	count: number;
	before: string;
	match: string;
	after: string;
}

/** Listed at most: past this the find bar's arrows reach the rest. */
const MAX_PAGES = 100;
/** How many uncached pages to read text from at once. */
const TEXT_BATCH = 4;
/** Extracted page text per document, released once the document closes. */
const pageTextCache = new WeakMap<PDFDocumentProxy, Map<number, string>>();

function docTextCache(doc: PDFDocumentProxy): Map<number, string> {
	let map = pageTextCache.get(doc);
	if (!map) {
		map = new Map();
		pageTextCache.set(doc, map);
	}
	return map;
}

async function readPageText(
	doc: PDFDocumentProxy,
	pageNumber: number,
	cache: Map<number, string>,
): Promise<string> {
	const cached = cache.get(pageNumber);
	if (cached !== undefined) return cached;
	try {
		const page = await doc.getPage(pageNumber);
		const content = await page.getTextContent();
		const text = content.items
			.map((item) => ("str" in item ? item.str + (item.hasEOL ? " " : "") : ""))
			.join("");
		cache.set(pageNumber, text);
		return text;
	} catch {
		return "";
	}
}

/**
 * Every page a search found something on, with the words around the
 * first match and how many there are. Fills in as pdf.js goes through
 * the document.
 */
export function FindResults({
	doc,
	finder,
	bus,
	query,
	options,
	onPick,
}: {
	doc: PDFDocumentProxy;
	finder: PDFFindController;
	bus: EventBus;
	query: string;
	options: FindOptions;
	onPick: (page: number) => void;
}) {
	const { matchCase, wholeWords } = options;
	const [results, setResults] = useState<PageResult[]>([]);
	const [pages, setPages] = useState(0);
	const [published, setPublished] = useState("");
	const [pending, setPending] = useState(true);
	const signature = JSON.stringify([query, matchCase, wholeWords]);
	const first = useRef(true);

	useLayoutEffect(() => {
		setPending(true);
		setResults([]);
		setPages(0);
		let cancelled = false;
		let run = 0;
		let timer = 0;
		const refresh = async () => {
			if (cancelled) return;
			const state = finder.state as {
				query?: string;
				caseSensitive?: boolean;
				entireWord?: boolean;
			} | null;
			if (
				state?.query !== query ||
				!!state.caseSensitive !== matchCase ||
				!!state.entireWord !== wholeWords
			)
				return;
			const now = ++run;
			const found: Array<{ page: number; count: number; at: number }> = [];
			(finder.pageMatches ?? []).forEach((matches: number[], index: number) => {
				if (matches?.length)
					found.push({
						page: index + 1,
						count: matches.length,
						at: matches[0],
					});
			});
			setPages(found.length);
			const slice = found.slice(0, MAX_PAGES);
			const cache = docTextCache(doc);
			const missing = slice.filter((entry) => !cache.has(entry.page));
			for (let i = 0; i < missing.length; i += TEXT_BATCH) {
				if (cancelled || now !== run) return;
				await Promise.all(
					missing
						.slice(i, i + TEXT_BATCH)
						.map((entry) => readPageText(doc, entry.page, cache)),
				);
			}
			if (cancelled || now !== run) return;
			const next: PageResult[] = slice.map((entry) => ({
				page: entry.page,
				count: entry.count,
				...snippet(cache.get(entry.page) ?? "", query, entry.at, {
					matchCase,
					wholeWords,
				}),
			}));
			setResults(next);
			setPublished(signature);
			setPending(false);
		};
		const soon = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(refresh, 120);
		};
		bus.on("updatetextlayermatches", soon);
		bus.on("updatefindmatchescount", soon);
		const stateChanged = (event: { state: number }) => {
			if (event.state === 3) {
				window.clearTimeout(timer);
				run++;
				setPending(true);
				setResults([]);
			} else soon();
		};
		bus.on("updatefindcontrolstate", stateChanged);
		if (first.current) {
			first.current = false;
			soon();
		}
		return () => {
			cancelled = true;
			run++;
			window.clearTimeout(timer);
			bus.off("updatetextlayermatches", soon);
			bus.off("updatefindmatchescount", soon);
			bus.off("updatefindcontrolstate", stateChanged);
		};
	}, [doc, finder, bus, query, matchCase, wholeWords, signature]);

	if (pending || published !== signature)
		return (
			<p className={s.findNone} aria-live="polite" aria-busy="true">
				{t("Loading")}
			</p>
		);
	if (!results.length)
		return (
			<p className={s.findNone} aria-live="polite">
				{t("No results. Try different words or turn off search options.")}
			</p>
		);
	return (
		<div className={s.findList} data-testid="find-results">
			<p className={s.findSum}>
				{tn(pages, "Found on {n} page", "Found on {n} pages")}
			</p>
			{results.map((result) => (
				<button
					type="button"
					key={result.page}
					className={s.findHit}
					onClick={() => onPick(result.page)}
					data-testid="find-result"
				>
					<strong>
						{t("Page {n}", { n: result.page })}
						{result.count > 1 && <small>{result.count}</small>}
					</strong>
					<span dir="auto">
						{result.before}
						<mark>{result.match}</mark>
						{result.after}
					</span>
				</button>
			))}
			{pages > MAX_PAGES && (
				<p className={s.findSum}>
					{t("Showing the first {n} pages.", { n: MAX_PAGES })}
				</p>
			)}
		</div>
	);
}
