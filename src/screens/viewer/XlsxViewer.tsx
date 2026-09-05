import { formatCssVar } from "@/components/FormatBadge";
import {
	Button,
	TextField,
	Sheet as UiSheet,
	showSnackbar,
} from "@/components/ui";
import {
	DEFAULT_COL_WIDTH,
	HEADER_HEIGHT,
	ROW_HEIGHT,
	colName,
	columnOffsets,
	computeVisibleWindow,
	ROW_LABEL_WIDTH as labelColWidth,
} from "@/lib/sheetLayout";
import type {
	GridCell,
	ParseResult,
	GridSheet as ParsedGridSheet,
} from "@/lib/workbookModel";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import styled from "styled-components";
import { ViewerShell } from "./ViewerShell";

/**
 * SCR-09 XLSX viewer (docs/07 section 3): worker-parsed workbook into
 * a windowed (virtualized) grid, sheet tabs along the bottom, cached
 * values only (no recalculation), cell selection with details, copy,
 * column resize, and keyboard navigation.
 *
 * Grid geometry (docs/14 audit XLS-01/02): one native two-axis
 * scroller owns all displacement. The column header strip is sticky
 * at the top of that scroller and spans the full logical surface, so
 * native horizontal scrolling moves headers and cells together —
 * there is no second scroll owner and no JS transform. The row-number
 * rail is sticky at the left, the corner sticky at both, and every
 * element shares the same column offsets and border-box widths.
 *
 * Merges (audit XLS-03): each visible merge renders exactly ONE
 * anchor box spanning the merge rectangle; interior cells are not
 * mounted, selection/copy resolve to the anchor, and width changes
 * flow from the same column offsets automatically.
 *
 * Row coordinates (audit XLS-02/04): rows come from prefix sums
 * (variable authored heights supported); the rail shows ORIGINAL row
 * numbers and headers show original column letters because hidden
 * rows/columns are mapped out of the visible coordinate space.
 */

/**
 * Parsing runs in a dedicated worker (docs/14 audit XLS-05): this
 * component only rebuilds a sparse cell map from the worker's plain
 * JSON payload. Terminal states are explicit — preparing, ready,
 * corrupt, too large, and empty — never a spinner that hangs.
 */

interface GridSheet {
	name: string;
	rows: number;
	cols: number;
	widths: number[];
	rowHeights: number[];
	rowPrefix: number[];
	cells: Map<string, GridCell>;
	merges: Array<{ r0: number; c0: number; r1: number; c1: number }>;
	rowOrigins: number[];
	colOrigins: number[];
	hiddenSheet?: boolean;
	mergeLimitHit?: boolean;
	limitNote?: string;
}

const GridWrap = styled.div`
	position: absolute;
	inset: 0;
	overflow: auto;
	background: var(--bg);
	/* Shared viewport contract (audit 8): real toolbar and sheet-tab
	   heights, safe areas included, instead of magic numbers. */
	margin-top: var(--viewer-top-height, calc(56px + var(--safe-area-top, 0px)));
	margin-bottom: calc(
		var(--viewer-bottom-height, 0px) + var(--viewer-bottom-reserve, 0px)
	);
	overscroll-behavior: contain;

	&:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
`;

/* One logical surface: the header strip is its first flow child and
   sticky at the top; the row rail is its second flow child and sticky
   at the left. Both travel the full scroll range because their
   containing block is the whole surface. */
const GridSurface = styled.div<{ $width: number; $height: number }>`
	position: relative;
	width: ${({ $width }) => $width}px;
	min-width: 100%;
	height: ${({ $height }) => $height}px;
	background: var(--surface);
`;

const HeadRow = styled.div`
	position: sticky;
	top: 0;
	z-index: 3;
	height: ${HEADER_HEIGHT}px;
	background: var(--surface-2);
	border-bottom: 1px solid var(--border);
	user-select: none;
	-webkit-user-select: none;
`;

/* The corner is a flow child of the full-width sticky header and is
   sticky at the left itself, so it stays aligned with both frozen
   edges while the header cells slide beneath it. */
