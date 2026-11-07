import { isMac } from "@/lib/env";
import { msg, t } from "@/lib/i18n";
import { FULLSCREEN_KEYS, keys } from "@/lib/keys";
import s from "./Settings.module.css";

type Shortcut = [keys: string, what: string, mac?: string];

/** Every shortcut, by what it is for, and on a Mac what its keyboard
 * has instead. */
const GROUPS: Array<[title: string, shortcuts: Shortcut[]]> = [
	[
		msg("Documents"),
		[
			["Ctrl+O", msg("Open a file")],
			["Ctrl+W", msg("Close the document")],
			["Ctrl+Tab · Ctrl+Shift+Tab", msg("The next and the previous tab")],
			["Ctrl+P", msg("Print")],
			["F · F11", msg("Full screen"), `F · ${FULLSCREEN_KEYS}`],
			["?", msg("Show this list")],
		],
	],
	[
		msg("Moving around"),
		[
			[
				"← · →",
				msg("The previous and the next page or slide"),
				"← · → · ⌘[ · ⌘]",
			],
			["Space · Page Up · Page Down", msg("Scroll a screen at a time")],
			["Home · End", msg("The start and the end of the document"), "⌘↑ · ⌘↓"],
			["G", msg("Go to page")],
			["Ctrl+F", msg("Find in the document")],
			["F3 · Shift+F3", msg("Next and previous match"), "⌘G · ⇧⌘G"],
			["Ctrl + · Ctrl - · Ctrl 0", msg("Zoom in, zoom out, back to the fit")],
			["Alt+←", msg("Back")],
		],
	],
	[
		msg("Reading and marking"),
		[
			["H · N", msg("Highlight the selected words, or add a note to them")],
			["D · T", msg("Draw on a PDF, or add text to it")],
			["Ctrl+Z · Ctrl+Y", msg("Undo and redo a mark")],
			["Delete", msg("Remove the mark you tapped")],
			["R · 2", msg("Rotate the pages, or show two side by side")],
			["Ctrl+] · Ctrl+[", msg("Rotate the pages of a PDF"), "⌘R · ⌘L"],
			["Ctrl+D", msg("Bookmark this place")],
			["Ctrl+Shift+U", msg("Read aloud")],
		],
	],
	[
		msg("Slides and sheets"),
		[
			["F5", msg("Start a slide show")],
			["P", msg("Presenter view, in a slide show")],
			["L", msg("Laser pointer, in a slide show")],
			["Ctrl+Page Up · Ctrl+Page Down", msg("The previous and the next sheet")],
		],
	],
];

export function ShortcutList() {
	return (
		<div className={s.keyGroups} data-testid="shortcuts">
			{GROUPS.map(([title, shortcuts]) => (
				<section key={title}>
					<h3 className={s.keyGroup}>{t(title)}</h3>
					<dl className={s.keys}>
						{shortcuts.map(([combo, what, mac]) => (
							<div key={combo}>
								<dt dir="ltr">{(isMac && mac) || keys(combo)}</dt>
								<dd>{t(what)}</dd>
							</div>
						))}
					</dl>
				</section>
			))}
		</div>
	);
}
