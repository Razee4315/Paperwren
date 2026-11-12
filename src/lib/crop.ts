/**
 * How a PDF's pages are cropped for reading, as the reader chose it:
 * by the app (the white around what is printed left out), by hand, or
 * both. Kept with where the reader stopped (Position), per document.
 *
 * A box by hand is kept as shares of its page (left, bottom, right, top
 * from 0 to 1, in the page's own space, as pdf.js reads it), so it fits
 * whatever the page is turned to, and pages of another size alike. A
 * page takes, of the boxes set, the first of: its own, its side's (odd
 * or even pages, as a book's margins alternate), every page's; and the
 * app's crop when there is none, if that is on.
 */

/** Left, bottom, right, top, as shares (0-1) of the page. */
export type Share = [number, number, number, number];

export interface CropChoice {
	/** The app crops the pages with no box of their own. */
	auto: boolean;
	/** ...leaving out running headers and page numbers. */
	bare?: boolean;
	all?: Share;
	odd?: Share;
	even?: Share;
	/** Boxes of single pages, by page number (from 1). */
	pages?: Record<number, Share>;
}

/** Which pages a box by hand is for. */
export type CropScope = "all" | "odd" | "even" | "page";

/** Smallest a box by hand can be, as a share of its page. */
export const MIN_SHARE = 0.05;

function cleanShare(value: unknown): Share | undefined {
	if (!Array.isArray(value) || value.length !== 4) return undefined;
	if (!value.every((v) => typeof v === "number" && v >= 0 && v <= 1))
		return undefined;
	const [l, b, r, t] = value as Share;
	return r - l >= MIN_SHARE / 2 && t - b >= MIN_SHARE / 2
		? [l, b, r, t]
		: undefined;
}

/** Whether a choice crops anything at all. */
export function cropOn(choice: CropChoice | null | undefined): boolean {
	if (!choice) return false;
	return (
		choice.auto ||
		!!choice.all ||
		!!choice.odd ||
		!!choice.even ||
		Object.keys(choice.pages ?? {}).length > 0
	);
}

/** Whether a choice has any box set by hand. */
export const byHand = (choice: CropChoice): boolean =>
	cropOn({ ...choice, auto: false });

/**
 * A stored crop as the app can use it, or undefined. `true` is how
 * crop margins was kept before boxes could be set by hand: the app's
 * crop.
 */
export function cleanCrop(value: unknown): CropChoice | undefined {
	if (value === true) return { auto: true };
	if (!value || typeof value !== "object") return undefined;
	const c = value as Record<string, unknown>;
	const out: CropChoice = { auto: c.auto === true };
	if (c.bare === true) out.bare = true;
	for (const key of ["all", "odd", "even"] as const) {
		const share = cleanShare(c[key]);
		if (share) out[key] = share;
	}
	if (c.pages && typeof c.pages === "object") {
		const pages: Record<number, Share> = {};
		for (const [key, value] of Object.entries(c.pages)) {
			const n = Number(key);
			const share = cleanShare(value);
			if (Number.isInteger(n) && n > 0 && share) pages[n] = share;
		}
		if (Object.keys(pages).length) out.pages = pages;
	}
	return cropOn(out) ? out : undefined;
}

const odd = (n: number) => n % 2 === 1;

/** The box set by hand for page `n`, if any. */
export function boxByHand(choice: CropChoice, n: number): Share | undefined {
	return choice.pages?.[n] ?? (odd(n) ? choice.odd : choice.even) ?? choice.all;
}

/** Only the single pages' boxes that `keep` keeps; none is left out. */
function pagesWhere(
	pages: CropChoice["pages"],
	keep: (n: number) => boolean,
): Pick<CropChoice, "pages"> {
	const left = Object.entries(pages ?? {}).filter(([n]) => keep(Number(n)));
	return left.length ? { pages: Object.fromEntries(left) } : {};
}

/** The choice with `share` set for `scope` (page `n` being the one on
 * show): the box overrides those of fewer pages it covers. */
export function setBox(
	choice: CropChoice,
	scope: CropScope,
	n: number,
	share: Share,
): CropChoice {
	const { all, odd: o, even: e, pages, ...rest } = choice;
	switch (scope) {
		case "all":
			return { ...rest, all: share };
		case "odd":
			return {
				...rest,
				...(all ? { all } : {}),
				odd: share,
				...(e ? { even: e } : {}),
				...pagesWhere(pages, (p) => !odd(p)),
			};
		case "even":
			return {
				...rest,
				...(all ? { all } : {}),
				...(o ? { odd: o } : {}),
				even: share,
				...pagesWhere(pages, odd),
			};
		case "page":
			return { ...choice, pages: { ...pages, [n]: share } };
	}
}

/** The choice without the boxes by hand that `scope` covers, so those
 * pages take the app's crop. */
export function clearBoxes(
	choice: CropChoice,
	scope: CropScope,
	n: number,
): CropChoice {
	const { all, odd: o, even: e, pages, ...rest } = choice;
	const out: CropChoice = { ...rest, auto: true };
	if (scope === "page") {
		if (all) out.all = all;
		if (o) out.odd = o;
		if (e) out.even = e;
		return { ...out, ...pagesWhere(pages, (p) => p !== n) };
	}
	if (scope === "odd") {
		if (all) out.all = all;
		if (e) out.even = e;
		return { ...out, ...pagesWhere(pages, (p) => !odd(p)) };
	}
	if (scope === "even") {
		if (all) out.all = all;
		if (o) out.odd = o;
		return { ...out, ...pagesWhere(pages, odd) };
	}
	return out;
}
