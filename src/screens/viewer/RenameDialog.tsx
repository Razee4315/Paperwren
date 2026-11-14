import { type FileRef, backend } from "@/lib/backend";
import { joinName, nameProblem, splitName } from "@/lib/fileName";
import { t } from "@/lib/i18n";
import { renameRefusal } from "@/lib/rename";
import type { Reopen } from "@/lib/types";
import { useRecents } from "@/state/recents";
import { Button, Dialog, toast } from "@/ui";
import { useState } from "react";
import s from "./Shell.module.css";

/**
 * Give a file a new name. The extension stays as it is, so a file
 * keeps opening as what it is. On a desktop the file itself is renamed
 * in its folder (never over another file); on a phone a document the
 * app may rename is renamed where it is. A copy the app holds can only
 * take a new name in the app, and the dialog says so before and after:
 * the original keeps its own. A refused rename changes nothing.
 */
export function RenameDialog({
	file,
	id,
	onClose,
	onRenamed,
}: {
	file: FileRef;
	/** Its id in recents. */
	id: string;
	onClose: () => void;
	/** The file now has `name`, at `reopen`, known in recents as `id`. */
	onRenamed?: (name: string, reopen: Reopen, id: string) => void;
}) {
	const recents = useRecents();
	const [stem0, ext] = splitName(file.name);
	const [stem, setStem] = useState(stem0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const problem = nameProblem(stem, ext);
	const inAppOnly = !backend.abilities(file).renameOriginal;

	const submit = async () => {
		if (busy) return;
		if (problem) {
			setError(t(problem));
			return;
		}
		const name = joinName(stem, ext);
		if (name === file.name) {
			onClose();
			return;
		}
		setBusy(true);
		let done: Awaited<ReturnType<typeof backend.rename>>;
		try {
			done = await backend.rename(file, name);
		} catch (err) {
			// Nothing was renamed: the old name stays everywhere.
			setError(t(renameRefusal(err)));
			setBusy(false);
			return;
		}
		const now = recents.rename(id, done.name, done.reopen);
		onRenamed?.(done.name, done.reopen, now);
		toast(
			done.original
				? t("Renamed to {name}", { name: done.name })
				: t(
						"Renamed to {name} in Paperwren. The original file keeps its name.",
						{
							name: done.name,
						},
					),
		);
		onClose();
	};

	return (
		<Dialog
			open
			title={t("Rename")}
			onClose={onClose}
			testId="rename"
			actions={
				<>
					<Button variant="ghost" onClick={onClose}>
						{t("Cancel")}
					</Button>
					<Button
						onClick={submit}
						disabled={busy || !!problem}
						data-testid="rename-go"
					>
						{t("Rename")}
					</Button>
				</>
			}
		>
			<form
				className={s.renameForm}
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<div className={s.renameField}>
					<input
						className={s.input}
						dir="auto"
						autoComplete="off"
						spellCheck={false}
						// biome-ignore lint/a11y/noAutofocus: the dialog exists to type a name
						autoFocus
						onFocus={(e) => e.currentTarget.select()}
						value={stem}
						onChange={(e) => {
							setStem(e.target.value);
							setError(null);
						}}
						aria-label={t("New name")}
						aria-invalid={!!error || undefined}
						data-testid="rename-input"
					/>
					{ext && (
						<span className={s.renameExt} dir="ltr">
							{ext}
						</span>
					)}
				</div>
				{inAppOnly && (
					<p className={s.renameNote} data-testid="rename-in-app">
						{t(
							"This changes the name in Paperwren only. The original file keeps its name.",
						)}
					</p>
				)}
				{(error || (problem && stem.trim())) && (
					<p className={s.renameError} role="alert" data-testid="rename-error">
						{error ?? t(problem ?? "")}
					</p>
				)}
			</form>
		</Dialog>
	);
}
