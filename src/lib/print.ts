/**
 * Printing. The screen layout is built for scrolling (virtualised
 * pages, a windowed grid, zoomed stages), none of which prints. So a
 * print job renders the document a second time into a plain container
 * that only exists on paper: `#pw-print`. The print stylesheet (in
 * global.css) hides the whole app and shows only that container.
 */

import { type FileRef, backend } from "./backend";

const ROOT_ID = "pw-print";

/** A4 is 794 CSS px wide and Letter 816; content scaled to this fits
 * both with a whisker of margin. */
export const PRINT_WIDTH = 780;

function printRoot(): HTMLElement {
	let root = document.getElementById(ROOT_ID);
	if (!root) {
		root = document.createElement("div");
		root.id = ROOT_ID;
		document.body.appendChild(root);
	}
	root.replaceChildren();
	return root;
}

/** Wrap `node` so it prints `width` px wide content at paper width. */
export function fitted(
	node: Node,
	width: number,
	className = "",
	/** Never enlarge beyond this (narrow content stays its own size). */
	limit = 1.5,
): HTMLElement {
	const wrap = document.createElement("div");
	wrap.className = className;
	wrap.style.zoom = String(Math.min(limit, PRINT_WIDTH / Math.max(1, width)));
	wrap.appendChild(node);
	return wrap;
}

/** A sheet of flowing content with normal paper margins. */
export function sheet(node: Node, className = ""): HTMLElement {
	const wrap = document.createElement("div");
	wrap.className = `pw-sheet ${className}`.trim();
	wrap.appendChild(node);
	return wrap;
}

/** Wait until every picture has loaded (or failed), within reason. */
async function imagesReady(root: HTMLElement) {
	const pending = Array.from(root.querySelectorAll("img"))
		.filter((img) => !img.complete)
		.map(
			(img) =>
				new Promise((resolve) => {
					img.addEventListener("load", resolve, { once: true });
					img.addEventListener("error", resolve, { once: true });
				}),
		);
	await Promise.race([
		Promise.all(pending),
		new Promise((resolve) => window.setTimeout(resolve, 15_000)),
	]);
}

let printing = false;

/** Thrown by a `fill` when the reader backed out of printing (closed
 * the "which pages" question): the job ends quietly. */
export class PrintCancelled extends Error {}

/**
 * Print a document: the original file when the host can (exact), else
 * the page `fill` lays out for paper.
 */
export async function printDocument(
	file: FileRef,
	fill: (root: HTMLElement) => Promise<void> | void,
): Promise<void> {
	if (printing) return;
	printing = true;
	try {
		if (await backend.printOriginal(file)) return;
		const root = printRoot();
		try {
			await fill(root);
		} catch (err) {
			root.replaceChildren();
			if (err instanceof PrintCancelled) return;
			throw err;
		}
		await imagesReady(root);
		// Let layout settle before the host snapshots the page.
		await new Promise((resolve) => {
			requestAnimationFrame(() => resolve(null));
			// A backgrounded window gets no frames; do not wait on one.
			window.setTimeout(() => resolve(null), 120);
		});

		if (await backend.printPage(file.name)) {
			// The host's print screen reads the page while it is open and
			// covers the app; tidy up once the app is back in front.
			await new Promise<void>((resolve) => {
				let left = false;
				const done = () => {
					document.removeEventListener("visibilitychange", check);
					window.clearTimeout(limit);
					resolve();
				};
				const check = () => {
					if (document.visibilityState === "hidden") left = true;
					else if (left) done();
				};
				const limit = window.setTimeout(done, 10 * 60_000);
				document.addEventListener("visibilitychange", check);
			});
		} else {
			await new Promise<void>((resolve) => {
				const done = () => {
					window.removeEventListener("afterprint", done);
					resolve();
				};
				window.addEventListener("afterprint", done);
				window.print();
				// Some webviews return from print() without ever firing afterprint.
				window.setTimeout(done, 60_000);
			});
		}
		root.replaceChildren();
	} finally {
		printing = false;
	}
}
