import { isDesktop, isTauri } from "./env";

// App handlers bubble through document first, even when a viewer mounts
// later. Keep this one window listener outside React's effect lifecycle.
if (isTauri && isDesktop) {
	window.addEventListener("keydown", (event) => {
		if (event.defaultPrevented || event.altKey) return;
		const key = event.key.toLowerCase();
		const mod = event.ctrlKey || event.metaKey;
		const reload = key === "f5" || (mod && key === "r");
		const target = event.target as HTMLElement | null;
		const typing =
			target?.isContentEditable || target?.closest?.("input, textarea, select");
		if (typing && !reload) return;
		if (
			reload ||
			(!mod && (key === "f3" || key === "f7")) ||
			(mod && !event.shiftKey && ["p", "s", "u", "f", "g"].includes(key)) ||
			(mod && event.shiftKey && key === "g") ||
			(import.meta.env.PROD &&
				mod &&
				event.shiftKey &&
				["i", "j", "c"].includes(key))
		) {
			event.preventDefault();
		}
	});
}
