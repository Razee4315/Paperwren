/**
 * Pages turned sideways, for documents whose text flows (a book, a
 * text file, a reflowed Word or OpenDocument file): the text is laid out
 * in columns as tall as the screen, one page to a screen (two, side by
 * side, on a wide one), and a swipe settles on the next page as it
 * would in a book. The scroller is marked `data-flow="across"`, which
 * the Shell already reads for its progress bar and Home/End.
 *
 * Where the reader is stays a ratio through the document either way, so
 * a remembered place, a bookmark or a jump from the contents lands on
 * the same text in both layouts.
 */

import { t } from "@/lib/i18n";
import { useSettings } from "@/state/settings";
import { SheetItem } from "@/ui";
import { GalleryHorizontal } from "lucide-react";
import {
	type RefObject,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { shellStyles } from "./Shell";

/** Whether a scroller shows its document as pages turned sideways. */
export const isPaged = (el: HTMLElement | null | undefined): boolean =>
	el?.dataset.flow === "across";

/** How far through its document a scroller is, 0 to 1. */
export function readRatio(el: HTMLElement): number {
	const range = isPaged(el)
		? el.scrollWidth - el.clientWidth
		: el.scrollHeight - el.clientHeight;
	const at = isPaged(el) ? el.scrollLeft : el.scrollTop;
	return range > 1 ? Math.min(1, Math.max(0, at / range)) : 0;
}

/** Put a scroller at a ratio through its document: on the page that
 * holds that place, when it is turned page by page. */
export function goToRatio(el: HTMLElement, ratio: number) {
	if (isPaged(el)) {
		const pages = Math.max(1, Math.round(el.scrollWidth / el.clientWidth));
		el.scrollLeft = Math.round(ratio * (pages - 1)) * el.clientWidth;
	} else el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
}

/** The page (0-based) a spot on screen is on. */
function pageAt(el: HTMLElement, x: number): number {
	const left = x - el.getBoundingClientRect().left + el.scrollLeft;
	return Math.max(0, Math.floor((left + 1) / el.clientWidth));
}

/** Bring a found word or a spoken sentence into view: its page, or a
 * third of the way down the screen. */
export function reveal(el: HTMLElement, rect: DOMRect, margin = 40) {
	const view = el.getBoundingClientRect();
	if (isPaged(el)) {
		if (rect.left >= view.left - 1 && rect.right <= view.right + 1) return;
		el.scrollLeft = pageAt(el, rect.left) * el.clientWidth;
		return;
	}
	if (rect.top < view.top + margin || rect.bottom > view.bottom - margin)
		el.scrollTop += rect.top - view.top - view.height / 3;
}

/** Go to where an element begins (a heading, a chapter): its top just
 * under the bar, or the page it starts on. */
export function jumpTo(el: HTMLElement, target: Element, offset = 12) {
	const rect = target.getBoundingClientRect();
	if (isPaged(el)) {
		el.scrollLeft = pageAt(el, rect.left) * el.clientWidth;
		return;
	}
	el.scrollTop += rect.top - el.getBoundingClientRect().top - offset;
}

/** Where a layout that was just taken down had its reader. */
const handover = new WeakMap<HTMLElement, { ratio: number; top: number }>();

/** The widest a page's column of text is drawn, at 100%. */
const MEASURE = 680;
/** From this wide a screen shows two pages, as an open book does. */
const SPREAD = 1000;
/** Space between the two pages of a spread, and at a page's sides. */
const GUTTER = 56;
/** Scroll that adds up to a turn of the page (a wheel's notch is ~100). */
const WHEEL_TURN = 60;

/** What a paged layout sets on its paper, to take back when it ends. */
const PROPS = [
	"width",
	"height",
	"max-width",
	"margin",
	"padding-left",
	"padding-right",
	"box-sizing",
	"column-width",
	"column-gap",
	"column-count",
	"column-fill",
	"--page-h",
	"--page-side",
] as const;

export interface Paged {
	/** The page on show (0-based) and how many there are: 0 when the
	 * document scrolls instead. */
	page: number;
	pages: number;
	/** Turn a page; false when there is none that way. */
	turn: (dir: 1 | -1) => boolean;
}

/**
 * Lay `paper` out as pages turned sideways inside `scroller` while `on`.
 * `zoom` is the text size the viewer draws at (CSS zoom on a parent of
 * the paper); `relayout` changes whenever the text changes.
 */
export function usePaged({
	scroller,
	paper,
	on,
	zoom = 1,
	relayout,
}: {
	scroller: RefObject<HTMLElement | null>;
	paper: () => HTMLElement | null;
	on: boolean;
	zoom?: number;
	relayout?: unknown;
}): Paged {
	const [state, setState] = useState({ page: 0, pages: 0 });
	const paperRef = useRef(paper);
	paperRef.current = paper;

	// biome-ignore lint/correctness/useExhaustiveDependencies: new text (relayout) is laid out again
	useLayoutEffect(() => {
		const el = scroller.current;
		const sheet = paperRef.current();
		if (!on || !el || !sheet) return;
		// Where the reader was, to be found again in the new layout: the
		// exact place a layout just taken down left, while the reader has
		// not moved since (a new text size lays the pages out afresh).
		const left = handover.get(el);
		let ratio = left && el.scrollTop === left.top ? left.ratio : readRatio(el);
		handover.delete(el);
		const marks = document.createElement("div");
		marks.setAttribute("aria-hidden", "true");
		marks.className = "pw-page-marks";
		el.appendChild(marks);

		let width = 0;
		let height = 0;
		const layout = () => {
			const screen = el.clientWidth;
			const tall = el.clientHeight;
			if (!screen || !tall) return;
			if (isPaged(el) && screen === width && tall === height) {
				ratio = readRatio(el);
			}
			width = screen;
			height = tall;
			el.dataset.flow = "across";
			el.classList.add("pw-paged");
			sheet.classList.add("pw-paged-paper");
			const z = zoom || 1;
			const across = screen / z;
			const perScreen = screen >= SPREAD ? 2 : 1;
			const side = across < 500 ? 22 : GUTTER / 2;
			const stride = across / perScreen;
			const column = Math.max(
				120,
				Math.min(MEASURE, stride - (perScreen > 1 ? GUTTER : 2 * side)),
			);
			const gap = stride - column;
			const set = (prop: string, value: string) =>
				sheet.style.setProperty(prop, value);
			set("box-sizing", "border-box");
			set("max-width", "none");
			set("margin", "0");
			set("height", `${tall / z}px`);
			set("--page-h", `${tall / z}px`);
			set("padding-left", `${gap / 2}px`);
			set("padding-right", `${gap / 2}px`);
			set("--page-side", `${gap / 2}px`);
			set("column-width", `${column}px`);
			set("column-gap", `${gap}px`);
			set("column-fill", "auto");
			// One column's width first, so the text overflows into as many
			// columns as it needs; then room for exactly those, so the
			// paper's own colour runs under every page.
			set("column-count", "auto");
			set("width", `${stride}px`);
			const columns = Math.max(
				1,
				Math.round((sheet.scrollWidth + gap / 2) / stride),
			);
			const pages = Math.ceil(columns / perScreen);
			set("column-count", String(pages * perScreen));
			set("width", `${pages * perScreen * stride}px`);
			// Where a swipe may come to rest: the start of each page.
			if (marks.childElementCount !== pages) {
				marks.replaceChildren(
					...Array.from({ length: pages }, (_, i) => {
						const mark = document.createElement("span");
						mark.style.left = `${i * screen}px`;
						return mark;
					}),
				);
			} else {
				Array.from(marks.children).forEach((mark, i) => {
					(mark as HTMLElement).style.left = `${i * screen}px`;
				});
			}
			goToRatio(el, ratio);
			setState({ page: Math.round(el.scrollLeft / screen), pages });
		};
		layout();

		let frame = 0;
		const later = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				ratio = readRatio(el);
				width = 0;
				layout();
			});
		};
		const resized = new ResizeObserver(() => {
			if (el.clientWidth !== width || el.clientHeight !== height) later();
		});
		resized.observe(el);
		// Pictures and fonts that arrive late change how much fits a page.
		sheet.addEventListener("load", later, true);
		document.fonts?.ready.then(later).catch(() => {});

		const onScroll = () =>
			setState((now) => {
				const page = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
				return page === now.page ? now : { ...now, page };
			});
		el.addEventListener("scroll", onScroll, { passive: true });

		// A mouse wheel turns the page; a trackpad's small steps add up.
		let sum = 0;
		let last = 0;
		const onWheel = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) return;
			if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
			e.preventDefault();
			if (e.timeStamp - last > 350) sum = 0;
			last = e.timeStamp;
			sum += e.deltaY;
			if (Math.abs(sum) < WHEEL_TURN) return;
			const dir = Math.sign(sum);
			sum = 0;
			el.scrollTo({
				left:
					(Math.round(el.scrollLeft / el.clientWidth) + dir) * el.clientWidth,
				behavior: "smooth",
			});
		};
		el.addEventListener("wheel", onWheel, { passive: false });

		return () => {
			cancelAnimationFrame(frame);
			resized.disconnect();
			sheet.removeEventListener("load", later, true);
			el.removeEventListener("scroll", onScroll);
			el.removeEventListener("wheel", onWheel);
			const at = readRatio(el);
			for (const prop of PROPS) sheet.style.removeProperty(prop);
			sheet.classList.remove("pw-paged-paper");
			el.classList.remove("pw-paged");
			delete el.dataset.flow;
			marks.remove();
			el.scrollLeft = 0;
			goToRatio(el, at);
			handover.set(el, { ratio: at, top: el.scrollTop });
			setState({ page: 0, pages: 0 });
		};
	}, [on, zoom, relayout, scroller]);

	const turn = useCallback(
		(dir: 1 | -1) => {
			const el = scroller.current;
			if (!el || !isPaged(el)) return false;
			const page = Math.round(el.scrollLeft / el.clientWidth) + dir;
			const pages = Math.round(el.scrollWidth / el.clientWidth);
			if (page < 0 || page >= pages) return false;
			el.scrollTo({ left: page * el.clientWidth, behavior: "smooth" });
			return true;
		},
		[scroller],
	);

	return { ...state, turn };
}

