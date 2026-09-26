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
	const file = name ? `“${name}”` : "This file";
	switch (failure) {
		case "not_found":
			return {
				title: "File not found",
				message: `${file} has been moved or deleted. Choose it again to update this recent.`,
				action: "locate",
			};
		case "permission":
			return {
				title: "Access expired",
				message: `Paperwren no longer has access to ${file}. Choose it again to restore access.`,
				action: "locate",
			};
		case "unreadable":
			return {
				title: "Couldn't read the file",
				message: `${file} could not be read. The app that provided it may be unavailable.`,
				action: "locate",
			};
		case "empty":
			return {
				title: "Empty file",
				message: `${file} contains no data.`,
				action: null,
			};
		case "corrupt":
			return {
				title: "File is damaged",
				message: `${file} looks damaged or incomplete. Try downloading it again.`,
				action: null,
			};
		case "unsupported":
			return {
				title: "Unsupported file",
				message:
					"Paperwren opens PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV, Markdown and text files.",
				action: null,
			};
		case "password":
			return {
				title: "Password required",
				message: `${file} is protected.`,
				action: null,
			};
	}
}
