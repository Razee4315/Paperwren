import { msg, t } from "./i18n";
import type { Protection } from "./pdfTools";

/**
 * Every tool opens a protected PDF and saves a new file, and that file
 * has neither the password nor the limits. Nothing is locked again for
 * the reader: which password, and which limits, is theirs to choose, in
 * Add a password. So the screens say it, in these words, wherever a copy
 * of such a file is about to be saved.
 */
const NOTES: Record<Protection, string> = {
	password: msg(
		"The copy will open without a password. To lock it again, use Add a password.",
	),
	limits: msg(
		"This PDF limits what a reader may do, such as copying. The copy will have no limits.",
	),
};

/** What to tell the reader about a copy of a file with this protection,
 * or null when there is nothing to say. */
export function copyNote(protection?: Protection | null): string | null {
	return protection ? t(NOTES[protection]) : null;
}
