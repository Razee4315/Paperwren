/**
 * Matching a search in a document's text, the same way in every
 * viewer: case-insensitive unless asked, and optionally whole words
 * only (a word being letters and digits in any script).
 */

export interface FindOptions {
	matchCase: boolean;
	wholeWords: boolean;
}

export const ANY_MATCH: FindOptions = { matchCase: false, wholeWords: false };

const WORD = /[\p{L}\p{N}\p{M}_]/u;

/** Lower-cased without changing length, so offsets still point into
 * the original text (a few letters grow when lower-cased). */
export function folded(text: string): string {
	const lower = text.toLowerCase();
	return lower.length === text.length ? lower : text;
}

/** Whether the text at [at, at + length) stands as a word of its own. */
function standsAlone(text: string, at: number, length: number): boolean {
	const before = at > 0 ? text[at - 1] : "";
	const after = text[at + length] ?? "";
	return !WORD.test(before) && !WORD.test(after);
}

/** Where `query` occurs in `text`, as offsets into `text`; matches do
 * not overlap. At most `limit` are returned. */
export function matchesIn(
	text: string,
	query: string,
	options: FindOptions = ANY_MATCH,
	limit = Number.POSITIVE_INFINITY,
): number[] {
	if (!query) return [];
	const hay = options.matchCase ? text : folded(text);
	const needle = options.matchCase ? query : folded(query);
	const found: number[] = [];
	let at = hay.indexOf(needle);
	while (at !== -1 && found.length < limit) {
		if (!options.wholeWords || standsAlone(hay, at, needle.length)) {
			found.push(at);
			at = hay.indexOf(needle, at + needle.length);
		} else {
			at = hay.indexOf(needle, at + 1);
		}
	}
	return found;
}

/** Whether `query` occurs in `text` at all. */
export const matches = (
	text: string,
	query: string,
	options: FindOptions = ANY_MATCH,
) => matchesIn(text, query, options, 1).length > 0;

/** The words around a match, for a list of results. `at` is where the
 * search engine says it is, for when its text and this one differ. */
export function snippet(
	text: string,
	query: string,
	at: number,
	options: FindOptions = ANY_MATCH,
	reach: [before: number, after: number] = [40, 80],
): { before: string; match: string; after: string } {
	const start = matchesIn(text, query, options, 1)[0] ?? at;
	const end = start + query.length;
	const from = Math.max(0, start - reach[0]);
	const to = Math.min(text.length, end + reach[1]);
	return {
		before: `${from > 0 ? "…" : ""}${text.slice(from, start)}`,
		match: text.slice(start, end),
		after: `${text.slice(end, to)}${to < text.length ? "…" : ""}`,
	};
}
