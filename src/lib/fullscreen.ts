/**
 * Full screen for reading (F11; ⌃⌘F on a Mac), as a desktop reader has
 * it.
 *
 * On Windows the page's own full screen is used: the shell follows it
 * and takes the whole window full screen, and Escape leaves it. On a
 * Mac it is the window's (the green button and the View menu ask for
 * the same one), and the app follows the window. While it is on, <html>
 * carries data-fullscreen ("page" for reading, "part" when one element
 * such as the slide show asked for it), which is what hides the top bar
 * and the window's buttons. Moving the pointer to the top edge brings
 * the bar back for as long as it stays near it.
 */

import { isTauri, sharesFrame } from "./env";

const REVEAL_AT = 2;
const HIDE_PAST = 140;

/** Full screen is the window's, not the page's (the Mac app). */
const ofWindow = isTauri && sharesFrame;
let windowFull = false;

const appWindow = () =>
	import("@tauri-apps/api/window").then((api) => api.getCurrentWindow());

export function inFullscreen(): boolean {
	return windowFull || document.fullscreenElement === document.documentElement;
}

export function toggleFullscreen() {
	if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
	else if (ofWindow)
		appWindow()
			.then((win) => win.setFullscreen(!windowFull))
			.catch(() => {});
	else document.documentElement.requestFullscreen?.().catch(() => {});
}

/** Keep <html> in step with the full-screen state. Returns a stop. */
export function watchFullscreen(): () => void {
	const root = document.documentElement;
	const onMove = (e: MouseEvent) => {
		if (e.clientY <= REVEAL_AT) root.dataset.reveal = "";
		else if (e.clientY > HIDE_PAST) delete root.dataset.reveal;
	};
	const sync = () => {
		const el = document.fullscreenElement;
		delete root.dataset.reveal;
		window.removeEventListener("mousemove", onMove);
		if (!el && !windowFull) {
			delete root.dataset.fullscreen;
			return;
		}
		const page = !el || el === root;
		root.dataset.fullscreen = page ? "page" : "part";
		if (page) window.addEventListener("mousemove", onMove);
	};
	document.addEventListener("fullscreenchange", sync);
	sync();

	// The window goes full screen and back by ways the page never hears
	// of (the green button, the menu, a swipe), each of which resizes it.
	let alive = true;
	let stop = () => {};
	if (ofWindow)
		appWindow()
			.then((win) => {
				const follow = () =>
					win
						.isFullscreen()
						.then((full) => {
							if (!alive || full === windowFull) return;
							windowFull = full;
							sync();
						})
						.catch(() => {});
				follow();
				return win.onResized(follow);
			})
			.then((unlisten) => {
				if (alive) stop = unlisten;
				else unlisten();
			})
			.catch(() => {});

	return () => {
		alive = false;
		stop();
		windowFull = false;
		document.removeEventListener("fullscreenchange", sync);
		window.removeEventListener("mousemove", onMove);
		delete root.dataset.fullscreen;
		delete root.dataset.reveal;
	};
}
