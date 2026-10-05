/**
 * Full screen for reading (F11), as a desktop reader has it.
 *
 * The page's own full screen is used: on Windows the shell follows it
 * and takes the whole window full screen, and Escape leaves it. While
 * it is on, <html> carries data-fullscreen ("page" for reading, "part"
 * when one element such as the slide show asked for it), which is what
 * hides the top bar and the window's buttons. Moving the pointer to the
 * top edge brings the bar back for as long as it stays near it.
 */

const REVEAL_AT = 2;
const HIDE_PAST = 140;

export function inFullscreen(): boolean {
	return document.fullscreenElement === document.documentElement;
}

export function toggleFullscreen() {
	if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
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
		if (!el) {
			delete root.dataset.fullscreen;
			return;
		}
		root.dataset.fullscreen = el === root ? "page" : "part";
		if (el === root) window.addEventListener("mousemove", onMove);
	};
	document.addEventListener("fullscreenchange", sync);
	sync();
	return () => {
		document.removeEventListener("fullscreenchange", sync);
		window.removeEventListener("mousemove", onMove);
		delete root.dataset.fullscreen;
		delete root.dataset.reveal;
	};
}
