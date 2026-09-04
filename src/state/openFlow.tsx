import { formatFromName } from "@/components/FormatBadge";
import { Button, Dialog } from "@/components/ui";
import { backend, formatBytes, readFileMeta } from "@/lib/backend";
import type { FileMeta } from "@/lib/types";
import { useCallback } from "react";

/**
 * The open flow with its error taxonomy (docs/09 section 3): every
 * failure is named, explained, and given one action. No dead taps.
 */

export type OpenError =
	| { kind: "legacy"; ext: string; newExt: string }
	| { kind: "unsupported" }
	| { kind: "too-large"; name: string; size: number; file?: FileMeta }
	| { kind: "not-found"; name: string; id: string }
	| { kind: "generic"; detail: string };

const LEGACY: Record<string, string> = {
	doc: "docx",
	xls: "xlsx",
	ppt: "pptx",
};

const SIZE_LIMIT_MB: Record<string, number> = {
	xlsx: 500,
	pptx: 200,
};

/** Validates a file name before anything expensive happens. */
export function validateFileName(name: string): OpenError | null {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (ext in LEGACY) {
		return { kind: "legacy", ext, newExt: LEGACY[ext] };
	}
	const format = formatFromName(name);
	if (format === "unknown") {
		return { kind: "unsupported" };
	}
	return null;
}

export function validateFileSize(
	name: string,
	size: number,
): Extract<OpenError, { kind: "too-large" }> | null {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	const limitMb = SIZE_LIMIT_MB[ext];
	if (limitMb && size > limitMb * 1024 * 1024) {
		return { kind: "too-large", name, size };
	}
	return null;
}

export function ErrorDialog({
	error,
	onDismiss,
	onRemoveRecent,
	onTryAnyway,
}: {
	error: OpenError | null;
	onDismiss: () => void;
	onRemoveRecent?: () => void;
	onTryAnyway?: (file: FileMeta) => void;
}) {
	const close = useCallback(() => {
		onDismiss();
	}, [onDismiss]);

	if (!error) return null;

	switch (error.kind) {
		case "legacy":
			return (
				<Dialog
					open
					title="Older Office format"
					onDismiss={close}
					actions={
						<Button onClick={close} data-testid="error-ok">
							OK
						</Button>
					}
				>
					{`This .${error.ext} file uses a legacy format Paperwren does not read yet. Save it as the newer format (.${error.newExt}) from Word, Excel, or PowerPoint, or try another viewer.`}
				</Dialog>
			);
		case "unsupported":
			return (
				<Dialog
					open
					title="Unsupported file type"
					onDismiss={close}
					actions={
						<Button onClick={close} data-testid="error-ok">
							OK
						</Button>
					}
				>
					Paperwren reads PDF, Word, Excel, and PowerPoint files.
				</Dialog>
			);
		case "too-large":
			return (
				<Dialog
					open
					title="Big file"
					onDismiss={close}
					actions={
						<>
							<Button variant="ghost" onClick={close}>
								Cancel
							</Button>
							<Button
								onClick={() => {
									if (error.file) onTryAnyway?.(error.file);
								}}
							>
								Try anyway
							</Button>
						</>
					}
				>
					{`This file is ${formatBytes(error.size)}. Opening it may be slow or run out of memory on this device.`}
				</Dialog>
			);
		case "not-found":
			return (
				<Dialog
					open
					title="File not found"
					onDismiss={close}
					actions={
						<>
							{onRemoveRecent && (
								<Button variant="destructive" onClick={onRemoveRecent}>
									Remove from recents
								</Button>
							)}
							<Button onClick={close}>OK</Button>
						</>
					}
				>
					{`'${error.name}' is not where it was. It may have been moved or deleted.`}
				</Dialog>
			);
		default:
			return (
				<Dialog
					open
					title="Can't open this file"
					onDismiss={close}
					actions={
						<Button onClick={close} data-testid="error-ok">
							OK
						</Button>
					}
				>
					{error.kind === "generic"
						? error.detail
						: "The file seems to be damaged or is not valid."}
				</Dialog>
			);
	}
}

/** Pick a file from the platform picker and validate it. A
 * too-large file comes back with the meta attached so the caller
 * can offer "Try anyway" and proceed on confirmation. */
export async function pickAndValidate(): Promise<
	{ ok: true; file: FileMeta } | { ok: false; error: OpenError }
> {
	const picked = await backend.pickFile();
	if (!picked) return { ok: false, error: { kind: "generic", detail: "" } };
	const nameError = validateFileName(picked.name);
	if (nameError) return { ok: false, error: nameError };
	const file = await readFileMeta(picked);
	const sizeError = validateFileSize(picked.name, picked.size);
	if (sizeError) {
		const tooLarge: OpenError = {
			kind: "too-large",
			name: sizeError.name,
			size: sizeError.size,
			file,
		};
		return { ok: false, error: tooLarge };
	}
	return { ok: true, file };
}
