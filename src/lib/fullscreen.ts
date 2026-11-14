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
 *
 * Asked of the window from the app (F11, the button, the menu, Escape,
 * the slide show), the change is made under a veil: data-fs-veil while
 * the document is covered, data-fs-bars while the bars are faded. The
 * browser tests stand in for the window with window.__paperwrenWindow.
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
		try {
			await win.setFullscreen(true);
		} catch (error) {
			// Turned down: the window goes back to how it was.
			if (wasMaximized) {
				wasMaximized = false;
				await win.maximize();
			}
			throw error;
		}
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

/** What the app asks of its window: full screen, and word of a resize. */
export interface AppWindow extends FullscreenWindow {
	onResized(then: () => void): Promise<() => void>;
}

declare global {
	interface Window {
		/** The browser tests' stand-in for the desktop app's window. */
		__paperwrenWindow?: AppWindow;
	}
}
const standIn =
	typeof window === "undefined" ? undefined : window.__paperwrenWindow;

/** Full screen is the window's (the desktop app), not the page's. */
export const ofWindow = isDesktop && (isTauri || !!standIn);
let windowFull = false;
/** The slide show asked for it, and leaves it when it ends. */
let held = false;

let control: ReturnType<typeof windowFullscreen> | null = null;
const appWindow = (): Promise<AppWindow> =>
	standIn
		? Promise.resolve(standIn)
		: import("@tauri-apps/api/window").then((api) => api.getCurrentWindow());
const windowControl = async () => {
	control ??= windowFullscreen(await appWindow(), {
		restoreMaximized: ownsFrame,
	});
	return control;
};

/**
 * Resolves once `read` has given the same answer `frames` frames running,
 * or after `max` milliseconds. While it still gives `from` (the size
 * before the change, which the window may not have begun yet) it waits
 * three times as long.
 */
export function untilSteady(
	read: () => string,
	{
		from,
		frames = 2,
		max = 400,
		frame = (then: () => void) => requestAnimationFrame(then),
		now = () => performance.now(),
	}: {
		from?: string;
		frames?: number;
		max?: number;
		frame?: (then: () => void) => void;
		now?: () => number;
	} = {},
): Promise<void> {
	return new Promise((done) => {
		const start = now();
		let last = read();
		let same = 0;
		const tick = () => {
			const size = read();
			same = size === last ? same + 1 : 0;
			last = size;
			const need = size === from ? frames * 3 : frames;
			if (same >= need || now() - start >= max) done();
			else frame(tick);
		};
		frame(tick);
	});
}

// Going into full screen or out of it: the document fades to its canvas
// (the veil, Shell.module.css), the window changes, and once its size
// has held the viewers fit it once and the veil lifts. A frameless
// window on Windows passes through a size of its own on the way (it is
// restored before it goes full screen), which nobody should see the
// pages fitted to.
const VEIL_IN = 80;
const SETTLE_MAX = 400;
/** A window that has not answered by then is not waited for. */
const ANSWER_MAX = 2000;

let changes = 0;
let line: Promise<void> = Promise.resolve();
const waiting = new Set<() => void>();

/** Whether the window is between states because of full screen. */
export const fullscreenChanging = () => changes > 0;

/**
 * A viewer's fit to its room, for a ResizeObserver: done at once, or,
 * while full screen is changing the window, once when it has settled.
 */
export function fitWhenSettled(fit: () => void) {
	return {
		run: () => {
			if (changes > 0) waiting.add(fit);
			else fit();
		},
		stop: () => {
			waiting.delete(fit);
		},
	};
}

const still = () =>
	!!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) =>
	new Promise<void>((done) => window.setTimeout(done, ms));
/** `work`, or `ms` milliseconds, whichever ends first. */
const within = (work: Promise<unknown>, ms: number) =>
	Promise.race([work.catch(() => {}), wait(ms)]);
const windowSize = () => `${window.innerWidth}x${window.innerHeight}`;
const twoFrames = () =>
	new Promise<void>((done) =>
		requestAnimationFrame(() => requestAnimationFrame(() => done())),
	);

/** One change of the window's full screen, under the veil. */
function change(step: (c: ReturnType<typeof windowFullscreen>) => unknown) {
	changes++;
	const root = document.documentElement;
	const turn = async () => {
		const from = windowSize();
		// The bars fade with the document, while they are still in the
		// layout. A bar brought out to press its button stays.
		if (!windowFull || root.dataset.reveal === undefined)
			root.dataset.fsBars = "";
		if (root.dataset.fsVeil === undefined) {
			root.dataset.fsVeil = "";
			if (!still()) await wait(VEIL_IN);
		}
		try {
			await within(
				windowControl().then((c) => step(c)),
				ANSWER_MAX,
			);
		} finally {
			// Refused, failed or done: the page follows the window as it is.
			await within(Promise.resolve().then(syncNow), SETTLE_MAX);
			await within(untilSteady(windowSize, { from }), SETTLE_MAX);
			changes--;
			if (changes === 0) {
				const fits = [...waiting];
				waiting.clear();
				for (const fit of fits) {
					try {
						fit();
					} catch {
						// One viewer's fit does not hold up the others'.
					}
				}
				// The fits laid out and their pages started, then the veil
				// lifts and the bars come back.
				await within(twoFrames(), 100);
			}
			if (changes === 0) {
				delete root.dataset.fsVeil;
				delete root.dataset.fsBars;
			}
		}
	};
	line = line.then(turn, turn);
	return line;
}

export function inFullscreen(): boolean {
	return windowFull || document.fullscreenElement === document.documentElement;
}

export function toggleFullscreen() {
	if (ofWindow) {
		held = false;
		change((c) => c.toggle());
	} else if (document.fullscreenElement)
		document.exitFullscreen?.().catch(() => {});
	else document.documentElement.requestFullscreen?.().catch(() => {});
}

/** Leave full screen if it is on. */
export function leaveFullscreen() {
	if (!inFullscreen()) return;
	if (ofWindow) {
		held = false;
		change((c) => c.leave());
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
	change((c) => c.enter());
	return () => {
		if (!held) return;
		held = false;
		change((c) => c.leave());
	};
}

let syncNow: () => unknown = () => {};

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
		delete root.dataset.fsVeil;
		delete root.dataset.fsBars;
	};
}
