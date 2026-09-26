import { formatBytes } from "@/lib/backend";
import { type FormatKind, KIND_LABEL, kindOf } from "@/lib/formats";
import type { RecentEntry } from "@/lib/types";
import { useRecents } from "@/state/recents";
import { FileBadge, IconButton, Sheet, SheetItem, toast } from "@/ui";
import {
	Info,
	MoreVertical,
	Pin,
	PinOff,
	Plus,
	Search,
	Settings as SettingsIcon,
	ShieldCheck,
	Trash2,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import s from "./Home.module.css";

const FILTERS: Array<FormatKind | "all"> = [
	"all",
	"pdf",
	"doc",
	"sheet",
	"slides",
	"text",
];

export function relativeTime(ts: number, now = Date.now()): string {
	if (!ts) return "";
	const d = new Date(ts);
	const today = new Date(now);
	if (d.toDateString() === today.toDateString())
		return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	const yesterday = new Date(now - 86_400_000);
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	return d.toLocaleDateString([], {
		month: "short",
		day: "numeric",
		year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
	});
}

function meta(e: RecentEntry): string {
	const parts: string[] = [];
	if (e.position?.kind === "pdf" && e.position.page > 1)
		parts.push(`Page ${e.position.page}`);
	else if (e.position?.kind === "slides" && e.position.slide > 0)
		parts.push(`Slide ${e.position.slide + 1}`);
	if (e.size > 0) parts.push(formatBytes(e.size));
	parts.push(relativeTime(e.openedAt));
	return parts.filter(Boolean).join(" · ");
}

export function Home({
	onOpenFile,
	onOpenRecent,
	onSettings,
}: {
	onOpenFile: () => void;
	onOpenRecent: (entry: RecentEntry) => void;
	onSettings: () => void;
}) {
	const { entries, ready, togglePin, remove } = useRecents();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<FormatKind | "all">("all");
	const [menuFor, setMenuFor] = useState<RecentEntry | null>(null);

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

	const row = (e: RecentEntry, i: number) => (
		<div
			key={e.id}
			className={`${s.row} ${e.unavailable ? s.unavailable : ""}`}
			style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
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
				<FileBadge format={e.format} />
				<span className={s.rowText}>
					<span className={s.name}>
						{e.pinned && (
							<Pin size={13} className={s.pin} aria-label="Pinned" />
						)}
						{e.name}
					</span>
					<span className={`${s.meta} ${e.unavailable ? s.warn : ""}`}>
						{e.unavailable ? "Unavailable · tap to locate" : meta(e)}
					</span>
				</span>
			</button>
			<IconButton
				label={`More actions for ${e.name}`}
				onClick={() => setMenuFor(e)}
			>
				<MoreVertical size={20} />
			</IconButton>
		</div>
	);

	const hasAny = entries.length > 0;

	return (
		<div className={s.page} data-testid="home">
			<header className={s.bar}>
				<img
					className={s.logo}
					src="/assets/icon.svg"
					alt=""
					width={32}
					height={32}
				/>
				<h1 className={s.brand}>Paperwren</h1>
				<IconButton
					label="Settings"
					onClick={onSettings}
					data-testid="open-settings"
				>
					<SettingsIcon size={22} />
				</IconButton>
			</header>

			<main className={s.scroll}>
				<div className={s.column}>
					{ready && !hasAny && (
						<div className={s.empty} data-testid="empty-state">
							<div className={s.tiles}>
								<FileBadge format="pdf" size={52} />
								<FileBadge format="docx" size={52} />
								<FileBadge format="xlsx" size={52} />
								<FileBadge format="pptx" size={52} />
							</div>
							<h2 className={s.emptyTitle}>Open any document</h2>
							<p className={s.emptyBody}>
								PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV and text.
								Files you open appear here.
							</p>
							<p className={s.privacy}>
								<ShieldCheck size={16} /> Offline. No accounts, no tracking.
							</p>
						</div>
					)}

					{hasAny && (
						<>
							<label className={s.search}>
								<Search size={18} />
								<input
									type="search"
									placeholder="Search recent files"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									aria-label="Search recent files"
									data-testid="search-input"
								/>
								{query && (
									<IconButton label="Clear search" onClick={() => setQuery("")}>
										<X size={18} />
									</IconButton>
								)}
							</label>

							<div
								className={s.chips}
								role="toolbar"
								aria-label="Filter by type"
							>
								{FILTERS.filter((f) => f === "all" || counts[f]).map((f) => (
									<button
										type="button"
										key={f}
										className={s.chip}
										aria-pressed={filter === f}
										onClick={() => setFilter(f)}
										data-testid={`filter-${f}`}
									>
										{f === "all" ? "All" : KIND_LABEL[f]}
										<span className={s.count}>{counts[f] ?? 0}</span>
									</button>
								))}
							</div>

							{visible.length === 0 && (
								<p className={s.noMatch} data-testid="no-match">
									{q
										? `Nothing matches “${query.trim()}”.`
										: "No files of this type yet."}
								</p>
							)}
							{pinned.length > 0 && (
								<>
									<h2 className={s.section}>Pinned</h2>
									<div className={s.list}>{pinned.map(row)}</div>
								</>
							)}
							{recent.length > 0 && (
								<>
									<h2 className={s.section}>Recent</h2>
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
				Open file
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
							}}
							testId="menu-pin"
						>
							{menuFor.pinned ? "Unpin" : "Pin to top"}
						</SheetItem>
						<SheetItem
							icon={<Info size={20} />}
							onClick={() => setMenuFor(null)}
							hint={meta(menuFor)}
						>
							Details
						</SheetItem>
						<SheetItem
							icon={<Trash2 size={20} />}
							danger
							hint="The file itself is not deleted"
							onClick={() => {
								remove(menuFor.id);
								setMenuFor(null);
								toast("Removed from recents");
							}}
							testId="menu-remove"
						>
							Remove from recents
						</SheetItem>
					</>
				)}
			</Sheet>
		</div>
	);
}
