/** XML helpers for OOXML parts: namespace-agnostic, by local name. */

export function kids(el: Element | null | undefined, name?: string): Element[] {
	if (!el) return [];
	const out: Element[] = [];
	for (const c of Array.from(el.children))
		if (!name || c.localName === name) out.push(c);
	return out;
}
export function kid(
	el: Element | null | undefined,
	name: string,
): Element | null {
	if (!el) return null;
	for (const c of Array.from(el.children)) if (c.localName === name) return c;
	return null;
}
export function path(
	el: Element | null | undefined,
	...names: string[]
): Element | null {
	let cur: Element | null | undefined = el;
	for (const n of names) cur = kid(cur, n);
	return cur ?? null;
}
export function attrOf(
	el: Element | null | undefined,
	name: string,
): string | null {
	return el?.getAttribute(name) ?? null;
}
export function relId(
	el: Element | null | undefined,
	name: string,
): string | null {
	if (!el) return null;
	for (const a of Array.from(el.attributes))
		if (a.localName === name && a.prefix === "r") return a.value;
	return el.getAttribute(`r:${name}`);
}
