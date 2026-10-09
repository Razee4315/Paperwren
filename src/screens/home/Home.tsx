import { type FileRef, backend, formatBytes } from "@/lib/backend";
import { isDesktop } from "@/lib/env";
import { type FormatKind, kindOf } from "@/lib/formats";
import { isolate, locale, msg, t } from "@/lib/i18n";
import { keys } from "@/lib/keys";
import type { OpenRequest, RecentEntry } from "@/lib/types";
import { FileDetails, HandOffItems } from "@/screens/viewer/FileMenu";
import { MAX_FOLDERS, useFolders } from "@/state/folders";
import { useRecents } from "@/state/recents";
import {
	EmptyScene,
	FileBadge,
	IconButton,
	Sheet,
	SheetItem,
	Wren,
	kindColor,
	toast,
} from "@/ui";
import {
	ArrowUpDown,
	Check,
	Folder as FolderIcon,
	FolderPlus,
	Info,
	MoreVertical,
	Pin,
	PinOff,
	Plus,
	SearchX,
	Settings as SettingsIcon,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { FolderList } from "./FolderList";
import s from "./Home.module.css";
import {
	type KindFilter,
	SearchField,
	TypeChips,
	countKinds,
	filterInForce,
} from "./ListTools";

/** The formats listed on the empty state, each in its family colour. */
const SUPPORTED: Array<[string, FormatKind]> = [
	["PDF", "pdf"],
	["DOCX", "doc"],
	["DOC", "doc"],
	["XLSX", "sheet"],
	["XLS", "sheet"],
	["CSV", "sheet"],
	["PPTX", "slides"],
	["PPT", "slides"],
	["ODT", "doc"],
	["ODS", "sheet"],
	["ODP", "slides"],
	["RTF", "doc"],
	["MD", "text"],
	["TXT", "text"],
	["JPG", "image"],
	["PNG", "image"],
];

/** How the recents are ordered (pinned files always come first). */
const SORTS = [
	["opened", msg("Last opened")],
	["name", msg("Name")],
	["size", msg("Size")],
] as const;
type Sort = (typeof SORTS)[number][0];

export function relativeTime(ts: number, now = Date.now()): string {
	if (!ts) return "";
	const d = new Date(ts);
	const today = new Date(now);
	if (d.toDateString() === today.toDateString())
		return d.toLocaleTimeString(locale(), {
			hour: "numeric",
			minute: "2-digit",
		});
	const yesterday = new Date(now - 86_400_000);
	if (d.toDateString() === yesterday.toDateString()) return t("Yesterday");
	return d.toLocaleDateString(locale(), {
		month: "short",
		day: "numeric",
		year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
	});
}

function greeting(hour = new Date().getHours()): string {
	if (hour < 5) return t("Up late");
	if (hour < 12) return t("Good morning");
	if (hour < 18) return t("Good afternoon");
	return t("Good evening");
}

function meta(e: RecentEntry): string {
	const parts: string[] = [];
	if (e.position?.kind === "pdf" && e.position.page > 1)
		parts.push(t("Page {n}", { n: e.position.page }));
	else if (e.position?.kind === "slides" && e.position.slide > 0)
		parts.push(t("Slide {n}", { n: e.position.slide + 1 }));
	if (e.size > 0) parts.push(formatBytes(e.size));
	parts.push(relativeTime(e.openedAt));
	return parts.filter(Boolean).map(isolate).join(" · ");
}

export function Home({
	onOpenFile,
	onOpenRecent,
	onOpenRequest,
	onSettings,
}: {
	onOpenFile: () => void;
	onOpenRecent: (entry: RecentEntry) => void;
	/** Open a file found in a browsed folder. */
	onOpenRequest: (request: OpenRequest) => void;
	onSettings: () => void;
}) {
	const { entries, ready, togglePin, remove, restore } = useRecents();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<KindFilter>("all");
	const [sort, setSort] = useState<Sort>("opened");
	const [sortOpen, setSortOpen] = useState(false);
	const [menuFor, setMenuFor] = useState<RecentEntry | null>(null);
	const [detailsFor, setDetailsFor] = useState<RecentEntry | null>(null);
	// Where the list looks: recents, or one of the folders the user chose.
	const { folders, add: addFolder, remove: removeFolder } = useFolders();
	const [place, setPlace] = useState<string | null>(null);
	const activeFolder = folders.find((f) => f.id === place) ?? null;
	const canBrowse = backend.canBrowseFolders();
	const browse = () => {
		if (folders.length >= MAX_FOLDERS) {
			toast(
				t("Paperwren keeps up to {n} folders. Remove one to add another.", {
					n: MAX_FOLDERS,
				}),
			);
			return;
		}
		addFolder()
			.then((folder) => folder && setPlace(folder.id))
			.catch(() => toast(t("Couldn't open the folder picker")));
	};
	const refOf = (e: RecentEntry): FileRef => ({
		name: e.name,
		format: e.format,
		reopen: e.reopen,
	});

	const counts = useMemo(
		() => countKinds(entries.map((e) => kindOf(e.format))),
		[entries],
	);

	const shown = filterInForce(filter, counts);
	const q = query.trim().toLowerCase();
	const visible = entries.filter(
		(e) =>
			(shown === "all" || kindOf(e.format) === shown) &&
			(!q || e.name.toLowerCase().includes(q)),
	);
	// The list arrives newest first; the other orders are made here.
	const ordered =
		sort === "opened"
			? visible
			: [...visible].sort(
					sort === "name"
						? (a, b) =>
								a.name.localeCompare(b.name, locale(), {
									numeric: true,
									sensitivity: "base",
								})
						: (a, b) => b.size - a.size,
				);
	const pinned = ordered.filter((e) => e.pinned);
	const recent = ordered.filter((e) => !e.pinned);
	const sortButton = (
		<span className={s.sectionActions}>
			<IconButton
				label={t("Sort")}
				active={sort !== "opened"}
				onClick={() => setSortOpen(true)}
				data-testid="sort"
			>
				<ArrowUpDown size={18} />
			</IconButton>
		</span>
	);

	const row = (e: RecentEntry) => {
		const ratio = e.position?.kind === "scroll" ? e.position.ratio : null;
		return (
			<div
				key={e.id}
				className={`${s.row} ${e.unavailable ? s.unavailable : ""}`}
				data-testid="recent"
			>
				<button
					type="button"
					className={s.rowMain}
					onClick={() => onOpenRecent(e)}
					onContextMenu={(ev) => {
						ev.preventDefault();
						setMenuFor(e);
					}}
				>
					<FileBadge format={e.format} size={46} />
					<span className={s.rowText}>
						<span className={s.name}>
							{e.pinned && (
								<Pin size={13} className={s.pin} aria-label={t("Pinned")} />
							)}
							{e.name}
						</span>
						<span className={`${s.meta} ${e.unavailable ? s.warn : ""}`}>
							{ratio !== null && ratio > 0.01 && !e.unavailable && (
								<span
									className={s.progress}
									role="img"
									aria-label={t("{n}% read", { n: Math.round(ratio * 100) })}
								>
									<i style={{ width: `${Math.max(6, ratio * 100)}%` }} />
								</span>
							)}
							{e.unavailable ? t("Unavailable · tap to locate") : meta(e)}
						</span>
					</span>
				</button>
				<IconButton
					label={t("More actions for {name}", { name: e.name })}
					onClick={() => setMenuFor(e)}
				>
					<MoreVertical size={20} />
				</IconButton>
			</div>
		);
	};

	const hasAny = entries.length > 0;

	return (
		<div className={s.page} data-testid="home">
			{/* Where the app draws the window's frame, this bar moves the window. */}
			<header className={s.bar} data-tauri-drag-region="deep">
				<span className={s.logo}>
					<Wren size={30} />
				</span>
				<div className={s.brandCol}>
					<span className={s.greeting}>{greeting()}</span>
					<h1 className={s.brand}>
						Paper<span className="brand-accent">wren</span>
					</h1>
				</div>
				{isDesktop && (
					<button
						type="button"
						className={s.open}
						onClick={onOpenFile}
						title={`${t("Open file")} (${keys("Ctrl+O")})`}
						data-testid="open-file"
					>
						<Plus size={18} strokeWidth={2.5} />
						{t("Open file")}
					</button>
				)}
				<IconButton
					label={t("Settings")}
					onClick={onSettings}
					data-testid="open-settings"
				>
					<SettingsIcon size={22} />
				</IconButton>
			</header>

			<main className={s.scroll}>
				<div className={s.column}>
					{canBrowse && (hasAny || folders.length > 0) && (
						<div
							className={s.places}
							role="toolbar"
							aria-label={t("Where to look")}
						>
							<button
								type="button"
								className={s.place}
								aria-pressed={!activeFolder}
								onClick={() => setPlace(null)}
								data-testid="place-recent"
							>
								{t("Recent")}
							</button>
							{folders.map((f) => (
								<button
									type="button"
									key={f.id}
									className={s.place}
									aria-pressed={activeFolder?.id === f.id}
									onClick={() => setPlace(f.id)}
									data-testid="place-folder"
								>
									<FolderIcon size={16} />
									{f.name}
								</button>
							))}
							<button
								type="button"
								className={`${s.place} ${s.addPlace}`}
								onClick={browse}
								data-testid="add-folder"
							>
								<FolderPlus size={16} />
								{t("Add folder")}
							</button>
						</div>
					)}

					{activeFolder && (
						<FolderList
							key={activeFolder.id}
							folder={activeFolder}
							onOpen={onOpenRequest}
							onRemove={() => {
								removeFolder(activeFolder.id);
								setPlace(null);
								toast(
									t("Removed “{name}”. Its files are untouched.", {
										name: activeFolder.name,
									}),
								);
							}}
						/>
					)}

					{!activeFolder && ready && !hasAny && (
						<div className={s.empty} data-testid="empty-state">
							<EmptyScene />
							<h2 className={s.emptyTitle}>{t("Open any document")}</h2>
							<p className={s.emptyBody}>
								{t(
									"Fast, private and offline. Everything you open shows up here.",
								)}
							</p>
							<div className={s.formats}>
								{SUPPORTED.map(([label, kind]) => (
									<span
										key={label}
										className={s.fmt}
										style={{ "--c": kindColor(kind) } as CSSProperties}
									>
										{label}
									</span>
								))}
							</div>
							{isDesktop && (
								<p className={s.emptyBody} data-testid="drop-tip">
									{keys(
										t("Drop a file anywhere on this window, or press Ctrl+O."),
									)}
								</p>
							)}
							<p className={s.privacy}>
								<ShieldCheck size={16} />{" "}
								{t("No ads · no accounts · no tracking")}
							</p>
							{canBrowse && folders.length === 0 && (
								<button
									type="button"
									className={s.browse}
									onClick={browse}
									data-testid="browse-folder"
								>
									<FolderPlus size={18} />
									{t("Browse a folder")}
								</button>
							)}
						</div>
					)}

					{!activeFolder && hasAny && (
						<>
							<SearchField
								value={query}
								onChange={setQuery}
								placeholder={t("Search your files")}
								label={t("Search recent files")}
								testId="search-input"
							/>
							<TypeChips counts={counts} value={shown} onChange={setFilter} />

							{visible.length === 0 && (
								<div className={s.noMatch} data-testid="no-match">
									<SearchX size={36} strokeWidth={1.5} />
									{q
										? t("Nothing matches “{query}”.", { query: query.trim() })
										: t("No files of this type yet.")}
								</div>
							)}
							{pinned.length > 0 && (
								<>
									<h2 className={s.section}>
										{t("Pinned")}{" "}
										<span className={s.bubble}>{pinned.length}</span>
										{sortButton}
									</h2>
									<div className={s.list}>{pinned.map(row)}</div>
								</>
							)}
							{recent.length > 0 && (
								<>
									<h2 className={s.section}>
										{t("Recent")}{" "}
										<span className={s.bubble}>{recent.length}</span>
										{pinned.length === 0 && sortButton}
									</h2>
									<div className={s.list}>{recent.map(row)}</div>
								</>
							)}
						</>
					)}
				</div>
			</main>

			{/* A thumb's button at the foot of a phone; on a desktop it is in
			    the bar, beside Settings. */}
			{!isDesktop && (
				<button
					type="button"
					className={s.fab}
					onClick={onOpenFile}
					data-testid="open-file"
				>
					<Plus size={22} strokeWidth={2.5} />
					{t("Open file")}
				</button>
			)}

			<Sheet
				open={sortOpen}
				title={t("Sort by")}
				onClose={() => setSortOpen(false)}
				testId="sort-menu"
			>
				{SORTS.map(([value, label]) => (
					<SheetItem
						key={value}
						icon={
							<Check
								size={20}
								style={{ visibility: sort === value ? "visible" : "hidden" }}
							/>
						}
						onClick={() => {
							setSort(value);
							setSortOpen(false);
						}}
						testId={`sort-${value}`}
					>
						{t(label)}
					</SheetItem>
				))}
			</Sheet>
			<Sheet
				open={menuFor !== null}
				title={menuFor?.name ?? ""}
				onClose={() => setMenuFor(null)}
				testId="recent-menu"
			>
				{menuFor && (
					<>
						<SheetItem
							icon={menuFor.pinned ? <PinOff size={20} /> : <Pin size={20} />}
							onClick={() => {
								togglePin(menuFor.id);
								setMenuFor(null);
								toast(menuFor.pinned ? t("Unpinned") : t("Pinned to the top"));
							}}
							testId="menu-pin"
						>
							{menuFor.pinned ? t("Unpin") : t("Pin to top")}
						</SheetItem>
						{!menuFor.unavailable && (
							<HandOffItems
								file={refOf(menuFor)}
								onDone={() => setMenuFor(null)}
								testPrefix="menu"
							/>
						)}
						<SheetItem
							icon={<Info size={20} />}
							onClick={() => {
								setDetailsFor(menuFor);
								setMenuFor(null);
							}}
							hint={meta(menuFor)}
							testId="menu-details"
						>
							{t("Details")}
						</SheetItem>
						<SheetItem
							icon={<Trash2 size={20} />}
							danger
							hint={t("The file itself is not deleted")}
							onClick={() => {
								const previous = remove(menuFor.id);
								setMenuFor(null);
								toast(t("Removed from recents"), {
									label: t("Undo"),
									run: () => restore(previous),
								});
							}}
							testId="menu-remove"
						>
							{t("Remove from recents")}
						</SheetItem>
					</>
				)}
			</Sheet>
			{detailsFor && (
				<FileDetails
					file={refOf(detailsFor)}
					size={detailsFor.size}
					extra={[
						[
							t("Last opened"),
							new Date(detailsFor.openedAt).toLocaleString(locale(), {
								dateStyle: "medium",
								timeStyle: "short",
							}),
						],
					]}
					onClose={() => setDetailsFor(null)}
				/>
			)}
		</div>
	);
}
