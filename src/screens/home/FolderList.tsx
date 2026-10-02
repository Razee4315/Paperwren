import {
	FOLDER_LIMITS,
	type FileRef,
	type Folder,
	type FolderFile,
	backend,
	formatBytes,
} from "@/lib/backend";
import { formatFromName, kindOf } from "@/lib/formats";
import { isolate, locale, t } from "@/lib/i18n";
import type { OpenRequest } from "@/lib/types";
import { FileDetails, HandOffItems } from "@/screens/viewer/FileMenu";
import { Button, FileBadge, IconButton, Sheet, SheetItem, Spinner } from "@/ui";
import { FolderX, Info, MoreVertical, RefreshCw, SearchX } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
	const [menuFor, setMenuFor] = useState<FolderFile | null>(null);
	const [detailsFor, setDetailsFor] = useState<FolderFile | null>(null);

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

	const shown = filterInForce(filter, counts);
	const q = query.trim().toLowerCase();
	const visible = files.filter(
		(f) =>
			(shown === "all" || kindOf(formatFromName(f.name)) === shown) &&
			(!q || f.name.toLowerCase().includes(q)),
	);

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
				{folder.name} <span className={s.bubble}>{files.length}</span>
				<span className={s.sectionActions}>
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

			{visible.length === 0 ? (
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
					{visible.map((f) => (
						<div key={f.request.id} className={s.row} data-testid="folder-file">
							<button
								type="button"
								className={s.rowMain}
								onClick={() => onOpen(f.request)}
							>
								<FileBadge format={formatFromName(f.name)} size={46} />
								<span className={s.rowText}>
									<span className={s.name}>{f.name}</span>
									<span className={s.meta}>
										{[
											f.folder,
											f.size > 0 ? formatBytes(f.size) : "",
											dated(f.modified),
										]
											.filter(Boolean)
											.map(isolate)
											.join(" · ")}
									</span>
								</span>
							</button>
							<IconButton
								label={t("More actions for {name}", { name: f.name })}
								onClick={() => setMenuFor(f)}
								data-testid="folder-file-more"
							>
								<MoreVertical size={20} />
							</IconButton>
						</div>
					))}
				</div>
			)}
			{files.length >= FOLDER_LIMITS.files && (
				<p className={s.limit}>
					{t("Showing the first {n} documents.", {
						n: FOLDER_LIMITS.files.toLocaleString(),
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
