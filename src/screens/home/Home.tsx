import { type FileRef, backend, formatBytes } from "@/lib/backend";
import { type FormatKind, kindLabel, kindOf } from "@/lib/formats";
import { isolate, locale, t } from "@/lib/i18n";
import type { OpenRequest, RecentEntry } from "@/lib/types";
import { FileDetails } from "@/screens/viewer/FileMenu";
import { useFolders } from "@/state/folders";
import { useRecents } from "@/state/recents";
import {
	EmptyScene,
	FileBadge,
	IconButton,
	Sheet,
	SheetItem,
	Wren,
	toast,
} from "@/ui";
import {
	AppWindow,
	Download,
	Folder as FolderIcon,
	FolderOpen,
	FolderPlus,
	Info,
	MoreVertical,
	Pin,
	PinOff,
	Plus,
	Search,
	SearchX,
	Settings as SettingsIcon,
	Share2,
	ShieldCheck,
	Trash2,
	X,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { FolderList } from "./FolderList";
import s from "./Home.module.css";

const FILTERS: Array<FormatKind | "all"> = [
	"all",
	"pdf",
	"doc",
	"sheet",
	"slides",
	"text",
	"image",
];

const KIND_COLOR: Record<FormatKind | "all", string> = {
	all: "var(--accent)",
	pdf: "var(--fmt-pdf)",
	doc: "var(--fmt-doc)",
	sheet: "var(--fmt-sheet)",
	slides: "var(--fmt-slides)",
	text: "var(--fmt-text)",
	image: "var(--fmt-image)",
	other: "var(--fmt-text)",
};

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
	if (d.toDateString() === yesterday.toDateString()) return t(t("Yesterday"));
	return d.toLocaleDateString(locale(), {
		month: "short",
		day: "numeric",
		year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
	});
}

