import { Button, Sheet, TextField } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import type { PdfDocument } from "./pdfTypes";

/**
 * OVL-01 search sheet (docs/07 section 2): progressive text search
 * with hit count, snippets, and jump-to-page. v0.9 jumps to the
 * page of a hit; on-canvas highlight boxes are a follow-up.
 */

interface SearchHit {
	page: number;
	snippet: string;
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

const SNIPPET_CONTEXT = 24;

function buildSnippet(
	text: string,
	index: number,
	queryLength: number,
): string {
	const start = Math.max(0, index - SNIPPET_CONTEXT);
	const end = Math.min(text.length, index + queryLength + SNIPPET_CONTEXT);
	const prefix = start > 0 ? "..." : "";
	const suffix = end < text.length ? "..." : "";
	return `${prefix}${text.slice(start, end).replace(/\s+/g, " ")}${suffix}`;
}

/** Per-document page-text cache: extraction runs once per page per
 * document instead of once per keystroke (audit 11.3). */
const textCache = new WeakMap<PdfDocument, Map<number, string>>();

async function pageText(doc: PdfDocument, pageNum: number): Promise<string> {
	let pages = textCache.get(doc);
	if (!pages) {
		pages = new Map<number, string>();
		textCache.set(doc, pages);
	}
	const cached = pages.get(pageNum);
	if (cached !== undefined) return cached;
	const page = await doc.getPage(pageNum);
	const content = await page.getTextContent();
	let out = "";
	for (const item of content.items) {
		if ("str" in item) out += `${item.str} `;
	}
	pages.set(pageNum, out);
	return out;
}

export function PdfSearchSheet({
	open,
	doc,
	onDismiss,
	onGoToPage,
}: {
	open: boolean;
	doc: PdfDocument | null;
	onDismiss: () => void;
	onGoToPage: (page: number) => void;
}) {
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [searched, setSearched] = useState(0);
	const [total, setTotal] = useState(0);
	const [busy, setBusy] = useState(false);
	const runId = useRef(0);
	const [selected, setSelected] = useState(-1);

	useEffect(() => {
		if (!open || !doc) return;
		const id = ++runId.current;
		setHits([]);
		setSearched(0);
		setTotal(doc.numPages);
		setSelected(-1);
		if (query.trim().length === 0) {
			setBusy(false);
			return;
		}
		setBusy(true);
		const needle = query.trim().toLowerCase();

		// Debounce input: typing must never block scrolling or chrome
		// interaction (audit 11.3), and stale runs are cancelled by
		// their generation id.
		const timer = window.setTimeout(() => {
			const run = async () => {
				const found: SearchHit[] = [];
				for (let p = 1; p <= doc.numPages; p++) {
					if (id !== runId.current) return;
					try {
						const text = (await pageText(doc, p)).toLowerCase();
						let idx = text.indexOf(needle);
						let count = 0;
						while (idx !== -1 && count < 5) {
							found.push({
								page: p,
								snippet: buildSnippet(text, idx, needle.length),
							});
							count++;
							idx = text.indexOf(needle, idx + needle.length);
						}
					} catch {
						// Unreadable page text; skip it.
					}
					if (id !== runId.current) return;
					setSearched(p);
					// Report progressive results as they land.
					setHits([...found]);
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

	return (
		<Sheet open={open} title="Search" id="pdf-search" onDismiss={onDismiss}>
			<TextField
				label="Find in document"
				value={query}
				onChange={setQuery}
				placeholder="Search text"
				autoFocus
			/>
			<StatusLine aria-live="polite">
				{busy
					? `Searching, page ${searched} of ${total} (${Math.round(progress * 100)}%)`
					: query.trim()
						? `${hits.length} ${hits.length === 1 ? "result" : "results"}`
						: "Type to search the document."}
			</StatusLine>
			<ListPanel>
				{hits.map((hit, i) => (
					<HitButton
						key={`hit-${hit.page}-${i}`}
						$current={i === selected}
						onClick={() => {
							setSelected(i);
							onGoToPage(hit.page);
						}}
					>
						<HitPage>Page {hit.page}</HitPage>
						<HitSnippet>{hit.snippet}</HitSnippet>
					</HitButton>
				))}
				{!busy && query.trim() && hits.length === 0 && (
					<NoHits>No matches. Try a shorter or different word.</NoHits>
				)}
			</ListPanel>
			{!busy && hits.length === 0 && (
				<Button variant="ghost" onClick={onDismiss}>
					Close
				</Button>
			)}
		</Sheet>
	);
}
