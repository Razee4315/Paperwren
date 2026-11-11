/**
 * Side by side (a desktop's wide window): two documents at once, one in
 * each half. Each viewer learns from PaneContext which half it fills;
 * the one the reader worked in last has the keyboard (its `active`), the
 * other is shown but hears no keys. SideBySide carries what the window
 * can do about it, for the file menu.
 */
import { createContext } from "react";
import type { Tab } from "../TabStrip";

export interface Pane {
	/** Shown: alone, or in a half beside another document. */
	visible: boolean;
	/** The half it fills, or null alone. */
	side: "left" | "right" | null;
	/** Where the halves meet, as a share of the window's width. */
	ratio: number;
	/** Too narrow a half for every button in its bar. */
	narrow: boolean;
	/** The reader turned to this half: it takes the keyboard. */
	onFocus?: () => void;
}

export const PaneContext = createContext<Pane | null>(null);

export interface SideBySide {
	/** Two documents are shown now. */
	on: boolean;
	/** The window is wide enough for two. */
	room: boolean;
	/** Other open documents, to show beside this one. */
	others: Tab[];
	/** Show `tab` beside the document on show. */
	beside: (tab: Tab) => void;
	/** Pick a file to open beside the document on show. */
	pickBeside: () => void;
	/** The halves change places. */
	swap: () => void;
	/** Back to one document at a time. */
	leave: () => void;
}

export const SideBySideContext = createContext<SideBySide | null>(null);

/** Where the halves may meet: each half at least this wide, in pixels. */
export const MIN_HALF = 380;
/** The narrowest window that shows two documents. */
export const SPLIT_ROOM = "(min-width: 900px)";

/** `ratio` kept so each half is at least MIN_HALF of `width`. */
export function clampRatio(ratio: number, width: number): number {
	if (width <= MIN_HALF * 2) return 0.5;
	const least = MIN_HALF / width;
	return Math.min(1 - least, Math.max(least, ratio));
}
