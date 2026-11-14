/**
 * Start-up timings for bug reports. With PAPERWREN_TRACE=1 in the
 * environment the desktop shell writes one line per milestone to stderr
 * (docs/development.md); this is how the web layer adds its own. The shell
 * does the timing, so every line comes from one clock. Anywhere else, and
 * with the trace off, a mark does nothing.
 */

import { isDesktop, isTauri } from "./env";

const here = isTauri && isDesktop;

async function core() {
	return import("@tauri-apps/api/core");
}

let asked: Promise<boolean> | undefined;
/** Whether the shell is tracing, asked of it once. */
function tracing(): Promise<boolean> {
	asked ??= here
		? core()
				.then(({ invoke }) => invoke<boolean>("trace_enabled"))
				.catch(() => false)
		: Promise.resolve(false);
	return asked;
}

const marked = new Set<string>();
// Milestones are sent one after the other, so they arrive in order.
let sending: Promise<unknown> = Promise.resolve();

/** Tell the shell a milestone was reached; each is told once. */
export function traceMark(name: string): void {
	if (!here || marked.has(name)) return;
	marked.add(name);
	sending = sending
		.then(async () => {
			if (!(await tracing())) return;
			const { invoke } = await core();
			await invoke("trace_mark", { name });
		})
		.catch(() => {});
}

/** The first page of a document drawn: pdf.js puts the page's canvas in
 * its wrapper when it has something to show. Watched only while tracing,
 * and until that first one. */
export function traceFirstPage(): void {
	if (!here || typeof MutationObserver === "undefined") return;
	tracing().then((on) => {
		if (!on) return;
		const watch = new MutationObserver((records) => {
			for (const record of records)
				for (const node of record.addedNodes) {
					if (
						node instanceof HTMLCanvasElement &&
						node.parentElement?.classList.contains("canvasWrapper")
					) {
						watch.disconnect();
						traceMark("first document page drawn");
						return;
					}
				}
		});
		watch.observe(document.documentElement, { childList: true, subtree: true });
	});
}
