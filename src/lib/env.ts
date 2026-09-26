declare global {
	interface Window {
		__TAURI_INTERNALS__?: unknown;
	}
}

export const isTauri =
	typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Touch-first device (phones, tablets) or the ?touch dev override. */
export const isTouch: boolean = (() => {
	if (typeof window === "undefined") return false;
	const params = new URLSearchParams(window.location.search);
	if (params.has("touch")) return true;
	try {
		return (
			window.matchMedia?.("(pointer: coarse)").matches ||
			/Android|iPhone|iPad/i.test(navigator.userAgent)
		);
	} catch {
		return false;
	}
})();
