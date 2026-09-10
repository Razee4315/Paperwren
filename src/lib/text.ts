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

/**
 * Truncate a filename from BOTH ends so the middle collapses: start
 * and end stay visible ("Quarterly…report.pdf") where CSS ellipsis
 * would blind-cut the tail ("Quarterly rep…"). The extension rides
 * through untouched. `measure` returns the rendered width of a
 * string; `maxPx` is the available width.
 */
export function middleTruncate(
	text: string,
	maxPx: number,
	measure: (s: string) => number,
): string {
	if (maxPx <= 0 || measure(text) <= maxPx) return text;
	const extMatch = text.match(/\.[^.]{1,8}$/);
	const ext = extMatch ? extMatch[0] : "";
	const stem = ext ? text.slice(0, text.length - ext.length) : text;
	const ellipsis = "…";
	// Binary search the largest kept-stem length whose head+tail
	// rendering fits. The tail gets the larger share (60/40): for
	// filenames the distinctive words usually sit at the end, next to
	// the extension.
	let lo = 0;
	let hi = stem.length;
	let best = 0;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const head = stem.slice(0, Math.floor(mid * 0.4));
		const tail = stem.slice(stem.length - Math.ceil(mid * 0.6));
		const candidate = `${head}${ellipsis}${tail}${ext}`;
		if (measure(candidate) <= maxPx) {
			best = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	// Too tight for a meaningful split: extension alone still says
	// more than a blind cut.
	if (best <= 2) {
		const minimal = `${ellipsis}${ext}`;
		return measure(minimal) <= maxPx ? minimal : ellipsis;
	}
	const head = stem.slice(0, Math.floor(best * 0.4));
	const tail = stem.slice(stem.length - Math.ceil(best * 0.6));
	return `${head}${ellipsis}${tail}${ext}`;
}
