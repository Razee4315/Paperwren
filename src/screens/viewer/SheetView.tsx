import {
	HEADER_HEIGHT,
	ROW_LABEL_WIDTH,
	colName,
	columnOffsets,
	computeVisibleWindow,
} from "@/lib/sheetLayout";
import { decodeText } from "@/lib/text";
import type { GridCell, GridSheet, ParseResult } from "@/lib/workbookModel";
import { useSettings } from "@/state/settings";
import { Button, IconButton, Spinner, StateView, toast } from "@/ui";
import { Copy, Search } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import s from "./Sheet.module.css";
import { FindBar, type FindState, Shell } from "./Shell";
import { runWorker } from "./runWorker";
import type { ViewerProps } from "./types";

interface Sheet extends Omit<GridSheet, "cells"> {
	cells: Map<number, GridCell>;
}

const key = (r: number, c: number) => r * 1024 + c;
const NUMERIC = /^[-+(]?[$€£¥]?\s?[\d.,]+%?\)?$/;

/** Spreadsheets (xlsx/xls/ods/csv): parsed in a worker, drawn as a
 * virtualised grid with frozen headers. Values are the cached results
 * the file stores; nothing is recalculated. */
export default function SheetView({
	data,
	name,
	format,
	position,
	onPosition,
	onClose,
	active,
}: ViewerProps) {
	const { settings } = useSettings();
	const [sheets, setSheets] = useState<Sheet[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [index, setIndex] = useState(0);
	const [selected, setSelected] = useState<{ r: number; c: number } | null>(
		null,
	);
	const [view, setView] = useState({ top: 0, left: 0, w: 400, h: 600 });
	const [findOpen, setFindOpen] = useState(false);
	const [find, setFind] = useState<FindState>({
		query: "",
		total: 0,
		current: -1,
	});
	const hits = useRef<Array<{ r: number; c: number }>>([]);
	const scroller = useRef<HTMLDivElement>(null);
	const restored = useRef(false);

	// Parse once per document; position/settings are read at that moment.
	// biome-ignore lint/correctness/useExhaustiveDependencies: parse only when the bytes change
	useEffect(() => {
		const abort = new AbortController();
		const input = format === "csv" ? decodeText(data) : data;
		runWorker<ParseResult>({ type: "workbook", buffer: input }, abort.signal)
			.then((result) => {
				if (!result.ok) {
					setError(
						result.reason === "too-large"
							? `This sheet is too large to show (${result.detail}).`
							: "The file is damaged or isn't a valid spreadsheet.",
					);
					return;
				}
				const list = result.sheets.map((sh) => ({
					...sh,
					cells: new Map(
						sh.cells.map(([r, c, cell]) => [key(r, c), cell] as const),
					),
				}));
				if (!list.length) {
					setError("This workbook has no sheets.");
					return;
				}
				const saved =
					position?.kind === "sheet" && settings.rememberPosition
						? position.sheet
						: -1;
				const firstVisible = Math.max(
					0,
					list.findIndex((sh) => !sh.hiddenSheet),
				);
				setIndex(saved >= 0 && saved < list.length ? saved : firstVisible);
				setSheets(list);
			})
			.catch((e) => {
				if (e?.name !== "AbortError")
					setError("The file is damaged or isn't a valid spreadsheet.");
			});
		return () => abort.abort();
	}, [data, format]);

	const sheet = sheets?.[index];
	const colX = useMemo(
		() => (sheet ? columnOffsets(sheet.widths) : [0]),
		[sheet],
	);
	const width = colX[colX.length - 1] ?? 0;
	const height = sheet?.rowPrefix[sheet.rows] ?? 0;

	// Track the viewport for windowing.
	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el || !sheet) return;
		const measure = () =>
			setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight }));
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [sheet]);

	// Restore the saved scroll offset once, then start fresh per sheet.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs per sheet switch only
	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el || !sheet) return;
		if (
			!restored.current &&
			position?.kind === "sheet" &&
			settings.rememberPosition
		) {
			el.scrollTop = position.top;
			el.scrollLeft = position.left;
		} else {
			el.scrollTop = 0;
			el.scrollLeft = 0;
		}
		restored.current = true;
		setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft }));
		setSelected(null);
	}, [sheet]);

	const saveTimer = useRef(0);
	const onScroll = () => {
		const el = scroller.current;
		if (!el) return;
		setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft }));
		window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(
			() =>
				onPosition({
					kind: "sheet",
					sheet: index,
					top: el.scrollTop,
					left: el.scrollLeft,
				}),
			400,
		);
	};
	useEffect(() => () => window.clearTimeout(saveTimer.current), []);

	const win = sheet
		? computeVisibleWindow({
				rows: sheet.rows,
				cols: sheet.cols,
				colOffsets: colX,
				rowOffsets: sheet.rowPrefix,
				scrollTop: view.top,
				scrollLeft: view.left,
				viewportWidth: view.w,
				viewportHeight: view.h,
			})
		: null;

	const mergeAt = useCallback(
		(r: number, c: number) =>
			sheet?.merges.find(
				(m) => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1,
			),
		[sheet],
	);

	const reveal = useCallback(
		(r: number, c: number) => {
			const el = scroller.current;
			if (!el || !sheet) return;
			const top = sheet.rowPrefix[r];
			const bottom = sheet.rowPrefix[r + 1];
			if (top < el.scrollTop) el.scrollTop = top;
			else if (bottom > el.scrollTop + el.clientHeight - HEADER_HEIGHT)
				el.scrollTop = bottom - el.clientHeight + HEADER_HEIGHT;
			const left = colX[c];
			const right = colX[c + 1];
			if (left < el.scrollLeft) el.scrollLeft = left;
			else if (right > el.scrollLeft + el.clientWidth - ROW_LABEL_WIDTH)
				el.scrollLeft = right - el.clientWidth + ROW_LABEL_WIDTH;
		},
		[sheet, colX],
	);

	const select = (r: number, c: number) => {
		const m = mergeAt(r, c);
		setSelected(m ? { r: m.r0, c: m.c0 } : { r, c });
	};

	const onKey = (e: React.KeyboardEvent) => {
		if (!sheet) return;
		const d: Record<string, [number, number]> = {
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0],
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1],
		};
		const delta = d[e.key];
		if (!delta) return;
		e.preventDefault();
		const base = selected ?? { r: 0, c: 0 };
		const r = Math.min(sheet.rows - 1, Math.max(0, base.r + delta[0]));
		const c = Math.min(sheet.cols - 1, Math.max(0, base.c + delta[1]));
		select(r, c);
		reveal(r, c);
	};

	// Find in the current sheet.
	useEffect(() => {
		if (!findOpen || !sheet) return;
		const q = find.query.trim().toLowerCase();
		const t = window.setTimeout(() => {
			const found: Array<{ r: number; c: number }> = [];
			if (q) {
				for (const [k, cell] of sheet.cells) {
					if (cell.value.toLowerCase().includes(q))
						found.push({ r: Math.floor(k / 1024), c: k % 1024 });
				}
				found.sort((a, b) => a.r - b.r || a.c - b.c);
			}
			hits.current = found;
			setFind((f) => ({
				...f,
				total: found.length,
				current: found.length ? 0 : -1,
			}));
			if (found[0]) {
				setSelected(found[0]);
				reveal(found[0].r, found[0].c);
			}
		}, 150);
		return () => window.clearTimeout(t);
	}, [find.query, findOpen, sheet, reveal]);

	const stepFind = (dir: 1 | -1) =>
		setFind((f) => {
			if (!f.total) return f;
			const current = (f.current + dir + f.total) % f.total;
			const hit = hits.current[current];
			setSelected(hit);
			reveal(hit.r, hit.c);
			return { ...f, current };
		});

	const cell =
		selected && sheet
			? sheet.cells.get(key(selected.r, selected.c))
			: undefined;
	const addr =
		selected && sheet
			? `${colName(sheet.colOrigins[selected.c] ?? selected.c)}${(sheet.rowOrigins[selected.r] ?? selected.r) + 1}`
			: "";

	const cellsOut: JSX.Element[] = [];
	const heads: JSX.Element[] = [];
	const labels: JSX.Element[] = [];
	if (sheet && win) {
		const drawn = new Set<number>();
		// Only merges touching the window matter for this frame.
		const local = sheet.merges.filter(
			(m) => m.r1 >= win.r0 && m.r0 < win.r1 && m.c1 >= win.c0 && m.c0 < win.c1,
		);
		const mergeIn = (r: number, c: number) =>
			local.find((m) => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1);
		for (let r = win.r0; r < win.r1; r++) {
			const y = sheet.rowPrefix[r];
			const h = sheet.rowHeights[r];
			labels.push(
				<div
					key={r}
					className={`${s.rowHead} ${selected?.r === r ? s.hot : ""}`}
					style={{ top: y, height: h }}
				>
					{(sheet.rowOrigins[r] ?? r) + 1}
				</div>,
			);
			for (let c = win.c0; c < win.c1; c++) {
				const m = mergeIn(r, c);
				const ar = m ? m.r0 : r;
				const ac = m ? m.c0 : c;
				const k = key(ar, ac);
				if (drawn.has(k)) continue;
				drawn.add(k);
				const value = sheet.cells.get(k)?.value ?? "";
				const x = colX[ac];
				const w = m ? colX[m.c1 + 1] - x : sheet.widths[ac];
				const top = sheet.rowPrefix[ar];
				const hh = m ? sheet.rowPrefix[m.r1 + 1] - top : sheet.rowHeights[ar];
				cellsOut.push(
					// biome-ignore lint/a11y/useKeyWithClickEvents: the grid owns keyboard navigation (arrow keys)
					<div
						key={k}
						className={`${s.cell} ${m ? s.merged : NUMERIC.test(value) ? s.num : ""}`}
						style={{ left: x, top, width: w, height: hh }}
						onClick={() => select(ar, ac)}
						title={value.length > 20 ? value : undefined}
					>
						{value}
					</div>,
				);
			}
		}
		for (let c = win.c0; c < win.c1; c++) {
			heads.push(
				<div
					key={c}
					className={`${s.colHead} ${selected?.c === c ? s.hot : ""}`}
					style={{ left: ROW_LABEL_WIDTH + colX[c], width: sheet.widths[c] }}
				>
					{colName(sheet.colOrigins[c] ?? c)}
				</div>,
			);
		}
	}

	let selBox: JSX.Element | null = null;
	if (selected && sheet) {
		const m = mergeAt(selected.r, selected.c);
		const r1 = m ? m.r1 : selected.r;
		const c1 = m ? m.c1 : selected.c;
		selBox = (
			<div
				className={s.selected}
				style={{
					left: colX[selected.c],
					top: sheet.rowPrefix[selected.r],
					width: colX[c1 + 1] - colX[selected.c],
					height: sheet.rowPrefix[r1 + 1] - sheet.rowPrefix[selected.r],
				}}
			/>
		);
	}

	const bottom = sheets ? (
		<>
			{selected && (
				<div className={s.detail} data-testid="cell-detail">
					<span className={s.addr}>{addr}</span>
					<span className={s.value}>
						{cell?.noCachedResult ? "No saved result" : cell?.value || "Empty"}
						{cell?.formula && <span className={s.formula}>{cell.formula}</span>}
					</span>
					<IconButton
						label="Copy value"
						disabled={!cell?.value}
						onClick={() =>
							navigator.clipboard
								?.writeText(cell?.value ?? "")
								.then(() => toast("Copied"))
								.catch(() => toast("Couldn't copy"))
						}
					>
						<Copy size={18} />
					</IconButton>
				</div>
			)}
			{sheets.length > 1 && (
				<div className={s.tabs} role="tablist" aria-label="Sheets">
					{sheets.map((sh, i) => (
						<button
							type="button"
							role="tab"
							key={sh.name}
							aria-selected={i === index}
							className={`${s.tab} ${sh.hiddenSheet ? s.hiddenTab : ""}`}
							onClick={() => setIndex(i)}
							data-testid={`sheet-tab-${i}`}
						>
							{sh.name}
						</button>
					))}
				</div>
			)}
		</>
	) : undefined;

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			actions={
				<IconButton
					label="Find"
					onClick={() => setFindOpen(true)}
					active={findOpen}
					disabled={!sheets}
					data-testid="sheet-find"
				>
					<Search size={20} />
				</IconButton>
			}
			find={
				findOpen ? (
					<FindBar
						state={find}
						onQuery={(query) => setFind((f) => ({ ...f, query }))}
						onStep={stepFind}
						onClose={() => {
							setFindOpen(false);
							setFind({ query: "", total: 0, current: -1 });
						}}
					/>
				) : undefined
			}
			bottom={bottom}
		>
			{sheet && (
				<div
					ref={scroller}
					className={s.scroller}
					onScroll={onScroll}
					onKeyDown={onKey}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: role=grid is focusable for arrow-key navigation
					tabIndex={0}
					// biome-ignore lint/a11y/useSemanticElements: virtualised grid; a <table> can't be windowed
					role="grid"
					aria-label={sheet.name}
					data-testid="sheet-grid"
				>
					<div
						className={s.surface}
						style={{
							width: width + ROW_LABEL_WIDTH,
							height: height + HEADER_HEIGHT,
						}}
					>
						<div
							className={s.head}
							style={{ height: HEADER_HEIGHT, width: width + ROW_LABEL_WIDTH }}
						>
							<div className={s.corner} style={{ width: ROW_LABEL_WIDTH }} />
							{heads}
						</div>
						<div className={s.rail} style={{ width: ROW_LABEL_WIDTH, height }}>
							{labels}
						</div>
						<div
							className={s.body}
							style={{
								left: ROW_LABEL_WIDTH,
								top: HEADER_HEIGHT,
								width,
								height,
							}}
						>
							{cellsOut}
							{selBox}
						</div>
					</div>
				</div>
			)}
			{!sheets && !error && (
				<StateView>
					<Spinner label="Opening spreadsheet" />
				</StateView>
			)}
			{error && (
				<StateView
					title="Can't show this spreadsheet"
					action={<Button onClick={onClose}>Close</Button>}
				>
					{error}
				</StateView>
			)}
			{sheet?.limitNote && (
				<div className="visually-hidden">{sheet.limitNote}</div>
			)}
		</Shell>
	);
}
