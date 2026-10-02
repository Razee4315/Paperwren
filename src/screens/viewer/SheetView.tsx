import { hasRtl } from "@/lib/bidi";
import { t } from "@/lib/i18n";
import { type Chart, readChart } from "@/lib/pptx/chart";
import {
	DEFAULT_COL_WIDTH,
	HEADER_HEIGHT,
	ROW_LABEL_WIDTH,
	colName,
	columnOffsets,
	computeVisibleWindow,
} from "@/lib/sheetLayout";
import { decodeText } from "@/lib/text";
import type { GridObject, ParseResult } from "@/lib/workbookModel";
import { useSettings } from "@/state/settings";
import { Button, ErrorArt, IconButton, Spinner, StateView, toast } from "@/ui";
import { Copy, Search } from "lucide-react";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import s from "./Sheet.module.css";
import { FindBar, type FindState, Shell, ZoomControl } from "./Shell";
import { SlideChart } from "./SlideChart";
import { useZoom } from "./hooks";
import { runWorker } from "./runWorker";
import {
	NUMERIC,
	type Range,
	type Sheet,
	chartColors,
	key,
	printSheet,
	rangeLabel,
	rangeOf,
	rangeStats,
	rangeText,
	rangeValues,
	styleCss,
	textWidth,
} from "./sheetHelpers";
import type { ViewerProps } from "./types";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;
const MIN_COL = 24;
const MAX_COL = 800;
/** Text may run over this many empty neighbours, as in Excel. */
const MAX_SPILL = 16;
/** The grid's font, for measuring text (see global.css --font). */
const FACE = '"Manrope Variable", Manrope, system-ui, sans-serif';
/** A frozen pane may not take more than this share of the screen. */
const MAX_FROZEN = 0.6;

interface Point {
	r: number;
	c: number;
}

const format = (n: number) =>
	n.toLocaleString("en-US", { maximumFractionDigits: 4 });

/** Spreadsheets (xlsx/xls/ods/csv): parsed in a worker, drawn as a
 * virtualised grid. Frozen rows and columns stay pinned, long text
 * runs over empty neighbours, and a range can be selected and copied.
 * Values are the cached results the file stores; nothing is
 * recalculated. */
