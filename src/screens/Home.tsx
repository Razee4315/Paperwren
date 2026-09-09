import { BrandMark } from "@/components/BrandMark";
import {
	type FileFormat,
	FormatBadge,
	formatCssVar,
} from "@/components/FormatBadge";
import {
	Button,
	ConfirmDialog,
	FAB,
	IconButton,
	Sheet,
	showSnackbar,
} from "@/components/ui";
import { formatBytes } from "@/lib/backend";
import { positionPageIndex } from "@/lib/recents";
import type { RecentsEntry } from "@/lib/types";
import { useRecents } from "@/state/RecentsContext";
import { CoachBubble } from "@/state/coachMarks";
import { layout, motion, radius, space, type } from "@/theme";
import {
	BookOpen,
	Check,
	ChevronDown,
	Info,
	MoreVertical,
	Pin,
	PinOff,
	Plus,
	Search as SearchIcon,
	Settings as SettingsIcon,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

/**
 * SCR-05 Home, redesigned around the Paperwren brand header and a
 * spotlight dashboard: the real app-icon wren up top, a Continue
 * reading spotlight, working format filter chips, a working sort
 * menu, and full-width recent rows whose meta carries the format
 * ink. Every control is live: chips filter, sort reorders, search
 * narrows, and the overflow/long-press sheet still owns row actions.
 * Unavailable files stay honest (dimmed with a repair hint).
 */

const Page = styled.div`
	flex: 1;
	display: flex;
	flex-direction: column;
	height: 100%;
	overflow: hidden;
	background: var(--bg);
	animation: pw-screen-in ${motion.dur.standard} ${motion.ease.enter};
`;

const AppBar = styled.header`
	padding: calc(10px + var(--safe-area-top, 0px)) ${space[4]} 6px;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: ${space[2]};
`;

const Brand = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
	min-width: 0;
`;

/** The launcher tile itself — the folded-paper wren on its black
 * tile, inlined so it is crisp on every density and theme. A hair
 * of border keeps it separable from dark surfaces. */
const LogoTile = styled.div`
	width: 40px;
	height: 40px;
	border-radius: 13px;
	flex-shrink: 0;
	box-shadow:
		0 0 0 1px var(--border),
		var(--shadow-1);
`;

const Title = styled.h1`
	${type.titleL};
	color: var(--ink-1);
	font-size: 1.375rem;
	font-weight: 800;
	letter-spacing: -0.02em;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`;

const AppBarActions = styled.div`
	display: flex;
	align-items: center;
	gap: ${space[1]};
	flex-shrink: 0;
`;

const SearchRow = styled.div`
	padding: 4px ${space[4]} 8px;
	max-width: ${layout.contentMaxWidth};
	width: 100%;
	margin: 0 auto;
	flex-shrink: 0;
	animation: pw-item-in ${motion.dur.fast} ${motion.ease.enter};
`;

const SearchField = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	height: 50px;
	padding: 0 4px 0 16px;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: ${radius.full};
	color: var(--ink-3);
	transition: border-color ${motion.dur.instant} ${motion.ease.standard};

	&:focus-within {
		border-color: var(--accent);
		color: var(--accent-strong);
	}
`;

const SearchInput = styled.input`
	flex: 1;
	min-width: 0;
	border: none;
	background: none;
	outline: none;
	color: var(--ink-1);
	${type.body};
	font-family: inherit;

	&::placeholder {
		color: var(--ink-3);
	}
`;

const Scroll = styled.main`
	flex: 1;
	overflow-y: auto;
	padding: 0 ${space[4]} 120px;
	max-width: ${layout.contentMaxWidth};
	width: 100%;
	margin: 0 auto;
`;

/** Horizontally scrolling format chips; the bleed margins let the
 * row scroll edge-to-edge while the content column stays inset. */
const Chips = styled.div`
	display: flex;
	gap: 8px;
	overflow-x: auto;
	scrollbar-width: none;
	margin: 10px calc(-1 * ${space[4]}) 0;
	padding: 2px ${space[4]};

	&::-webkit-scrollbar {
		display: none;
	}
`;

const Chip = styled.button<{ $active: boolean; $dim?: boolean }>`
	display: inline-flex;
	align-items: center;
	gap: 7px;
	padding: 7px 14px;
	border-radius: ${radius.full};
	border: 1px solid
		${({ $active }) => ($active ? "transparent" : "var(--border)")};
	background: ${({ $active }) => ($active ? "var(--ink-1)" : "var(--surface)")};
	color: ${({ $active }) => ($active ? "var(--bg)" : "var(--ink-2)")};
	${type.small};
	font-weight: ${({ $active }) => ($active ? 700 : 600)};
	white-space: nowrap;
	flex-shrink: 0;
	cursor: pointer;
	opacity: ${({ $dim }) => ($dim ? 0.55 : 1)};
	transition:
		background-color ${motion.dur.instant} ${motion.ease.standard},
		color ${motion.dur.instant} ${motion.ease.standard},
		transform ${motion.dur.instant} ${motion.ease.standard};

	&:active {
		transform: scale(0.95);
	}
	&:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
`;

const ChipDot = styled.span<{ $color: string }>`
	width: 7px;
	height: 7px;
	border-radius: ${radius.full};
	background: ${({ $color }) => $color};
	flex-shrink: 0;
`;

const ChipCount = styled.span`
	font-size: 0.6875rem;
	font-variant-numeric: tabular-nums;
	opacity: 0.6;
`;

const SectionHead = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: ${space[2]};
	margin: ${space[4]} 0 ${space[2]};
`;

const SectionLabel = styled.h2`
	${type.caption};
	color: var(--ink-3);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`;

const SortWrap = styled.div`
	position: relative;
	flex-shrink: 0;
`;

const SortButton = styled.button`
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 6px 2px;
	background: none;
	border: none;
	cursor: pointer;
	color: var(--ink-3);
	${type.caption};
	font-weight: 700;
	letter-spacing: 0.04em;

	&:hover {
		color: var(--ink-2);
	}
	&:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 6px;
	}
