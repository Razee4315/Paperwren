/**
 * The keyboard shortcuts a reader can change (Settings, Keyboard).
 *
 * Every handler asks `matches(event, "nextPage")` instead of naming its
 * keys, so a change made in Settings applies everywhere at once. Keys
 * are written the Windows way ("Ctrl+]"); on a Mac, Ctrl stands for ⌘
 * (the handlers take either), as everywhere else in the app.
 *
 * A few keys are not the reader's to change: the ones that scroll, type,
 * undo, close a dialog or move between tabs (`FIXED`). Those are listed
 * in Settings beside the others, without a way to change them.
 */

import { isMac } from "./env";
import { msg } from "./i18n";
import { FULLSCREEN_KEYS, keys as written } from "./keys";

export type ShortcutId =
	| "open"
	| "close"
	| "print"
	| "fullscreen"
	| "keys"
	| "nextPage"
	| "prevPage"
	| "goToPage"
	| "find"
	| "zoomIn"
	| "zoomOut"
	| "zoomReset"
	| "highlight"
	| "note"
	| "draw"
	| "addText"
	| "rotate"
	| "rotateLeft"
	| "twoPages"
	| "bookmark"
	| "readAloud"
	| "slideShow"
	| "presenter"
	| "laser";

/** What a shortcut does, untranslated (pass it to `t`), and its keys. */
export interface ShortcutDef {
	what: string;
	keys: string[];
	/** A Mac's keys, where they differ. */
	mac?: string[];
}

export const SHORTCUTS: Record<ShortcutId, ShortcutDef> = {
	open: { what: msg("Open a file"), keys: ["Ctrl+O"] },
	close: { what: msg("Close the document"), keys: ["Ctrl+W"] },
	print: { what: msg("Print"), keys: ["Ctrl+P"] },
	fullscreen: { what: msg("Full screen"), keys: ["F"] },
	keys: { what: msg("Show this list"), keys: ["?"] },
	nextPage: {
		what: msg("Next page"),
		keys: ["ArrowRight"],
		// ⌘] is a Mac's forward: a trackpad's swipe often sends it.
		mac: ["ArrowRight", "Ctrl+]"],
	},
	prevPage: {
		what: msg("Previous page"),
		keys: ["ArrowLeft"],
		mac: ["ArrowLeft", "Ctrl+["],
	},
	goToPage: { what: msg("Go to page"), keys: ["G"] },
	find: { what: msg("Find in the document"), keys: ["Ctrl+F"] },
	zoomIn: { what: msg("Zoom in"), keys: ["Ctrl+=", "Ctrl++"] },
	zoomOut: { what: msg("Zoom out"), keys: ["Ctrl+-", "Ctrl+_"] },
	zoomReset: { what: msg("Back to the fit"), keys: ["Ctrl+0"] },
	highlight: { what: msg("Highlight the selected words"), keys: ["H"] },
	note: { what: msg("Add a note to the selected words"), keys: ["N"] },
	draw: { what: msg("Draw on a PDF"), keys: ["D"] },
	addText: { what: msg("Add text to a PDF"), keys: ["T"] },
	// Ctrl+] and Ctrl+[ as in Edge and Chrome; ⌘R and ⌘L as in Preview.
	rotate: { what: msg("Rotate"), keys: ["R", "Ctrl+]"], mac: ["R", "Ctrl+R"] },
	rotateLeft: {
		what: msg("Rotate left"),
		keys: ["Shift+R", "Ctrl+["],
		mac: ["Shift+R", "Ctrl+L"],
	},
	twoPages: { what: msg("Two pages side by side"), keys: ["2"] },
	bookmark: { what: msg("Bookmark this place"), keys: ["Ctrl+D"] },
	readAloud: { what: msg("Read aloud"), keys: ["Ctrl+Shift+U"] },
	slideShow: { what: msg("Start a slide show"), keys: ["F5"] },
	presenter: { what: msg("Presenter view, in a slide show"), keys: ["P"] },
	laser: { what: msg("Laser pointer, in a slide show"), keys: ["L"] },
};

