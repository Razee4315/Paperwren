/**
 * One place decides what "in Tauri" means, and one place decides
 * what "should render mobile" means (docs and platform lessons:
 * three different facts, never conflate them).
 */

declare global {
	interface Window {
		__TAURI_INTERNALS__?: unknown;
	}
}

export const isTauriEnvironment =
	typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Mobile shell: touch device or the ?mobile=1 dev override. */
export const isMobileShell: boolean = (() => {
	if (typeof window === "undefined") return false;
	if (new URLSearchParams(window.location.search).has("mobile")) return true;
	if (new URLSearchParams(window.location.search).has("desktop")) return false;
	const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
	const touchUA = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
	return coarsePointer || touchUA;
})();

export function applyShellClass() {
	if (typeof document === "undefined") return;
	document.documentElement.classList.toggle("mobile", isMobileShell);
}