const HeadCorner = styled.div`
	position: sticky;
	left: 0;
	z-index: 4;
	width: ${labelColWidth}px;
	height: 100%;
	background: var(--surface-2);
	border-right: 1px solid var(--border);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.8125rem;
	font-weight: 600;
	color: var(--ink-3);
`;

const HeadCell = styled.div`
	position: absolute;
	top: 0;
	height: ${HEADER_HEIGHT}px;
	padding: 6px 8px;
	font-size: 0.8125rem;
	font-weight: 600;
	color: var(--ink-2);
	text-align: center;
	border-right: 1px solid var(--border);
	box-sizing: border-box;
	overflow: hidden;
	display: flex;
	align-items: center;
	justify-content: center;
	user-select: none;
	-webkit-user-select: none;
`;

const ResizeHandle = styled.span`
	position: absolute;
	right: 0;
	top: 0;
	bottom: 0;
	width: 12px;
	cursor: col-resize;
	touch-action: none;
	z-index: 2;

	&::after {
		content: "";
		position: absolute;
		right: 2px;
		top: 6px;
		bottom: 6px;
		width: 3px;
		border-radius: 2px;
		background: var(--border);
	}
	&:hover::after {
		background: var(--accent);
	}
`;

/* Full-height sticky rail: in flow below the header (its height is
   surface height minus header) so sticky-left can travel the whole
   surface. Labels are absolutely positioned at their row offsets. */
const RowRail = styled.div<{ $height: number }>`
	position: sticky;
	left: 0;
	z-index: 2;
	width: ${labelColWidth}px;
	height: ${({ $height }) => $height}px;
	background: var(--surface-2);
	border-right: 1px solid var(--border);
	overflow: hidden;
	user-select: none;
	-webkit-user-select: none;
`;

const RowLabel = styled.div`
	position: absolute;
	left: 0;
	width: ${labelColWidth}px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.8125rem;
	color: var(--ink-3);
	font-variant-numeric: tabular-nums;
	background: var(--surface-2);
	border-bottom: 1px solid var(--border);
	box-sizing: border-box;
`;

/* Body cells carry the grid lines: right and bottom borders inside
   their border-box, so adjacent cells share one 1px line and the
   header (same widths) lines up edge for edge (audit XLS-02). */
const GridCellBox = styled.div<{
	$selected: boolean;
	$bold?: boolean;
	$italic?: boolean;
	$align?: string;
}>`
	position: absolute;
	line-height: 24px;
	padding: 2px 8px;
	font-size: 0.84375rem;
	font-variant-numeric: tabular-nums;
	background: ${({ $selected }) =>
		$selected ? "var(--accent-tint)" : "var(--surface)"};
	color: ${({ $selected }) =>
		$selected ? "var(--accent-strong)" : "var(--ink-1)"};
	font-weight: ${({ $bold }) => ($bold ? 700 : 400)};
	font-style: ${({ $italic }) => ($italic ? "italic" : "normal")};
	text-align: ${({ $align }) => $align ?? "left"};
	border-right: 1px solid var(--border);
	border-bottom: 1px solid var(--border);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	cursor: cell;
`;

/* A merge renders as ONE box spanning its rectangle; opaque so no
   interior grid lines show through (audit XLS-03). */
const MergeBox = styled(GridCellBox)``;

const TabStrip = styled.div`
	display: flex;
	align-items: stretch;
	overflow-x: auto;
	height: 44px;
	background: var(--surface-2);
`;

const Tab = styled.button<{ $active: boolean; $hiddenSheet?: boolean }>`
	background: ${({ $active }) => ($active ? "var(--surface)" : "transparent")};
	color: ${({ $active }) => ($active ? "var(--ink-1)" : "var(--ink-2)")};
	border: none;
	border-bottom: 2px solid
		${({ $active }) => ($active ? "var(--accent)" : "transparent")};
	padding: 0 16px;
	font-size: 0.8125rem;
	font-weight: 600;
	font-style: ${({ $hiddenSheet }) => ($hiddenSheet ? "italic" : "normal")};
	cursor: pointer;
	white-space: nowrap;
	flex-shrink: 0;
`;

const Center = styled.div`
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--ink-2);
	padding: 24px;
	text-align: center;
`;

const CellCard = styled.dl`
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-bottom: 16px;
`;

