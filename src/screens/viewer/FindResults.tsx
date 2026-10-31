import { type FindOptions, snippet } from "@/lib/find";
import { t, tn } from "@/lib/i18n";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
	EventBus,
	PDFFindController,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import { useEffect, useRef, useState } from "react";
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
	const [results, setResults] = useState<PageResult[]>([]);
	const [pages, setPages] = useState(0);
	const texts = useRef(new Map<number, Promise<string>>());

	useEffect(() => {
		let run = 0;
		let timer = 0;
		const refresh = async () => {
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
			const next: PageResult[] = [];
			for (const entry of found.slice(0, MAX_PAGES)) {
				let text = texts.current.get(entry.page);
				if (!text) {
					text = doc
						.getPage(entry.page)
						.then((page) => page.getTextContent())
						.then((content) =>
							content.items
								.map((item) =>
									"str" in item ? item.str + (item.hasEOL ? " " : "") : "",
								)
								.join(""),
						);
					texts.current.set(entry.page, text);
				}
				const words = await text.catch(() => "");
				if (now !== run) return;
				next.push({
					page: entry.page,
					count: entry.count,
					...snippet(words, query, entry.at, options),
				});
			}
			setResults(next);
		};
		const soon = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(refresh, 120);
		};
		bus.on("updatetextlayermatches", soon);
		bus.on("updatefindmatchescount", soon);
		bus.on("updatefindcontrolstate", soon);
		soon();
		return () => {
			run++;
			window.clearTimeout(timer);
			bus.off("updatetextlayermatches", soon);
			bus.off("updatefindmatchescount", soon);
			bus.off("updatefindcontrolstate", soon);
		};
	}, [doc, finder, bus, query, options]);

	if (!results.length)
		return <p className={s.findNone}>{t("Nothing found yet.")}</p>;
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
