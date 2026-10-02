import { type FileRef, backend, formatBytes } from "@/lib/backend";
import { formatLabel, kindLabel, kindOf } from "@/lib/formats";
import { t } from "@/lib/i18n";
import { printDocument } from "@/lib/print";
import { Button, Dialog, IconButton, Sheet, SheetItem, toast } from "@/ui";
import {
	AppWindow,
	Download,
	FolderOpen,
	Info,
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
}

export const ViewerFileContext = createContext<ViewerFile | null>(null);

/** Where the file lives, in words a person would use. */
function whereabouts(file: FileRef): string {
	switch (file.reopen.kind) {
		case "path":
			return file.reopen.path;
		case "managed":
			return t(t("A private copy kept by Paperwren"));
		case "uri":
			return t(t("Provided by another app"));
		default:
			return t(t("This browser"));
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
		[t(t("Name")), file.name],
		[
			t(t("Type")),
			`${formatLabel(file.format)} · ${kindLabel(kindOf(file.format))}`,
		],
		[t(t("Size")), size > 0 ? formatBytes(size) : t(t("Unknown"))],
		[t(t("Location")), whereabouts(file)],
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
 * The "more" menu every viewer shares: the viewer's own items, then
 * share, open elsewhere, print and details. Items the platform cannot
 * do are left out rather than shown disabled.
 */
export function FileMenu({
	extra,
	onPrint,
	active,
}: {
	/** The viewer's own items; `close` dismisses the menu. */
	extra?: (close: () => void) => ReactNode;
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
	const can = backend.abilities(file);
	const run = (action: Promise<void>, failure: string) => {
		setOpen(false);
		action.catch(() => toast(failure));
	};

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
				{can.share && (
					<SheetItem
						icon={
							can.shareIsDownload ? (
								<Download size={20} />
							) : (
								<Share2 size={20} />
							)
						}
						onClick={() =>
							run(backend.share(file), t(t("Couldn't share this file")))
						}
						testId="file-share"
					>
						{can.shareIsDownload ? t(t("Save a copy")) : t(t("Share"))}
					</SheetItem>
				)}
				{can.openWith && (
					<SheetItem
						icon={<AppWindow size={20} />}
						onClick={() =>
							run(
								backend.openWith(file),
								t(t("No other app can open this file")),
							)
						}
						testId="file-open-with"
					>
						{t("Open in another app")}
					</SheetItem>
				)}
				{can.reveal && (
					<SheetItem
						icon={<FolderOpen size={20} />}
						onClick={() =>
							run(backend.reveal(file), t(t("Couldn't show the folder")))
						}
						testId="file-reveal"
					>
						{t("Show in folder")}
					</SheetItem>
				)}
				{onPrint && (
					<SheetItem
						icon={<Printer size={20} />}
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
					onClose={() => setDetails(false)}
				/>
			)}
		</>
	);
}