/** Whether the reader turns pages sideways: one choice for every
 * document, a PDF's too (Settings, Reading: "Pages scroll"). */
export function useSideways(): [on: boolean, set: (on: boolean) => void] {
	const { settings, update } = useSettings();
	return [
		settings.pdfFlow === "across",
		(on) => update("pdfFlow", on ? "across" : "down"),
	];
}

/** The viewer menu's switch between scrolling down and turning pages. */
export function SidewaysItem({
	close,
	disabled,
	hint,
}: {
	close: () => void;
	disabled?: boolean;
	hint?: string;
}) {
	const [on, set] = useSideways();
	return (
		<SheetItem
			icon={<GalleryHorizontal size={20} />}
			checked={on && !disabled}
			disabled={disabled}
			hint={hint}
			onClick={() => {
				close();
				set(!on);
			}}
			testId="pages-sideways"
		>
			{t("Scroll pages sideways")}
		</SheetItem>
	);
}

/** "3 / 12": the page on show, while pages are turned. */
export function PageCount({ paged }: { paged: Paged }) {
	if (!paged.pages) return null;
	return (
		<span
			className={shellStyles.meta}
			aria-live="polite"
			data-testid="paged-count"
		>
			{t("{n} of {total}", { n: paged.page + 1, total: paged.pages })}
		</span>
	);
}
