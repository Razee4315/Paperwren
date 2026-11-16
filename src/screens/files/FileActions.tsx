import { type FileRef, backend, formatBytes } from "@/lib/backend";
import { formatLabel, kindLabel, kindOf, mimeOf } from "@/lib/formats";
import { t } from "@/lib/i18n";
import { withFeedback } from "@/lib/taskFeedback";
import { announceSaved } from "@/screens/tools/saved";
import { Button, Dialog, SheetItem, SheetTile, toast } from "@/ui";
import { AppWindow, Download, FolderOpen, Share2 } from "lucide-react";
import type { ReactNode } from "react";
import s from "./FileActions.module.css";

/** Where the file lives, in words a person would use. */
function whereabouts(file: FileRef): string {
	switch (file.reopen.kind) {
		case "path":
			return file.reopen.path;
		case "managed":
			return t("A private copy kept by Paperwren");
		case "uri":
			return t("Provided by another app");
		case "memory":
			return t("Inside another document");
		default:
			return t("This browser");
	}
}

/** "DOCX · Document"; a format named like its family ("PDF") once. */
function typeLabel(file: FileRef): string {
	const format = formatLabel(file.format);
	const kind = kindLabel(kindOf(file.format));
	return format.toLowerCase() === kind.toLowerCase()
		? format
		: `${format} · ${kind}`;
}

export function FileDetails({
	file,
	size,
	extra,
	onClose,
}: {
	file: FileRef;
	size: number;
	/** Further rows: [label, value]. */
	extra?: Array<[string, string]>;
	onClose: () => void;
}) {
	const rows: Array<[string, string]> = [
		[t("Name"), file.name],
		[t("Type"), typeLabel(file)],
		[t("Size"), size > 0 ? formatBytes(size) : t("Unknown")],
		[t("Location"), whereabouts(file)],
		...(extra ?? []),
	];
	return (
		<Dialog
			open
			title={t("Details")}
			onClose={onClose}
			testId="file-details"
			actions={<Button onClick={onClose}>{t("Done")}</Button>}
		>
			<dl className={s.details}>
				{rows.map(([label, value]) => (
					<div key={label}>
						<dt>{label}</dt>
						<dd>{value}</dd>
					</div>
				))}
			</dl>
		</Dialog>
	);
}

/** A copy of the file as it is, saved as a new file where the reader
 * picks (the file itself is never touched). */
async function saveCopyOf(file: FileRef) {
	const bytes = new Uint8Array(await backend.read(file.reopen));
	const saved = await backend.saveFile(
		file.name,
		bytes,
		mimeOf(file.format, file.name),
	);
	if (saved) announceSaved(saved, undefined, bytes.length);
}

type ItemProps = {
	icon: ReactNode;
	children: ReactNode;
	onClick: () => void;
	testId?: string;
};
const RowItem = (props: ItemProps) => <SheetItem {...props} />;
const TileItem = (props: ItemProps) => <SheetTile {...props} />;

/**
 * Share, save a copy, open in another app, show in folder: the ways a
 * file leaves the app, as menu items. Those the platform cannot do for this file
 * are left out rather than shown disabled.
 */
export function HandOffItems({
	file,
	onDone,
	testPrefix,
	tiles = false,
}: {
	file: FileRef;
	/** Runs as soon as one is chosen (close the menu). */
	onDone: () => void;
	testPrefix: string;
	/** As tiles (inside `SheetTiles`) rather than rows. */
	tiles?: boolean;
}) {
	const can = backend.abilities(file);
	const run = (action: () => Promise<void>, failure: string) => {
		onDone();
		withFeedback(`handoff-${JSON.stringify(file.reopen)}`, action).catch(() =>
			toast(failure),
		);
	};
	const Item = tiles ? TileItem : RowItem;
	return (
		<>
			{can.share && (
				<Item
					icon={
						can.shareIsDownload ? <Download size={20} /> : <Share2 size={20} />
					}
					onClick={() =>
						run(() => backend.share(file), t("Couldn't share this file"))
					}
					testId={`${testPrefix}-share`}
				>
					{can.shareIsDownload ? t("Save a copy") : t("Share")}
				</Item>
			)}
			{can.saveCopy && (
				<Item
					icon={<Download size={20} />}
					onClick={() => run(() => saveCopyOf(file), t("Couldn't save a copy"))}
					testId={`${testPrefix}-save-copy`}
				>
					{t("Save a copy")}
				</Item>
			)}
			{can.openWith && (
				<Item
					icon={<AppWindow size={20} />}
					onClick={() =>
						run(
							() => backend.openWith(file),
							t("No other app can open this file"),
						)
					}
					testId={`${testPrefix}-open-with`}
				>
					{t("Open in another app")}
				</Item>
			)}
			{can.reveal && (
				<Item
					icon={<FolderOpen size={20} />}
					onClick={() =>
						run(() => backend.reveal(file), t("Couldn't show the folder"))
					}
					testId={`${testPrefix}-reveal`}
				>
					{t("Show in folder")}
				</Item>
			)}
		</>
	);
}
