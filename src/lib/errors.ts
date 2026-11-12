import { isDesktop } from "./env";
import { t } from "./i18n";

/**
 * Typed open failures: each has a name, an honest message, and one
 * recovery action. "File not found" is never a catch-all.
 */

export type OpenFailure =
	| "not_found"
	| "permission"
	| "busy"
	| "unreadable"
	| "empty"
	| "corrupt"
	| "unsupported"
	| "password";

export class OpenError extends Error {
	constructor(
		readonly failure: OpenFailure,
		detail?: string,
	) {
		super(detail ?? failure);
		this.name = "OpenError";
	}
}

/** Map whatever the platform threw onto the taxonomy. The app's own
 * commands say what went wrong in `kind`; elsewhere (the file system
 * plugin, Android) only the message tells, in the words of the system:
 * Windows', macOS's, Linux's or Android's. */
export function classifyError(err: unknown): OpenFailure {
	if (err instanceof OpenError) return err.failure;
	const kind = (err as { kind?: unknown } | null)?.kind;
	if (kind === "not_found") return "not_found";
	if (kind === "corrupt") return "corrupt";
	const text = (
		typeof err === "string"
			? err
			: err instanceof Error
				? `${err.name} ${err.message}`
				: String((err as { message?: unknown })?.message ?? err)
	).toLowerCase();
	// Windows: another app holds it open and shares it with no one.
	if (
		/os error 3[23]\b|used by another process|locked a portion|sharing violation|ebusy/.test(
			text,
		)
	)
		return "busy";
	if (
		/permission|securityexception|eacces|eperm|not allowed|not permitted|denied|os error 5\b/.test(
			text,
		)
	)
		return "permission";
	if (
		/no such file|not found|does not exist|enoent|filenotfound|cannot find|os error [23]\b/.test(
			text,
		)
	)
		return "not_found";
	if (/invalidpdf|corrupt|invalid|malformed|bad zip|end of central/.test(text))
		return "corrupt";
	return "unreadable";
}

/** The Chromium version of the WebView the app runs in, or null where
 * it is not Chromium (macOS). */
export function chromeMajor(
	agent: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
): number | null {
	const m = /\bChrom(?:e|ium)\/(\d+)/.exec(agent);
	return m ? Number(m[1]) : null;
}

/** Below this, a failure of the engine itself is put down to the
 * WebView being out of date rather than to the file. */
export const OLD_WEBVIEW = 110;

/**
 * A failure that comes from the phone's web engine, not from the file:
 * a built-in it lacks ("is not a function", "is not defined"), code it
 * cannot parse, or WebAssembly it cannot run. Only ever said on an old
 * WebView: on an up-to-date one the same errors are a reader's bug or a
 * strange file, and the file's own message stays.
 */
export function engineFault(
	err: unknown,
	major: number | null = chromeMajor(),
): boolean {
	if (major === null || major >= OLD_WEBVIEW) return false;
	const wasm = (globalThis as { WebAssembly?: Record<string, unknown> })
		.WebAssembly;
	for (const kind of ["CompileError", "LinkError", "RuntimeError"]) {
		const type = wasm?.[kind];
		if (typeof type === "function" && err instanceof type) return true;
	}
	if (
		err instanceof TypeError ||
		err instanceof ReferenceError ||
		err instanceof SyntaxError
	)
		return true;
	// A worker that failed to start reports an event, not an error.
	const text = String(
		(err as { message?: unknown })?.message ?? err ?? "",
	).toLowerCase();
	return /syntaxerror|referenceerror|is not a function|is not defined|unexpected token|webassembly/.test(
		text,
	);
}

/** What to tell the reader when a viewer could not show a file: the
 * viewer's own words (`damaged`), or, when the phone's web engine is
 * what failed, that it needs updating. */
export function explainFailure(err: unknown, damaged: string): string {
	return engineFault(err)
		? t(
				"This phone's web engine (Android System WebView) is out of date, so this file couldn't be shown. Update it from your app store (on Huawei phones, update Huawei WebView in AppGallery), then try again.",
			)
		: damaged;
}

/** A tool's short word when a file it was given could not be read. */
export function unreadNote(err: unknown, name: string): string {
	return engineFault(err)
		? t(
				"This phone's web engine is out of date. Update Android System WebView (Huawei WebView on Huawei phones), then try again.",
			)
		: t("{name} couldn't be read", { name });
}

export interface FailureCopy {
	title: string;
	message: string;
	/** "locate": pick the file again to repair the recent. */
	action: "locate" | null;
}

export function failureCopy(failure: OpenFailure, name: string): FailureCopy {
	const file = name ? `“${name}”` : t("This file");
	switch (failure) {
		case "not_found":
			return {
				title: t("File not found"),
				message: t(
					"{file} has been moved or deleted. Choose it again to update this recent.",
					{ file },
				),
				action: "locate",
			};
		case "permission":
			return {
				title: t("Access expired"),
				message: t(
					"Paperwren no longer has access to {file}. Choose it again to restore access.",
					{ file },
				),
				action: "locate",
			};
		case "busy":
			return {
				title: t("File in use"),
				message: t(
					"{file} is open in another app that won't share it. Close it there, then try again.",
					{ file },
				),
				action: null,
			};
		case "unreadable":
			return {
				title: t("Couldn't read the file"),
				// On a phone a file comes from an app (a cloud drive, a mail
				// app), which may be what is missing; a desktop reads its disk.
				message: isDesktop
					? t("{file} could not be read.", { file })
					: t(
							"{file} could not be read. The app that provided it may be unavailable.",
							{ file },
						),
				action: "locate",
			};
		case "empty":
			return {
				title: t("Empty file"),
				message: t("{file} contains no data.", { file }),
				action: null,
			};
		case "corrupt":
			return {
				title: t("File is damaged"),
				message: t(
					"{file} looks damaged or incomplete. Try downloading it again.",
					{ file },
				),
				action: null,
			};
		case "unsupported":
			return {
				title: t("Unsupported file"),
				message: t(
					"Paperwren opens PDF, Word, Excel, PowerPoint, OpenDocument, RTF, EPUB, CSV, Markdown and text files, comic books, pictures and source code.",
				),
				action: null,
			};
		case "password":
			return {
				title: t("Can't unlock this file"),
				message: t(
					"{file} is protected in a way Paperwren can't open (a certificate or rights management, not a password).",
					{ file },
				),
				action: null,
			};
	}
}
