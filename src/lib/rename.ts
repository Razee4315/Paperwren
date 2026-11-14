/**
 * Renaming a file, as pure rules: how a file can be renamed where it
 * came from, what the Android side's answer means, and what to tell
 * the reader when it is refused. The work itself is the backend's.
 */

import { classifyError } from "./errors";
import { msg } from "./i18n";
import type { Reopen } from "./types";

/** What a rename did. `original` is true when the file itself was
 * renamed where it is; false when only the name Paperwren knows it by
 * changed (a copy the app holds, or a file it may not rename), and the
 * original keeps its own. */
export interface Renamed {
	reopen: Reopen;
	name: string;
	original: boolean;
}

/**
 * How a file is renamed here:
 * - "file": a path on a computer, renamed in its folder;
 * - "document": an Android document, which its provider is asked to
 *   rename (it may say no: then only the app's name changes);
 * - "app": a copy the app holds (picked, or opened from another app)
 *   or one the browser handed over: the original is out of reach, so
 *   only the name it goes by in Paperwren changes;
 * - null: a file inside another one, with no place of its own.
 */
export type RenameWay = "file" | "document" | "app" | null;

export function renameWay(reopen: Reopen, providerRenames: boolean): RenameWay {
	switch (reopen.kind) {
		case "path":
			return "file";
		case "uri":
			return providerRenames ? "document" : "app";
		case "managed":
		case "browser":
			return "app";
		case "memory":
			return null;
	}
}

/** A refusal with the kind the desktop side gives its own. */
export function renameRefused(kind: string): Error & { kind: string } {
	return Object.assign(new Error(kind), { kind });
}

/**
 * The Android side's answer to a document rename: {uri, name} once the
 * provider renamed it (the name read back from it, which may not be the
 * one asked for: a provider never replaces another file, and some pick
 * a free name instead); "unsupported" or "permission" when the provider
 * will not rename it for Paperwren, so only the app's name changes;
 * anything else is a failure the reader is told about, and nothing is
 * renamed.
 */
export function documentRenamed(
	answer: unknown,
	reopen: Reopen,
	asked: string,
): Renamed {
	if (answer && typeof answer === "object") {
		const { uri, name } = answer as { uri?: unknown; name?: unknown };
		if (typeof uri === "string" && uri.startsWith("content://"))
			return {
				reopen: { kind: "uri", uri },
				name: typeof name === "string" && name.trim() ? name.trim() : asked,
				original: true,
			};
	}
	if (answer === "unsupported" || answer === "permission")
		return { reopen, name: asked, original: false };
	if (answer === "not_found") throw renameRefused("not_found");
	throw renameRefused("io");
}

/** Why a rename was refused, in words (still to be translated). */
export function renameRefusal(err: unknown): string {
	const kind = (err as { kind?: unknown } | null)?.kind;
	if (kind === "exists")
		return msg("Another file in that folder already has this name");
	if (kind === "not_found") return msg("The file is no longer where it was");
	if (kind === "invalid_name") return msg("That name can't be used");
	// The system's own words say the rest (Windows, macOS, Linux).
	const failure = classifyError(err);
	if (failure === "busy")
		return msg(
			"Another app is using this file. Close it there, then try again.",
		);
	if (failure === "permission")
		return msg("Paperwren isn't allowed to rename this file");
	if (failure === "not_found") return msg("The file is no longer where it was");
	return msg("Couldn't rename this file");
}
