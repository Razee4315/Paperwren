/**
 * How a shortcut is written for the reader.
 *
 * The code names every shortcut the Windows way ("Ctrl+O"). A Mac shows
 * the same keys as its own keyboard prints them ("⌘O"): the handlers
 * take Ctrl and ⌘ alike, so only the writing differs.
 */

import { isMac } from "./env";

/** A shortcut, or a sentence that names one, as this machine writes it. */
export function keys(text: string): string {
	if (!isMac) return text;
	return text
		.replace(/Ctrl[+ ]/g, "⌘")
		.replace(/Shift\+/g, "⇧")
		.replace(/Alt\+/g, "⌥");
}

/** Full screen: F11 on Windows; on a Mac, where F11 shows the desktop,
 * ⌃⌘F as in every Mac app. */
export const FULLSCREEN_KEYS = isMac ? "⌃⌘F" : "F11";

export function isFullscreenKey(e: KeyboardEvent): boolean {
	if (e.key === "F11") return true;
	return isMac && e.ctrlKey && e.metaKey && e.key.toLowerCase() === "f";
}
