import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Button, Sheet as UiSheet } from "@/components/ui";
import { ViewerShell } from "./ViewerShell";
import { formatCssVar } from "@/components/FormatBadge";

/**
 * SCR-09 XLSX viewer (docs/07 section 3): SheetJS parse into a
 * windowed (virtualized) grid, sheet tabs along the bottom, cached
 * values only (no recalculation), cell selection with copy.
 */

type WorkBook = import("xlsx").WorkBook;

interface GridCell {
	value: string;
	bold?: boolean;
	italic?: boolean;
	align?: string;
	formula?: string;
}

interface GridSheet {
	name: string;
	rows: number;
	cols: number;
	widths: number[];
	cells: Map<string, GridCell>;
}

const ROW_H = 30;
const DEFAULT_COL = 96;
const OVERSCAN = 6;

function colName(index: number): string {
	let name = "";
	let n = index;
	while (n >= 0) {
		name = String.fromCharCode(65 + (n % 26)) + name;
		n = Math.floor(n / 26) - 1;
	}
	return name;
}

async function loadXlsx(): Promise<typeof import("xlsx")> {
	return import("xlsx");
}

function parseWorkbook(wb: WorkBook): GridSheet[] {
	const XLSX = window.__PAPERWREN_XLSX!;
	const sheets: GridSheet[] = [];

	for (const sheetName of wb.SheetNames) {
		const ws = wb.SheetNames.length > 0 ? wb.Sheets[sheetName] : undefined;
		if (!ws) continue;
		const ref = ws["!ref"];
		if (!ref) {
			sheets.push({
				name: sheetName,
				rows: 1,
				cols: 1,
				widths: [DEFAULT_COL],
				cells: new Map(),
			});
			continue;
		}
		const range = XLSX.utils.decode_range(ref);
		const rows = Math.min(range.e.r + 1, 1_000_000);
		const cols = Math.min(range.e.c + 1, 500);

		const merges = ws["!merges"] ?? [];
		const mergeCovered = new Set<string>();
		for (const m of merges) {
			for (let r = m.s.r; r <= m.e.r; r++) {
				for (let c = m.s.c; c <= m.e.c; c++) {
					if (!(r === m.s.r && c === m.s.c)) mergeCovered.add(`${r}:${c}`);
				}
			}
		}

		const cells = new Map<string, GridCell>();
		for (const key of Object.keys(ws)) {
			if (key.startsWith("!")) continue;
			const addr = XLSX.utils.decode_cell(key);
			if (addr.r >= rows || addr.c >= cols) continue;
			if (mergeCovered.has(`${addr.r}:${addr.c}`)) continue;
			const cell = ws[key];
			if (!cell) continue;
			let value = "";
			if (cell.t === "n") value = String(cell.w ?? cell.v);
			else if (cell.t === "b") value = cell.v ? "TRUE" : "FALSE";
			else if (cell.t === "e") value = "#ERROR";
			else if (cell.w !== undefined) value = cell.w;
			else if (cell.v !== undefined) value = String(cell.v);
			cells.set(`${addr.r}:${addr.c}`, {
				value,
				formula: cell.f ? `=${cell.f}` : undefined,
			});
		}

		const widths: number[] = [];
		for (let c = 0; c < cols; c++) {
			const w = (ws["!cols"]?.[c] as { wpx?: number } | undefined)?.wpx;
			widths.push(Math.min(320, Math.max(48, Math.round(w ?? DEFAULT_COL))));
		}

		sheets.push({ name: sheetName, rows, cols, widths, cells });
	}
	return sheets;
}

declare global {
	interface Window {
		__PAPERWREN_XLSX?: typeof import("xlsx");
	}
}

const GridWrap = styled.div`
	position: absolute;
	inset: 0;
	overflow: auto;
	background: var(--bg);
	/* The always-visible toolbar and sheet tabs overlay this area;
	   keep the grid and its sticky header out from under them. */
	margin-top: calc(56px + var(--safe-area-top, 0px));
	margin-bottom: var(--bottom-bar-height, 0px);
`;

