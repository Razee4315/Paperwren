import { Button, Sheet, TextField } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import type { PdfDocument } from "./pdfTypes";

/**
 * OVL-01 search (docs/14 audit PDF-09): progressive search over
 * per-page text with a normalized index that maps every match back
 * to its text item and character offset, so the reader can highlight
 * and scroll to the ACTUAL match instead of just the page.
 *
 * Extraction model: items are concatenated and a newline is recorded
 * where pdf.js reports hasEOL; no unconditional spaces are inserted,
 * so a word split across two items still matches. The per-character
 * map is what makes item+offset highlights possible.
 *
 * Result policy: ALL matches are counted; the rendered list is
 * bounded with an explicit label (never a silent cap).
 */

export interface SearchHit {
	page: number;
	/** Index into the page's text content items. */
	itemIndex: number;
	/** Character offset within that item's string. */
	startInItem: number;
	length: number;
	snippet: string;
}

/** The parts of a pdf.js text item the match layer needs to place
 * highlights. A slim copy: keeping full pdf.js items alive would pin
 * the whole extraction per page. */
export interface PageTextItem {
	str: string;
	transform: number[];
	width: number;
	height: number;
	/** pdf.js hasEOL: a line break follows this item in reading order. */
	eol: boolean;
}

interface PageTextIndex {
	items: string[];
	normalized: string;
	/** Per-character back-references (parallel arrays): mapItem[idx]
	 * is the text item, mapOffset[idx] the char inside it. */
	mapItem: number[];
	mapOffset: number[];
	/** The page reported no extractable text (image-only scan or an
	 * extraction that came back empty). */
	empty: boolean;
}

const SNIPPET_CONTEXT = 24;
/** Rendered result-list bound; the count stays honest (audit
 * PDF-09: "Count all matches, or explicitly label a capped set" — we
 * do both: count everything, label the rendered bound). */
const RENDERED_HIT_LIMIT = 200;

