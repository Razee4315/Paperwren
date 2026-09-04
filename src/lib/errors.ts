/**
 * Typed open/read failures (audit section 15.3): every failure has a
 * name, one clear recovery path, and a mapping from whatever the
 * platform layer threw. "File not found" is never a catch-all.
 */

export type OpenFailure =
	| "not_found"
	| "permission_revoked"
	| "provider_unavailable"
	| "read_failed"
	| "unsupported"
	| "corrupt"
	| "out_of_memory"
	| "cancelled";

/** Map a thrown value from the read/pick layer onto the taxonomy. */
export function classifyOpenError(err: unknown): OpenFailure {
	if (err === null || err === undefined) return "read_failed";
	const message =
		typeof err === "string"
			? err
			: err instanceof Error
				? `${err.name}: ${err.message}`
				: String((err as { message?: unknown })?.message ?? err);
	const lower = message.toLowerCase();
	if (lower.includes("cancel")) return "cancelled";
	if (
		lower.includes("permission denied") ||
		lower.includes("permission_revoked") ||
		lower.includes("eacces") ||
		lower.includes("security exception")
	) {
		return "permission_revoked";
	}
	if (
		lower.includes("no such file") ||
		lower.includes("not found") ||
		lower.includes("does not exist") ||
		lower.includes("enoent")
	) {
		return lower.includes("content://") || lower.includes("provider")
			? "provider_unavailable"
			: "not_found";
	}
	if (lower.includes("content://") || lower.includes("provider"))
		return "provider_unavailable";
	if (lower.includes("out of memory") || lower.includes("oom"))
		return "out_of_memory";
	if (lower.includes("corrupt") || lower.includes("invalid")) return "corrupt";
	return "read_failed";
}

export interface FailureCopy {
	title: string;
	message: string;
	/** Primary recovery action label, or null when the only path is
	 * acknowledging the failure. */
	action: "locate" | "remove" | "retry" | null;
}

/** One clear recovery path per failure kind. */
export function failureCopy(failure: OpenFailure, name: string): FailureCopy {
	const quoted = name ? `'${name}'` : "This file";
	switch (failure) {
		case "not_found":
			return {
				title: "File not found",
				message: `${quoted} is not where it was. It may have been moved or deleted. Choose the file again to update this recent.`,
				action: "locate",
			};
		case "permission_revoked":
			return {
				title: "Permission revoked",
				message: `${quoted} can no longer be opened because the app's access to it was revoked. Choose the file again to grant access back.`,
				action: "locate",
			};
		case "provider_unavailable":
			return {
				title: "Source unavailable",
				message: `The app that provided ${quoted} is not reachable right now. Open it from its app again, or pick the file from storage.`,
				action: "locate",
			};
		case "read_failed":
			return {
				title: "Couldn't read the file",
				message: `${quoted} could not be read. Pick it again; if it keeps failing, the file or its storage may be damaged.`,
				action: "locate",
			};
		case "unsupported":
			return {
				title: "Unsupported file type",
				message:
					"Paperwren reads PDF, Word, Excel, PowerPoint, CSV, Markdown, and text files.",
				action: null,
			};
		case "corrupt":
			return {
				title: "File is damaged",
				message: `${quoted} seems to be damaged or incomplete. Try re-downloading or re-saving it.`,
				action: null,
			};
		case "out_of_memory":
			return {
				title: "Not enough memory",
				message: `${quoted} is too large for this device to open right now.`,
				action: null,
			};
		case "cancelled":
			return {
				title: "Cancelled",
				message: "The open was cancelled.",
				action: null,
			};
	}
}
