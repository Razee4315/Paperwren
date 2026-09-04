import { FormatBadge } from "@/components/FormatBadge";
import {
	Button,
	ConfirmDialog,
	FAB,
	IconButton,
	Sheet,
	showSnackbar,
} from "@/components/ui";
import { formatBytes } from "@/lib/backend";
import type { RecentsEntry } from "@/lib/types";
import { useRecents } from "@/state/RecentsContext";
import { CoachBubble } from "@/state/coachMarks";
import { layout, motion, radius, space, type } from "@/theme";
import {
	BookOpen,
	Info,
	MoreVertical,
	Pin,
	PinOff,
	Plus,
	Settings as SettingsIcon,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

/**
 * SCR-05 Home (docs/05 section 4, audit section 12): a useful,
 * intentional dashboard. Full-width recent rows on phones with a
 * visible overflow action (long-press is a shortcut, never the only
 * route), a Continue reading card for the most recent healthy
 * document, skeletons while loading, and honest unavailable states
 * with repair instead of a late parser failure.
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
	padding: calc(8px + var(--safe-area-top, 0px)) ${space[4]} 8px;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: ${space[2]};
`;

const Title = styled.h1`
	${type.titleL};
	color: var(--ink-1);
	font-size: 1.375rem;
`;

const Scroll = styled.main`
	flex: 1;
	overflow-y: auto;
	padding: 0 ${space[4]} 120px;
	max-width: ${layout.contentMaxWidth};
	width: 100%;
	margin: 0 auto;
`;

const SectionLabel = styled.h2`
	${type.caption};
	color: var(--ink-3);
	text-transform: uppercase;
	letter-spacing: 0.08em;
	margin: ${space[4]} 0 ${space[2]};
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

const UnavailableChip = styled.span`
	${type.small};
	color: var(--danger, #b3261e);
	font-weight: 600;
`;

/** Continue reading card for the most recent healthy document. */
const ContinueCard = styled.button`
	display: flex;
	align-items: center;
	gap: ${space[3]};
	width: 100%;
	padding: ${space[4]};
	margin-top: ${space[2]};
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

function recentMeta(entry: RecentsEntry): string {
	const format =
		entry.format === "unknown" ? "File" : entry.format.toUpperCase();
	const parts = [format];
	if (entry.size > 0) parts.push(formatBytes(entry.size));
	if (entry.position?.page !== undefined) {
		parts.push(`Page ${entry.position.page + 1}`);
	}
	parts.push(relativeDate(entry.lastOpenedAt));
	return parts.join(" · ");
}

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
	const scrollRef = useRef<HTMLElement | null>(null);
	const lastScrollTop = useRef(0);

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

	const pinned = entries.filter((e) => e.pinned);
	const recent = entries.filter((e) => !e.pinned);
	const continueEntry = entries.find(
		(e) => !e.unavailable && e.position?.page !== undefined,
	);

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
				<RowMeta>{recentMeta(entry)}</RowMeta>
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

	return (
		<Page data-testid="home">
			<AppBar>
				<Title>Paperwren</Title>
				<IconButton
					label="Settings"
					onClick={onOpenSettings}
					data-testid="open-settings"
				>
					<SettingsIcon size={22} />
				</IconButton>
			</AppBar>

			{!ready ? (
				<Scroll aria-busy="true">
					<SectionLabel>Recent files</SectionLabel>
					<Skeleton />
					<Skeleton />
					<Skeleton />
				</Scroll>
			) : entries.length === 0 ? (
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
									Page {(continueEntry.position?.page ?? 0) + 1} ·{" "}
									{relativeDate(continueEntry.lastOpenedAt)}
								</ContinueSub>
							</ContinueBody>
							<ContinueCta>
								<BookOpen size={16} /> Resume
							</ContinueCta>
						</ContinueCard>
					)}
					{pinned.length > 0 && (
						<>
							<SectionLabel>Pinned</SectionLabel>
							<List>{pinned.map(renderRow)}</List>
						</>
					)}
					{recent.length > 0 && (
						<>
							<SectionLabel>Recent files ({recent.length})</SectionLabel>
							<List>{recent.map(renderRow)}</List>
						</>
					)}
				</Scroll>
			)}

			<FAB onClick={onPickFile} hidden={fabHidden} label="Open a file">
				<Plus size={26} />
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
							{recentMeta(sheetEntry)}
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
