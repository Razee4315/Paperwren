import { type FileRef, backend, formatBytes } from "@/lib/backend";
import { isDesktop } from "@/lib/env";
import { formatLabel, kindLabel, kindOf, mimeOf } from "@/lib/formats";
import { inFullscreen, toggleFullscreen } from "@/lib/fullscreen";
import { t } from "@/lib/i18n";
import { FULLSCREEN_KEYS } from "@/lib/keys";
import { printDocument } from "@/lib/print";
import { hintFor, matches } from "@/lib/shortcuts";
import type { OpenRequest, Reopen } from "@/lib/types";
import { announceSaved } from "@/screens/tools/saved";
import {
	Button,
	Dialog,
	IconButton,
	Sheet,
	SheetDivider,
	SheetItem,
	SheetTile,
	SheetTiles,
	toast,
} from "@/ui";
import {
	AppWindow,
	Download,
	FolderOpen,
	Info,
	Maximize,
	Minimize,
	MoreVertical,
	PencilLine,
	Printer,
	Share2,
} from "lucide-react";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { RenameDialog } from "./RenameDialog";
import s from "./Shell.module.css";

/** The file a viewer is showing, for the actions that leave the app. */
export interface ViewerFile {
	file: FileRef;
	/** Its id in recents. */
	id: string;
	/** The file was renamed: show it under its new name. */
	onRenamed?: (name: string, reopen: Reopen, id: string) => void;
	/** Bytes, as read. */
	size: number;
	/** Show another file in place of this one (the next picture of a
	 * folder): Back then leaves the viewer, not a trail of files. */
	openOther?: (request: OpenRequest) => void;
	/** Open another file over this one (a PDF's attachment): Back
	 * returns here. */
	openOver?: (request: OpenRequest) => void;
	/** Open the tools (or one of them) with this file in them. */
	openTools?: (tool?: string) => void;
}

export const ViewerFileContext = createContext<ViewerFile | null>(null);

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
	const run = (action: Promise<void>, failure: string) => {
		onDone();
		action.catch(() => toast(failure));
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
						run(backend.share(file), t("Couldn't share this file"))
					}
					testId={`${testPrefix}-share`}
				>
					{can.shareIsDownload ? t("Save a copy") : t("Share")}
				</Item>
			)}
			{can.saveCopy && (
				<Item
					icon={<Download size={20} />}
					onClick={() => run(saveCopyOf(file), t("Couldn't save a copy"))}
					testId={`${testPrefix}-save-copy`}
				>
					{t("Save a copy")}
				</Item>
			)}
			{can.openWith && (
				<Item
					icon={<AppWindow size={20} />}
					onClick={() =>
						run(backend.openWith(file), t("No other app can open this file"))
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
						run(backend.reveal(file), t("Couldn't show the folder"))
					}
					testId={`${testPrefix}-reveal`}
				>
					{t("Show in folder")}
				</Item>
			)}
		</>
	);
}

/**
 * The "more" menu every viewer shares: the viewer's own items, then
 * share, open elsewhere, print and details. Items the platform cannot
 * do are left out rather than shown disabled.
 */
export function FileMenu({
	extra,
	details: more,
	onPrint,
	active,
}: {
	/** The viewer's own items; `close` dismisses the menu. */
	extra?: (close: () => void) => ReactNode;
	/** What the viewer knows about the document, for Details. */
	details?: Array<[string, string]>;
	/** Lay the document out for paper inside `root`. */
	onPrint?: (root: HTMLElement) => Promise<void> | void;
	active: boolean;
}) {
	const context = useContext(ViewerFileContext);
	const [open, setOpen] = useState(false);
	const [details, setDetails] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const close = useCallback(() => setOpen(false), []);

	const print = useCallback(() => {
		if (!context || !onPrint) return;
		setOpen(false);
		printDocument(context.file, onPrint).catch(() =>
			toast(t("Couldn't prepare this file for printing")),
		);
	}, [context, onPrint]);

	// Ctrl/Cmd+P prints the document, not the app's chrome.
	const printRef = useRef(print);
	printRef.current = print;
	const printable = !!context && !!onPrint;
	useEffect(() => {
		// With nothing to print the shortcut is left alone.
		if (!active || !printable) return;
		const onKey = (e: KeyboardEvent) => {
			if (matches(e, "print")) {
				e.preventDefault();
				printRef.current();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, printable]);

	if (!context) return null;
	const { file, size } = context;

	return (
		<>
			<IconButton
				label={t("More")}
				onClick={() => setOpen(true)}
				data-testid="file-more"
			>
				<MoreVertical size={20} />
			</IconButton>
			<Sheet open={open} title={file.name} onClose={close} testId="file-menu">
				{extra && (
					<>
						{extra(close)}
						<SheetDivider />
					</>
				)}
				{isDesktop && (
					<SheetItem
						icon={
							inFullscreen() ? <Minimize size={20} /> : <Maximize size={20} />
						}
						shortcut={FULLSCREEN_KEYS}
						onClick={() => {
							setOpen(false);
							toggleFullscreen();
						}}
						testId="file-fullscreen"
					>
						{inFullscreen() ? t("Leave full screen") : t("Full screen")}
					</SheetItem>
				)}
				{/* The file itself: tiles, so the menu stays short. */}
				<SheetTiles>
					{onPrint && (
						<SheetTile
							icon={<Printer size={20} />}
							hint={isDesktop ? hintFor("print") : undefined}
							onClick={print}
							testId="file-print"
						>
							{t("Print")}
						</SheetTile>
					)}
					<HandOffItems file={file} onDone={close} testPrefix="file" tiles />
					{backend.abilities(file).rename && context.onRenamed && (
						<SheetTile
							icon={<PencilLine size={20} />}
							onClick={() => {
								setOpen(false);
								setRenaming(true);
							}}
							testId="file-rename"
						>
							{t("Rename")}
						</SheetTile>
					)}
					<SheetTile
						icon={<Info size={20} />}
						onClick={() => {
							setOpen(false);
							setDetails(true);
						}}
						testId="file-details-open"
					>
						{t("Details")}
					</SheetTile>
				</SheetTiles>
			</Sheet>
			{details && (
				<FileDetails
					file={file}
					size={size}
					extra={more}
					onClose={() => setDetails(false)}
				/>
			)}
			{renaming && (
				<RenameDialog
					file={file}
					id={context.id}
					onClose={() => setRenaming(false)}
					onRenamed={context.onRenamed}
				/>
			)}
		</>
	);
}
