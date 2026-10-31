import { isMac } from "@/lib/env";
import { msg, t } from "@/lib/i18n";
import { FULLSCREEN_KEYS, keys } from "@/lib/keys";
import s from "./Settings.module.css";

/** Every shortcut, and on a Mac what its keyboard has instead. */
const SHORTCUTS: Array<[keys: string, what: string, mac?: string]> = [
	["Ctrl+O", msg("Open a file")],
	["Ctrl+W", msg("Close the document")],
	["Ctrl+F", msg("Find in the document")],
	["F3 · Shift+F3", msg("Next and previous match"), "⌘G · ⇧⌘G"],
	["Ctrl+P", msg("Print")],
	["Ctrl + · Ctrl - · Ctrl 0", msg("Zoom in, zoom out, back to the fit")],
	["F · F11", msg("Full screen"), `F · ${FULLSCREEN_KEYS}`],
	["Space · Page Up · Page Down", msg("Scroll a screen at a time")],
	["Home · End", msg("The start and the end of the document"), "⌘↑ · ⌘↓"],
	["← · →", msg("The previous and the next page or slide")],
	["H · N", msg("Highlight the selected words, or add a note to them")],
	["D · T", msg("Draw on a PDF, or add text to it")],
	["Ctrl+Z · Ctrl+Y", msg("Undo and redo a mark")],
	["Delete", msg("Remove the mark you tapped")],
	["R · 2", msg("Turn the pages, or show two side by side")],
	["F5", msg("Start a slide show")],
	["P", msg("Presenter view, in a slide show")],
	["L", msg("Laser pointer, in a slide show")],
	["Ctrl+D", msg("Bookmark this place")],
	["Ctrl+Shift+U", msg("Read aloud")],
	["Ctrl+Tab · Ctrl+Shift+Tab", msg("The next and the previous tab")],
	["Ctrl+] · Ctrl+[", msg("Turn the pages of a PDF")],
	["Ctrl+Page Up · Ctrl+Page Down", msg("The previous and the next sheet")],
	["Alt+←", msg("Back")],
	["?", msg("Show this list")],
];

export function ShortcutList() {
	return (
		<dl className={s.keys} data-testid="shortcuts">
			{SHORTCUTS.map(([combo, what, mac]) => (
				<div key={combo}>
					<dt dir="ltr">{(isMac && mac) || keys(combo)}</dt>
					<dd>{t(what)}</dd>
				</div>
			))}
		</dl>
	);
}
