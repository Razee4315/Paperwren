import { isDesktop, isTauri } from "./env";

/**
 * While held, closing the app's window (its X, Alt+F4, the taskbar)
 * asks first: `ask` is handed the close, to run on Discard.
 *
 * Held only while there is work to lose. A listener for the window's
 * close request keeps the window open until the page lets it go, so
 * with nothing to lose there is none, and a window closes as it always
 * has. A phone has no window to close; a browser tab is left alone.
 */
export function holdWindow(ask: (close: () => void) => void): () => void {
	if (!isTauri || !isDesktop) return () => {};
	let gone = false;
	let stop: (() => void) | null = null;
	import("@tauri-apps/api/window")
		.then(({ getCurrentWindow }) => {
			if (gone) return;
			const win = getCurrentWindow();
			return win
				.onCloseRequested((event) => {
					event.preventDefault();
					ask(() => {
						void win.destroy().catch(() => {});
					});
				})
				.then((unlisten) => {
					if (gone) unlisten();
					else stop = unlisten;
				});
		})
		.catch(() => {});
	return () => {
		gone = true;
		stop?.();
	};
}