function buildSnippet(
	normalized: string,
	index: number,
	length: number,
): string {
	const start = Math.max(0, index - SNIPPET_CONTEXT);
	const end = Math.min(normalized.length, index + length + SNIPPET_CONTEXT);
	const prefix = start > 0 ? "..." : "";
	const suffix = end < normalized.length ? "..." : "";
	return `${prefix}${normalized.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

/** Per-document page-text cache with in-flight deduplication (audit
 * PDF-09): extraction runs once per page per document no matter how
 * many searches race — or how many consumers need the text. The
 * search sheet and the viewer's match-highlight layer share this
 * cache, which halves extraction work exactly when the user just
 * searched. */
const itemCache = new WeakMap<
	PdfDocument,
	Map<number, Promise<PageTextItem[]>>
>();

export function pageTextItems(
	doc: PdfDocument,
	pageNum: number,
): Promise<PageTextItem[]> {
	let pages = itemCache.get(doc);
	if (!pages) {
		pages = new Map<number, Promise<PageTextItem[]>>();
		itemCache.set(doc, pages);
	}
	const cached = pages.get(pageNum);
	if (cached) return cached;
	const promise = (async () => {
		const page = await doc.getPage(pageNum);
		const content = await page.getTextContent();
		const items: PageTextItem[] = [];
		for (const item of content.items) {
			if (!("str" in item)) continue;
			items.push({
				str: item.str,
				transform: item.transform,
				width: item.width,
				height: item.height,
				eol: "hasEOL" in item && item.hasEOL,
			});
		}
		return items;
	})();
	pages.set(pageNum, promise);
	return promise;
}

/** Derived search index cache: pageTextItems feeds it, so extraction
 * happens once even when both caches fill. */
const indexCache = new WeakMap<
	PdfDocument,
	Map<number, Promise<PageTextIndex>>
>();

function pageTextIndex(
	doc: PdfDocument,
	pageNum: number,
): Promise<PageTextIndex> {
	let pages = indexCache.get(doc);
	if (!pages) {
		pages = new Map<number, Promise<PageTextIndex>>();
		indexCache.set(doc, pages);
	}
	const cached = pages.get(pageNum);
	if (cached) return cached;
	const promise = (async () => {
		const rawItems = await pageTextItems(doc, pageNum);
		const items: string[] = [];
		// Parallel per-character maps instead of one object per char:
		// a text-heavy page previously allocated millions of short-
		// lived CharRef objects on the main thread.
		const mapItem: number[] = [];
		const mapOffset: number[] = [];
		let normalized = "";
		for (let i = 0; i < rawItems.length; i++) {
			const raw = rawItems[i];
			const str = raw.str;
			items.push(str);
			for (let k = 0; k < str.length; k++) {
				normalized += str[k].toLowerCase();
				mapItem.push(i);
				mapOffset.push(k);
			}
			if (raw.eol) {
				normalized += "\n";
				mapItem.push(i);
				mapOffset.push(str.length);
			}
		}
		return {
			items,
			normalized,
			mapItem,
			mapOffset,
			empty: normalized.trim().length === 0,
		};
	})();
	pages.set(pageNum, promise);
	return promise;
}

const ListPanel = styled.div`
	display: flex;
	flex-direction: column;
	gap: 2px;
`;

const StatusLine = styled.p`
	color: var(--ink-2);
	font-size: 0.8125rem;
	padding: 4px 8px 12px;
	font-variant-numeric: tabular-nums;
`;

const HitButton = styled.button<{ $current: boolean }>`
	background: ${({ $current }) => ($current ? "var(--surface-2)" : "none")};
	border: none;
	border-left: 3px solid
		${({ $current }) => ($current ? "var(--accent)" : "transparent")};
	text-align: left;
	padding: 10px 8px;
	border-radius: 8px;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	gap: 4px;

	&:hover {
		background: var(--surface-2);
	}
`;

const HitPage = styled.span`
	font-size: 0.6875rem;
	font-weight: 600;
	color: var(--accent-strong);
	font-variant-numeric: tabular-nums;
`;

const HitSnippet = styled.span`
	font-size: 0.8125rem;
	color: var(--ink-1);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`;

const NoHits = styled.p`
	color: var(--ink-2);
	font-size: 0.9375rem;
	padding: 8px;
`;

export function PdfSearchSheet({
	open,
	doc,
	onDismiss,
	onNavigateToMatches,
}: {
	open: boolean;
	doc: PdfDocument | null;
	onDismiss: () => void;
	/** Hands the full hit list + active index to the viewer, which
	 * highlights matches, scrolls to the active one, and closes this
	 * sheet (audit PDF-09). */
	onNavigateToMatches: (hits: SearchHit[], activeIndex: number) => void;
}) {
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [matchCount, setMatchCount] = useState(0);
	const [searched, setSearched] = useState(0);
	const [total, setTotal] = useState(0);
	const [busy, setBusy] = useState(false);
	const [textlessPages, setTextlessPages] = useState(0);
	const [erroredPages, setErroredPages] = useState(0);
	const runId = useRef(0);
	const [selected, setSelected] = useState(-1);

	useEffect(() => {
		if (!open || !doc) return;
		const id = ++runId.current;
		setHits([]);
		setMatchCount(0);
		setSearched(0);
		setTotal(doc.numPages);
		setSelected(-1);
		setTextlessPages(0);
		setErroredPages(0);
		const needle = query.trim().toLowerCase();
		if (needle.length === 0) {
			setBusy(false);
			return;
		}
		setBusy(true);
		// Debounce input: typing must never block scrolling or chrome
		// interaction; stale runs are cancelled by their generation id.
		const timer = window.setTimeout(() => {
			const run = async () => {
				const found: SearchHit[] = [];
				let count = 0;
				let textless = 0;
				let errored = 0;
				let lastPublish = Date.now();
				const publish = (p: number, force: boolean) => {
					const now = Date.now();
					if (!force && now - lastPublish < 100) return;
					lastPublish = now;
					setSearched(p);
					setMatchCount(count);
					setHits([...found]);
					setTextlessPages(textless);
					setErroredPages(errored);
				};
				for (let p = 1; p <= doc.numPages; p++) {
					if (id !== runId.current) return;
					try {
						const index = await pageTextIndex(doc, p);
						if (index.empty) textless++;
						let idx = index.normalized.indexOf(needle);
						while (idx !== -1) {
							count++;
							const startItem = index.mapItem[idx];
							const endIdx = idx + needle.length - 1;
							const startOffset = index.mapOffset[idx];
							const endOffset =
								endIdx < index.mapOffset.length
									? index.mapOffset[endIdx]
									: startOffset;
							if (found.length < RENDERED_HIT_LIMIT) {
								found.push({
									page: p,
									itemIndex: startItem,
									startInItem: startOffset,
									length: endOffset - startOffset + 1,
									snippet: buildSnippet(index.normalized, idx, needle.length),
								});
							}
							idx = index.normalized.indexOf(
								needle,
								idx + Math.max(1, needle.length),
							);
						}
					} catch {
						// A page that fails extraction is a fact worth
						// disclosing, not silence (audit PDF-09).
						errored++;
					}
					if (id !== runId.current) return;
					// Throttled: state per page re-rendered the list for
					// every page of large documents; 10Hz keeps progress
					// honest without competing with the reader.
					publish(p, p === doc.numPages);
				}
				setBusy(false);
			};
			run();
		}, 250);
		return () => {
			window.clearTimeout(timer);
			runId.current++;
		};
	}, [open, query, doc]);

	const progress = total > 0 ? searched / total : 0;
	const renderedCapped = matchCount > hits.length;

	return (
		<Sheet open={open} title="Search" id="pdf-search" onDismiss={onDismiss}>
			<TextField
				label="Find in document"
				value={query}
				onChange={setQuery}
				placeholder="Search text"
				autoFocus
			/>
			<StatusLine aria-live="polite" data-testid="pdf-search-status">
				{busy
					? `Searching, page ${searched} of ${total} (${Math.round(progress * 100)}%)`
					: query.trim()
						? `${matchCount} ${matchCount === 1 ? "result" : "results"}`
						: "Type to search the document."}
				{renderedCapped ? ` — showing the first ${RENDERED_HIT_LIMIT}.` : ""}
				{!busy && erroredPages > 0
					? ` ${erroredPages} ${erroredPages === 1 ? "page" : "pages"} could not be searched.`
					: ""}
			</StatusLine>
			<ListPanel data-testid="pdf-search-results">
				{hits.map((hit, i) => (
					<HitButton
						key={`hit-${hit.page}-${hit.itemIndex}-${hit.startInItem}`}
						$current={i === selected}
						data-testid={`pdf-search-hit-${i}`}
						onClick={() => {
							setSelected(i);
							onNavigateToMatches(hits, i);
						}}
					>
						<HitPage>Page {hit.page}</HitPage>
						<HitSnippet>{hit.snippet}</HitSnippet>
					</HitButton>
				))}
				{!busy && query.trim() && matchCount === 0 && (
					<NoHits>
						{textlessPages === total && total > 0
							? "No searchable text. This document may be a scan (image-only pages) — search needs embedded text."
							: "No matches. Try a shorter or different word."}
					</NoHits>
				)}
			</ListPanel>
			{!busy && matchCount === 0 && (
				<Button variant="ghost" onClick={onDismiss}>
					Close
				</Button>
			)}
		</Sheet>
	);
}