`;

const SortMenu = styled.div`
	position: absolute;
	right: 0;
	top: calc(100% + 2px);
	z-index: 60;
	min-width: 168px;
	padding: 4px;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: ${radius.m};
	box-shadow: var(--shadow-3);
	/* Entrance nudges position only: an opacity keyframe here would
	   leave the menu see-through if the animation is ever throttled
	   mid-flight (backgrounded webviews do exactly that). */
	transform-origin: top right;
	animation: pw-menu-in ${motion.dur.fast} ${motion.ease.enter};
`;

const SortOption = styled.button<{ $active: boolean }>`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: ${space[3]};
	width: 100%;
	padding: 9px 12px;
	background: none;
	border: none;
	border-radius: 8px;
	cursor: pointer;
	color: ${({ $active }) => ($active ? "var(--accent-strong)" : "var(--ink-1)")};
	${type.small};
	font-weight: ${({ $active }) => ($active ? 700 : 500)};
	text-align: left;

	&:hover {
		background: var(--surface-2);
	}
`;

/** Full-width rows on compact widths; a balanced grid only when the
 * cards can actually use the width (audit 12.2). */
const List = styled.div`
	display: grid;
	grid-template-columns: 1fr;
	gap: ${space[2]};
	@media (min-width: 720px) {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
		gap: ${space[3]};
	}
`;

const RowCard = styled.button<{ $index: number; $dim?: boolean }>`
	animation: pw-item-in ${motion.dur.standard} ${motion.ease.enter} both;
	animation-delay: ${({ $index }) => Math.min($index * 40, 320)}ms;
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: center;
	gap: ${space[3]};
	padding: ${space[3]};
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: ${radius.l};
	cursor: pointer;
	text-align: left;
	font-family: inherit;
	transition:
		background-color ${motion.dur.instant} ${motion.ease.standard},
		transform ${motion.dur.instant} ${motion.ease.standard},
		box-shadow ${motion.dur.standard} ${motion.ease.standard};
	min-width: 0;
	min-height: 76px;
	opacity: ${({ $dim }) => ($dim ? 0.62 : 1)};

	&:hover {
		background: var(--surface-2);
		box-shadow: var(--shadow-1);
	}
	&:active {
		transform: scale(0.98);
		background: var(--surface-2);
	}