const CardKey = styled.dt`
	font-size: 0.8125rem;
	color: var(--ink-3);
`;

const CardValue = styled.dd`
	font-size: 0.9375rem;
	color: var(--ink-1);
	font-variant-numeric: tabular-nums;
	word-break: break-all;
`;

/* Persistent precise notice for disclosed limits (audit XLS-04
   item 7): sits above the tabs, never covers grid content. */
const LimitNotice = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 12px;
	background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
	color: var(--ink-2);
	font-size: 0.75rem;
	border-top: 1px solid var(--border);
`;

/* Visible cell strip (audit XLS-06): a tap selects and the strip
   shows the address + value with a Details action, without covering
   grid content. */
const CellStrip = styled.div`
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 12px;
	background: var(--surface);
	border-top: 1px solid var(--border);
	min-width: 0;
`;

const StripAddress = styled.span`
	font-size: 0.8125rem;
	font-weight: 700;
	color: var(--accent-strong);
	font-variant-numeric: tabular-nums;
	flex-shrink: 0;
`;

const StripValue = styled.span`
	flex: 1;
	min-width: 0;
	font-size: 0.8125rem;
	color: var(--ink-1);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`;

const StripButton = styled.button`
	border: 1px solid var(--border);
	border-radius: 999px;
	background: var(--surface-2);
	color: var(--ink-1);
	font-size: 0.75rem;
	font-weight: 600;
	padding: 6px 14px;
	cursor: pointer;
	flex-shrink: 0;

	&:hover {
		background: var(--surface-3);
	}