const HeadRow = styled.div`
	position: sticky;
	top: 0;
	z-index: 3;
	display: flex;
	background: var(--surface-2);
	border-bottom: 1px solid var(--border);
	width: max-content;
`;

const HeadCell = styled.div<{ $width: number }>`
	width: ${({ $width }) => $width}px;
	min-width: ${({ $width }) => $width}px;
	padding: 6px 8px;
	font-size: 0.8125rem;
	font-weight: 600;
	color: var(--ink-2);
	text-align: center;
	border-right: 1px solid var(--border);
`;

const RowLabelCol = styled(HeadCell)`
	position: sticky;
	left: 0;
	z-index: 4;
	background: var(--surface-2);
	width: 48px;
	min-width: 48px;
`;

const GridCanvas = styled.div<{ $width: number; $height: number }>`
	position: relative;
	width: ${({ $width }) => $width}px;
	height: ${({ $height }) => $height}px;
`;

const GridCellBox = styled.div<{
	$x: number;
	$y: number;
	$width: number;
	$selected: boolean;
	$bold?: boolean;
	$italic?: boolean;
	$align?: string;
}>`
	position: absolute;
	left: ${({ $x }) => $x}px;
	top: ${({ $y }) => $y}px;
	width: ${({ $width }) => $width - 1}px;
	height: ${ROW_H - 1}px;
	line-height: ${ROW_H - 6}px;
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

const RowLabel = styled(GridCellBox)`
	background: var(--surface-2);
	color: var(--ink-3);
	font-size: 0.8125rem;
	text-align: center;
	cursor: default;
`;

const TabStrip = styled.div`
	display: flex;
	align-items: stretch;
	overflow-x: auto;
	height: 44px;
	background: var(--surface-2);
