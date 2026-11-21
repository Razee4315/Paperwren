/**
 * The window's own background on Windows, in step with the theme.
 *
 * While the window changes size (full screen, maximise, a drag of its
 * edge) the web view can be a frame or two behind it, and what it has
 * not painted yet shows the window underneath. That is left unpainted
 * unless the window has a colour of its own, so it is given the app's
 * canvas (--canvas, what the veil and the viewers show). macOS and Linux
 * keep the system's frame and are left as they are.
 */

import { isTauri, ownsFrame } from "./env";
import type { ResolvedTheme } from "./types";

/** Canvas colour (`--canvas` in global.css) for each theme, so changing
 * themes does not force a full-document `getComputedStyle` recalculation. */
const CANVAS_RGB: Record<ResolvedTheme, [number, number, number]> = {
	light: [0xe7, 0xe4, 0xdd],
	sepia: [0xe0, 0xd3, 0xba],
	dark: [0x11, 0x13, 0x15],
	"plain-light": [0xec, 0xec, 0xee],
	"plain-dark": [0x0a, 0x0a, 0x0b],
};

let windowApi: Promise<typeof import("@tauri-apps/api/window")> | null = null;
let lastColor = "";

/** A CSS colour as red, green and blue (0 to 255), or null when it is
 * not a plain hex or rgb() colour. */
export function cssColorRgb(value: string): [number, number, number] | null {
	const text = value.trim().toLowerCase();
	const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
	if (hex) {
		const short = hex.length <= 4;
		const at = (i: number) =>
			short
				? Number.parseInt(hex[i] + hex[i], 16)
				: Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		return [at(0), at(1), at(2)];
	}
	const rgb =
		/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(
			text,
		);
	if (!rgb) return null;
	const parts = rgb.slice(1, 4).map(Number);
	if (parts.some((n) => !Number.isFinite(n) || n > 255)) return null;
	return parts.map(Math.round) as [number, number, number];
}

/** Give the window the canvas colour of the theme now applied to the
 * page. Nothing happens outside the Windows app, or if the colour cannot
 * be read or set. */
export function paintWindowBackground(theme?: ResolvedTheme) {
	if (!isTauri || !ownsFrame) return;
	const color =
		(theme && CANVAS_RGB[theme]) ||
		cssColorRgb(
			getComputedStyle(document.documentElement).getPropertyValue("--canvas"),
		);
	if (!color) return;
	const key = `${color[0]},${color[1]},${color[2]}`;
	if (key === lastColor) return;
	lastColor = key;
	windowApi ??= import("@tauri-apps/api/window");
	windowApi
		.then((api) => api.getCurrentWindow().setBackgroundColor(color))
		.catch(() => {
			lastColor = "";
		});
}
