/* docx-preview numbers lists with CSS counters it resets once, on the
 * wrapper. Each page only lays out near the screen (content-visibility:
 * auto), and that brings style containment: a page cannot see a counter
 * from outside it, so every item would read 1. Starting each page's
 * counters where the page before left off keeps both the counting and
 * the speed. */

/** The names and numbers in a computed counter-reset, counter-set or
 * counter-increment value ("none", or "a 1 b 0"). A name with no number
 * gets `fallback`. */
export function counterPairs(
	value: string,
	fallback: number,
): [string, number][] {
	const out: [string, number][] = [];
	if (!value || value === "none") return out;
	const parts = value.trim().split(/\s+/);
	for (let i = 0; i < parts.length; i++) {
		const next = parts[i + 1];
		if (next !== undefined && /^[-+]?\d+$/.test(next)) {
			out.push([parts[i], Number(next)]);
			i++;
		} else out.push([parts[i], fallback]);
	}
	return out;
}

/** One numbered paragraph: the counters it sets (on itself) and the
 * one its marker counts up (on its ::before). */
export interface ListItem {
	set: string;
	increment: string;
}

/** Where every counter stands at the start of each page, as a
 * counter-reset value: `initial` is the wrapper's own reset. */
export function pageCounterResets(
	initial: string,
	pages: ListItem[][],
): string[] {
	const values = new Map(counterPairs(initial, 0));
	return pages.map((items) => {
		const reset = [...values].map(([name, n]) => `${name} ${n}`).join(" ");
		// An element's counter-set applies before its ::before counts up.
		for (const item of items) {
			for (const [name, n] of counterPairs(item.set, 0)) values.set(name, n);
			for (const [name, n] of counterPairs(item.increment, 1))
				values.set(name, (values.get(name) ?? 0) + n);
		}
		return reset;
	});
}

/** Starts each rendered page's list counters where the last page left
 * them. Call once the pages are in the document (styles must apply). */
export function seedListCounters(root: HTMLElement) {
	const wrapper = root.querySelector<HTMLElement>(".docx-wrapper");
	if (!wrapper) return;
	const initial = getComputedStyle(wrapper).counterReset;
	if (!initial || initial === "none") return;
	const bodies = [
		...wrapper.querySelectorAll<HTMLElement>(":scope > section.docx > article"),
	];
	const resets = pageCounterResets(
		initial,
		bodies.map((body) =>
			[...body.querySelectorAll('p[class*="docx-num-"]')].map((p) => ({
				set: getComputedStyle(p).counterSet,
				increment: getComputedStyle(p, "::before").counterIncrement,
			})),
		),
	);
	for (let i = 0; i < bodies.length; i++)
		bodies[i].style.counterReset = resets[i];
}