function greeting(hour = new Date().getHours()): string {
	if (hour < 5) return t(t("Up late"));
	if (hour < 12) return t(t("Good morning"));
	if (hour < 18) return t(t("Good afternoon"));
	return t(t("Good evening"));
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
	const { entries, ready, togglePin, remove } = useRecents();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<FormatKind | "all">("all");
	const [menuFor, setMenuFor] = useState<RecentEntry | null>(null);
	const [detailsFor, setDetailsFor] = useState<RecentEntry | null>(null);
	// Where the list looks: recents, or one of the folders the user chose.
	const { folders, add: addFolder, remove: removeFolder } = useFolders();
	const [place, setPlace] = useState<string | null>(null);
	const activeFolder = folders.find((f) => f.id === place) ?? null;
	const canBrowse = backend.canBrowseFolders();
	const browse = () => {
		addFolder()
			.then((folder) => folder && setPlace(folder.id))
			.catch(() => toast(t("Couldn't open the folder picker")));
	};
	const refOf = (e: RecentEntry): FileRef => ({
		name: e.name,
		format: e.format,
		reopen: e.reopen,
	});
	const can =
		menuFor && !menuFor.unavailable ? backend.abilities(refOf(menuFor)) : null;
	const handOff = (action: Promise<void>, failure: string) => {
		setMenuFor(null);
		action.catch(() => toast(failure));
	};

	const counts = useMemo(() => {
		const c: Record<string, number> = { all: entries.length };
		for (const e of entries)
			c[kindOf(e.format)] = (c[kindOf(e.format)] ?? 0) + 1;
		return c;
	}, [entries]);

	const q = query.trim().toLowerCase();
	const visible = entries.filter(
		(e) =>
			(filter === "all" || kindOf(e.format) === filter) &&
			(!q || e.name.toLowerCase().includes(q)),
	);
	const pinned = visible.filter((e) => e.pinned);
	const recent = visible.filter((e) => !e.pinned);

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
							{e.unavailable ? t(t("Unavailable · tap to locate")) : meta(e)}
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
			<header className={s.bar}>
				<span className={s.logo}>
					<Wren size={30} />
				</span>
				<div className={s.brandCol}>
					<span className={s.greeting}>{greeting()}</span>
					<h1 className={s.brand}>
						Paper<span className="brand-accent">wren</span>
					</h1>
				</div>
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
							role="tablist"
							aria-label={t("Where to look")}
						>
							<button
								type="button"
								role="tab"
								className={s.place}
								aria-selected={!activeFolder}
								onClick={() => setPlace(null)}
								data-testid="place-recent"
							>
								{t("Recent")}
							</button>
							{folders.map((f) => (
								<button
									type="button"
									role="tab"
									key={f.id}
									className={s.place}
									aria-selected={activeFolder?.id === f.id}
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
										style={{ "--c": KIND_COLOR[kind] } as CSSProperties}
									>
										{label}
									</span>
								))}
							</div>
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
							<label className={s.search}>
								<Search size={18} />
								<input
									type="search"
									placeholder={t("Search your files")}
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									aria-label={t("Search recent files")}
									data-testid="search-input"
								/>
								{query && (
									<IconButton
										label={t("Clear search")}
										onClick={() => setQuery("")}
									>
										<X size={18} />
									</IconButton>
								)}
							</label>

							<div
								className={s.chips}
								role="toolbar"
								aria-label={t("Filter by type")}
							>
								{FILTERS.filter((f) => f === "all" || counts[f]).map((f) => (
									<button
										type="button"
										key={f}
										className={s.chip}
										aria-pressed={filter === f}
										onClick={() => setFilter(f)}
										style={{ "--c": KIND_COLOR[f] } as CSSProperties}
										data-testid={`filter-${f}`}
									>
										{f !== "all" && <span className={s.dot} />}
										{f === "all" ? t("All") : kindLabel(f)}
										<span className={s.count}>{counts[f] ?? 0}</span>
									</button>
								))}
							</div>

							{visible.length === 0 && (
								<div className={s.noMatch} data-testid="no-match">
									<SearchX size={36} strokeWidth={1.5} />
									{q
										? t("Nothing matches “{query}”.", { query: query.trim() })
										: t(t("No files of this type yet."))}
								</div>
							)}
							{pinned.length > 0 && (
								<>
									<h2 className={s.section}>
										{t("Pinned")}{" "}
										<span className={s.bubble}>{pinned.length}</span>
									</h2>
									<div className={s.list}>{pinned.map(row)}</div>
								</>
							)}
							{recent.length > 0 && (
								<>
									<h2 className={s.section}>
										{t("Recent")}{" "}
										<span className={s.bubble}>{recent.length}</span>
									</h2>
									<div className={s.list}>{recent.map(row)}</div>
								</>
							)}
						</>
					)}
				</div>
			</main>

			<button
				type="button"
				className={s.fab}
				onClick={onOpenFile}
				data-testid="open-file"
			>
				<Plus size={22} strokeWidth={2.5} />
				{t("Open file")}
			</button>

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
								toast(
									menuFor.pinned ? t(t("Unpinned")) : t(t("Pinned to the top")),
								);
							}}
							testId="menu-pin"
						>
							{menuFor.pinned ? t(t("Unpin")) : t(t("Pin to top"))}
						</SheetItem>
						{can?.share && (
							<SheetItem
								icon={
									can.shareIsDownload ? (
										<Download size={20} />
									) : (
										<Share2 size={20} />
									)
								}
								onClick={() =>
									handOff(
										backend.share(refOf(menuFor)),
										t(t("Couldn't share this file")),
									)
								}
								testId="menu-share"
							>
								{can.shareIsDownload ? t(t("Save a copy")) : t(t("Share"))}
							</SheetItem>
						)}
						{can?.openWith && (
							<SheetItem
								icon={<AppWindow size={20} />}
								onClick={() =>
									handOff(
										backend.openWith(refOf(menuFor)),
										t(t("No other app can open this file")),
									)
								}
							>
								{t("Open in another app")}
							</SheetItem>
						)}
						{can?.reveal && (
							<SheetItem
								icon={<FolderOpen size={20} />}
								onClick={() =>
									handOff(
										backend.reveal(refOf(menuFor)),
										t(t("Couldn't show the folder")),
									)
								}
							>
								{t("Show in folder")}
							</SheetItem>
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
								remove(menuFor.id);
								setMenuFor(null);
								toast(t("Removed from recents"));
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
							t(t("Last opened")),
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
