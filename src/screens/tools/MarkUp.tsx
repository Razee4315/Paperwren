import { type SavedFile, backend } from "@/lib/backend";
import { startsRtl } from "@/lib/bidi";
import {
	type DocMark,
	MARKER_COLORS,
	PEN_COLORS,
	newMarkId,
} from "@/lib/docMarks";
import { copyName } from "@/lib/fileName";
import { msg, t } from "@/lib/i18n";
import { UNITS, lengthOf, measureLabel, scaleFrom } from "@/lib/measure";
import {
	type PageTextItem,
	type TextLine,
	textBetween,
	textLines,
} from "@/lib/pageText";
import { NOTE_SIZE, type TextPicture, addMarkup } from "@/lib/pdfMarkup";
import { ToolError } from "@/lib/pdfTools";
import {
	LINE_HEIGHT,
	layoutText,
	textFont,
	textHeight,
	textPicture,
} from "@/lib/textBox";
import { whole } from "@/screens/viewer/pdfCrop";
import type { MarkStore } from "@/screens/viewer/useDocMarks";
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
	Ruler,
	StickyNote,
	Strikethrough,
	Trash2,
	Type,
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

export type MarkTool =
	| "move"
	| "pen"
	| "marker"
	| "highlight"
	| "underline"
	| "strike"
	| "note"
	| "text"
	| "measure"
	| "erase";
type Item = DocMark;
/** What is being drawn or dragged, not yet part of the page. */
type Live =
	| { kind: "ink"; page: number; points: Array<[number, number]> }
	| {
			kind: "text" | "line";
			page: number;
			from: [number, number];
			to: [number, number];
	  };
/** A note or a text box being written: a new one has no id yet. */
type Writing = {
	id?: string;
	kind: "note" | "text";
	page: number;
	x: number;
	y: number;
	text: string;
};

export const SIGNED_WARNING = msg(
	"This PDF has a digital signature. A changed copy won't keep it valid.",
);
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** Shorter than this on screen, a measuring line is a slip. */
const MIN_LINE = 8;
/** A new text box: how wide as a share of its page, and how large. */
const TEXT_WIDTH = 0.4;
const TEXT_SIZES = [10, 14, 20, 28];

/**
 * Write on a PDF: a pen and a felt marker that go anywhere, highlight,
 * underline and strike-out that follow the words, notes and text
 * boxes. What is made here is the same set of marks the reader shows
 * and keeps: there is nothing to save to go on reading. A saved copy has
 * them as the PDF's own annotations, for other apps; the file that was
 * opened stays as it was.
 */
