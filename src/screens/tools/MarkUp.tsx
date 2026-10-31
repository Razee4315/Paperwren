import { type SavedFile, backend } from "@/lib/backend";
import { copyName } from "@/lib/fileName";
import { t } from "@/lib/i18n";
import {
	type PageTextItem,
	type TextLine,
	textBetween,
	textLines,
} from "@/lib/pageText";
import { type Markup, NOTE_SIZE, addMarkup } from "@/lib/pdfMarkup";
import { ToolError } from "@/lib/pdfTools";
import { useBackClose } from "@/state/navigation";
import { Button, Dialog, IconButton, Spinner, toast } from "@/ui";
import { useModalFocus } from "@/ui/Overlay";
import {
	ArrowLeft,
	Eraser,
	Hand,
	Highlighter,
	Minus,
	PenLine,
	Plus,
	Redo2,
	StickyNote,
	Strikethrough,
	Trash2,
	Underline,
	Undo2,
	WholeWord,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
	type PointerEvent as ReactPointerEvent,
	memo,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { FillPage } from "./FillSign";
import s from "./Tools.module.css";
import { curve, markHit, pushPoint } from "./ink";

type Tool =
	| "move"
	| "pen"
	| "marker"
	| "highlight"
	| "underline"
	| "strike"
	| "note"
	| "erase";
type Item = Markup & { id: string };
/** What is being drawn or dragged, not yet part of the page. */
type Live =
	| { kind: "ink"; page: number; points: Array<[number, number]> }
	| {
			kind: "text";
			page: number;
			from: [number, number];
			to: [number, number];
	  };
/** A note being written: a new one has no id yet. */
type Writing = {
	id?: string;
	page: number;
	x: number;
	y: number;
	text: string;
};

const PEN_COLORS = ["#111111", "#1a3c8c", "#c0392b", "#1f8a4c"];
const MARKER_COLORS = ["#ffd93b", "#8ee06e", "#ff9ecb", "#7fd3ff"];
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

let made = 0;
const newId = () => `k${++made}`;

/**
 * Write on a PDF: a pen and a felt marker that go anywhere, highlight,
 * underline and strike-out that follow the words, and notes. Saving
 * makes a new copy with them as the PDF's own annotations; the file
 * that was opened stays as it was.
 */
export function MarkUp({
	doc,
	name,
	password,
	onClose,
	onSaved,
}: {
	doc: PDFDocumentProxy;
	name: string;
	password?: string;
	onClose: () => void;
	onSaved?: (saved: SavedFile) => void;
}) {
	const [items, setItems] = useState<Item[]>([]);
	const marks = useRef(items);
	marks.current = items;
	const [past, setPast] = useState<Item[][]>([]);
	const [future, setFuture] = useState<Item[][]>([]);
	const [tool, setTool] = useState<Tool>("pen");
	const [penColor, setPenColor] = useState(PEN_COLORS[0]);
	const [markerColor, setMarkerColor] = useState(MARKER_COLORS[0]);
	const [penWidth, setPenWidth] = useState(1.6);
	const [markerWidth, setMarkerWidth] = useState(14);
	const [live, setLive] = useState<Live | null>(null);
	const [writing, setWriting] = useState<Writing | null>(null);
	const [sizes, setSizes] = useState<Array<[number, number]>>([]);
	const [width, setWidth] = useState(0);
	const [zoom, setZoom] = useState(1);
	// Once a stylus has touched the page, a finger only scrolls.
	const [stylus, setStylus] = useState(false);
	const [leaving, setLeaving] = useState(false);
	const [saving, setSaving] = useState<"ask" | "busy" | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const editor = useRef<HTMLDivElement>(null);
	const textOf = useRef(new Map<number, Promise<TextLine[]>>());
	const lines = useRef<TextLine[]>([]);

	useEffect(() => {
		let alive = true;
		(async () => {
			const out: Array<[number, number]> = [];
			for (let n = 1; n <= doc.numPages; n++) {
				const view = (await doc.getPage(n)).getViewport({ scale: 1 });
				out.push([view.width, view.height]);
			}
			if (alive) setSizes(out);
		})().catch(() => {});
		return () => {
			alive = false;
		};
	}, [doc]);

	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const fit = () => setWidth(Math.min(900, el.clientWidth - 24));
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const readLines = (page: number) => {
		let found = textOf.current.get(page);
		if (!found) {
			found = (async () => {
				const proxy = await doc.getPage(page + 1);
				const { items: read } = await proxy.getTextContent();
				return textLines(
					read as PageTextItem[],
					proxy.getViewport({ scale: 1 }),
				);
			})().catch(() => []);
			textOf.current.set(page, found);
		}
		return found;
	};

	const dirty = items.length > 0;
	const close = useCallback(() => {
		if (dirty) setLeaving(true);
		else onClose();
	}, [dirty, onClose]);
	useBackClose("mark-up", true, close);
	useModalFocus(editor, close);

	/** Change what is on the pages, as one step of undo. */
	const change = (next: Item[]) => {
		const was = marks.current;
		setPast((list) => [...list, was]);
		setFuture([]);
		setItems(next);
	};
	const undo = () => {
		const last = past[past.length - 1];
		if (!last) return;
		setPast(past.slice(0, -1));
		setFuture([items, ...future]);
		setItems(last);
	};
	const redo = () => {
		const [next, ...rest] = future;
		if (!next) return;
		setFuture(rest);
		setPast([...past, items]);
		setItems(next);
	};

	const stepKeys = useRef({ undo, redo });
	stepKeys.current = { undo, redo };
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			if ((e.target as Element | null)?.closest("input, textarea")) return;
			const key = e.key.toLowerCase();
			if (key === "z" && !e.shiftKey) stepKeys.current.undo();
			else if (key === "y" || (key === "z" && e.shiftKey))
				stepKeys.current.redo();
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const pageWidth = Math.max(200, width) * zoom;
	const draws = tool !== "move";

	// --- the pointers on the pages ---
	const touches = useRef(new Map<number, [number, number]>());
	const stroke = useRef<Live | null>(null);
	const frame = useRef(0);
	const showLive = () => {
		if (frame.current) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = 0;
			const now = stroke.current;
			setLive(now && { ...now });
		});
	};
	useEffect(() => () => cancelAnimationFrame(frame.current), []);

	/** Where the pointer is on a page, as fractions of it. */
	const place = (e: PointerEvent, page: number): [number, number] | null => {
		const el = scroller.current?.querySelector(`[data-page="${page}"]`);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return [
			Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
			Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
		];
	};

	const eraseAt = (page: number, u: number, v: number) => {
		const [pw, ph] = sizes[page] ?? [600, 800];
		// A finger's width, whatever the zoom.
		const reach = (10 * pw) / pageWidth;
		const hit = [...items]
			.reverse()
			.find((item) => item.page === page && markHit(item, u, v, pw, ph, reach));
		if (hit) change(items.filter((item) => item.id !== hit.id));
	};

	const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!draws || (e.pointerType === "mouse" && e.button !== 0)) return;
		if (e.pointerType === "pen") setStylus(true);
		if (e.pointerType === "touch") {
			if (stylus) return;
			touches.current.set(e.pointerId, [e.clientX, e.clientY]);
			// Two fingers move the page instead: what the first began is
			// not a stroke.
			if (touches.current.size > 1) {
				stroke.current = null;
				setLive(null);
				return;
			}
		}
		const sheet = (e.target as Element).closest<HTMLElement>("[data-page]");
		if (!sheet) return;
		const page = Number(sheet.dataset.page);
		const at = place(e.nativeEvent, page);
		if (!at) return;
		e.preventDefault();
		scroller.current?.setPointerCapture(e.pointerId);
		if (tool === "note") {
			setWriting({ page, x: at[0], y: at[1], text: "" });
			return;
		}
		if (tool === "erase") {
			stroke.current = { kind: "ink", page, points: [] };
			eraseAt(page, at[0], at[1]);
			return;
		}
		if (tool === "pen" || tool === "marker") {
			stroke.current = { kind: "ink", page, points: [at] };
		} else {
			stroke.current = { kind: "text", page, from: at, to: at };
			readLines(page).then((found) => {
				if (stroke.current?.page === page) {
					lines.current = found;
					showLive();
				}
			});
			lines.current = [];
		}
		showLive();
	};

	const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const finger = touches.current.get(e.pointerId);
		if (finger && touches.current.size === 2) {
			const other = [...touches.current].find(
				([id]) => id !== e.pointerId,
			)?.[1];
			if (other) {
				const was = Math.hypot(finger[0] - other[0], finger[1] - other[1]);
				const now = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
				scroller.current?.scrollBy(
					(finger[0] - e.clientX) / 2,
					(finger[1] - e.clientY) / 2,
				);
				if (was > 0)
					setZoom((z) =>
						Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (z * now) / was)),
					);
			}
			touches.current.set(e.pointerId, [e.clientX, e.clientY]);
			return;
		}
		const now = stroke.current;
		if (!now) return;
		if (tool === "erase") {
			const at = place(e.nativeEvent, now.page);
			if (at) eraseAt(now.page, at[0], at[1]);
			return;
		}
		if (now.kind === "text") {
			const at = place(e.nativeEvent, now.page);
			if (at) now.to = at;
		} else {
			// A stylus reports far more points than the screen shows.
			const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
			for (const event of events.length ? events : [e.nativeEvent]) {
				const at = place(event, now.page);
				if (at) pushPoint(now.points, at);
			}
		}
		showLive();
	};

	const onUp = async (e: ReactPointerEvent<HTMLDivElement>) => {
		touches.current.delete(e.pointerId);
		const now = stroke.current;
		stroke.current = null;
		setLive(null);
		if (!now || tool === "erase") return;
		if (now.kind === "ink") {
			if (tool !== "pen" && tool !== "marker") return;
			change([
				...items,
				{
					id: newId(),
					kind: "ink",
					page: now.page,
					points: now.points,
					color: tool === "pen" ? penColor : markerColor,
					width: tool === "pen" ? penWidth : markerWidth,
					marker: tool === "marker" || undefined,
				},
			]);
			return;
		}
		if (tool !== "highlight" && tool !== "underline" && tool !== "strike")
			return;
		// A quick first drag can end before the page's text has been read.
		const picked = textBetween(await readLines(now.page), now.from, now.to);
		if (!picked) {
			toast(t("There's no text to mark here. Use the pen or marker instead."));
			return;
		}
		change([
			...marks.current,
			{
				id: newId(),
				kind: tool,
				page: now.page,
				color: tool === "highlight" ? markerColor : penColor,
				...picked,
			},
		]);
	};

	const onCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
		touches.current.delete(e.pointerId);
		stroke.current = null;
		setLive(null);
	};

	const keepNote = () => {
		if (!writing) return;
		const { id, page, x, y } = writing;
		const text = writing.text.trim();
		setWriting(null);
		if (!text) return;
		if (id)
			change(
				items.map((item) =>
					item.id === id && item.kind === "note" ? { ...item, text } : item,
				),
			);
		else change([...items, { id: newId(), kind: "note", page, x, y, text }]);
		// A note is one at a time; the page can be read again after it.
		if (tool === "note") setTool("move");
	};

	const save = async () => {
		setSaving("busy");
		try {
			// pdf.js holds the file's bytes (the ones read were handed to it).
			const bytes = await addMarkup(await doc.getData(), {
				password,
				marks: items,
			});
			const saved = await backend.saveFile(
				copyName(name, t("marked up")),
				bytes,
				"application/pdf",
			);
			if (!saved) {
				setSaving("ask");
				return;
			}
			setSaving(null);
			onSaved?.(saved);
			onClose();
		} catch (err) {
			setSaving("ask");
			toast(
				err instanceof ToolError && err.reason === "password"
					? t("This PDF's password is needed to save a copy")
					: t("Couldn't save a copy"),
			);
		}
	};

	const tools: Array<[Tool, string, JSX.Element]> = [
		["move", t("Move"), <Hand key="m" size={20} />],
		["pen", t("Pen"), <PenLine key="p" size={20} />],
		["marker", t("Marker"), <Highlighter key="k" size={20} />],
		["highlight", t("Highlight text"), <WholeWord key="h" size={20} />],
		["underline", t("Underline"), <Underline key="u" size={20} />],
		["strike", t("Strike out"), <Strikethrough key="s" size={20} />],
		["note", t("Note"), <StickyNote key="n" size={20} />],
		["erase", t("Eraser"), <Eraser key="e" size={20} />],
	];

	const usesPen = tool === "pen" || tool === "underline" || tool === "strike";
	const usesMarker = tool === "marker" || tool === "highlight";
	const colors = usesPen ? PEN_COLORS : usesMarker ? MARKER_COLORS : null;
	const color = usesPen ? penColor : markerColor;
	const setColor = usesPen ? setPenColor : setMarkerColor;
	const byPage = useMemo(() => {
		const out = new Map<number, Item[]>();
		for (const item of items) {
			const list = out.get(item.page);
			if (list) list.push(item);
			else out.set(item.page, [item]);
		}
		return out;
	}, [items]);
	const hint = {
		move: t("Scroll and zoom the pages. Tap a note to read or change it."),
		pen: t("Write with a finger, stylus or mouse. Two fingers scroll."),
		marker: t("Colour over anything on the page. Two fingers scroll."),
		highlight: t("Drag across the words to highlight them."),
		underline: t("Drag across the words to underline them."),
		strike: t("Drag across the words to strike them out."),
		note: t("Tap the page where the note belongs."),
		erase: t("Tap or drag over a mark to remove it."),
	}[tool];

	const previewBoxes =
		live?.kind === "text"
			? (textBetween(lines.current, live.from, live.to)?.boxes ?? [])
			: [];

	return createPortal(
		<div
			ref={editor}
			tabIndex={-1}
			className={s.fill}
			// biome-ignore lint/a11y/useSemanticElements: a full-screen surface, not a native dialog
			role="dialog"
			aria-modal="true"
			aria-label={t("Mark up")}
			data-testid="mark-up"
		>
			<header className={s.fillBar} data-tauri-drag-region="deep">
				<IconButton label={t("Close")} onClick={close} data-testid="mark-close">
					<ArrowLeft size={22} className="pw-flip" />
				</IconButton>
				<div className={s.fillTitle} title={name}>
					<strong>{t("Mark up")}</strong>
					<span dir="auto">{name}</span>
				</div>
			</header>
			<div
				className={`${s.toolbar} ${s.markTools}`}
				role="toolbar"
				aria-label={t("Mark up")}
			>
				{tools.map(([kind, label, icon]) => (
					<button
						key={kind}
						type="button"
						className={s.tool}
						title={label}
						aria-pressed={tool === kind}
						onClick={() => setTool(kind)}
						data-testid={`mark-tool-${kind}`}
					>
						{icon}
						<span>{label}</span>
					</button>
				))}
			</div>
			<div className={s.fillActions} data-testid="mark-actions">
				<div className={`${s.zoom} ${s.markZoom}`}>
					<IconButton
						label={t("Undo")}
						disabled={!past.length}
						onClick={undo}
						data-testid="mark-undo"
					>
						<Undo2 size={18} className="pw-flip" />
					</IconButton>
					<IconButton
						label={t("Redo")}
						disabled={!future.length}
						onClick={redo}
						data-testid="mark-redo"
					>
						<Redo2 size={18} className="pw-flip" />
					</IconButton>
					<IconButton
						label={t("Zoom out")}
						disabled={zoom <= MIN_ZOOM}
						onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))}
					>
						<Minus size={18} />
					</IconButton>
					<span>{Math.round(zoom * 100)}%</span>
					<IconButton
						label={t("Zoom in")}
						disabled={zoom >= MAX_ZOOM}
						onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))}
					>
						<Plus size={18} />
					</IconButton>
				</div>
				<Button
					onClick={() => setSaving("ask")}
					disabled={!dirty || saving === "busy"}
					data-testid="mark-save"
				>
					{t("Save a copy")}
				</Button>
			</div>

			<div className={s.markOptions} data-testid="mark-options">
				<p aria-live="polite" data-testid="mark-hint">
					{hint}
				</p>
				{colors && (
					<div
						className={s.swatches}
						role="radiogroup"
						aria-label={t("Colour")}
					>
						{colors.map((c, i) => (
							<button
								key={c}
								type="button"
								role="radio"
								aria-checked={color === c}
								aria-label={t("Colour {n}", { n: i + 1 })}
								className={s.swatch}
								style={{ background: c }}
								onClick={() => setColor(c)}
								data-testid="mark-color"
							/>
						))}
					</div>
				)}
				{(tool === "pen" || tool === "marker") && (
					<input
						type="range"
						className={s.markWidth}
						aria-label={t("Thickness")}
						min={tool === "pen" ? 0.6 : 6}
						max={tool === "pen" ? 6 : 28}
						step={tool === "pen" ? 0.2 : 1}
						value={tool === "pen" ? penWidth : markerWidth}
						onChange={(e) =>
							(tool === "pen" ? setPenWidth : setMarkerWidth)(
								Number(e.target.value),
							)
						}
						data-testid="mark-width"
					/>
				)}
			</div>

			<div
				ref={scroller}
				className={s.fillPages}
				data-tool={draws ? tool : undefined}
				data-draws={(draws && !stylus) || undefined}
				data-testid="mark-pages"
				onPointerDown={onDown}
				onPointerMove={onMove}
				onPointerUp={onUp}
				onPointerCancel={onCancel}
			>
				{!sizes.length && <Spinner label={t("Opening")} />}
				{sizes.map(([pw, ph], page) => (
					<FillPage
						key={page}
						doc={doc}
						page={page}
						width={pageWidth}
						height={(pageWidth * ph) / pw}
						placing={false}
						onTap={() => {}}
					>
						<Marks
							page={page}
							pw={pw}
							ph={ph}
							items={byPage.get(page)}
							canOpen={tool === "move"}
							onOpen={(note) =>
								setWriting({
									id: note.id,
									page,
									x: note.x,
									y: note.y,
									text: note.text,
								})
							}
						/>
						{live?.page === page && (
							<LiveMark
								live={live}
								pw={pw}
								ph={ph}
								color={tool === "marker" ? markerColor : penColor}
								width={tool === "marker" ? markerWidth : penWidth}
								marker={tool === "marker"}
								boxes={previewBoxes}
								boxColor={tool === "highlight" ? markerColor : penColor}
							/>
						)}
					</FillPage>
				))}
			</div>

			{writing && (
				<Dialog
					open
					title={writing.id ? t("Note") : t("Add a note")}
					onClose={() => setWriting(null)}
					testId="mark-note"
					actions={
						<>
							{writing.id && (
								<IconButton
									label={t("Delete")}
									onClick={() => {
										change(items.filter((item) => item.id !== writing.id));
										setWriting(null);
									}}
									data-testid="mark-note-delete"
								>
									<Trash2 size={18} />
								</IconButton>
							)}
							<Button variant="ghost" onClick={() => setWriting(null)}>
								{t("Cancel")}
							</Button>
							<Button
								onClick={keepNote}
								disabled={!writing.text.trim()}
								data-testid="mark-note-keep"
							>
								{t("Done")}
							</Button>
						</>
					}
				>
					<textarea
						className={s.field}
						rows={5}
						dir="auto"
						// biome-ignore lint/a11y/noAutofocus: the dialog exists to take these words
						autoFocus
						aria-label={t("Note")}
						value={writing.text}
						onChange={(e) => setWriting({ ...writing, text: e.target.value })}
						data-testid="mark-note-text"
					/>
				</Dialog>
			)}
			{saving && (
				<Dialog
					open
					title={t("Save a copy")}
					onClose={() => saving !== "busy" && setSaving(null)}
					testId="mark-save-ask"
					actions={
						<>
							<Button
								variant="ghost"
								disabled={saving === "busy"}
								onClick={() => setSaving(null)}
							>
								{t("Cancel")}
							</Button>
							<Button
								onClick={save}
								disabled={saving === "busy"}
								data-testid="mark-save-go"
							>
								{saving === "busy" ? t("Saving…") : t("Save")}
							</Button>
						</>
					}
				>
					<p className={s.hint}>
						{t("A new PDF is made; the file you opened stays as it was.")}
					</p>
				</Dialog>
			)}
			{leaving && (
				<Dialog
					open
					title={t("Leave without saving?")}
					onClose={() => setLeaving(false)}
					alert
					testId="mark-leave"
					actions={
						<>
							<Button variant="ghost" onClick={() => setLeaving(false)}>
								{t("Keep editing")}
							</Button>
							<Button
								variant="danger"
								onClick={onClose}
								data-testid="mark-discard"
							>
								{t("Discard")}
							</Button>
						</>
					}
				>
					{t("What you added is lost unless you save a copy.")}
				</Dialog>
			)}
		</div>,
		document.body,
	);
}

