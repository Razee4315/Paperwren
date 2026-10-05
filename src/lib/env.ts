declare global {
	interface Window {
		__TAURI_INTERNALS__?: unknown;
	}
}

export const isTauri =
	typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const params =
	typeof window === "undefined"
		? new URLSearchParams()
		: new URLSearchParams(window.location.search);
const agent = typeof navigator === "undefined" ? "" : navigator.userAgent;
const isPhoneAgent = /Android|iPhone|iPad/i.test(agent);

/** Touch-first device (phones, tablets) or the ?touch dev override. */
export const isTouch: boolean = (() => {
	if (typeof window === "undefined") return false;
	if (params.has("touch")) return true;
	try {
		return window.matchMedia?.("(pointer: coarse)").matches || isPhoneAgent;
	} catch {
		return false;
	}
})();

/** The desktop app: one bar that holds the page and zoom controls,
 * menus that open at the pointer, a side panel. The ?desktop override
 * shows that layout in the dev server and the browser tests. */
export const isDesktop: boolean =
	typeof window !== "undefined" &&
	!params.has("touch") &&
	((isTauri && !isPhoneAgent) || params.has("desktop"));

/** The window has no frame of its own (tauri.windows.conf.json turns
 * the native one off), so the app draws the window buttons and its bar
 * is the title bar. ?frame shows them in the dev server. */
export const ownsFrame: boolean =
	typeof window !== "undefined" &&
	((isTauri && /Windows/i.test(agent) && !isPhoneAgent) ||
		(isDesktop && params.has("frame")));
