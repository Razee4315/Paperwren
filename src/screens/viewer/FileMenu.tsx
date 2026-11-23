import { type FileRef, backend } from "@/lib/backend";
import { isDesktop } from "@/lib/env";
import { t } from "@/lib/i18n";
import { FULLSCREEN_KEYS } from "@/lib/keys";
import { printDocument } from "@/lib/print";
import { hintFor, matches } from "@/lib/shortcuts";
import { withFeedback } from "@/lib/taskFeedback";
import type { OpenRequest, Reopen } from "@/lib/types";
import {
	IconButton,
	Sheet,
	SheetDivider,
	SheetItem,
	SheetTile,
	SheetTiles,
	ownsKeys,
	toast,
} from "@/ui";
import {
	ArrowLeftRight,
	Columns2,
	FilePlus,
	FileText,
	Info,
	Maximize,
	Minimize,
	MoreVertical,
	PencilLine,
	Printer,
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
import { FileDetails, HandOffItems } from "../files/FileActions";
import { RenameDialog } from "../files/RenameDialog";
import { SideBySideContext } from "./pane";

/** The file a viewer is showing, for the actions that leave the app. */
export interface ViewerFile {
	file: FileRef;
	/** Its id in recents. */
	id: string;
	/** Session-only Android grant: never saved to recents or thumbs. */
	ephemeral?: boolean;
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
	fullscreen,
}: {
	/** The viewer's own items; `close` dismisses the menu. */
	extra?: (close: () => void) => ReactNode;
	/** What the viewer knows about the document, for Details. */
	details?: Array<[string, string]> | (() => Array<[string, string]>);
	/** Lay the document out for paper inside `root`. */
	onPrint?: (root: HTMLElement) => Promise<void> | void;
	active: boolean;
	/** Full screen, here when the bar has no room for its button. */
	fullscreen?: { on: boolean; toggle: () => void };
}) {
	const context = useContext(ViewerFileContext);
	const [open, setOpen] = useState(false);
	const [details, setDetails] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const pair = useContext(SideBySideContext);
	const [besideOpen, setBesideOpen] = useState(false);
	const close = useCallback(() => setOpen(false), []);

	const print = useCallback(() => {
		if (!context || !onPrint) return;
		setOpen(false);
		withFeedback("print", () => printDocument(context.file, onPrint)).catch(
			() => toast(t("Couldn't prepare this file for printing")),
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
			if (!ownsKeys()) return;
			if (matches(e, "print")) {
				e.preventDefault();
				printRef.current();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
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
				{open && (
					<>
						{extra && (
							<>
								{extra(close)}
								<SheetDivider />
							</>
						)}
						{pair?.room && (
							<SheetItem
								icon={<Columns2 size={20} />}
								checked={pair.on}
								onClick={() => {
									setOpen(false);
									if (pair.on) pair.leave();
									else if (pair.others.length) setBesideOpen(true);
									else pair.pickBeside();
								}}
								testId="file-side-by-side"
								extra={
									pair.on ? (
										<IconButton
											label={t("Swap sides")}
											onClick={() => {
												setOpen(false);
												pair.swap();
											}}
											data-testid="file-swap-sides"
										>
											<ArrowLeftRight size={18} />
										</IconButton>
									) : undefined
								}
							>
								{t("Side by side")}
							</SheetItem>
						)}
						{fullscreen && (
							<SheetItem
								icon={
									fullscreen.on ? (
										<Minimize size={20} />
									) : (
										<Maximize size={20} />
									)
								}
								shortcut={FULLSCREEN_KEYS}
								onClick={() => {
									setOpen(false);
									fullscreen.toggle();
								}}
								testId="file-fullscreen"
							>
								{fullscreen.on ? t("Leave full screen") : t("Full screen")}
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
							<HandOffItems
								file={file}
								onDone={close}
								testPrefix="file"
								tiles
							/>
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
					</>
				)}
			</Sheet>
			{details && (
				<FileDetails
					file={file}
					size={size}
					extra={typeof more === "function" ? more() : more}
					onClose={() => setDetails(false)}
				/>
			)}
			{pair && (
				<Sheet
					open={besideOpen}
					title={t("Show beside this")}
					onClose={() => setBesideOpen(false)}
					testId="side-by-side-pick"
				>
					{besideOpen && (
						<>
							{pair.others.map((tab) => (
								<SheetItem
									key={tab.key}
									icon={<FileText size={20} />}
									onClick={() => {
										setBesideOpen(false);
										pair.beside(tab);
									}}
									testId="side-by-side-tab"
								>
									<span dir="auto">{tab.request.name}</span>
								</SheetItem>
							))}
							<SheetDivider />
							<SheetItem
								icon={<FilePlus size={20} />}
								onClick={() => {
									setBesideOpen(false);
									pair.pickBeside();
								}}
								testId="side-by-side-file"
							>
								{t("Choose a file")}
							</SheetItem>
						</>
					)}
				</Sheet>
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