`;

const Tab = styled.button<{ $active: boolean }>`
	background: ${({ $active }) => ($active ? "var(--surface)" : "transparent")};
	color: ${({ $active }) => ($active ? "var(--ink-1)" : "var(--ink-2)")};
	border: none;
	border-bottom: 2px solid
		${({ $active }) => ($active ? "var(--accent)" : "transparent")};
	padding: 0 16px;
	font-size: 0.8125rem;
	font-weight: 600;
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
	const [active, setActive] = useState(0);
	const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
	const [cellCardOpen, setCellCardOpen] = useState(false);
	const [scrollTop, setScrollTop] = useState(0);
	const [scrollLeft, setScrollLeft] = useState(0);
	const [viewport, setViewport] = useState({ w: 800, h: 600 });
	const scrollRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		loadXlsx().then((XLSX) => {
			window.__PAPERWREN_XLSX = XLSX;
			if (cancelled) return;
			try {
				const wb = XLSX.read(data, { type: "array" });
				setSheets(parseWorkbook(wb));
			} catch {
				setFailed(true);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [data]);

	// Track viewport size for the windowing math.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const update = () =>
			setViewport({ w: el.clientWidth, h: el.clientHeight });
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, [sheets]);

	const sheet = sheets?.[active];

	// Column x-offsets via prefix sums for windowing.
	const colOffsets = useMemo(() => {
		if (!sheet) return [0];
		const offsets = [0];
		for (let c = 0; c < sheet.cols; c++) {
			offsets.push(offsets[c] + (sheet.widths[c] ?? DEFAULT_COL));
		}
		return offsets;
	}, [sheet]);

	const labelColWidth = 48;

	const windowed = useMemo(() => {
		if (!sheet) return null;
		const r0 = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
		const rCount = Math.ceil(viewport.h / ROW_H) + OVERSCAN * 2;
		const r1 = Math.min(sheet.rows, r0 + rCount);

		// First visible column: linear scan is fine for <= 500 cols.
		let c0 = 0;
		const viewLeft = scrollLeft;
		while (
			c0 < sheet.cols - 1 &&
			colOffsets[c0 + 1] + labelColWidth < viewLeft
		) {
			c0++;
		}
		c0 = Math.max(0, c0 - OVERSCAN);
		let c1 = c0;
		while (
			c1 < sheet.cols &&
			colOffsets[c1] + labelColWidth < viewLeft + viewport.w + OVERSCAN * DEFAULT_COL
		) {
			c1++;
		}
		c1 = Math.min(sheet.cols, c1 + OVERSCAN);

		return { r0, r1, c0, c1 };
	}, [sheet, scrollTop, scrollLeft, viewport, colOffsets]);

	const onGridScroll = useCallback((e: React.UIEvent) => {
		const el = e.currentTarget;
		setScrollTop(el.scrollTop);
		setScrollLeft(el.scrollLeft);
	}, []);

	const copySelection = useCallback(() => {
		if (!selected || !sheet) return;
		const cell = sheet.cells.get(`${selected.r}:${selected.c}`);
		const text = cell?.value ?? "";
		if (navigator.clipboard) {
			navigator.clipboard.writeText(text).catch(() => {});
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
	const gridHeight = sheet.rows * ROW_H;

	return (
		<ViewerShell
			name={name}
			formatColor={formatCssVar("xlsx").base}
			progress={null}
			onClose={onClose}
			chromeAutohide={false}
			bottomBar={
				sheets.length > 1 ? (
					<TabStrip role="tablist">
						{sheets.map((s, i) => (
							<Tab
								key={s.name}
								$active={i === active}
								onClick={() => {
									setActive(i);
									setSelected(null);
									if (scrollRef.current) {
										scrollRef.current.scrollTop = 0;
										scrollRef.current.scrollLeft = 0;
									}
								}}
								role="tab"
								aria-selected={i === active}
							>
								{s.name}
							</Tab>
						))}
					</TabStrip>
				) : undefined
			}
		>
			<GridWrap ref={scrollRef} onScroll={onGridScroll} data-testid="xlsx-grid">
				<HeadRow style={{ transform: `translateX(${scrollLeft}px)` }}>
					<RowLabelCol $width={48}>#</RowLabelCol>
					{Array.from(
						{ length: windowed.c1 - windowed.c0 },
						(_, i) => windowed.c0 + i,
					).map((c) => (
						<HeadCell key={c} $width={sheet.widths[c] ?? DEFAULT_COL}>
							{colName(c)}
						</HeadCell>
					))}
				</HeadRow>
				<GridCanvas $width={gridWidth + labelColWidth} $height={gridHeight}>
					{Array.from({ length: windowed.r1 - windowed.r0 }, (_, i) =>
						windowed.r0 + i,
					).map((r) => (
						<div key={r}>
							<RowLabel
								$x={0}
								$y={r * ROW_H}
								$width={labelColWidth}
								$selected={false}
							>
								{r + 1}
							</RowLabel>
							{Array.from(
								{ length: windowed.c1 - windowed.c0 },
								(_, i) => windowed.c0 + i,
							).map((c) => {
								const cell = sheet.cells.get(`${r}:${c}`);
								const isSel = selected?.r === r && selected?.c === c;
								return (
									<GridCellBox
										key={c}
										$x={labelColWidth + (colOffsets[c] ?? 0)}
										$y={r * ROW_H}
										$width={sheet.widths[c] ?? DEFAULT_COL}
										$selected={isSel}
										$bold={cell?.bold}
										$italic={cell?.italic}
										$align={cell?.align}
										onClick={() => setSelected({ r, c })}
										onDoubleClick={() => {
											setSelected({ r, c });
											setCellCardOpen(true);
										}}
									>
										{cell?.value ?? ""}
									</GridCellBox>
								);
							})}
						</div>
					))}
				</GridCanvas>
			</GridWrap>

			<UiSheet
				open={cellCardOpen}
				title={`${sheet.name} · ${
					selected ? `${colName(selected.c)}${selected.r + 1}` : ""
				}`}
				onDismiss={() => setCellCardOpen(false)}
			>
				<CellCard>
					<div>
						<CardKey>Value</CardKey>
						<CardValue>{selectedCell?.value || "(empty)"}</CardValue>
					</div>
					{selectedCell?.formula && (
						<div>
							<CardKey>Formula</CardKey>
							<CardValue>{selectedCell.formula}</CardValue>
						</div>
					)}
					<Button
						onClick={() => {
							copySelection();
							setCellCardOpen(false);
						}}
					>
						Copy
					</Button>
				</CellCard>
			</UiSheet>
		</ViewerShell>
	);
}