/** Keys that stay as they are, and what they do. `label` is how they
 * are printed where the keys can't be written as one combination. */
export const FIXED = {
	scroll: {
		keys: ["Space", "PageUp", "PageDown"],
		what: msg("Scroll a screen at a time"),
	},
	ends: {
		keys: ["Home", "End"],
		mac: ["Ctrl+ArrowUp", "Ctrl+ArrowDown"],
		what: msg("The start and the end of the document"),
	},
	findNext: {
		keys: ["F3", "Shift+F3"],
		mac: ["Ctrl+G", "Ctrl+Shift+G"],
		what: msg("Next and previous match"),
	},
	back: { keys: ["Alt+ArrowLeft"], what: msg("Back") },
	undo: { keys: ["Ctrl+Z", "Ctrl+Y"], what: msg("Undo and redo a mark") },
	remove: { keys: ["Delete"], what: msg("Remove the mark you tapped") },
	tabs: {
		keys: ["Ctrl+Tab", "Ctrl+Shift+Tab"],
		what: msg("The next and the previous tab"),
	},
	sheets: {
		keys: ["Ctrl+PageUp", "Ctrl+PageDown"],
		what: msg("The previous and the next sheet"),
	},
	fullscreenKey: {
		keys: ["F11"],
		label: FULLSCREEN_KEYS,
		what: msg("Full screen"),
	},
} satisfies Record<
	string,
	{ keys: string[]; what: string; mac?: string[]; label?: string }
>;
export type FixedId = keyof typeof FIXED;

/** How fixed keys are printed on this machine. */
export function fixedLabel(id: FixedId): string {
	const row: { keys: string[]; mac?: string[]; label?: string } = FIXED[id];
	if (row.label) return row.label;
	return ((isMac && row.mac) || row.keys).map(shortcutLabel).join(" · ");
}

/** Keys no shortcut may take: they type, scroll, close or undo. */
const RESERVED = new Set([
	"Escape",
	"Tab",
	"Shift+Tab",
	"Enter",
	"Space",
	"Backspace",
	"Delete",
	"ArrowUp",
	"ArrowDown",
	"PageUp",
	"PageDown",
	"Home",
	"End",
	"F3",
	"Shift+F3",
	"F11",
	"Alt+ArrowLeft",
	"Alt+ArrowRight",
	"Ctrl+A",
	"Ctrl+C",
	"Ctrl+V",
	"Ctrl+X",
	"Ctrl+Z",
	"Ctrl+Y",
	"Ctrl+Shift+Z",
	"Ctrl+Tab",
	"Ctrl+Shift+Tab",
	"Ctrl+PageUp",
	"Ctrl+PageDown",
	"Ctrl+ArrowUp",
	"Ctrl+ArrowDown",
	"Ctrl+Home",
	"Ctrl+End",
	...Array.from({ length: 9 }, (_, i) => `Ctrl+${i + 1}`),
]);

/** Pressing these alone is not a shortcut yet. */
const MODIFIERS = new Set([
	"Shift",
	"Control",
	"Alt",
	"AltGraph",
	"Meta",
	"OS",
	"Fn",
	"CapsLock",
]);

/**
 * A key press as a shortcut is written: "Ctrl+Shift+U", "R", "Ctrl+]",
 * "ArrowRight". Letters and digits by their place on the keyboard, so
 * they work whatever its language; a symbol as it is typed, which
 * already says whether Shift was down ("?"). Null for a modifier alone.
 */
