/**
 * Marks over stretches of a document's text (find matches, the words
 * being read aloud) without touching the document's own elements.
 *
 * Where the CSS Custom Highlight API exists (Chrome 105) the browser
 * paints them, styled by the `::highlight()` rules in global.css. An
 * older WebView has no such API, so boxes are laid over the text
 * instead, in a layer of their own, and moved as the page scrolls.
 */

interface HighlightRegistry {
	set(name: string, h: unknown): void;
	delete(name: string): void;
}
declare const Highlight: { new (...ranges: Range[]): unknown } | undefined;

function registry(): HighlightRegistry | null {
	const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
	return css?.highlights && typeof Highlight !== "undefined"
		? css.highlights
		: null;
}

/** Each mark's colour when the boxes are drawn by hand: the same as
 * its `::highlight()` rule. */
const COLOURS: Record<string, string> = {
	"pw-find": "var(--highlight)",
	"pw-find-active": "var(--highlight-active)",
	"pw-speech": "rgba(43, 110, 102, 0.24)",
};

interface Painted {
	ranges: Range[];
	/** What the marks stay inside: the scrolling view of the document. */
	clip: HTMLElement | null;
}
const painted = new Map<string, Painted>();
let layer: HTMLDivElement | null = null;
let frame = 0;

function repaint() {
	frame = 0;
	if (!layer) return;
	layer.textContent = "";
	const view = { w: window.innerWidth, h: window.innerHeight };
	for (const [name, { ranges, clip }] of painted) {
		const bounds = clip?.getBoundingClientRect() ?? {
			left: 0,
			top: 0,
			right: view.w,
			bottom: view.h,
		};
		for (const range of ranges) {
			for (const r of Array.from(range.getClientRects())) {
				const left = Math.max(r.left, bounds.left);
				const top = Math.max(r.top, bounds.top);
				const right = Math.min(r.right, bounds.right);
				const bottom = Math.min(r.bottom, bounds.bottom);
				if (right <= left || bottom <= top) continue;
				const box = document.createElement("div");
				box.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px;background:${COLOURS[name] ?? COLOURS["pw-find"]};border-radius:2px`;
				layer.appendChild(box);
			}
		}
	}
}
const schedule = () => {
	if (!frame) frame = requestAnimationFrame(repaint);
};

/** The layer lives inside the document's scrolling view: over its
 * text, under the viewer's bars, menus and sheets. */
function ensureLayer(home: HTMLElement) {
	if (!layer) {
		layer = document.createElement("div");
		layer.setAttribute("aria-hidden", "true");
		layer.dataset.marks = "";
		layer.style.cssText =
			"position:fixed;inset:0;pointer-events:none;z-index:1;overflow:hidden";
		window.addEventListener("scroll", schedule, {
			capture: true,
			passive: true,
		});
		window.addEventListener("resize", schedule);
	}
	if (layer.parentNode !== home) home.appendChild(layer);
}

function dropLayer() {
	if (!layer) return;
	window.removeEventListener("scroll", schedule, { capture: true });
	window.removeEventListener("resize", schedule);
	if (frame) cancelAnimationFrame(frame);
	frame = 0;
	layer.remove();
	layer = null;
}

/** Mark these ranges under `name`, in place of what it marked before. */
export function markRanges(
	name: string,
	ranges: Range[],
	clip: HTMLElement | null = null,
) {
	const reg = registry();
	if (reg && typeof Highlight !== "undefined") {
		reg.set(name, new Highlight(...ranges));
		return;
	}
	painted.set(name, { ranges, clip });
	ensureLayer(clip ?? document.body);
	schedule();
}

/** Take away what `name` marked. */
export function unmarkRanges(name: string) {
	const reg = registry();
	if (reg) {
		reg.delete(name);
		return;
	}
	painted.delete(name);
	if (painted.size === 0) dropLayer();
	else schedule();
}
