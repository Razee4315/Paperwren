/**
 * The desktop window opens where, and as large as, it was left.
 *
 * The shell puts the window back before it is shown
 * (src-tauri/src/placement.rs); the page keeps the place saved as the
 * window moves. The saved place is only used when it is still on a
 * screen (a monitor may have been unplugged since).
 */

import { backend } from "./backend";
import { isDesktop, isTauri } from "./env";
import { fullscreenChanging } from "./fullscreen";

const KEY = "window";
const SAVE_MS = 500;
/** How much of the window must be on a screen to count as reachable. */
const GRIP = 80;

export interface WindowPlace {
	/** Physical pixels, as the window system reports them. */
	x: number;
	y: number;
	w: number;
	h: number;
	maximized: boolean;
}

export interface Screen {
	x: number;
	y: number;
	w: number;
	h: number;
}

export function normalizePlace(value: unknown): WindowPlace | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const n = (v: unknown) =>
		typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
	const [x, y, w, h] = [n(raw.x), n(raw.y), n(raw.w), n(raw.h)];
	if (x === null || y === null || w === null || h === null) return null;
	if (w < 200 || h < 200) return null;
	return { x, y, w, h, maximized: raw.maximized === true };
}

/** True when enough of the title bar is on one of the screens to grab.
 * The shell applies the same rule (`reachable` in placement.rs). */
export function reachable(place: WindowPlace, screens: Screen[]): boolean {
	return screens.some(
		(s) =>
			place.x + place.w - GRIP > s.x &&
			place.x + GRIP < s.x + s.w &&
			place.y >= s.y - 8 &&
			place.y + GRIP / 2 < s.y + s.h,
	);
}

/** Keep the window's place saved as it changes. */
export async function watchWindow(): Promise<void> {
	if (!isTauri || !isDesktop) return;
	const api = await import("@tauri-apps/api/window");
	const win = api.getCurrentWindow();
	const read = async (): Promise<WindowPlace> => {
		const [size, at] = await Promise.all([
			win.innerSize(),
			win.outerPosition(),
		]);
		return {
			x: at.x,
			y: at.y,
			w: size.width,
			h: size.height,
			maximized: false,
		};
	};
	let last = normalizePlace(await backend.storeGet(KEY).catch(() => null));
	// The size to go back to when a maximised window is restored: the
	// one it last had while it was not maximised (a window the shell
	// opened maximised cannot be asked for it).
	let normal: WindowPlace = last ? { ...last, maximized: false } : await read();

	let timer = 0;
	const save = () => {
		window.clearTimeout(timer);
		timer = window.setTimeout(async () => {
			try {
				// Neither a minimised nor a full-screen window has a size worth
				// coming back to.
				if (
					fullscreenChanging() ||
					(await win.isMinimized()) ||
					(await win.isFullscreen())
				)
					return;
				const maximized = await win.isMaximized();
				if (!maximized) normal = await read();
				const next = { ...normal, maximized };
				if (JSON.stringify(next) === JSON.stringify(last)) return;
				last = next;
				await backend.storeSet(KEY, next);
			} catch {
				// A window on its way out: nothing to save.
			}
		}, SAVE_MS);
	};
	await win.onResized(save);
	await win.onMoved(save);
}
