/**
 * Where Space and Page Up / Down stop in a document of pages laid down
 * a scroll.
 *
 * A screen at a time leaves the next page part way down the screen,
 * and the reader scrolls back to put its top in place. So: when the top
 * of the next page is already on the screen, everything before it has
 * been seen, and the key goes to that top; otherwise it goes most of a
 * screen on, as before. Nothing is skipped either way. A page that fits
 * the screen is then turned a page at a time.
 */

/** A page top this close is the one on show, not the next. */
const NEAR = 24;
/** The share of the screen a key moves when no page top is near. */
const STEP = 0.9;

/**
 * The scroll position a screen key goes to.
 * @param from the scroll position now
 * @param view the height of the screen
 * @param dir 1 for down, -1 for up
 * @param tops where each page begins, in scroll positions, in order
 */
export function screenStop(
	from: number,
	view: number,
	dir: 1 | -1,
	tops: readonly number[],
): number {
	if (dir > 0) {
		const next = tops.find((top) => top > from + NEAR);
		return next !== undefined && next <= from + view
			? next
			: from + view * STEP;
	}
	let prev: number | undefined;
	for (const top of tops) {
		if (top >= from - NEAR) break;
		prev = top;
	}
	return prev !== undefined && prev >= from - view ? prev : from - view * STEP;
}