type NoteItem = Extract<Item, { kind: "note" }>;

/** The marks of a page. Felt ink and highlights sit in a layer of their
 * own, blended with the page, so the words stay dark under them. */
const Marks = memo(function Marks({
	page,
	pw,
	ph,
	items = [],
	canOpen,
	onOpen,
}: {
	page: number;
	pw: number;
	ph: number;
	items?: Item[];
	canOpen: boolean;
	onOpen: (note: NoteItem) => void;
}) {
	const under = items.filter(
		(i) => i.kind === "highlight" || (i.kind === "ink" && i.marker),
	);
	const over = items.filter((i) => !under.includes(i));
	const view = `0 0 ${pw} ${ph}`;
	return (
		<>
			<svg className={s.markUnder} viewBox={view} aria-hidden="true">
				{under.map((item) => (
					<MarkShape key={item.id} item={item} pw={pw} ph={ph} />
				))}
			</svg>
			<svg
				className={s.markOver}
				viewBox={view}
				data-page-marks={page}
				data-testid="mark-layer"
			>
				<title>{t("Page {n}", { n: page + 1 })}</title>
				{over.map((item) =>
					item.kind === "note" ? (
						<g
							key={item.id}
							// biome-ignore lint/a11y/useSemanticElements: a mark inside a drawing, which a button cannot be
							role="button"
							tabIndex={canOpen ? 0 : -1}
							aria-label={item.text}
							className={canOpen ? s.markNote : undefined}
							data-testid="mark-note-pin"
							onClick={() => canOpen && onOpen(item)}
							onKeyDown={(e) => e.key === "Enter" && canOpen && onOpen(item)}
						>
							<rect
								x={item.x * pw - NOTE_SIZE / 2}
								y={item.y * ph - NOTE_SIZE / 2}
								width={NOTE_SIZE}
								height={NOTE_SIZE}
								rx={2}
								fill="#ffd93b"
								stroke="#735c0d"
							/>
							{[6, 10, 14].map((at) => (
								<line
									key={at}
									x1={item.x * pw - 6}
									x2={item.x * pw + 6}
									y1={item.y * ph - NOTE_SIZE / 2 + at}
									y2={item.y * ph - NOTE_SIZE / 2 + at}
									stroke="#735c0d"
								/>
							))}
						</g>
					) : (
						<MarkShape key={item.id} item={item} pw={pw} ph={ph} />
					),
				)}
			</svg>
		</>
	);
});