export function MarkUp({
	doc,
	name,
	password,
	store,
	start = "pen",
	signed = false,
	onClose,
	onSaved,
}: {
	doc: PDFDocumentProxy;
	name: string;
	password?: string;
	/** The document's marks. */
	store: MarkStore;
	/** The tool in hand to begin with. */
	start?: MarkTool;
	/** The file has a digital signature, which a copy will not keep. */
	signed?: boolean;
	onClose: () => void;
	onSaved?: (saved: SavedFile) => void;
}) {
	const items = store.list;
	const marks = useRef(items);
	marks.current = items;
	const [tool, setTool] = useState<MarkTool>(start);
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
	const [textSize, setTextSize] = useState(TEXT_SIZES[1]);
	// Measuring: a line or an area, the corners of an area so far, and a
	// line drawn to set the scale by.
	const [measuring, setMeasuring] = useState<"line" | "area">("line");
	const [settingScale, setSettingScale] = useState(false);
	const [corners, setCorners] = useState<{
		page: number;
		points: Array<[number, number]>;
	} | null>(null);
	const [askScale, setAskScale] = useState<{
		page: number;
		points: Array<[number, number]>;
	} | null>(null);
	const [scaleText, setScaleText] = useState("");
	const [scaleUnit, setScaleUnit] = useState("m");
	const scroller = useRef<HTMLDivElement>(null);
	const editor = useRef<HTMLDivElement>(null);
	const textOf = useRef(new Map<number, Promise<TextLine[]>>());
	const lines = useRef<TextLine[]>([]);

	useEffect(() => {
		let alive = true;
		(async () => {
			const out: Array<[number, number]> = [];
			for (let n = 1; n <= doc.numPages; n++) {
				const page = await doc.getPage(n);
				// The whole page, whatever the reader has cropped on screen.
				const view = whole(page, () => page.getViewport({ scale: 1 }));
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
					whole(proxy, () => proxy.getViewport({ scale: 1 })),
				);
			})().catch(() => []);
			textOf.current.set(page, found);
		}
		return found;
	};

	// Only a file with a password loses what is not saved as a copy.
	const atRisk = !store.persist && items.length > 0;
	const close = useCallback(() => {
		if (atRisk) setLeaving(true);
		else onClose();
	}, [atRisk, onClose]);
	useBackClose("mark-up", true, close);
	useModalFocus(editor, close);

	/** Change what is on the pages, as one step of undo. */
	const change = store.set;
	const stepKeys = useRef(store);
	stepKeys.current = store;
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
		if (tool === "note" || tool === "text") {
			setWriting({ kind: tool, page, x: at[0], y: at[1], text: "" });
			return;
		}
		if (tool === "erase") {
			stroke.current = { kind: "ink", page, points: [] };
			eraseAt(page, at[0], at[1]);
			return;
		}
		if (tool === "pen" || tool === "marker") {
			stroke.current = { kind: "ink", page, points: [at] };
		} else if (tool === "measure" && measuring === "area" && !settingScale) {
			// Corners are tapped one at a time, all on one page.
			setCorners((was) =>
				was?.page === page
					? { page, points: [...was.points, at] }
					: { page, points: [at] },
			);
			return;
		} else if (tool === "measure") {
			stroke.current = { kind: "line", page, from: at, to: at };
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
		if (now.kind === "text" || now.kind === "line") {
			const at = place(e.nativeEvent, now.page);
			if (at) now.to = at;
		} else if (now.kind === "ink") {
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
		if (now.kind === "line") {
			const [pw, ph] = sizes[now.page] ?? [600, 800];
			const line = [now.from, now.to];
			// A slip of the finger is not a line.
			if (lengthOf(line, pw, ph) * (pageWidth / pw) < MIN_LINE) return;
			if (settingScale) {
				setScaleText("");
				setAskScale({ page: now.page, points: line });
				return;
			}
			change([
				...items,
				{
					id: newMarkId(),
					createdAt: Date.now(),
					kind: "measure",
					page: now.page,
					points: line,
					color: penColor,
				},
			]);
			return;
		}
		if (now.kind === "ink") {
			if (tool !== "pen" && tool !== "marker") return;
			change([
				...items,
				{
					id: newMarkId(),
					createdAt: Date.now(),
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
				id: newMarkId(),
				createdAt: Date.now(),
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
		const { id, kind, page, x, y } = writing;
		const text = writing.text.trim();
		setWriting(null);
		if (!text) return;
		const was = items.find((item) => item.id === id);
		const base = {
			id: id ?? newMarkId(),
			createdAt: was?.createdAt ?? Date.now(),
			page,
			x,
			y,
			text,
		};
		let made: Item = { ...base, kind: "note" };
		if (kind === "text") {
			const [pw, ph] = sizes[page] ?? [600, 800];
			const box = was?.kind === "text" ? was : null;
			const w = box?.w ?? Math.min(TEXT_WIDTH, 1 - x);
			const size = box?.size ?? textSize;
			made = {
				...base,
				kind: "text",
				w,
				h: textHeight(layoutText(text, size, w * pw), size) / ph,
				size,
				color: box?.color ?? penColor,
			};
		}
		change(
			id
				? items.map((item) => (item.id === id ? made : item))
				: [...items, made],
		);
		// One at a time; the page can be read again after it.
		if (tool === "note" || tool === "text") setTool("move");
	};

	const finishArea = () => {
		if (!corners || corners.points.length < 3) return;
		change([
			...items,
			{
				id: newMarkId(),
				createdAt: Date.now(),
				kind: "measure",
				page: corners.page,
				points: corners.points,
				closed: true,
				color: penColor,
			},
		]);
		setCorners(null);
	};

	const keepScale = () => {
		if (!askScale) return;
		const [pw, ph] = sizes[askScale.page] ?? [600, 800];
		const scale = scaleFrom(
			askScale.points,
			pw,
			ph,
			Number(scaleText.replace(",", ".")),
			scaleUnit,
		);
		if (!scale) {
			toast(t("Enter a length above zero."));
			return;
		}
		store.setScales({ ...store.scales, [askScale.page]: scale });
		setAskScale(null);
		setSettingScale(false);
	};

	const labelFor = (item: Item) => {
		if (item.kind !== "measure") return undefined;
		const [pw, ph] = sizes[item.page] ?? [600, 800];
		return measureLabel(item, pw, ph, store.scales[item.page]);
	};

	const save = async () => {
		setSaving("busy");
		try {
			const pictures: Array<TextPicture | undefined> = [];
			for (const item of items) {
				if (item.kind !== "text") continue;
				const [pw, ph] = sizes[item.page] ?? [600, 800];
				pictures.push(await textPicture(item, pw, ph));
			}
			// pdf.js holds the file's bytes (the ones read were handed to it).
			const bytes = await addMarkup(await doc.getData(), {
				password,
				marks: items,
				pictures,
				labels: items.filter((i) => i.kind === "measure").map(labelFor),
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

	const tools: Array<[MarkTool, string, JSX.Element]> = [
		["move", t("Move"), <Hand key="m" size={20} />],
		["pen", t("Pen"), <PenLine key="p" size={20} />],
		["marker", t("Marker"), <Highlighter key="k" size={20} />],
		["highlight", t("Highlight text"), <WholeWord key="h" size={20} />],
		["underline", t("Underline"), <Underline key="u" size={20} />],
		["strike", t("Strike out"), <Strikethrough key="s" size={20} />],
		["note", t("Note"), <StickyNote key="n" size={20} />],
		["text", t("Text"), <Type key="t" size={20} />],
		["measure", t("Measure"), <Ruler key="r" size={20} />],
		["erase", t("Eraser"), <Eraser key="e" size={20} />],
	];

	const usesPen =
		tool === "pen" ||
		tool === "underline" ||
		tool === "strike" ||
		tool === "text" ||
		tool === "measure";
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
		move: t(
			"Scroll and zoom the pages. Tap a note or a text box to change it.",
		),
		pen: t("Write with a finger, stylus or mouse. Two fingers scroll."),
		marker: t("Colour over anything on the page. Two fingers scroll."),
		highlight: t("Drag across the words to highlight them."),
		underline: t("Drag across the words to underline them."),
		strike: t("Drag across the words to strike them out."),
		note: t("Tap the page where the note belongs."),
		text: t("Tap the page where the text goes."),
		measure: settingScale
			? t("Drag along something whose real length you know.")
			: measuring === "area"
				? t("Tap each corner, then choose Finish shape.")
				: t("Drag from one end to the other to measure it."),
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
			className={`${s.fill} ${s.markFill}`}
			data-can-mark=""
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
						disabled={!store.canUndo}
						onClick={store.undo}
						data-testid="mark-undo"
					>
						<Undo2 size={18} className="pw-flip" />
					</IconButton>
					<IconButton
						label={t("Redo")}
						disabled={!store.canRedo}
						onClick={store.redo}
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
					variant="secondary"
					onClick={() => setSaving("ask")}
					disabled={!items.length || saving === "busy"}
					data-testid="mark-save"
				>
					{t("Save a copy")}
				</Button>
				<Button onClick={close} data-testid="mark-done">
					{t("Done")}
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
				{tool === "measure" && (
					<div className={s.measureRow}>
						<div className={s.segment}>
							<button
								type="button"
								aria-pressed={measuring === "line"}
								onClick={() => {
									setMeasuring("line");
									setCorners(null);
								}}
								data-testid="measure-line"
							>
								{t("Length")}
							</button>
							<button
								type="button"
								aria-pressed={measuring === "area"}
								onClick={() => {
									setMeasuring("area");
									setSettingScale(false);
								}}
								data-testid="measure-area"
							>
								{t("Area")}
							</button>
						</div>
						{corners && (
							<Button
								variant="secondary"
								disabled={corners.points.length < 3}
								onClick={finishArea}
								data-testid="measure-finish"
							>
								{t("Finish shape")}
							</Button>
						)}
						<Button
							variant="ghost"
							onClick={() => {
								setSettingScale((on) => !on);
								setCorners(null);
							}}
							data-testid="measure-scale"
						>
							{settingScale ? t("Cancel") : t("Set the scale")}
						</Button>
					</div>
				)}
				{tool === "text" && (
					<div className={s.segment}>
						{TEXT_SIZES.map((size, i) => (
							<button
								key={size}
								type="button"
								aria-pressed={textSize === size}
								aria-label={t("Size {n}", { n: i + 1 })}
								onClick={() => setTextSize(size)}
								data-testid="mark-text-size"
								style={{ fontSize: 11 + i * 3 }}
							>
								A
							</button>
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
							labelOf={labelFor}
							onOpen={(note) =>
								setWriting({
									id: note.id,
									kind: note.kind,
									page,
									x: note.x,
									y: note.y,
									text: note.text,
								})
							}
						/>
						{corners?.page === page && (
							<svg
								className={s.markOver}
								viewBox={`0 0 ${pw} ${ph}`}
								aria-hidden="true"
							>
								<polyline
									points={corners.points
										.map(([u, v]) => `${u * pw},${v * ph}`)
										.join(" ")}
									fill="none"
									stroke={penColor}
									strokeWidth={1.2}
								/>
								{corners.points.map(([u, v]) => (
									<circle
										key={`${u}-${v}`}
										cx={u * pw}
										cy={v * ph}
										r={3}
										fill={penColor}
									/>
								))}
							</svg>
						)}
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
					title={
						writing.kind === "text"
							? t("Text")
							: writing.id
								? t("Note")
								: t("Add a note")
					}
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
						aria-label={writing.kind === "text" ? t("Text") : t("Note")}
						value={writing.text}
						onChange={(e) => setWriting({ ...writing, text: e.target.value })}
						data-testid="mark-note-text"
					/>
				</Dialog>
			)}
			{askScale && (
				<Dialog
					open
					title={t("How long is that line?")}
					onClose={() => setAskScale(null)}
					testId="measure-ask"
					actions={
						<>
							<Button variant="ghost" onClick={() => setAskScale(null)}>
								{t("Cancel")}
							</Button>
							<Button onClick={keepScale} data-testid="measure-keep">
								{t("Done")}
							</Button>
						</>
					}
				>
					<div className={s.scaleFields}>
						<input
							className={s.field}
							inputMode="decimal"
							// biome-ignore lint/a11y/noAutofocus: the dialog exists to take this number
							autoFocus
							aria-label={t("Length")}
							value={scaleText}
							onChange={(e) => setScaleText(e.target.value)}
							data-testid="measure-length"
						/>
						<select
							className={s.field}
							aria-label={t("Unit")}
							value={scaleUnit}
							onChange={(e) => setScaleUnit(e.target.value)}
							data-testid="measure-unit"
						>
							{UNITS.map((unit) => (
								<option key={unit} value={unit}>
									{unit}
								</option>
							))}
						</select>
					</div>
					<p className={s.hint}>
						{t("Everything measured on this page will use this scale.")}
					</p>
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
					{signed && <p className={s.hint}>{t(SIGNED_WARNING)}</p>}
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

type NoteItem = Extract<Item, { kind: "note" | "text" }>;

/** The marks of a page. Felt ink and highlights sit in a layer of their
 * own, blended with the page, so the words stay dark under them. */
const Marks = memo(function Marks({
	page,
	pw,
	ph,
	items = [],
	canOpen,
	labelOf,
	onOpen,
}: {
	page: number;
	pw: number;
	ph: number;
	items?: Item[];
	canOpen: boolean;
	labelOf: (item: Item) => string | undefined;
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
					item.kind === "text" ? (
						<g
							key={item.id}
							// biome-ignore lint/a11y/useSemanticElements: a mark inside a drawing, which a button cannot be
							role="button"
							tabIndex={canOpen ? 0 : -1}
							aria-label={item.text}
							className={canOpen ? s.markNote : undefined}
							data-testid="mark-text"
							onClick={() => canOpen && onOpen(item)}
							onKeyDown={(e) => e.key === "Enter" && canOpen && onOpen(item)}
						>
							<rect
								x={item.x * pw}
								y={item.y * ph}
								width={item.w * pw}
								height={item.h * ph}
								fill="transparent"
							/>
							{layoutText(item.text, item.size, item.w * pw).map((line, i) => (
								<text
									key={`${i}-${line}`}
									x={(item.x + (startsRtl(line) ? item.w : 0)) * pw}
									y={item.y * ph + (i + 0.8) * item.size * LINE_HEIGHT}
									fill={item.color}
									direction={startsRtl(line) ? "rtl" : "ltr"}
									style={{ font: textFont(item.size) }}
								>
									{line}
								</text>
							))}
						</g>
					) : item.kind === "note" ? (
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
						<MarkShape
							key={item.id}
							item={item}
							pw={pw}
							ph={ph}
							label={labelOf(item)}
						/>
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
	label,
}: {
	item: Item;
	pw: number;
	ph: number;
	label?: string;
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
	if (item.kind === "note" || item.kind === "text") return null;
	if (item.kind === "measure") {
		const spots = item.points.map(([u, v]) => [u * pw, v * ph]);
		const middle = spots.reduce(
			(sum, [x, y]) => [sum[0] + x / spots.length, sum[1] + y / spots.length],
			[0, 0],
		);
		const Shape = item.closed ? "polygon" : "polyline";
		return (
			<>
				<Shape
					points={spots.map(([x, y]) => `${x},${y}`).join(" ")}
					fill={item.closed ? `${item.color}22` : "none"}
					stroke={item.color}
					strokeWidth={1.2}
				/>
				{spots.map(([x, y]) => (
					<circle key={`${x}-${y}`} cx={x} cy={y} r={2.4} fill={item.color} />
				))}
				{label && (
					<text
						x={middle[0]}
						y={middle[1] - 5}
						textAnchor="middle"
						fill={item.color}
						stroke="#fff"
						strokeWidth={3}
						paintOrder="stroke"
						style={{ font: `600 ${textFont(11)}` }}
						data-testid="measure-label"
					>
						{label}
					</text>
				)}
			</>
		);
	}
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
	if (live.kind === "line")
		return (
			<svg
				className={s.markOver}
				viewBox={`0 0 ${pw} ${ph}`}
				aria-hidden="true"
			>
				<line
					x1={live.from[0] * pw}
					y1={live.from[1] * ph}
					x2={live.to[0] * pw}
					y2={live.to[1] * ph}
					stroke={color}
					strokeWidth={1.2}
				/>
			</svg>
		);
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