export function comboOf(
	e: Pick<
		KeyboardEvent,
		"key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
	>,
): string | null {
	if (!e.key || MODIFIERS.has(e.key)) return null;
	let key: string;
	if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
	else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
	else if (e.key === " ") key = "Space";
	else if (e.key.length === 1) key = e.key.toUpperCase();
	else key = e.key;
	const symbol = key.length === 1 && !/[A-Z0-9]/.test(key);
	return [
		(e.ctrlKey || e.metaKey) && "Ctrl",
		e.altKey && "Alt",
		e.shiftKey && !symbol && "Shift",
		key,
	]
		.filter(Boolean)
		.join("+");
}

type Custom = Partial<Record<ShortcutId, string[]>>;
let custom: Custom = {};

/** The reader's own keys (from Settings); called by the settings state. */
export function setCustomShortcuts(next: Custom | undefined) {
	custom = next ?? {};
}

/** The keys a shortcut has on this machine, by default. */
export const defaultKeys = (id: ShortcutId): string[] =>
	(isMac && SHORTCUTS[id].mac) || SHORTCUTS[id].keys;

/** The keys a shortcut has now: the reader's, or its own. */
export const keysFor = (id: ShortcutId, from: Custom = custom): string[] =>
	from[id] ?? defaultKeys(id);

/** Whether a key press goes to a field being typed in. */
function typing(e: KeyboardEvent): boolean {
	const at = e.target as Element | null;
	return !!at?.closest?.(
		"input, textarea, select, [contenteditable]:not([contenteditable='false'])",
	);
}

/** Whether this key press is that shortcut. A key with neither Ctrl nor
 * Alt (a letter, an arrow) is the field's while one is typed in. */
export function matches(e: KeyboardEvent, id: ShortcutId): boolean {
	const combo = comboOf(e);
	if (!combo || !keysFor(id).includes(combo)) return false;
	const plain = !/^(Ctrl|Alt)\+/.test(combo) && !/^F\d+$/.test(combo);
	return !(plain && typing(e));
}

/** Which shortcut has these keys now, other than `except`. */
export function whoHas(
	combo: string,
	from: Custom,
	except?: ShortcutId,
): ShortcutId | null {
	for (const id of Object.keys(SHORTCUTS) as ShortcutId[])
		if (id !== except && keysFor(id, from).includes(combo)) return id;
	return null;
}

/** Whether these keys are kept for typing, scrolling or closing. */
export const isReserved = (combo: string) => RESERVED.has(combo);

/** Keys as this machine prints them: "⌘]" on a Mac, arrows as arrows. */
export function shortcutLabel(combo: string): string {
	const arrows: Record<string, string> = {
		ArrowLeft: "←",
		ArrowRight: "→",
		ArrowUp: "↑",
		ArrowDown: "↓",
		PageUp: "Page Up",
		PageDown: "Page Down",
	};
	const text = combo
		.split("+")
		.map((part, i, all) =>
			// "Ctrl++" splits into an empty last part: that is the plus key.
			part === "" && i === all.length - 1 ? "+" : (arrows[part] ?? part),
		)
		.filter((part, i, all) => part !== "" || i === all.length - 1)
		.join("+");
	return written(text);
}

/** The keys a menu or a tooltip names for a shortcut, as this machine
 * prints them: a Ctrl one where there is one ("Ctrl+F"), else the
 * first. Nothing for a shortcut the reader took every key from. */
export function hintFor(id: ShortcutId): string | undefined {
	const list = keysFor(id);
	const pick = list.find((k) => k.startsWith("Ctrl+")) ?? list[0];
	return pick ? shortcutLabel(pick) : undefined;
}

/** Check stored custom keys: known shortcuts, a few short combos each. */
export function normalizeShortcuts(value: unknown): Custom {
	if (!value || typeof value !== "object") return {};
	const out: Custom = {};
	for (const [id, list] of Object.entries(value as Record<string, unknown>)) {
		if (!(id in SHORTCUTS) || !Array.isArray(list)) continue;
		out[id as ShortcutId] = list
			.filter((k): k is string => typeof k === "string" && k.length < 40)
			.slice(0, 4);
	}
	return out;
}