export default function SheetView({
	data,
	name,
	format: fileFormat,
	position,
	onPosition,
	onClose,
	active,
}: ViewerProps) {
	const { settings } = useSettings();
	const [sheets, setSheets] = useState<Sheet[] | null>(null);
	const [looks, setLooks] = useState<CSSProperties[]>([]);
	const [mediaUrls, setMediaUrls] = useState<string[]>([]);
	const [accents, setAccents] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [index, setIndex] = useState(0);
	// The selection: where it started and (for a range) where it reaches.
	const [anchor, setAnchor] = useState<Point | null>(null);
	const [focus, setFocus] = useState<Point | null>(null);
	const [view, setView] = useState({ top: 0, left: 0, w: 400, h: 600 });
	// Column widths the reader dragged, per sheet.
	const [resized, setResized] = useState<Record<number, number[]>>({});
	// Zoom is CSS zoom on the grid surface: cell geometry stays in sheet
	// pixels, and only the scroll offsets convert between the two.
	const [zoom, setZoom] = useState(() =>
		position?.kind === "sheet" && settings.rememberPosition && position.zoom
			? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, position.zoom))
			: 1,
	);
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	const [findOpen, setFindOpen] = useState(false);
	const [find, setFind] = useState<FindState>({
		query: "",
		total: 0,
		current: -1,
	});
	const hits = useRef<Array<Point & { sheet: number }>>([]);
	/** A cell to show once the sheet it is on has been switched to. */
	const pending = useRef<Point | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const surface = useRef<HTMLDivElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const restored = useRef(false);

	// Parse once per document; position/settings are read at that moment.
	// biome-ignore lint/correctness/useExhaustiveDependencies: parse only when the bytes change
	useEffect(() => {
		const abort = new AbortController();
		let urls: string[] = [];
		const input = fileFormat === "csv" ? decodeText(data) : data;
		runWorker<ParseResult>({ type: "workbook", buffer: input }, abort.signal)
			.then((result) => {
				if (!result.ok) {
					setError(
						result.reason === "too-large"
							? t("This sheet is too large to show ({detail}).", {
									detail: result.detail ?? "",
								})
							: t("The file is damaged or isn't a valid spreadsheet."),
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
					setError(t("This workbook has no sheets."));
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
				urls = (result.media ?? []).map((m) =>
					m.bytes.length
						? URL.createObjectURL(
								new Blob([m.bytes as BlobPart], { type: m.type }),
							)
						: "",
				);
				setMediaUrls(urls);
				setAccents(result.accents ?? []);
				setIndex(saved >= 0 && saved < list.length ? saved : firstVisible);
				setLooks((result.styles ?? []).map(styleCss));
				setSheets(list);
			})
			.catch((e) => {
				if (e?.name !== "AbortError")
					setError(t("The file is damaged or isn't a valid spreadsheet."));
			});
		return () => {
			abort.abort();
			for (const url of urls) if (url) URL.revokeObjectURL(url);
		};
	}, [data, fileFormat]);

	const sheet = sheets?.[index];
	const widths = (sheet && resized[index]) || sheet?.widths || [];
	// biome-ignore lint/correctness/useExhaustiveDependencies: `widths` is derived from sheet and resized
	const colX = useMemo(() => columnOffsets(widths), [sheet, resized, index]);
	const width = colX[colX.length - 1] ?? 0;
	const height = sheet?.rowPrefix[sheet.rows] ?? 0;

	// Frozen panes, unless they would swallow the screen (a phone
	// showing a sheet frozen for a wide monitor).
	const frozenRows =
		sheet?.freeze &&
		sheet.rowPrefix[sheet.freeze.rows] * zoom <= view.h * MAX_FROZEN
			? sheet.freeze.rows
			: 0;
	const frozenCols =
		sheet?.freeze &&
		(colX[sheet.freeze.cols] ?? 0) * zoom <= view.w * MAX_FROZEN
			? sheet.freeze.cols
			: 0;
	const frozenH = sheet ? sheet.rowPrefix[frozenRows] : 0;
	const frozenW = colX[frozenCols] ?? 0;

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

	const saveTimer = useRef(0);
	const syncView = useCallback(() => {
		const el = scroller.current;
		if (!el) return;
		setView((v) =>
			v.top === el.scrollTop && v.left === el.scrollLeft
				? v
				: { ...v, top: el.scrollTop, left: el.scrollLeft },
		);
	}, []);
	const onScroll = () => {
		const el = scroller.current;
		if (!el) return;
		syncView();
		if (!settings.rememberPosition) return;
		window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(
			() =>
				onPosition({
					kind: "sheet",
					sheet: index,
					top: el.scrollTop,
					left: el.scrollLeft,
					zoom: zoomRef.current,
				}),
			400,
		);
	};
	useEffect(() => () => window.clearTimeout(saveTimer.current), []);

	// The grid is windowed, so it re-flows on every frame of a pinch:
	// the cells stay sharp and the headers stay put while zooming.
	const commit = useCallback((z: number) => flushSync(() => setZoom(z)), []);
	const settle = useCallback(() => flushSync(syncView), [syncView]);
	const { zoomBy, zoomTo } = useZoom({
		scroller,
		content: surface,
		zoom,
		commit,
		hud,
		min: MIN_ZOOM,
		max: MAX_ZOOM,
		onSettle: settle,
		doubleTap: false,
		enabled: !!sheet,
		active,
	});

	const win = sheet
		? computeVisibleWindow({
				rows: sheet.rows,
				cols: sheet.cols,
				colOffsets: colX,
				rowOffsets: sheet.rowPrefix,
				scrollTop: view.top / zoom,
				scrollLeft: view.left / zoom,
				viewportWidth: view.w / zoom,
				viewportHeight: view.h / zoom,
			})
		: null;

	const mergeAt = useCallback(
		(r: number, c: number) =>
			sheet?.merges.find(
				(m) => r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1,
			),
		[sheet],
	);

	/** Scroll just enough to bring a cell out from under the headers
	 * and frozen panes. Offsets are in surface (zoomed) pixels. */
	const reveal = useCallback(
		(r: number, c: number) => {
			const el = scroller.current;
			if (!el || !sheet) return;
			const z = zoomRef.current;
			if (r >= frozenRows) {
				const pinned = (HEADER_HEIGHT + frozenH) * z;
				const top = (HEADER_HEIGHT + sheet.rowPrefix[r]) * z;
				const bottom = (HEADER_HEIGHT + sheet.rowPrefix[r + 1]) * z;
				if (top < el.scrollTop + pinned) el.scrollTop = top - pinned;
				else if (bottom > el.scrollTop + el.clientHeight)
					el.scrollTop = bottom - el.clientHeight;
			}
			if (c >= frozenCols) {
				const pinned = (ROW_LABEL_WIDTH + frozenW) * z;
				const left = (ROW_LABEL_WIDTH + colX[c]) * z;
				const right = (ROW_LABEL_WIDTH + colX[c + 1]) * z;
				if (left < el.scrollLeft + pinned) el.scrollLeft = left - pinned;
				else if (right > el.scrollLeft + el.clientWidth)
					el.scrollLeft = right - el.clientWidth;
			}
		},
		[sheet, colX, frozenRows, frozenCols, frozenH, frozenW],
	);

	// Restore the saved scroll offset once, then start fresh per sheet
	// (or at the cell a cross-sheet find is heading for).
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
		const target = pending.current;
		pending.current = null;
		setAnchor(target);
		setFocus(null);
		if (target) reveal(target.r, target.c);
		setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft }));
	}, [sheet]);

	const select = useCallback(
		(r: number, c: number, extend = false) => {
			if (extend && anchor) {
				setFocus({ r, c });
				return;
			}
			const m = mergeAt(r, c);
			setAnchor(m ? { r: m.r0, c: m.c0 } : { r, c });
			setFocus(null);
		},
		[anchor, mergeAt],
	);

	const range: Range | null = anchor ? rangeOf(anchor, focus ?? anchor) : null;
	const single = !!range && range.r0 === range.r1 && range.c0 === range.c1;

	const copy = useCallback((value: string, what = t("Copied")) => {
		navigator.clipboard
			?.writeText(value)
			.then(() => toast(what))
			.catch(() => toast(t("Couldn't copy")));
	}, []);
	const copySelection = () => {
		if (!sheet || !range) return;
		if (single) {
			const value = sheet.cells.get(key(range.r0, range.c0))?.value;
			if (value) copy(value);
			return;
		}
		const rows = range.r1 - range.r0 + 1;
		const cols = range.c1 - range.c0 + 1;
		copy(
			rangeText(sheet, range),
			t("Copied {rows} × {cols} cells", { rows, cols }),
		);
	};

	const onKey = (e: React.KeyboardEvent) => {
		if (!sheet) return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
			if (range && !window.getSelection()?.toString()) {
				e.preventDefault();
				copySelection();
			}
			return;
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
			e.preventDefault();
			setAnchor({ r: 0, c: 0 });
			setFocus({ r: sheet.rows - 1, c: sheet.cols - 1 });
			return;
		}
		const d: Record<string, [number, number]> = {
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0],
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1],
		};
		const delta = d[e.key];
		if (!delta) return;
		e.preventDefault();
		// Shift moves the far corner of the range; plain arrows move the cell.
		const base = (e.shiftKey ? (focus ?? anchor) : anchor) ?? { r: 0, c: 0 };
		const r = Math.min(sheet.rows - 1, Math.max(0, base.r + delta[0]));
		const c = Math.min(sheet.cols - 1, Math.max(0, base.c + delta[1]));
		select(r, c, e.shiftKey);
		reveal(r, c);
	};

	// --- pointer: click, shift-click, drag a range, drag its handle ---
	const dragging = useRef(false);
	const cellUnder = (target: EventTarget | null, x: number, y: number) => {
		// The pointer may be captured; ask what is really under it.
		const el =
			(dragging.current ? document.elementFromPoint(x, y) : target) ?? null;
		const cell = (el as HTMLElement | null)?.closest?.<HTMLElement>("[data-r]");
		if (!cell) return null;
		return { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
	};
	const onPointerDown = (e: React.PointerEvent) => {
		const handle = (e.target as HTMLElement).closest(`.${s.grip}`);
		if (handle) {
			dragging.current = true;
			e.currentTarget.setPointerCapture(e.pointerId);
			e.preventDefault();
			return;
		}
		if (e.pointerType !== "mouse" || e.button !== 0) return;
		const cell = cellUnder(e.target, e.clientX, e.clientY);
		if (!cell) return;
		select(cell.r, cell.c, e.shiftKey);
		// Keep receiving the drag when it leaves the grid.
		dragging.current = true;
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e: React.PointerEvent) => {
		if (!dragging.current) return;
		const cell = cellUnder(e.target, e.clientX, e.clientY);
		if (
			cell &&
			(cell.r !== (focus ?? anchor)?.r || cell.c !== (focus ?? anchor)?.c)
		)
			setFocus(cell);
	};
	const onPointerUp = () => {
		dragging.current = false;
	};
	/** Taps (touch, pen): mouse clicks were handled on pointer down. */
	const onClick = (e: React.MouseEvent) => {
		const native = e.nativeEvent as PointerEvent;
		if (native.pointerType === "mouse") return;
		const cell = cellUnder(e.target, e.clientX, e.clientY);
		if (cell) select(cell.r, cell.c, e.shiftKey);
	};

	// --- column resizing ---
	const resizing = useRef<{ c: number; x: number; w: number } | null>(null);
	const setWidth = (c: number, w: number) =>
		setResized((all) => {
			const next = [...(all[index] ?? sheet?.widths ?? [])];
			next[c] = Math.round(Math.min(MAX_COL, Math.max(MIN_COL, w)));
			return { ...all, [index]: next };
		});
	/** Double-click a column edge: fit the widest text on screen. */
	const autoFit = (c: number) => {
		if (!sheet || !win) return;
		let widest = MIN_COL;
		for (let r = Math.min(win.r0, frozenRows ? 0 : win.r0); r < win.r1; r++) {
			const cell = sheet.cells.get(key(r, c));
			if (!cell?.value) continue;
			const bold =
				cell.style !== undefined && looks[cell.style]?.fontWeight === 700;
			widest = Math.max(widest, textWidth(cell.value, bold, FACE) + 16);
		}
		setWidth(c, widest);
	};

	// --- find, across every sheet ---
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new query or workbook restarts the search; switching sheets must not
	useEffect(() => {
		if (!findOpen || !sheets) return;
		const q = find.query.trim().toLowerCase();
		const t = window.setTimeout(() => {
			const found: Array<Point & { sheet: number }> = [];
			if (q) {
				sheets.forEach((sh, si) => {
					const here: Point[] = [];
					for (const [k, cell] of sh.cells)
						if (cell.value.toLowerCase().includes(q))
							here.push({ r: Math.floor(k / 1024), c: k % 1024 });
					here.sort((a, b) => a.r - b.r || a.c - b.c);
					for (const hit of here) found.push({ ...hit, sheet: si });
				});
			}
			hits.current = found;
			// Start with the first match on the sheet being looked at.
			const start = Math.max(
				0,
				found.findIndex((h) => h.sheet === index),
			);
			setFind((f) => ({
				...f,
				total: found.length,
				current: found.length ? start : -1,
			}));
			const first = found[start];
			if (first) go(first);
		}, 150);
		return () => window.clearTimeout(t);
	}, [find.query, findOpen, sheets]);

	const go = (hit: Point & { sheet: number }) => {
		if (hit.sheet !== index) {
			pending.current = { r: hit.r, c: hit.c };
			setIndex(hit.sheet);
			return;
		}
		setAnchor({ r: hit.r, c: hit.c });
		setFocus(null);
		reveal(hit.r, hit.c);
	};
	const stepFind = (dir: 1 | -1) => {
		if (!find.total) return;
		const current = (find.current + dir + find.total) % find.total;
		setFind((f) => ({ ...f, current }));
		go(hits.current[current]);
	};

	// --- charts on the sheet, parsed where there is a DOM ---
	const charts = useMemo(() => {
		const out = new Map<GridObject, Chart>();
		if (!sheet?.objects) return out;
		const colors = chartColors(accents);
		for (const object of sheet.objects) {
			if (!object.chartXml) continue;
			try {
				const doc = new DOMParser().parseFromString(
					object.chartXml,
					"application/xml",
				);
				if (doc.getElementsByTagName("parsererror").length) continue;
				// A chart with no stored values reads its ranges from the sheets.
				const chart = readChart(doc, colors, (formula) =>
					rangeValues(sheets ?? [], formula),
				);
				if (chart) out.set(object, chart);
			} catch {
				// An odd chart part: the grid still shows.
			}
		}
		return out;
	}, [sheet, sheets, accents]);

	// Objects hang from their columns, so they move (and stretch, when
	// anchored at both ends) as columns are resized. They may sit beyond
	// the last cell; the grid must reach them.
	const placed = (sheet?.objects ?? []).map((object) => {
		const edge = (col: number, dx: number) =>
			(col < colX.length
				? colX[col]
				: width + (col - (colX.length - 1)) * DEFAULT_COL_WIDTH) + dx;
		const left = edge(object.col, object.dx);
		const w =
			object.endCol !== undefined
				? Math.max(8, edge(object.endCol, object.endDx ?? 0) - left)
				: object.w;
		return { object, left, w };
	});
	const extentW = Math.max(width, ...placed.map((p) => p.left + p.w + 16));
	const extentH = Math.max(
		height,
		...(sheet?.objects ?? []).map((o) => o.y + o.h + 16),
	);

	// --- cells, per pane ---

	/** The cells of rows [r0, r1) x columns [c0, c1), `shift` px to the
	 * right (panes that include the row rail). With `ghosts`, only the
	 * text that runs out of a frozen column past the freeze line: the
	 * scrolling pane beside it repeats that text, so the run carries on
	 * where the frozen pane clips it. */
	const cellsFor = (
		r0: number,
		r1: number,
		c0: number,
		c1: number,
		shift: number,
		ghosts = false,
	): JSX.Element[] => {
		const out: JSX.Element[] = [];
		if (!sheet || r1 <= r0 || c1 <= c0) return out;
		const drawn = new Set<number>();
		const local = sheet.merges.filter(
			(m) => m.r1 >= r0 && m.r0 < r1 && m.c1 >= c0 && m.c0 < c1,
		);
		for (let r = r0; r < r1; r++) {
			for (let c = c0; c < c1; c++) {
				const m = local.find(
					(x) => r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1,
				);
				const ar = m ? m.r0 : r;
				const ac = m ? m.c0 : c;
				const k = key(ar, ac);
				if (drawn.has(k)) continue;
				drawn.add(k);
				const cell = sheet.cells.get(k);
				const value = cell?.value ?? "";
				const look = cell?.style !== undefined ? looks[cell.style] : undefined;
				const numeric = NUMERIC.test(value);
				let w = m ? colX[m.c1 + 1] - colX[ac] : widths[ac];
				// Long text runs over the empty cells to its right, as in Excel.
				let spilled = false;
				if (
					value &&
					!m &&
					!numeric &&
					look?.whiteSpace !== "normal" &&
					look?.textAlign !== "center" &&
					look?.textAlign !== "right" &&
					!hasRtl(value)
				) {
					const need = textWidth(value, look?.fontWeight === 700, FACE) + 14;
					if (need > w) {
						let room = w;
						for (
							let next = ac + 1;
							next < sheet.cols && room < need && next - ac <= MAX_SPILL;
							next++
						) {
							const beside = sheet.cells.get(key(ar, next));
							if (
								beside?.value ||
								(beside?.style !== undefined &&
									looks[beside.style]?.background) ||
								mergeAt(ar, next)
							)
								break;
							room += widths[next];
						}
						if (room > w) {
							w = Math.min(room, need);
							spilled = true;
						}
					}
				}
				if (ghosts && !(spilled && colX[ac] + w > frozenW)) continue;
				const top = sheet.rowPrefix[ar];
				const hh = m ? sheet.rowPrefix[m.r1 + 1] - top : sheet.rowHeights[ar];
				out.push(
					<div
						key={k}
						data-r={ghosts ? undefined : ar}
						data-c={ghosts ? undefined : ac}
						aria-hidden={ghosts || undefined}
						className={`${s.cell} ${m ? s.merged : numeric ? s.num : ""} ${spilled ? s.spill : ""} ${ghosts ? s.ghost : ""} ${look?.["--ink" as keyof typeof look] ? s.ink : ""}`}
						style={{
							left: shift + colX[ac],
							top,
							width: w,
							height: hh,
							...look,
						}}
						// Right-to-left text starts from the right edge, as in Excel.
						dir={value && hasRtl(value) ? "rtl" : undefined}
						title={value.length > 20 ? value : undefined}
					>
						{value}
					</div>,
				);
			}
		}
		return out;
	};

	const rowLabels = (r0: number, r1: number): JSX.Element[] => {
		const out: JSX.Element[] = [];
		if (!sheet) return out;
		for (let r = r0; r < r1; r++)
			out.push(
				<button
					type="button"
					key={r}
					tabIndex={-1}
					className={`${s.rowHead} ${range && r >= range.r0 && r <= range.r1 ? s.hot : ""}`}
					style={{ top: sheet.rowPrefix[r], height: sheet.rowHeights[r] }}
					onClick={() => {
						setAnchor({ r, c: 0 });
						setFocus({ r, c: sheet.cols - 1 });
					}}
					aria-label={t("Select row {n}", {
						n: (sheet.rowOrigins[r] ?? r) + 1,
					})}
				>
					{(sheet.rowOrigins[r] ?? r) + 1}
				</button>,
			);
		return out;
	};

	const colHeads = (c0: number, c1: number): JSX.Element[] => {
		const out: JSX.Element[] = [];
		if (!sheet) return out;
		for (let c = c0; c < c1; c++) {
			const letter = colName(sheet.colOrigins[c] ?? c);
			out.push(
				<button
					type="button"
					key={c}
					tabIndex={-1}
					className={`${s.colHead} ${range && c >= range.c0 && c <= range.c1 ? s.hot : ""}`}
					style={{ left: ROW_LABEL_WIDTH + colX[c], width: widths[c] }}
					onClick={() => {
						setAnchor({ r: 0, c });
						setFocus({ r: sheet.rows - 1, c });
					}}
					aria-label={t("Select column {letter}", { letter })}
				>
					{letter}
				</button>,
				<div
					key={`w${c}`}
					className={s.resizer}
					style={{ left: ROW_LABEL_WIDTH + colX[c + 1] }}
					title={t("Drag to resize; double-click to fit")}
					onPointerDown={(e) => {
						resizing.current = { c, x: e.clientX, w: widths[c] };
						e.currentTarget.setPointerCapture(e.pointerId);
						e.stopPropagation();
					}}
					onPointerMove={(e) => {
						const drag = resizing.current;
						if (drag?.c === c)
							setWidth(c, drag.w + (e.clientX - drag.x) / zoomRef.current);
					}}
					onPointerUp={() => {
						resizing.current = null;
					}}
					onPointerCancel={() => {
						resizing.current = null;
					}}
					onDoubleClick={() => autoFit(c)}
					data-testid={`col-resize-${c}`}
				/>,
			);
		}
		return out;
	};

	/** The selection outline, for a pane whose origin sits `shift` px
	 * left of the body's (the pane clips whatever lies outside it). */
	const selection = (shift: number, withGrip: boolean) => {
		if (!sheet || !range) return null;
		const m = single ? mergeAt(range.r0, range.c0) : undefined;
		const r1 = m ? m.r1 : range.r1;
		const c1 = m ? m.c1 : range.c1;
		return (
			<div
				className={s.selected}
				style={{
					left: shift + colX[range.c0],
					top: sheet.rowPrefix[range.r0],
					width: colX[c1 + 1] - colX[range.c0],
					height: sheet.rowPrefix[r1 + 1] - sheet.rowPrefix[range.r0],
				}}
			>
				{withGrip && <span className={s.grip} aria-hidden="true" />}
			</div>
		);
	};

	const bodyRows: [number, number] = win
		? [Math.max(win.r0, frozenRows), win.r1]
		: [0, 0];
	const bodyCols: [number, number] = win
		? [Math.max(win.c0, frozenCols), win.c1]
		: [0, 0];

	const cell =
		single && range && sheet
			? sheet.cells.get(key(range.r0, range.c0))
			: undefined;
	const stats = sheet && range && !single ? rangeStats(sheet, range) : null;

	const bottom = sheets ? (
		<>
			{range && sheet && (
				<div className={s.detail} data-testid="cell-detail">
					<span className={s.addr}>{rangeLabel(sheet, range)}</span>
					<span className={s.value}>
						{single ? (
							<>
								{cell?.noCachedResult
									? t(t("No saved result"))
									: cell?.value || t(t("Empty"))}
								{cell?.formula && (
									<span className={s.formula}>{cell.formula}</span>
								)}
							</>
						) : (
							<>
								{t("{rows} × {cols} cells", {
									rows: range.r1 - range.r0 + 1,
									cols: range.c1 - range.c0 + 1,
								})}
								{stats && (
									<span className={s.formula} data-testid="range-stats">
										{t("Sum {sum} · Average {average} · Count {count}", {
											sum: format(stats.sum),
											average: format(stats.sum / stats.count),
											count: stats.count,
										})}
									</span>
								)}
							</>
						)}
					</span>
					<IconButton
						label={single ? t(t("Copy value")) : t(t("Copy cells"))}
						disabled={single && !cell?.value}
						onClick={copySelection}
						data-testid="sheet-copy"
					>
						<Copy size={18} />
					</IconButton>
				</div>
			)}
			<div className={s.bar}>
				{sheets.length > 1 ? (
					<div className={s.tabs} role="tablist" aria-label={t("Sheets")}>
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
				) : (
					<span className={s.size}>
						{sheet
							? t("{rows} rows · {cols} columns", {
									rows: sheet.rows.toLocaleString(),
									cols: sheet.cols.toLocaleString(),
								})
							: ""}
					</span>
				)}
				<ZoomControl
					label={`${Math.round(zoom * 100)}%`}
					onOut={() => zoomBy(1 / 1.2)}
					onIn={() => zoomBy(1.2)}
					onReset={() => zoomTo(1)}
					resetLabel={t("Reset zoom to 100%")}
					testId="sheet"
				/>
			</div>
		</>
	) : undefined;

	const pinnedWidth = ROW_LABEL_WIDTH + frozenW;

	return (
		<Shell
			name={name}
			format={fileFormat}
			onClose={onClose}
			active={active}
			hud={hud}
			onFind={sheets ? () => setFindOpen(true) : undefined}
			onPrint={
				sheet ? (root) => printSheet(root, sheet, widths, looks) : undefined
			}
			actions={
				<IconButton
					label={t("Find")}
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
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={onPointerUp}
					onClick={onClick}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: role=grid is focusable for arrow-key navigation
					tabIndex={0}
					// biome-ignore lint/a11y/useSemanticElements: virtualised grid; a <table> can't be windowed
					role="grid"
					aria-label={sheet.name}
					data-testid="sheet-grid"
				>
					<div
						ref={surface}
						className={s.surface}
						style={{
							width: extentW + ROW_LABEL_WIDTH,
							height: extentH + HEADER_HEIGHT,
							zoom,
						}}
					>
						{/* Column letters; those of frozen columns stay pinned. */}
						<div className={s.head} style={{ height: HEADER_HEIGHT }}>
							{colHeads(bodyCols[0], bodyCols[1])}
							<div className={s.pin} style={{ width: pinnedWidth }}>
								<div className={s.corner} style={{ width: ROW_LABEL_WIDTH }} />
								{colHeads(0, frozenCols)}
							</div>
						</div>

						{/* Frozen rows: pinned under the letters. */}
						{frozenRows > 0 && (
							<div
								className={s.topPane}
								style={{ height: frozenH, marginBottom: -frozenH }}
								data-testid="frozen-rows"
							>
								{cellsFor(
									0,
									frozenRows,
									bodyCols[0],
									bodyCols[1],
									ROW_LABEL_WIDTH,
								)}
								{cellsFor(0, frozenRows, 0, frozenCols, ROW_LABEL_WIDTH, true)}
								{selection(ROW_LABEL_WIDTH, false)}
								<div className={s.pin} style={{ width: pinnedWidth }}>
									<div className={s.rail} style={{ width: ROW_LABEL_WIDTH }}>
										{rowLabels(0, frozenRows)}
									</div>
									{cellsFor(0, frozenRows, 0, frozenCols, ROW_LABEL_WIDTH)}
									{selection(ROW_LABEL_WIDTH, false)}
								</div>
							</div>
						)}

						{/* Row numbers and frozen columns: pinned at the left. */}
						<div
							className={s.side}
							style={{ width: pinnedWidth, height: extentH }}
							data-testid={frozenCols > 0 ? "frozen-cols" : undefined}
						>
							<div className={s.rail} style={{ width: ROW_LABEL_WIDTH }}>
								{rowLabels(bodyRows[0], bodyRows[1])}
							</div>
							{cellsFor(
								bodyRows[0],
								bodyRows[1],
								0,
								frozenCols,
								ROW_LABEL_WIDTH,
							)}
							{frozenCols > 0 && selection(ROW_LABEL_WIDTH, false)}
						</div>

						<div
							className={s.body}
							style={{
								left: ROW_LABEL_WIDTH,
								top: HEADER_HEIGHT,
								width: extentW,
								height: extentH,
							}}
						>
							{cellsFor(bodyRows[0], bodyRows[1], bodyCols[0], bodyCols[1], 0)}
							{cellsFor(bodyRows[0], bodyRows[1], 0, frozenCols, 0, true)}
							{placed.map(({ object, left, w }, i) => {
								const chart = charts.get(object);
								const src =
									object.image !== undefined ? mediaUrls[object.image] : "";
								if (!chart && !src) return null;
								return (
									<div
										key={i}
										className={s.object}
										style={{
											left,
											top: object.y,
											width: w,
											height: object.h,
										}}
										data-testid="sheet-object"
									>
										{chart ? (
											<SlideChart chart={chart} w={w} h={object.h} />
										) : (
											<img src={src} alt="" draggable={false} />
										)}
									</div>
								);
							})}
							{selection(0, true)}
						</div>
					</div>
				</div>
			)}
			{!sheets && !error && (
				<StateView>
					<Spinner label={t("Opening spreadsheet")} />
				</StateView>
			)}
			{error && (
				<StateView
					icon={<ErrorArt />}
					title={t("Can't show this spreadsheet")}
					action={<Button onClick={onClose}>{t("Close")}</Button>}
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
