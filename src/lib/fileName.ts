/**
 * File names the reader types: for renaming a file, and for the copies
 * the tools save. The checks match the desktop side (src-tauri
 * save.rs), so a name refused there is refused here first, in words.
 */

import { msg } from "./i18n";

const FORBIDDEN = /[<>:"/\\|?*]/;
/** Tabs, line breaks and the other characters no one types on purpose. */
const control = (text: string) =>
	[...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** In bytes, as file systems count. */
const MAX_BYTES = 255;

/** "Report.final.pdf" as ["Report.final", ".pdf"]. A name that starts
 * with its only dot (".env") has no extension. */
export function splitName(name: string): [stem: string, ext: string] {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/** What is wrong with a name typed for a file (its stem: the
 * extension is kept apart), or null when it will do. */
export function nameProblem(stem: string, ext = ""): string | null {
	const name = stem.trim();
	// Dots and spaces at the end are dropped (joinName), so "..." is no
	// name at all.
	if (!name.replace(/[. ]+$/, "")) return msg("Type a name");
	if (FORBIDDEN.test(name) || control(name))
		return msg("A name can't contain any of \\ / : * ? \" < > |");
	if (RESERVED.test(name.split(".")[0]))
		return msg("That name is kept by the system");
	if (new TextEncoder().encode(name + ext).length > MAX_BYTES)
		return msg("That name is too long");
	return null;
}

/** The name to use: the stem tidied (no spaces or dots at its ends,
 * which Windows would drop) and the extension put back. */
export function joinName(stem: string, ext: string): string {
	return stem.trim().replace(/[. ]+$/, "") + ext;
}

/** A name for a copy the tools save: "Contract (signed).pdf". */
export function copyName(name: string, what: string, ext?: string): string {
	const [stem, own] = splitName(name);
	return `${stem} (${what})${ext ?? (own || ".pdf")}`;
}

/** Files in order of their names, as a person reads them: "Scan 2"
 * before "Scan 10", whatever the case, in the reader's language. */
export function byName<T extends { name: string }>(files: T[]): T[] {
	const order = new Intl.Collator(undefined, {
		numeric: true,
		sensitivity: "base",
	});
	return [...files].sort((a, b) => order.compare(a.name, b.name));
}