`;

const RowText = styled.span`
	display: flex;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
`;

const RowName = styled.span`
	${type.titleS};
	font-weight: 700;
	color: var(--ink-1);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 100%;
`;

const RowMeta = styled.span`
	${type.small};
	color: var(--ink-3);
	font-variant-numeric: tabular-nums;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`;

/** The format tag inside a row's meta line, in the format ink. */
const FmtTag = styled.span<{ $color: string }>`
	color: ${({ $color }) => $color};
	font-weight: 700;
	font-size: 0.6875rem;
	letter-spacing: 0.05em;
`;

const MetaSep = styled.span`
	opacity: 0.55;
	padding: 0 1px;
`;

const UnavailableChip = styled.span`
	${type.small};
	color: var(--danger, #b3261e);
	font-weight: 600;
`;

/** Continue reading spotlight for the most recent healthy document. */
const ContinueCard = styled.button`
	display: flex;
	align-items: center;
	gap: ${space[3]};
	width: 100%;
	padding: ${space[4]};
	margin-top: ${space[3]};
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: ${radius.xl};
	cursor: pointer;
	text-align: left;
	font-family: inherit;
	box-shadow: var(--shadow-1);
	transition: transform ${motion.dur.instant} ${motion.ease.standard};

	&:active {
		transform: scale(0.99);
	}
`;

const ContinueBody = styled.span`
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
	flex: 1;
`;

const ContinueTitle = styled.span`
	${type.caption};
	color: var(--ink-3);
	text-transform: uppercase;
	letter-spacing: 0.08em;
`;

const ContinueName = styled.span`
	${type.titleS};
	font-weight: 700;
	color: var(--ink-1);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`;

const ContinueSub = styled.span`
	${type.small};
	color: var(--ink-2);
	font-variant-numeric: tabular-nums;
`;

const ContinueCta = styled.span`
	display: inline-flex;
	align-items: center;
	gap: 6px;
	color: var(--accent-strong);
	${type.small};
	font-weight: 700;
	flex-shrink: 0;
`;

const Skeleton = styled.div<{ $w?: string }>`
	height: 76px;
	border-radius: ${radius.l};
	background: var(--surface-2);
	margin-bottom: ${space[2]};
`;

const ChipsSkeleton = styled.div`
	display: flex;
	gap: 8px;
	margin-top: 12px;
`;

const ChipSkeleton = styled.div`
	width: 84px;
	height: 34px;
	border-radius: ${radius.full};
	background: var(--surface-2);
`;

const NoMatch = styled.div`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: ${space[3]};
	padding: ${space[8]} ${space[4]};
	text-align: center;
	color: var(--ink-2);
	${type.body};
`;

const EmptyState = styled.div`
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	text-align: center;
	gap: ${space[3]};
	padding: ${space[6]};
	max-width: 420px;
	margin: 0 auto;
`;

const EmptyArt = styled.div`
	position: relative;
	width: 140px;
	height: 110px;
`;

const EmptySheet = styled.div<{ $color: string; $rot: string; $op?: number }>`
	position: absolute;
	width: 52px;
	height: 68px;
	border-radius: ${radius.m};
	background: ${({ $color }) => $color};
	opacity: ${({ $op }) => $op ?? 1};
	left: 44px;
	top: 20px;
	transform: rotate(${({ $rot }) => $rot});
`;

const EmptyHeadline = styled.h2`
	${type.display};
	font-size: 1.75rem;
	color: var(--ink-1);
`;

const EmptyBody = styled.p`
	${type.body};
	color: var(--ink-2);
`;

function relativeDate(ts: number): string {
	const d = new Date(ts);
	const now = new Date();
	if (!Number.isFinite(ts) || ts <= 0 || Number.isNaN(d.getTime())) {
		return "Previously opened";
	}
	const sameDay = d.toDateString() === now.toDateString();
	if (sameDay) {
		return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
	}
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	return d.toLocaleDateString([], {
		month: "short",
		day: "numeric",
		year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
	});
}

function recentMeta(entry: RecentsEntry): {
	format: string;
	color: string;
	rest: string[];
} {
	const format =
		entry.format === "unknown" ? "File" : entry.format.toUpperCase();
	const parts: string[] = [];
	if (entry.size > 0) parts.push(formatBytes(entry.size));
	const pageIndex = positionPageIndex(entry.position);
	if (pageIndex !== undefined && entry.format === "pdf") {
		parts.push(`Page ${pageIndex + 1}`);
	}
	parts.push(relativeDate(entry.lastOpenedAt));
	return {
		format,
		color: formatCssVar(entry.format).base,
		rest: parts,
	};
}

/** Dashboard filter chips. Sheets covers the spreadsheet family
 * (xlsx + csv); Text covers plain text and Markdown. */
const FILTERS: Array<{
	key: string;
	label: string;
	dot: string | null;
	matches: (f: FileFormat) => boolean;
}> = [
	{
		key: "all",
		label: "All files",
		dot: null,
		matches: () => true,
	},
	{
		key: "pdf",
		label: "PDFs",
		dot: "var(--fmt-pdf)",
		matches: (f) => f === "pdf",
	},
	{
		key: "docx",
		label: "Word",
		dot: "var(--fmt-docx)",
		matches: (f) => f === "docx",
	},
	{
		key: "xlsx",
		label: "Sheets",
		dot: "var(--fmt-xlsx)",
		matches: (f) => f === "xlsx" || f === "csv",
	},
	{
		key: "pptx",
		label: "Slides",
		dot: "var(--fmt-pptx)",
		matches: (f) => f === "pptx",
	},
	{
		key: "txt",
		label: "Text",
		dot: "var(--ink-3)",
		matches: (f) => f === "txt",
	},
];

const SORTS: Array<{ key: SortKey; label: string }> = [
	{ key: "recent", label: "Recent" },
	{ key: "name", label: "Name" },
	{ key: "size", label: "Size" },
];

type SortKey = "recent" | "name" | "size";

function EmptyIllustration() {
	return (
		<EmptyArt aria-hidden="true">
			<EmptySheet $color="var(--fmt-xlsx)" $rot="-12deg" $op={0.85} />
			<EmptySheet $color="var(--fmt-docx)" $rot="0deg" $op={0.85} />
			<EmptySheet $color="var(--fmt-pdf)" $rot="10deg" />
		</EmptyArt>
	);
}

export function Home({
	onPickFile,
	onOpenRecent,
	onOpenSettings,
}: {
	onPickFile: () => void;
	onOpenRecent: (entry: RecentsEntry) => void;
	onOpenSettings: () => void;
}) {
	const { entries, ready, togglePin, remove, clearAll, restore } = useRecents();
	const [sheetEntry, setSheetEntry] = useState<RecentsEntry | null>(null);
	const [confirmClear, setConfirmClear] = useState(false);
	const [fabHidden, setFabHidden] = useState(false);
	const [filterKey, setFilterKey] = useState("all");
	const [sortKey, setSortKey] = useState<SortKey>("recent");
	const [sortOpen, setSortOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const scrollRef = useRef<HTMLElement | null>(null);
	const lastScrollTop = useRef(0);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const sortWrapRef = useRef<HTMLDivElement | null>(null);

	const activeFilter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];

	// FAB hides on scroll down, returns on scroll up (docs/04).
	const onScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const goingDown = el.scrollTop > lastScrollTop.current + 4;
		const goingUp = el.scrollTop < lastScrollTop.current - 4;
		if (goingDown && el.scrollTop > 80) setFabHidden(true);
		else if (goingUp) setFabHidden(false);
		lastScrollTop.current = el.scrollTop;
	}, []);

	useEffect(() => {
		if (entries.length === 0) setFabHidden(false);
	}, [entries.length]);

	// Dismiss the sort menu on any outside press or Escape.
	useEffect(() => {
		if (!sortOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			if (
				sortWrapRef.current &&
				e.target instanceof Node &&
				!sortWrapRef.current.contains(e.target)
			) {
				setSortOpen(false);
			}
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setSortOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [sortOpen]);

	// Focus the field when search opens; reset when it closes.
	useEffect(() => {
		if (searchOpen) {
			searchInputRef.current?.focus();
		} else {
			setSearchQuery("");
		}
	}, [searchOpen]);

	const query = searchQuery.trim().toLowerCase();
	const searching = query.length > 0;

	const counts = useMemo(() => {
		const map = new Map<string, number>();
		for (const f of FILTERS) {
			map.set(
				f.key,
				f.key === "all"
					? entries.length
					: entries.filter((e) => f.matches(e.format)).length,
			);
		}
		return map;
	}, [entries]);

	const sortEntries = useCallback(
		(list: RecentsEntry[]): RecentsEntry[] => {
			if (sortKey === "recent") return list;
			const copy = [...list];
			if (sortKey === "name") {
				copy.sort((a, b) => a.name.localeCompare(b.name));
			} else {
				copy.sort((a, b) => b.size - a.size);
			}
			return copy;
		},
		[sortKey],
	);

	const visible = useMemo(
		() =>
			sortEntries(
				entries.filter(
					(e) =>
						activeFilter.matches(e.format) &&
						(!searching || e.name.toLowerCase().includes(query)),
				),
			),
		[entries, activeFilter, searching, query, sortEntries],
	);

	const pinnedVisible = searching ? [] : visible.filter((e) => e.pinned);
	const recentVisible = searching ? visible : visible.filter((e) => !e.pinned);
	const continueEntry =
		!searching && filterKey === "all"
			? entries.find(
					(e) => !e.unavailable && positionPageIndex(e.position) !== undefined,
				)
			: undefined;

	const closeSearch = () => {
		setSearchOpen(false);
		setSearchQuery("");
	};

	const longPressFired = useRef(false);

	const longPressProps = (entry: RecentsEntry) => ({
		onContextMenu: (e: React.MouseEvent) => {
			e.preventDefault();
			setSheetEntry(entry);
		},
		onTouchStart: (e: React.TouchEvent) => {
			const target = e.currentTarget;
			const timer = window.setTimeout(() => {
				longPressFired.current = true;
				setSheetEntry(entry);
			}, 500);
			const cancel = () => {
				window.clearTimeout(timer);
				target.removeEventListener("touchend", cancel);
				target.removeEventListener("touchmove", cancel);
				target.removeEventListener("touchcancel", cancel);
			};
			target.addEventListener("touchend", cancel);
			target.addEventListener("touchmove", cancel);
			target.addEventListener("touchcancel", cancel);
		},
	});

	const renderMeta = (entry: RecentsEntry) => {
		const meta = recentMeta(entry);
		return (
			<RowMeta>
				<FmtTag $color={meta.color}>{meta.format}</FmtTag>
				{meta.rest.map((part, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static meta segments in a fixed order
					<span key={i}>
						<MetaSep>·</MetaSep> {part}
					</span>
				))}
			</RowMeta>
		);
	};

	const renderRow = (entry: RecentsEntry, i: number) => (
		<RowCard
			key={entry.id}
			$index={i}
			$dim={entry.unavailable}
			onClick={() => {
				if (longPressFired.current) {
					longPressFired.current = false;
					return;
				}
				onOpenRecent(entry);
			}}
			{...longPressProps(entry)}
			data-testid={`recent-${entry.id}`}
		>
			<FormatBadge format={entry.format} size={48} />
			<RowText>
				<RowName>{entry.name}</RowName>
				{renderMeta(entry)}
				{entry.unavailable && (
					<UnavailableChip>Not available — tap to fix</UnavailableChip>
				)}
			</RowText>
			{/* Visible overflow: actions are never long-press-only. */}
			<IconButton
				label={`Actions for ${entry.name}`}
				onClick={(e) => {
					e.stopPropagation();
					setSheetEntry(entry);
				}}
				data-testid={`recent-actions-${entry.id}`}
			>
				<MoreVertical size={20} />
			</IconButton>
		</RowCard>
	);

	const hasList = entries.length > 0;

	return (
		<Page data-testid="home">
			<AppBar>
				<Brand>
					<LogoTile>
						<BrandMark size={40} title="" />
					</LogoTile>
					<Title>Paperwren</Title>
				</Brand>
				<AppBarActions>
					<IconButton
						label={searchOpen ? "Close search" : "Search documents"}
						active={searchOpen}
						onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
						data-testid="open-search"
					>
						{searchOpen ? <X size={22} /> : <SearchIcon size={21} />}
					</IconButton>
					<IconButton
						label="Settings"
						onClick={onOpenSettings}
						data-testid="open-settings"
					>
						<SettingsIcon size={22} />
					</IconButton>
				</AppBarActions>
			</AppBar>

			{searchOpen && (
				<SearchRow>
					<SearchField>
						<SearchIcon size={17} />
						<SearchInput
							ref={searchInputRef}
							type="text"
							placeholder="Search documents"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Escape") closeSearch();
							}}
							enterKeyHint="search"
							aria-label="Search documents"
							data-testid="search-input"
						/>
						{searching && (
							<IconButton
								label="Clear search"
								onClick={() => setSearchQuery("")}
							>
								<X size={18} />
							</IconButton>
						)}
					</SearchField>
				</SearchRow>
			)}

			{!ready ? (
				<Scroll aria-busy="true">
					<ChipsSkeleton>
						<ChipSkeleton />
						<ChipSkeleton />
						<ChipSkeleton />
					</ChipsSkeleton>
					<SectionLabel>Recent files</SectionLabel>
					<Skeleton />
					<Skeleton />
					<Skeleton />
				</Scroll>
			) : !hasList ? (
				<EmptyState data-testid="empty-state">
					<EmptyIllustration />
					<EmptyHeadline>Nothing here yet.</EmptyHeadline>
					<EmptyBody>
						Files you open will appear here, and stay on this device only.
					</EmptyBody>
					<Button
						variant="filled"
						onClick={onPickFile}
						data-testid="empty-open-button"
					>
						<Plus size={18} />
						Open a file
					</Button>
				</EmptyState>
			) : (
				<Scroll ref={scrollRef} onScroll={onScroll}>
					{continueEntry && (
						<ContinueCard
							onClick={() => onOpenRecent(continueEntry)}
							data-testid="continue-reading"
						>
							<FormatBadge format={continueEntry.format} size={44} />
							<ContinueBody>
								<ContinueTitle>Continue reading</ContinueTitle>
								<ContinueName>{continueEntry.name}</ContinueName>
								<ContinueSub>
									Page {(positionPageIndex(continueEntry.position) ?? 0) + 1} ·{" "}
									{relativeDate(continueEntry.lastOpenedAt)}
								</ContinueSub>
							</ContinueBody>
							<ContinueCta>
								<BookOpen size={16} /> Resume
							</ContinueCta>
						</ContinueCard>
					)}

					<Chips>
						{FILTERS.map((f) => {
							const count = counts.get(f.key) ?? 0;
							return (
								<Chip
									key={f.key}
									$active={filterKey === f.key}
									$dim={f.key !== "all" && count === 0}
									onClick={() => setFilterKey(f.key)}
									aria-pressed={filterKey === f.key}
									data-testid={`filter-${f.key}`}
								>
									{f.dot && <ChipDot $color={f.dot} />}
									<span>{f.label}</span>
									<ChipCount>{count}</ChipCount>
								</Chip>
							);
						})}
					</Chips>

					{visible.length === 0 ? (
						<NoMatch data-testid="no-match">
							<span>
								{searching
									? `No documents match “${searchQuery.trim()}”.`
									: `No ${activeFilter.label.toLowerCase()} here yet.`}
							</span>
							<Button
								variant="ghost"
								onClick={() => {
									setFilterKey("all");
									setSearchQuery("");
								}}
							>
								Show everything
							</Button>
						</NoMatch>
					) : (
						<>
							{searching ? (
								<>
									<SectionHead>
										<SectionLabel>Results ({visible.length})</SectionLabel>
									</SectionHead>
									<List>{visible.map(renderRow)}</List>
								</>
							) : (
								<>
									{pinnedVisible.length > 0 && (
										<>
											<SectionHead>
												<SectionLabel>
													Pinned ({pinnedVisible.length})
												</SectionLabel>
											</SectionHead>
											<List>{pinnedVisible.map(renderRow)}</List>
										</>
									)}
									{recentVisible.length > 0 && (
										<>
											<SectionHead>
												<SectionLabel>
													Recent documents ({recentVisible.length})
												</SectionLabel>
												<SortWrap ref={sortWrapRef}>
													<SortButton
														onClick={() => setSortOpen((v) => !v)}
														aria-haspopup="menu"
														aria-expanded={sortOpen}
														data-testid="sort-button"
													>
														Sort: {SORTS.find((s) => s.key === sortKey)?.label}
														<ChevronDown
															size={13}
															style={{
																transform: sortOpen
																	? "rotate(180deg)"
																	: undefined,
															}}
														/>
													</SortButton>
													{sortOpen && (
														<SortMenu role="menu" aria-label="Sort documents">
															{SORTS.map((s) => (
																<SortOption
																	key={s.key}
																	$active={sortKey === s.key}
																	role="menuitemradio"
																	aria-checked={sortKey === s.key}
																	onClick={() => {
																		setSortKey(s.key);
																		setSortOpen(false);
																	}}
																>
																	{s.label}
																	{sortKey === s.key && <Check size={15} />}
																</SortOption>
															))}
														</SortMenu>
													)}
												</SortWrap>
											</SectionHead>
											<List>{recentVisible.map(renderRow)}</List>
										</>
									)}
								</>
							)}
						</>
					)}
				</Scroll>
			)}

			<FAB onClick={onPickFile} hidden={fabHidden} label="Open file" extended>
				<Plus size={22} strokeWidth={2.5} />
			</FAB>

			{ready && entries.length === 0 && (
				<CoachBubble
					id="homeFab"
					position={{ bottom: "96px" }}
					text="Tap to pick your first file, or open any document from your Files app and choose Paperwren."
				/>
			)}

			<Sheet
				open={sheetEntry !== null}
				title={sheetEntry?.name ?? ""}
				id="home-actions"
				onDismiss={() => setSheetEntry(null)}
			>
				{sheetEntry && (
					<>
						<SheetRow
							$danger={false}
							onClick={() => {
								togglePin(sheetEntry.id);
								setSheetEntry(null);
							}}
						>
							<RowLead>
								<Pin size={20} />
							</RowLead>
							{sheetEntry.pinned ? "Unpin" : "Pin"}
						</SheetRow>
						<SheetRow $danger={false} onClick={() => setSheetEntry(null)}>
							<RowLead>
								<Info size={20} />
							</RowLead>
							{(() => {
								const meta = recentMeta(sheetEntry);
								return [meta.format, ...meta.rest].join(" · ");
							})()}
						</SheetRow>
						<SheetRow
							$danger
							onClick={() => {
								remove(sheetEntry.id);
								setSheetEntry(null);
								showSnackbar({ message: "Removed from recents." });
							}}
						>
							<RowLead>
								<Trash2 size={20} />
							</RowLead>
							Remove from recents
						</SheetRow>
						{entries.length > 0 && (
							<SheetRow
								$danger
								onClick={() => {
									setSheetEntry(null);
									setConfirmClear(true);
								}}
							>
								<RowLead>
									<PinOff size={20} />
								</RowLead>
								Clear all recents
							</SheetRow>
						)}
					</>
				)}
			</Sheet>

			<ConfirmDialog
				open={confirmClear}
				title="Remove all recents?"
				message="Your recent files list will be cleared. Your files are not touched."
				confirmLabel="Clear"
				variant="destructive"
				onConfirm={() => {
					const previous = clearAll();
					showSnackbar({
						message: "Recents cleared.",
						actionLabel: "Undo",
						onAction: () => restore(previous),
					});
				}}
				onDismiss={() => setConfirmClear(false)}
			/>
		</Page>
	);
}

const SheetRow = styled.button<{ $danger?: boolean }>`
	display: flex;
	align-items: center;
	gap: ${space[4]};
	width: 100%;
	min-height: ${layout.minTouch};
	padding: ${space[3]} ${space[2]};
	background: none;
	border: none;
	border-radius: ${radius.m};
	color: ${({ $danger }) => ($danger ? "var(--danger)" : "var(--ink-1)")};
	${type.body};
	cursor: pointer;
	text-align: left;

	&:hover {
		background: var(--surface-2);
	}
`;

const RowLead = styled.span`
	display: flex;
	flex-shrink: 0;
`;
