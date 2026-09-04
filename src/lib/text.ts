/** Pure helpers for document text search. */

const SNIPPET_CONTEXT = 24;

/** A short excerpt around a match, ellipsized where it was cut. */
export function buildSnippet(
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

/** Find up to maxHits matches, case-insensitively. */
export function findMatches(
	pageText: string,
	needle: string,
	page: number,
	maxHitsPerPage: number,
): Array<{ page: number; snippet: string }> {
	const hits: Array<{ page: number; snippet: string }> = [];
	const lower = pageText.toLowerCase();
	const target = needle.toLowerCase();
	let idx = lower.indexOf(target);
	let count = 0;
	while (idx !== -1 && count < maxHitsPerPage) {
		hits.push({ page, snippet: buildSnippet(pageText, idx, needle.length) });
		count++;
		idx = lower.indexOf(target, idx + target.length);
	}
	return hits;
}
