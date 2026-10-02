import { t } from "./i18n";

/**
 * Typed open failures: each has a name, an honest message, and one
 * recovery action. "File not found" is never a catch-all.
 */

export type OpenFailure =
	| "not_found"
	| "permission"
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

/** Map whatever the platform threw onto the taxonomy. */
export function classifyError(err: unknown): OpenFailure {
	if (err instanceof OpenError) return err.failure;
	const text = (
		typeof err === "string"
			? err
			: err instanceof Error
				? `${err.name} ${err.message}`
				: String((err as { message?: unknown })?.message ?? err)
	).toLowerCase();
	if (/permission|securityexception|eacces|not allowed|denied/.test(text))
		return "permission";
	if (/no such file|not found|does not exist|enoent|filenotfound/.test(text))
		return "not_found";
	if (/invalidpdf|corrupt|invalid|malformed|bad zip|end of central/.test(text))
		return "corrupt";
	return "unreadable";
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
		case "unreadable":
			return {
				title: t("Couldn't read the file"),
				message: t(
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
					"Paperwren opens PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV, Markdown and text files, and pictures.",
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
