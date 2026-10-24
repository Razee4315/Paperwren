import {
	FOLDER_LIMITS,
	type FileRef,
	type Folder,
	type FolderFile,
	backend,
	formatBytes,
} from "@/lib/backend";
import { type FolderNode, folderAt, folderTree } from "@/lib/folderTree";
import { formatFromName, kindOf } from "@/lib/formats";
import { isolate, locale, t, tn } from "@/lib/i18n";
import { rememberPictures } from "@/lib/siblings";
import type { OpenRequest } from "@/lib/types";
import { FileDetails, HandOffItems } from "@/screens/viewer/FileMenu";
import { useBackClose, useNav } from "@/state/navigation";
import { Button, FileBadge, IconButton, Sheet, SheetItem, Spinner } from "@/ui";
import {
	ChevronRight,
	Folder as FolderIcon,
	FolderTree,
	FolderX,
	Info,
	List,
	MoreVertical,
	RefreshCw,
	SearchX,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import s from "./Home.module.css";
import {
	type KindFilter,
	SearchField,
	TypeChips,
	countKinds,
	filterInForce,
} from "./ListTools";

function dated(ms: number): string {
	if (!ms) return "";
	const d = new Date(ms);
	return d.toLocaleDateString(locale(), {
		month: "short",
		day: "numeric",
		year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
	});
}

const refOf = (f: FolderFile): FileRef => ({
	name: f.name,
	format: formatFromName(f.name),
	reopen: f.request.reopen,
});

/** Rows drawn at a time: a folder can hold two thousand documents, and
 * a phone should not lay out all of them to show the first screen. */
const PAGE = 200;

/** How a folder is shown: its own folders to go into, or every document
 * in it at once, newest first. Kept for the next folder, and next time. */
type View = "folders" | "all";
const VIEW_KEY = "paperwren.folderView";
function storedView(): View {
	try {
		return localStorage.getItem(VIEW_KEY) === "all" ? "all" : "folders";
	} catch {
		return "folders";
	}
}

type Listing =
	| { state: "loading" }
	| { state: "failed" }
	| { state: "ready"; files: FolderFile[] };

/** The documents inside a folder the user chose: newest first, with
 * the same search and type filters as recents. */
export function FolderList({
	folder,
	onOpen,
	onRemove,
}: {
	folder: Folder;
	onOpen: (request: OpenRequest) => void;
	onRemove: () => void;
}) {
	const [listing, setListing] = useState<Listing>({ state: "loading" });
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<KindFilter>("all");
	const [shownRows, setShownRows] = useState(PAGE);
	const [menuFor, setMenuFor] = useState<FolderFile | null>(null);
	const [detailsFor, setDetailsFor] = useState<FolderFile | null>(null);
	const [view, setView] = useState<View>(storedView);
	// The sub-folder on show ("" for the chosen folder itself).
	const [path, setPath] = useState("");
	const changeView = (next: View) => {
		setView(next);
		setShownRows(PAGE);
		try {
			localStorage.setItem(VIEW_KEY, next);
		} catch {
			// Kept for this visit only.
		}
	};
	const goTo = (next: string) => {
		setPath(next);
		setShownRows(PAGE);
	};

	const load = useCallback(() => {
		let alive = true;
		setListing({ state: "loading" });
		backend
			.listFolder(folder)
			.then((files) => {
				if (!alive) return;
				files.sort(
					(a, b) => b.modified - a.modified || a.name.localeCompare(b.name),
				);
				setListing({ state: "ready", files });
			})
			.catch(() => alive && setListing({ state: "failed" }));
		return () => {
			alive = false;
		};
	}, [folder]);
	useEffect(() => load(), [load]);

	const files = listing.state === "ready" ? listing.files : [];
	const counts = useMemo(
		() => countKinds(files.map((f) => kindOf(formatFromName(f.name)))),
		[files],
	);
	const tree = useMemo(() => folderTree(files, (f) => f.folder), [files]);
	// A folder looked through again may no longer hold documents there.
	const node: FolderNode<FolderFile> = folderAt(tree, path) ?? tree;
	const shown = filterInForce(filter, counts);
	const q = query.trim().toLowerCase();
	// Going into folders, unless a search or a type looks through them all.
	const browsing =
		view === "folders" && !q && shown === "all" && tree.folders.length > 0;
	const deeper = browsing && node.path !== "";
	const up = () => goTo(node.path.split("/").slice(0, -1).join("/"));
	// Back goes up a folder before it leaves the list: only while the list
	// is on show, not under a document opened from it.
	const onTop = useNav().state.screens.length === 1;
	useBackClose("folder-up", deeper && onTop, up);

	if (listing.state === "loading")
		return (
			<div className={s.noMatch} data-testid="folder-loading">
				<Spinner label={t("Looking through {name}", { name: folder.name })} />
			</div>
		);
	if (listing.state === "failed")
		return (
			<div className={s.noMatch} data-testid="folder-failed">
				<FolderX size={36} strokeWidth={1.5} />
				{t(
					"Paperwren can't reach “{name}” any more. It may have been moved, or access to it was withdrawn.",
					{ name: folder.name },
				)}
				<div className={s.placeActions}>
					<Button variant="secondary" onClick={load}>
						{t("Try again")}
					</Button>
					<Button variant="danger" onClick={onRemove}>
						{t("Remove folder")}
					</Button>
				</div>
			</div>
		);

	const visible = files.filter(
		(f) =>
			(shown === "all" || kindOf(formatFromName(f.name)) === shown) &&
			(!q || f.name.toLowerCase().includes(q)),
	);
	// In a folder: its own folders first, then its documents.
	const rows: Array<FolderNode<FolderFile> | FolderFile> = browsing
		? [...node.folders, ...node.files]
		: visible;

	return (
		<>
			<SearchField
				value={query}
				onChange={setQuery}
				placeholder={t("Search {name}", { name: folder.name })}
				label={t("Search {name}", { name: folder.name })}
				testId="folder-search"
			/>
			{files.length > 0 && (
				<TypeChips counts={counts} value={shown} onChange={setFilter} />
			)}

			<h2 className={s.section}>
				{browsing ? (
					<nav className={s.crumbs} aria-label={t("Folder path")}>
						{["", ...node.path.split("/").filter(Boolean)].map(
							(name, i, all) => {
								const at = all.slice(1, i + 1).join("/");
								const here = i === all.length - 1;
								return (
									<Fragment key={at || "."}>
										{i > 0 && (
											<ChevronRight
												size={14}
												className={`${s.crumbArrow} pw-flip`}
												aria-hidden="true"
											/>
										)}
										<button
											type="button"
											className={s.crumb}
											aria-current={here ? "page" : undefined}
											disabled={here}
											onClick={() => goTo(at)}
											data-testid="folder-crumb"
										>
											{name || folder.name}
										</button>
									</Fragment>
								);
							},
						)}
					</nav>
				) : (
					folder.name
				)}{" "}
				<span className={s.bubble}>{browsing ? node.total : files.length}</span>
				<span className={s.sectionActions}>
					{tree.folders.length > 0 && (
						<IconButton
							label={
								view === "folders" ? t("Show all files") : t("Show folders")
							}
							onClick={() => changeView(view === "folders" ? "all" : "folders")}
							data-testid="folder-view"
						>
							{view === "folders" ? (
								<List size={18} />
							) : (
								<FolderTree size={18} />
							)}
						</IconButton>
					)}
					<IconButton label={t("Look again")} onClick={load}>
						<RefreshCw size={18} />
					</IconButton>
					<IconButton
						label={t("Remove this folder from Paperwren")}
						onClick={onRemove}
						data-testid="folder-remove"
					>
						<FolderX size={18} />
					</IconButton>
				</span>
			</h2>

			{rows.length === 0 ? (
				<div className={s.noMatch} data-testid="folder-empty">
					<SearchX size={36} strokeWidth={1.5} />
					{files.length === 0
						? t("No documents in this folder.")
						: q
							? t("Nothing matches “{query}”.", { query: query.trim() })
							: t("No files of this type here.")}
				</div>
			) : (
				<div className={s.list}>
					{rows.slice(0, shownRows).map((row) =>
						"folders" in row ? (
							<div key={`folder:${row.path}`} className={s.row}>
								<button
									type="button"
									className={s.rowMain}
									onClick={() => goTo(row.path)}
									data-testid="folder-subfolder"
								>
									<span className={s.folderIcon} aria-hidden="true">
										<FolderIcon size={40} strokeWidth={1.5} />
									</span>
									<span className={s.rowText}>
										<span className={s.name}>{row.name}</span>
										<span className={s.meta}>
											{tn(row.total, "{n} document", "{n} documents")}
										</span>
									</span>
									<ChevronRight
										size={18}
										className={`${s.rowArrow} pw-flip`}
										aria-hidden="true"
									/>
								</button>
							</div>
						) : (
							<div
								key={row.request.id}
								className={s.row}
								data-testid="folder-file"
							>
								<button
									type="button"
									className={s.rowMain}
									onClick={() => {
										// A picture can then step through the others beside it.
										rememberPictures(
											(browsing ? node.files : files).map(
												(file) => file.request,
											),
										);
										onOpen(row.request);
									}}
								>
									<FileBadge format={formatFromName(row.name)} size={46} />
									<span className={s.rowText}>
										<span className={s.name}>{row.name}</span>
										<span className={s.meta}>
											{[
												browsing ? "" : row.folder,
												row.size > 0 ? formatBytes(row.size) : "",
												dated(row.modified),
											]
												.filter(Boolean)
												.map(isolate)
												.join(" · ")}
										</span>
									</span>
								</button>
								<IconButton
									label={t("More actions for {name}", { name: row.name })}
									onClick={() => setMenuFor(row)}
									data-testid="folder-file-more"
								>
									<MoreVertical size={20} />
								</IconButton>
							</div>
						),
					)}
				</div>
			)}
			{rows.length > shownRows && (
				<div className={s.placeActions}>
					<Button
						variant="secondary"
						onClick={() => setShownRows((n) => n + PAGE)}
						data-testid="folder-more"
					>
						{t("Show {n} more", {
							n: Math.min(PAGE, rows.length - shownRows),
						})}
					</Button>
				</div>
			)}
			{files.length >= FOLDER_LIMITS.files && (
				<p className={s.limit}>
					{t("Showing the first {n} documents.", {
						n: FOLDER_LIMITS.files,
					})}
				</p>
			)}

			<Sheet
				open={menuFor !== null}
				title={menuFor?.name ?? ""}
				onClose={() => setMenuFor(null)}
				testId="folder-file-menu"
			>
				{menuFor && (
					<>
						<HandOffItems
							file={refOf(menuFor)}
							onDone={() => setMenuFor(null)}
							testPrefix="folder"
						/>
						<SheetItem
							icon={<Info size={20} />}
							onClick={() => {
								setDetailsFor(menuFor);
								setMenuFor(null);
							}}
							testId="folder-details"
						>
							{t("Details")}
						</SheetItem>
					</>
				)}
			</Sheet>
			{detailsFor && (
				<FileDetails
					file={refOf(detailsFor)}
					size={detailsFor.size}
					onClose={() => setDetailsFor(null)}
				/>
			)}
		</>
	);
}
