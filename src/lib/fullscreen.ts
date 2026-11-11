/**
 * Full screen for reading (F11; ⌃⌘F on a Mac), as a desktop reader has
 * it.
 *
 * In the desktop app it is the window's full screen. On a Mac the green
 * button and the View menu ask for the same one, and the app follows
 * the window. On Windows the window has no frame of its own, and a
 * frameless window that is maximised keeps the screen minus the taskbar
 * when it goes full screen (a strip shows where the taskbar is), so it
 * is restored first and maximised again after. Being the window's, not
 * the page's, Escape reaches the app: it leaves full screen only when
 * no dialog is open (the dialog takes it first). In a browser the
 * page's own full screen is used.
 *
 * While it is on, <html> carries data-fullscreen ("page" for reading,
 * "part" when the slide show asked for it), which is what hides the
 * top bar and the window's buttons. Moving the pointer to the top edge
 * brings the bar back for as long as it stays near it.
 */

import { isDesktop, isTauri, ownsFrame } from "./env";

const REVEAL_AT = 2;
const HIDE_PAST = 140;

/** What full screen needs of the app's window. */
export interface FullscreenWindow {
	isFullscreen(): Promise<boolean>;
	setFullscreen(on: boolean): Promise<void>;
	isMaximized(): Promise<boolean>;
	maximize(): Promise<void>;
	unmaximize(): Promise<void>;
}

/**
 * Full screen of a window, one change at a time. With `restoreMaximized`
 * (Windows) a maximised window is restored before it goes full screen
 * and maximised again when it leaves.
 */
export function windowFullscreen(
	win: FullscreenWindow,
	{ restoreMaximized }: { restoreMaximized: boolean },
) {
	let wasMaximized = false;
	let busy = false;
	let queue: Promise<void> = Promise.resolve();
	const run = (step: () => Promise<void>) => {
		queue = queue
			.then(async () => {
				busy = true;
				try {
					await step();
				} finally {
					busy = false;
				}
			})
			.catch(() => {});
		return queue;
	};
	const enter = async () => {
		if (await win.isFullscreen()) return;
		wasMaximized = restoreMaximized && (await win.isMaximized());
		if (wasMaximized) await win.unmaximize();
		await win.setFullscreen(true);
	};
	const leave = async () => {
		if (await win.isFullscreen()) await win.setFullscreen(false);
		if (wasMaximized) {
			wasMaximized = false;
			await win.maximize();
		}
	};
	return {
		enter: () => run(enter),
		leave: () => run(leave),
		toggle: () =>
			run(async () => ((await win.isFullscreen()) ? leave() : enter())),
		/** Between asking and the window settling: its size then is not
		 * one to keep. */
		busy: () => busy,
	};
}

/** Full screen is the window's (the desktop app), not the page's. */
export const ofWindow = isTauri && isDesktop;
let windowFull = false;
/** The slide show asked for it, and leaves it when it ends. */
let held = false;

let control: ReturnType<typeof windowFullscreen> | null = null;
const appWindow = () =>
	import("@tauri-apps/api/window").then((api) => api.getCurrentWindow());
const windowControl = async () => {
	control ??= windowFullscreen(await appWindow(), {
		restoreMaximized: ownsFrame,
	});
	return control;
};

/** Whether the window is between states because of full screen. */
export const fullscreenChanging = () => control?.busy() ?? false;

export function inFullscreen(): boolean {
	return windowFull || document.fullscreenElement === document.documentElement;
}

export function toggleFullscreen() {
	if (ofWindow) {
		held = false;
		windowControl()
			.then((c) => c.toggle())
			.then(syncNow);
	} else if (document.fullscreenElement)
		document.exitFullscreen?.().catch(() => {});
	else document.documentElement.requestFullscreen?.().catch(() => {});
}

/** Leave full screen if it is on. */
export function leaveFullscreen() {
	if (!inFullscreen()) return;
	if (ofWindow) {
		held = false;
		windowControl()
			.then((c) => c.leave())
			.then(syncNow);
	} else document.exitFullscreen?.().catch(() => {});
}

/**
 * The window full screen while the slide show runs (desktop app only).
 * Returns what ends it: full screen is left again unless the reader was
 * already in it.
 */
export function holdFullscreen(): () => void {
	if (!ofWindow || windowFull) return () => {};
	held = true;
	syncNow();
	windowControl()
		.then((c) => c.enter())
		.then(syncNow);
	return () => {
		if (!held) return;
		held = false;
		windowControl()
			.then((c) => c.leave())
			.then(syncNow);
	};
}

let syncNow = () => {};

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
		if (!el && !windowFull && !held) {
			delete root.dataset.fullscreen;
			return;
		}
		const page = held ? false : !el || el === root;
		root.dataset.fullscreen = page ? "page" : "part";
		if (page) window.addEventListener("mousemove", onMove);
	};
	document.addEventListener("fullscreenchange", sync);
	sync();

	// Escape leaves the window's full screen, once nothing else wants it:
	// a dialog takes it first, and so does whatever handles it later on
	// its way (the find bar closes), which is known once it has been
	// handed round.
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape" || !windowFull || held) return;
		if (document.querySelector('[aria-modal="true"]')) return;
		window.setTimeout(() => {
			if (!e.defaultPrevented) leaveFullscreen();
		});
	};

	// The window goes full screen and back by ways the page never hears
	// of (the green button, the menu, a swipe), each of which resizes it.
	let alive = true;
	let stop = () => {};
	if (ofWindow) {
		window.addEventListener("keydown", onKey);
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
				syncNow = follow;
				follow();
				return win.onResized(follow);
			})
			.then((unlisten) => {
				if (alive) stop = unlisten;
				else unlisten();
			})
			.catch(() => {});
	}

	return () => {
		alive = false;
		stop();
		syncNow = () => {};
		windowFull = false;
		document.removeEventListener("fullscreenchange", sync);
		window.removeEventListener("keydown", onKey);
		window.removeEventListener("mousemove", onMove);
		delete root.dataset.fullscreen;
		delete root.dataset.reveal;
	};
}
