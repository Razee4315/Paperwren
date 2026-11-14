/**
 * The files this window has open, so a copy the reader saves never goes
 * over one of them: the app's rule is that a tool saves a new copy and
 * the file it opened is never changed. Whoever holds files (the tabs, a
 * tool's list) says which; the save is refused where the reader picks
 * one of them, and asked again.
 */

import { msg } from "./i18n";
import type { Reopen } from "./types";

const held = new Map<string, string[]>();

/** The desktop paths among `reopens` (a phone's files are copies or
 * documents the system hands over: saving never reaches them). */
export function pathsOf(reopens: Array<Reopen | undefined>): string[] {
	const paths: string[] = [];
	for (const reopen of reopens)
		if (reopen?.kind === "path" && !paths.includes(reopen.path))
			paths.push(reopen.path);
	return paths;
}

/** `owner` has these files open now (an empty list lets them go). */
export function holdOpen(owner: string, reopens: Array<Reopen | undefined>) {
	const paths = pathsOf(reopens);
	if (paths.length) held.set(owner, paths);
	else held.delete(owner);
}

/** Every file open in this window, each once. */
export function openPaths(): string[] {
	return pathsOf(
		[...held.values()].flat().map((path) => ({ kind: "path", path })),
	);
}

/** The refusal the desktop side gives a save over an open file. */
export const OPEN_FILE = "is_open";

export const OPEN_FILE_NOTE = msg(
	"That's the file you have open. Choose another name.",
);

function isOpenRefusal(err: unknown): boolean {
	return (err as { kind?: unknown } | null)?.kind === OPEN_FILE;
}

/**
 * Save, telling the reader when they picked a file that is open and
 * asking again (the system's save screen comes back) until they pick
 * another place or cancel. `save` is given the open files to refuse.
 */
export async function saveAsking<T>(
	save: (open: string[]) => Promise<T>,
	refused: (note: string) => void,
	open: () => string[] = openPaths,
	tries = 5,
): Promise<T | null> {
	for (let left = tries; ; left--) {
		try {
			return await save(open());
		} catch (err) {
			if (!isOpenRefusal(err)) throw err;
			refused(OPEN_FILE_NOTE);
			// The reader keeps picking it: leave it to them to try again.
			if (left <= 1) return null;
		}
	}
}

let notice: (note: string) => void = () => {};

/** How the app says a save was refused (set once by the app). */
export function onSaveRefused(say: (note: string) => void) {
	notice = say;
}

export function saveRefused(note: string) {
	notice(note);
}

/** The open files in a header value the desktop side reads: one path
 * per line, percent-encoded (a header holds no newline or non-ASCII). */
export function openHeader(paths: string[]): string {
	return encodeURIComponent(paths.join("\n"));
}