function MarkShape({
	item,
	pw,
	ph,
}: {
	item: Item;
	pw: number;
	ph: number;
}) {
	if (item.kind === "ink")
		return (
			<path
				d={curve(item.points, pw, ph)}
				className={s.markInk}
				stroke={item.color}
				strokeWidth={item.width}
			/>
		);
	if (item.kind === "note") return null;
	return (
		<TextMark
			kind={item.kind}
			boxes={item.boxes}
			color={item.color}
			pw={pw}
			ph={ph}
		/>
	);
}

function TextMark({
	kind,
	boxes,
	color,
	pw,
	ph,
}: {
	kind: "highlight" | "underline" | "strike";
	boxes: Array<{ x: number; y: number; w: number; h: number }>;
	color: string;
	pw: number;
	ph: number;
}) {
	return (
		<>
			{boxes.map((b) => {
				const key = `${b.x}-${b.y}`;
				if (kind === "highlight")
					return (
						<rect
							key={key}
							x={b.x * pw}
							y={b.y * ph}
							width={b.w * pw}
							height={b.h * ph}
							fill={color}
						/>
					);
				const y = (b.y + b.h * (kind === "underline" ? 0.92 : 0.55)) * ph;
				return (
					<line
						key={key}
						x1={b.x * pw}
						x2={(b.x + b.w) * pw}
						y1={y}
						y2={y}
						stroke={color}
						strokeWidth={Math.max(0.6, b.h * ph * 0.07)}
					/>
				);
			})}
		</>
	);
}

/** What is being drawn, over the page's other marks. */
function LiveMark({
	live,
	pw,
	ph,
	color,
	width,
	marker,
	boxes,
	boxColor,
}: {
	live: Live;
	pw: number;
	ph: number;
	color: string;
	width: number;
	marker: boolean;
	boxes: Array<{ x: number; y: number; w: number; h: number }>;
	boxColor: string;
}) {
	const blended = marker || live.kind === "text";
	return (
		<svg
			className={blended ? s.markUnder : s.markOver}
			viewBox={`0 0 ${pw} ${ph}`}
			aria-hidden="true"
		>
			{live.kind === "ink" ? (
				<path
					d={curve(live.points, pw, ph)}
					className={s.markInk}
					stroke={color}
					strokeWidth={width}
				/>
			) : (
				<TextMark
					kind="highlight"
					boxes={boxes}
					color={boxColor}
					pw={pw}
					ph={ph}
				/>
			)}
		</svg>
	);
}
