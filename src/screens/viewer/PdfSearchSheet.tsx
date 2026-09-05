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

interface CharRef {
	item: number;
	offset: number;
}

interface PageTextIndex {
	items: string[];
	normalized: string;
	map: CharRef[];
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
 * many searches race. */
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
		const page = await doc.getPage(pageNum);
		const content = await page.getTextContent();
		const items: string[] = [];
		let normalized = "";
		const map: CharRef[] = [];
		for (let i = 0; i < content.items.length; i++) {
			const item = content.items[i];
			if (!("str" in item)) continue;
			const str = item.str;
			items.push(str);
			for (let k = 0; k < str.length; k++) {
				normalized += str[k].toLowerCase();
				map.push({ item: i, offset: k });
			}
			if ("hasEOL" in item && item.hasEOL) {
				normalized += "\n";
				map.push({ item: i, offset: str.length });
			}
		}
		return {
			items,
			normalized,
			map,
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
				for (let p = 1; p <= doc.numPages; p++) {
					if (id !== runId.current) return;
					try {
						const index = await pageTextIndex(doc, p);
						if (index.empty) textless++;
						let idx = index.normalized.indexOf(needle);
						while (idx !== -1) {
							count++;
							const startRef = index.map[idx];
							const endRef = index.map[idx + needle.length - 1] ?? startRef;
							if (found.length < RENDERED_HIT_LIMIT) {
								found.push({
									page: p,
									itemIndex: startRef.item,
									startInItem: startRef.offset,
									length: endRef.offset - startRef.offset + 1,
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
					setSearched(p);
					setMatchCount(count);
					setHits([...found]);
					setTextlessPages(textless);
					setErroredPages(errored);
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