`;

export function XlsxViewer({
	data,
	name,
	onClose,
}: {
	data: ArrayBuffer;
	name: string;
	onClose: () => void;
}) {
	const [sheets, setSheets] = useState<GridSheet[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [tooLarge, setTooLarge] = useState<string | null>(null);
	const [empty, setEmpty] = useState(false);
	const [active, setActive] = useState(0);
	const [selected, setSelected] = useState<{ r: number; c: number } | null>(
		null,
	);
	const [cellCardOpen, setCellCardOpen] = useState(false);
	const [scrollTop, setScrollTop] = useState(0);
	const [scrollLeft, setScrollLeft] = useState(0);
	const [viewport, setViewport] = useState({ w: 800, h: 600 });
	const [widthDraft, setWidthDraft] = useState("");
	const scrollRef = useRef<HTMLDivElement | null>(null);

	// --- worker-owned parsing (audit XLS-05): the worker owns the
	// SheetJS import and the whole parse; the buffer is transferred
	// as a copy so the caller's bytes stay valid. The worker is
	// terminated on close or document change to cancel obsolete
	// work. ---
	useEffect(() => {
		let cancelled = false;
		setSheets(null);
		setFailed(false);
		setTooLarge(null);
		setEmpty(false);
		let worker: Worker;
		try {
			worker = new Worker(
				new URL("../../lib/xlsxParseWorker.ts", import.meta.url),
				{ type: "module" },
			);
		} catch {
			// No worker support: surface an honest error, never a
			// spinner that hangs forever.
			setFailed(true);
			return;
		}
		worker.onmessage = (e: MessageEvent) => {
			if (cancelled) return;
			const result = e.data as ParseResult;
			if (!result.ok) {
				if (result.reason === "too-large") {
					setTooLarge(result.detail ?? "too many populated cells");
				} else {
					setFailed(true);
				}
				worker.terminate();
				return;
			}
			if (result.sheets.length === 0) {
				// A workbook with no viewable sheets is a terminal empty
				// state, not eternal "Preparing sheet..." (audit XLS-04
				// item 8).
				setEmpty(true);
				worker.terminate();
				return;
			}
			const rebuilt: GridSheet[] = (result.sheets as ParsedGridSheet[]).map(
				(s) => ({
					name: s.name,
					rows: s.rows,
					cols: s.cols,
					widths: s.widths,
					rowHeights: s.rowHeights,
					rowPrefix: s.rowPrefix,
					merges: s.merges,
					rowOrigins: s.rowOrigins,
					colOrigins: s.colOrigins,
					hiddenSheet: s.hiddenSheet,
					mergeLimitHit: s.mergeLimitHit,
					limitNote: s.limitNote,
					cells: new Map(
						s.cells.map(([r, c, cell]) => [`${r}:${c}`, cell] as const),
					),
				}),
			);
			setSheets(rebuilt);
			// Hidden sheets are never the initial presentation (audit
			// XLS-04 item 6): land on the first visible one.
			const firstVisible = rebuilt.findIndex((s) => !s.hiddenSheet);
			setActive(firstVisible === -1 ? 0 : firstVisible);
			worker.terminate();
		};
		worker.onerror = () => {
			if (!cancelled) setFailed(true);
		};
		const copy = data.slice(0);
		worker.postMessage({ id: 1, buffer: copy }, [copy]);
		return () => {
			cancelled = true;
			worker.terminate();
		};
	}, [data]);

	// Track viewport size for the windowing math.
	useEffect(() => {
		if (!sheets) return;
		const el = scrollRef.current;
		if (!el) return;
		const update = () => setViewport({ w: el.clientWidth, h: el.clientHeight });
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, [sheets]);

	const sheetStateRef = useRef<
		Record<
			number,
			{
				scrollTop: number;
				scrollLeft: number;
				selected: { r: number; c: number } | null;
			}
		>
	>({});
	const sheet = sheets?.[active];
	const [widthOverrides, setWidthOverrides] = useState<
		Record<number, number[]>
	>({});
	const effectiveWidths = useMemo(
		() => widthOverrides[active] ?? sheet?.widths ?? [],
		[widthOverrides, active, sheet],
	);

	// Column resize is one owned pointer session on the handle: capture
	// retargets moves to the handle, so other fingers never resize and
	// listeners die with the element (audit XLS-06 ownership rules).
	const resizeRef = useRef<{
		col: number;
		startX: number;
		startWidth: number;
	} | null>(null);

	const onResizePointerDown = useCallback(
		(col: number, width: number) =>
			(e: React.PointerEvent<HTMLSpanElement>) => {
				e.stopPropagation();
				e.preventDefault();
				e.currentTarget.setPointerCapture(e.pointerId);
				resizeRef.current = {
					col,
					startX: e.clientX,
					startWidth: width,
				};
			},
		[],
	);

	const onResizePointerMove = useCallback(
		(e: React.PointerEvent<HTMLSpanElement>) => {
			const state = resizeRef.current;
			if (!state) return;
			const next = Math.min(
				480,
				Math.max(48, Math.round(state.startWidth + e.clientX - state.startX)),
			);
			setWidthOverrides((prev) => {
				const base = prev[active] ?? (sheets?.[active]?.widths ?? []).slice();
				if (base[state.col] === next) return prev;
				const copy = base.slice();
				copy[state.col] = next;
				return { ...prev, [active]: copy };
			});
		},
		[active, sheets],
	);

	const endResize = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
		if (!resizeRef.current) return;
		resizeRef.current = null;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
	}, []);

	// Column x-offsets via prefix sums for windowing.
	const colOffsets = useMemo(
		() => (sheet ? columnOffsets(effectiveWidths) : [0]),
		[sheet, effectiveWidths],
	);

	const windowed = useMemo(() => {
		if (!sheet) return null;
		return computeVisibleWindow({
			rows: sheet.rows,
			cols: sheet.cols,
			colOffsets,
			scrollTop,
			scrollLeft,
			viewportWidth: viewport.w,
			viewportHeight: viewport.h,
			rowOffsets: sheet.rowPrefix,
		});
	}, [sheet, scrollTop, scrollLeft, viewport, colOffsets]);

	// Restore the active sheet's scroll state AFTER the new surface
	// geometry commits, and sync refs/state from the applied (clamped)
	// offsets (audit XLS-02). The trigger is the active sheet and its
	// data, not the live scroll values.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el || !sheet) return;
		const saved = sheetStateRef.current[active];
		el.scrollTop = saved?.scrollTop ?? 0;
		el.scrollLeft = saved?.scrollLeft ?? 0;
		setScrollTop(el.scrollTop);
		setScrollLeft(el.scrollLeft);
	}, [active, sheets]);

	// Per-sheet scroll state is kept live so switching sheets can
	// restore it (audit XLS-02).
	const onGridScroll = useCallback(
		(e: React.UIEvent) => {
			const el = e.currentTarget;
			setScrollTop(el.scrollTop);
			setScrollLeft(el.scrollLeft);
			sheetStateRef.current[active] = {
				scrollTop: el.scrollTop,
				scrollLeft: el.scrollLeft,
				selected,
			};
		},
		[active, selected],
	);

	/** Merges resolve hit-testing, selection, and copy to their anchor
	 * cell (audit XLS-03). */
	const resolveAnchor = useCallback(
		(r: number, c: number): { r: number; c: number } => {
			if (!sheet) return { r, c };
			for (const m of sheet.merges) {
				if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) {
					return { r: m.r0, c: m.c0 };
				}
			}
			return { r, c };
		},
		[sheet],
	);

	/** Keyboard navigation with scroll-into-view (audit XLS-06): the
	 * scroller keeps focus (aria-activedescendant strategy) and the
	 * destination is scrolled into view before the frame renders. */
	const onGridKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (!sheet) return;
			if (e.key === "Escape") {
				if (cellCardOpen) setCellCardOpen(false);
				return;
			}
			const deltas: Record<string, [number, number]> = {
				ArrowUp: [-1, 0],
				ArrowDown: [1, 0],
				ArrowLeft: [0, -1],
				ArrowRight: [0, 1],
				Enter: [0, 0],
			};
			const d = deltas[e.key];
			if (!d) return;
			e.preventDefault();
			if (e.key === "Enter") {
				if (selected) setCellCardOpen(true);
				return;
			}
			const base = selected ?? { r: 0, c: 0 };
			const target = {
				r: Math.min(sheet.rows - 1, Math.max(0, base.r + d[0])),
				c: Math.min(sheet.cols - 1, Math.max(0, base.c + d[1])),
			};
			const anchor = resolveAnchor(target.r, target.c);
			setSelected(anchor);
			// Scroll the destination into the visible body before the
			// virtual window re-renders (destination must be mounted
			// before it can be named/focused).
			const el = scrollRef.current;
			if (!el) return;
			const rowTop = sheet.rowPrefix[target.r] ?? 0;
			const rowBottom = sheet.rowPrefix[target.r + 1] ?? rowTop + ROW_HEIGHT;
			const visTop = el.scrollTop;
			const visBottom = el.scrollTop + el.clientHeight - HEADER_HEIGHT;
			if (rowTop < visTop) el.scrollTop = rowTop;
			else if (rowBottom > visBottom)
				el.scrollTop = rowBottom - (el.clientHeight - HEADER_HEIGHT);
			const cLeft = colOffsets[target.c] ?? 0;
			const cRight = colOffsets[target.c + 1] ?? cLeft + DEFAULT_COL_WIDTH;
			const visLeft = el.scrollLeft;
			const visRight = el.scrollLeft + el.clientWidth - labelColWidth;
			if (cLeft < visLeft) el.scrollLeft = cLeft;
			else if (cRight > visRight)
				el.scrollLeft = cRight - (el.clientWidth - labelColWidth);
		},
		[sheet, selected, cellCardOpen, resolveAnchor, colOffsets],
	);

	// Copy with await + explicit feedback; the details stay open on
	// failure (audit XLS-06).
	const copySelection = useCallback(async () => {
		if (!selected || !sheet) return;
		const cell = sheet.cells.get(`${selected.r}:${selected.c}`);
		const text = cell?.value ?? "";
		try {
			if (!navigator.clipboard) throw new Error("unavailable");
			await navigator.clipboard.writeText(text);
			showSnackbar({ message: "Copied cell value" });
			return true;
		} catch {
			showSnackbar({
				message: "Couldn't copy. Clipboard access was denied.",
			});
			return false;
		}
	}, [selected, sheet]);

	if (failed) {
		return (
			<ViewerShell
				name={name}
				formatColor={formatCssVar("xlsx").base}
				progress={null}
				onClose={onClose}
				chromeAutohide={false}
			>
				<Center>
					Can't open this file. It seems to be damaged or isn't a valid
					spreadsheet.
				</Center>
			</ViewerShell>
		);
	}

	if (tooLarge !== null) {
		// Actionable, precise limit disclosure (audit XLS-04 item 7 /
		// XLS-05): the boundary is named, not silently truncated.
		return (
			<ViewerShell
				name={name}
				formatColor={formatCssVar("xlsx").base}
				progress={null}
				onClose={onClose}
				chromeAutohide={false}
			>
				<Center>
					This spreadsheet is too large for this viewer: it has more than
					400,000 populated cells ({tooLarge}).
				</Center>
			</ViewerShell>
		);
	}

	if (empty) {
		return (
			<ViewerShell
				name={name}
				formatColor={formatCssVar("xlsx").base}
				progress={null}
				onClose={onClose}
				chromeAutohide={false}
			>
				<Center>This workbook has no sheets with content.</Center>
			</ViewerShell>
		);
	}

	if (!sheets || !sheet || !windowed) {
		return (
			<ViewerShell
				name={name}
				formatColor={formatCssVar("xlsx").base}
				progress={0.4}
				onClose={onClose}
				chromeAutohide={false}
			>
				<Center>Preparing sheet...</Center>
			</ViewerShell>
		);
	}

	const selectedCell = selected
		? sheet.cells.get(`${selected.r}:${selected.c}`)
		: undefined;

	const gridWidth = colOffsets[sheet.cols] ?? 0;
	const gridHeight = sheet.rowPrefix[sheet.rows] ?? sheet.rows * ROW_HEIGHT;

	const rows = Array.from(
		{ length: windowed.r1 - windowed.r0 },
		(_, i) => windowed.r0 + i,
	);
	const cols = Array.from(
		{ length: windowed.c1 - windowed.c0 },
		(_, i) => windowed.c0 + i,
	);

	// Visible merges: every merge intersecting the window renders, even
	// when its anchor lies outside the normal window (audit XLS-03).
	const visibleMerges = sheet.merges.filter(
		(m) =>
			m.r1 >= windowed.r0 &&
			m.r0 <= windowed.r1 - 1 &&
			m.c1 >= windowed.c0 &&
			m.c0 <= windowed.c1 - 1,
	);
	// Cells inside a visible merge interior are never mounted: the
	// merge box covers them.
	const mergeHidden = new Set<string>();
	for (const m of visibleMerges) {
		for (let r = m.r0; r <= m.r1; r++) {
			for (let c = m.c0; c <= m.c1; c++) {
				if (r === m.r0 && c === m.c0) continue;
				mergeHidden.add(`${r}:${c}`);
			}
		}
	}

	const selectedAddress = selected
		? `${colName(sheet.colOrigins[selected.c] ?? selected.c)}${
				(sheet.rowOrigins[selected.r] ?? selected.r) + 1
			}`
		: "";

	const notices: string[] = [];
	if (sheet.limitNote) notices.push(sheet.limitNote);
	if (sheet.mergeLimitHit) {
		notices.push(
			"Some unusually large merged ranges render without their merge borders.",
		);
	}
	if (sheet.hiddenSheet) {
		notices.push("This sheet is marked hidden in the workbook.");
	}

	return (
		<ViewerShell
			name={name}
			formatColor={formatCssVar("xlsx").base}
			progress={null}
			onClose={onClose}
			chromeAutohide={false}
			bottomBar={
				<>
					{notices.length > 0 && (
						<LimitNotice data-testid="xlsx-limit-notice">
							{notices.join(" ")}
						</LimitNotice>
					)}
					{selected && (
						<CellStrip data-testid="xlsx-cell-strip">
							<StripAddress>{selectedAddress}</StripAddress>
							<StripValue>
								{selectedCell?.noCachedResult
									? "Formula — no cached result"
									: selectedCell?.value || "(empty)"}
							</StripValue>
							<StripButton
								data-testid="xlsx-details-open"
								onClick={() => setCellCardOpen(true)}
							>
								Details
							</StripButton>
						</CellStrip>
					)}
					{sheets.length > 1 && (
						<TabStrip role="tablist">
							{sheets.map((s, i) => (
								<Tab
									key={s.name}
									$active={i === active}
									$hiddenSheet={s.hiddenSheet}
									onClick={() => {
										// Per-sheet state (audit XLS-02): scroll offsets
										// and selection are stored per sheet and restored
										// in a layout effect after the new surface
										// geometry commits, so the first frame is never
										// stale and never clamped against the wrong
										// surface size.
										sheetStateRef.current[active] = {
											scrollTop,
											scrollLeft,
											selected,
										};
										const saved = sheetStateRef.current[i];
										setActive(i);
										setSelected(saved?.selected ?? null);
										setCellCardOpen(false);
										setScrollTop(saved?.scrollTop ?? 0);
										setScrollLeft(saved?.scrollLeft ?? 0);
									}}
									role="tab"
									aria-selected={i === active}
								>
									{s.hiddenSheet ? `${s.name} (hidden)` : s.name}
								</Tab>
							))}
						</TabStrip>
					)}
				</>
			}
		>
			<GridWrap
				ref={scrollRef}
				onScroll={onGridScroll}
				onKeyDown={onGridKeyDown}
				tabIndex={0}
				// biome-ignore lint/a11y/useSemanticElements: a virtualized grid cannot be a static table; aria-grid with activedescendant is the documented pattern
				role="grid"
				aria-rowcount={sheet.rows}
				aria-colcount={sheet.cols}
				aria-activedescendant={
					selected ? `xlsx-cell-anchor-${selected.r}-${selected.c}` : undefined
				}
				data-testid="xlsx-grid"
			>
				<GridSurface
					$width={labelColWidth + gridWidth}
					$height={HEADER_HEIGHT + gridHeight}
				>
					<HeadRow>
						<HeadCorner>#</HeadCorner>
						{cols.map((c) => (
							<HeadCell
								key={`colhead-${c}`}
								data-testid={`xlsx-head-${c}`}
								data-col={c}
								style={{
									left: labelColWidth + (colOffsets[c] ?? 0),
									width: effectiveWidths[c] ?? DEFAULT_COL_WIDTH,
								}}
							>
								{colName(sheet.colOrigins[c] ?? c)}
								<ResizeHandle
									data-resize={c}
									onPointerDown={onResizePointerDown(
										c,
										effectiveWidths[c] ?? DEFAULT_COL_WIDTH,
									)}
									onPointerMove={onResizePointerMove}
									onPointerUp={endResize}
									onPointerCancel={endResize}
								/>
							</HeadCell>
						))}
					</HeadRow>
					<RowRail $height={gridHeight}>
						{rows.map((r) => (
							<RowLabel
								key={`rowlabel-${r}`}
								style={{
									top: sheet.rowPrefix[r] ?? r * ROW_HEIGHT,
									height: sheet.rowHeights[r] ?? ROW_HEIGHT,
								}}
							>
								{(sheet.rowOrigins[r] ?? r) + 1}
							</RowLabel>
						))}
					</RowRail>
					{rows.map((r) =>
						cols.map((c) => {
							if (mergeHidden.has(`${r}:${c}`)) return null;
							const cell = sheet.cells.get(`${r}:${c}`);
							const isSel = selected?.r === r && selected?.c === c;
							return (
								<GridCellBox
									key={`cell-${r}-${c}`}
									data-testid={`xlsx-cell-${r}-${c}`}
									data-row={r}
									data-col={c}
									id={`xlsx-cell-anchor-${r}-${c}`}
									style={{
										left: labelColWidth + (colOffsets[c] ?? 0),
										top: HEADER_HEIGHT + (sheet.rowPrefix[r] ?? r * ROW_HEIGHT),
										width: effectiveWidths[c] ?? DEFAULT_COL_WIDTH,
										height: sheet.rowHeights[r] ?? ROW_HEIGHT,
									}}
									$selected={isSel}
									$bold={cell?.bold}
									$italic={cell?.italic}
									// biome-ignore lint/a11y/useSemanticElements: virtualized cell cannot be a static table
									$align={cell?.align}
									role="gridcell"
									aria-selected={isSel}
									aria-colindex={(sheet.colOrigins[c] ?? c) + 1}
									aria-rowindex={(sheet.rowOrigins[r] ?? r) + 1}
									aria-label={`${colName(sheet.colOrigins[c] ?? c)}${
										(sheet.rowOrigins[r] ?? r) + 1
									}${cell?.value ? `, ${cell.value}` : ", empty"}`}
									onClick={() => setSelected(resolveAnchor(r, c))}
									onDoubleClick={() => {
										setSelected(resolveAnchor(r, c));
										setCellCardOpen(true);
									}}
								>
									{cell?.value ?? ""}
								</GridCellBox>
							);
						}),
					)}
					{visibleMerges.map((m) => {
						const cell = sheet.cells.get(`${m.r0}:${m.c0}`);
						const isSel = selected?.r === m.r0 && selected?.c === m.c0;
						return (
							<MergeBox
								key={`merge-${m.r0}-${m.c0}`}
								data-testid={`xlsx-merge-${m.r0}-${m.c0}`}
								id={`xlsx-cell-anchor-${m.r0}-${m.c0}`}
								style={{
									left: labelColWidth + (colOffsets[m.c0] ?? 0),
									top:
										HEADER_HEIGHT +
										(sheet.rowPrefix[m.r0] ?? m.r0 * ROW_HEIGHT),
									width:
										(colOffsets[m.c1 + 1] ?? colOffsets[m.c1] ?? 0) -
										(colOffsets[m.c0] ?? 0),
									height:
										(sheet.rowPrefix[m.r1 + 1] ?? (m.r1 + 1) * ROW_HEIGHT) -
										(sheet.rowPrefix[m.r0] ?? m.r0 * ROW_HEIGHT),
								}}
								$selected={isSel}
								$bold={cell?.bold}
								$italic={cell?.italic}
								// biome-ignore lint/a11y/useSemanticElements: virtualized merge box cannot be a static table
								role="gridcell"
								aria-selected={isSel}
								aria-label={`${colName(sheet.colOrigins[m.c0] ?? m.c0)}${
									(sheet.rowOrigins[m.r0] ?? m.r0) + 1
								} (merged)${cell?.value ? `, ${cell.value}` : ", empty"}`}
								onClick={() => setSelected({ r: m.r0, c: m.c0 })}
								onDoubleClick={() => {
									setSelected({ r: m.r0, c: m.c0 });
									setCellCardOpen(true);
								}}
							>
								{cell?.value ?? ""}
							</MergeBox>
						);
					})}
				</GridSurface>
			</GridWrap>

			<UiSheet
				open={cellCardOpen}
				title={`${sheet.name} · ${selectedAddress}`}
				id="xlsx-cell-details"
				onDismiss={() => setCellCardOpen(false)}
			>
				<CellCard>
					<div>
						<CardKey>Value</CardKey>
						<CardValue data-testid="xlsx-detail-value">
							{selectedCell?.noCachedResult
								? "No cached result — the formula has no stored value to display."
								: selectedCell?.value || "(empty)"}
						</CardValue>
					</div>
					{selectedCell?.formula && (
						<div>
							<CardKey>Formula</CardKey>
							<CardValue>{selectedCell.formula}</CardValue>
						</div>
					)}
					<div>
						<CardKey>Cell</CardKey>
						<CardValue>{selectedAddress || "(none)"}</CardValue>
					</div>
					<Button
						data-testid="xlsx-detail-copy"
						onClick={async () => {
							await copySelection();
						}}
					>
						Copy value
					</Button>
				</CellCard>
				{selected && (
					<div>
						<CardKey>
							Column width ({selectedAddress.replace(/\d+/, "")})
						</CardKey>
						<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
							<TextField
								label="Width (px, 48–480)"
								value={widthDraft}
								onChange={setWidthDraft}
								inputMode="numeric"
							/>
							<Button
								data-testid="xlsx-width-apply"
								onClick={() => {
									const n = Number.parseInt(widthDraft, 10);
									if (!Number.isFinite(n)) return;
									const clamped = Math.min(480, Math.max(48, n));
									setWidthOverrides((prev) => {
										const base =
											prev[active] ?? (sheets?.[active]?.widths ?? []).slice();
										const copy = base.slice();
										copy[selected.c] = clamped;
										return { ...prev, [active]: copy };
									});
									showSnackbar({
										message: `Column width set to ${clamped}px`,
									});
								}}
							>
								Apply
							</Button>
						</div>
					</div>
				)}
			</UiSheet>
		</ViewerShell>
	);
}
