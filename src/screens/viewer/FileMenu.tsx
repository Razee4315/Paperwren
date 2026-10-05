import { type FileRef, backend, formatBytes } from "@/lib/backend";
import { isDesktop } from "@/lib/env";
import { formatLabel, kindLabel, kindOf } from "@/lib/formats";
import { inFullscreen, toggleFullscreen } from "@/lib/fullscreen";
import { t } from "@/lib/i18n";
import { printDocument } from "@/lib/print";
import type { OpenRequest } from "@/lib/types";
import { Button, Dialog, IconButton, Sheet, SheetItem, toast } from "@/ui";
import {
	AppWindow,
	Download,
	FolderOpen,
	Info,
	Maximize,
	Minimize,
	MoreVertical,
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
import s from "./Shell.module.css";

/** The file a viewer is showing, for the actions that leave the app. */
export interface ViewerFile {
	file: FileRef;
	/** Bytes, as read. */
	size: number;
	/** Show another file in place of this one (the next picture of a
	 * folder): Back then leaves the viewer, not a trail of files. */
	openOther?: (request: OpenRequest) => void;
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
		default:
			return t("This browser");
	}
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
		[
			t("Type"),
			`${formatLabel(file.format)} · ${kindLabel(kindOf(file.format))}`,
		],
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

/**
 * Share, open in another app, show in folder: the ways a file leaves
 * the app, as menu items. Those the platform cannot do for this file
 * are left out rather than shown disabled.
 */
export function HandOffItems({
	file,
	onDone,
	testPrefix,
}: {
	file: FileRef;
	/** Runs as soon as one is chosen (close the menu). */
	onDone: () => void;
	testPrefix: string;
}) {
	const can = backend.abilities(file);
	const run = (action: Promise<void>, failure: string) => {
		onDone();
		action.catch(() => toast(failure));
	};
	return (
		<>
			{can.share && (
				<SheetItem
					icon={
						can.shareIsDownload ? <Download size={20} /> : <Share2 size={20} />
					}
					onClick={() =>
						run(backend.share(file), t("Couldn't share this file"))
					}
					testId={`${testPrefix}-share`}
				>
					{can.shareIsDownload ? t("Save a copy") : t("Share")}
				</SheetItem>
			)}
			{can.openWith && (
				<SheetItem
					icon={<AppWindow size={20} />}
					onClick={() =>
						run(backend.openWith(file), t("No other app can open this file"))
					}
					testId={`${testPrefix}-open-with`}
				>
					{t("Open in another app")}
				</SheetItem>
			)}
			{can.reveal && (
				<SheetItem
					icon={<FolderOpen size={20} />}
					onClick={() =>
						run(backend.reveal(file), t("Couldn't show the folder"))
					}
					testId={`${testPrefix}-reveal`}
				>
					{t("Show in folder")}
				</SheetItem>
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
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
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
				{extra?.(close)}
				{isDesktop && (
					<SheetItem
						icon={
							inFullscreen() ? <Minimize size={20} /> : <Maximize size={20} />
						}
						shortcut="F11"
						onClick={() => {
							setOpen(false);
							toggleFullscreen();
						}}
						testId="file-fullscreen"
					>
						{inFullscreen() ? t("Leave full screen") : t("Full screen")}
					</SheetItem>
				)}
				<HandOffItems file={file} onDone={close} testPrefix="file" />
				{onPrint && (
					<SheetItem
						icon={<Printer size={20} />}
						shortcut="Ctrl+P"
						onClick={print}
						testId="file-print"
					>
						{t("Print")}
					</SheetItem>
				)}
				<SheetItem
					icon={<Info size={20} />}
					onClick={() => {
						setOpen(false);
						setDetails(true);
					}}
					testId="file-details-open"
				>
					{t("Details")}
				</SheetItem>
			</Sheet>
			{details && (
				<FileDetails
					file={file}
					size={size}
					extra={more}
					onClose={() => setDetails(false)}
				/>
			)}
		</>
	);
}
