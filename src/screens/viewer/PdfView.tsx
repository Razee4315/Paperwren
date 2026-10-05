import { isDesktop } from "@/lib/env";
import { locale, t, tn } from "@/lib/i18n";
import { PrintCancelled } from "@/lib/print";
import { isDarkTheme } from "@/lib/settings";
import type { Position } from "@/lib/types";
import { useSettings } from "@/state/settings";
import {
	Button,
	Dialog,
	ErrorArt,
	IconButton,
	Sheet,
	SheetItem,
	Spinner,
	StateView,
	toast,
} from "@/ui";
import {
	BookOpen,
	LayoutGrid,
	ListTree,
	Maximize,
	RotateCcw,
	RotateCw,
	Search,
	StretchHorizontal,
} from "lucide-react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type {
	EventBus,
	PDFFindController,
	PDFLinkService,
	PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageJump, PasswordDialog } from "./Dialogs";
import { PdfThumbs } from "./PdfThumbs";
import s from "./PdfView.module.css";
import { Scrubber } from "./Scrubber";
import {
	FindBar,
	type FindState,
	Shell,
	type SideTab,
	ZoomControl,
	type ZoomPreset,
	percentPresets,
	shellStyles,
} from "./Shell";
import { useZoom } from "./hooks";
import type { ViewerProps } from "./types";

/**
 * PDF on pdf.js's own viewer component (the engine behind Firefox's
 * reader): virtualised page rendering, text selection, links and find
 * with highlighting all come from pdf.js. This file adds the chrome,
 * the shared zoom gestures and position memory.
 */

async function loadEngine() {
	const pdfjs = await import("pdfjs-dist");
	pdfjs.GlobalWorkerOptions.workerSrc = new URL(
		"pdfjs-dist/build/pdf.worker.min.mjs",
		import.meta.url,
	).toString();
	// pdf_viewer.mjs reads the core library from this global.
	(globalThis as { pdfjsLib?: unknown }).pdfjsLib = pdfjs;
	const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs");
	return { pdfjs, viewer };
}

interface Outline {
	title: string;
	dest: unknown;
	items: Outline[];
}

/** Where pdf.js finds its character maps and standard fonts: beside
 * the app (see vite.config.ts), never on the network. */
const pdfAsset = (dir: string) =>
	new URL(`pdfjs/${dir}/`, document.baseURI).toString();

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
/** pdf.js's AnnotationMode.ENABLE: links and notes work, and a form's
 * fields are drawn as the file saved them. Its default makes them live
 * fields, and what a reader typed there would be neither saved nor
 * printed: Paperwren shows documents, it does not fill them in. */
const ANNOTATIONS_SHOWN = 1;
/** pdf.js's SpreadMode: one page across, or two with odd pages first. */
const SPREAD_NONE = 0;
const SPREAD_ODD = 1;
/** The largest bitmap a page is drawn into before pdf.js stretches a
 * smaller one. A desktop has the memory for sharp pages at high zoom;
 * a phone is held to half of that. */
const MAX_CANVAS = isDesktop ? 2 ** 25 : 2 ** 24;
const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200, 400];
/** A file longer than this asks which pages to print before any are
 * drawn; a short one just prints. */
const ASK_PAGES_OVER = 10;

/** Which pages a print job takes. */
type PrintChoice = { from: number; to: number };

/** A PDF's own date ("D:20240131120000+05'00'") in the reader's words. */
function pdfDate(raw: unknown): string | null {
	const m =
		typeof raw === "string"
			? /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(raw)
			: null;
	if (!m) return null;
	const date = new Date(
		Number(m[1]),
		Number(m[2] ?? 1) - 1,
		Number(m[3] ?? 1),
		Number(m[4] ?? 0),
		Number(m[5] ?? 0),
	);
	if (Number.isNaN(date.getTime())) return null;
	return date.toLocaleString(locale(), {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

export default function PdfView({
	data,
	name,
	format,
	position,
	onPosition,
	onClose,
	active,
}: ViewerProps) {
	const { settings, theme } = useSettings();
	const container = useRef<HTMLDivElement>(null);
	const viewerEl = useRef<HTMLDivElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const pdfViewer = useRef<PDFViewer | null>(null);
	const bus = useRef<EventBus | null>(null);
	const links = useRef<PDFLinkService | null>(null);

	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
	const [status, setStatus] = useState<
		"loading" | "ready" | "password" | "error"
	>("loading");
	const [passwordWrong, setPasswordWrong] = useState(false);
	const [page, setPage] = useState(1);
	const [pageLabel, setPageLabel] = useState<string | null>(null);
	const [pages, setPages] = useState(0);
	const [scaleLabel, setScaleLabel] = useState("");
	const [scale, setScale] = useState(1);
	const [preset, setPresetName] = useState("");
	const [rotation, setRotation] = useState(0);
	const [spread, setSpread] = useState(
		() =>
			position?.kind === "pdf" &&
			settings.rememberPosition &&
			position.spread === true,
	);
	const [chromeHidden, setChromeHidden] = useState(false);
	const [outline, setOutline] = useState<Outline[] | null>(null);
	const [outlineOpen, setOutlineOpen] = useState(false);
	const [thumbsOpen, setThumbsOpen] = useState(false);
	const [details, setDetails] = useState<Array<[string, string]>>([]);
	const [findOpen, setFindOpen] = useState(false);
	const [find, setFind] = useState<FindState>({
		query: "",
		total: 0,
		current: -1,
	});
	const [matchCase, setMatchCase] = useState(false);
	const [wholeWords, setWholeWords] = useState(false);

	const positionRef = useRef(position);
	const onPositionRef = useRef(onPosition);
	onPositionRef.current = onPosition;
	const rememberRef = useRef(settings.rememberPosition);
	rememberRef.current = settings.rememberPosition;
	const defaultZoom = useRef(settings.pdfZoom);
	const fitWidthRef = useRef<() => number>(() => 1);
	const spreadRef = useRef(spread);
	spreadRef.current = spread;

	// --- open the document ---
	// pdf.js takes the bytes over: they move to its worker rather than
	// being copied, so a large file is held once, not twice. A locked
	// file asks for its password through the same load, so trying a
	// password never reads the file again.
	const unlock = useRef<((password: string) => void) | null>(null);
	useEffect(() => {
		let alive = true;
		let task: PDFDocumentLoadingTask | null = null;
		setStatus("loading");
		loadEngine()
			.then(({ pdfjs }) => {
				// In development React runs this effect twice; the first run is
				// cancelled before it gets here, so the bytes are given away once.
				if (!alive) return;
				if (data.byteLength === 0) {
					setStatus("error");
					return;
				}
				task = pdfjs.getDocument({
					data: new Uint8Array(data),
					isEvalSupported: false,
					cMapUrl: pdfAsset("cmaps"),
					cMapPacked: true,
					standardFontDataUrl: pdfAsset("standard_fonts"),
				});
				task.onPassword = (
					update: (password: string) => void,
					reason: number,
				) => {
					if (!alive) return;
					unlock.current = update;
					setPasswordWrong(
						reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD,
					);
					setStatus("password");
				};
				return task.promise.then((pdf) => {
					if (!alive) return;
					setDoc(pdf);
					setPages(pdf.numPages);
					setStatus("ready");
					pdf
						.getOutline()
						.then((o) => setOutline((o as unknown as Outline[]) ?? []))
						.catch(() => setOutline([]));
					// What the file says about itself, for Details.
					pdf
						.getMetadata()
						.then(({ info }) => {
							if (!alive) return;
							const meta = info as Record<string, unknown>;
							const text = (key: string) =>
								typeof meta[key] === "string" && (meta[key] as string).trim()
									? (meta[key] as string).trim()
									: null;
							const rows: Array<[string, string | null]> = [
								[t("Pages"), String(pdf.numPages)],
								[t("Title"), text("Title")],
								[t("Author"), text("Author")],
								[t("Created"), pdfDate(meta.CreationDate)],
								[t("Made with"), text("Creator") ?? text("Producer")],
							];
							setDetails(
								rows.filter((row): row is [string, string] => !!row[1]),
							);
						})
						.catch(() => {});
				});
			})
			.catch(() => {
				if (alive) setStatus("error");
			});
		return () => {
			alive = false;
			// Ends the load and frees the document, whichever it reached.
			task?.destroy();
		};
	}, [data]);

	// --- mount pdf.js's viewer once the document is ready ---
	useEffect(() => {
		if (!doc || !container.current || !viewerEl.current) return;
		let cancelled = false;
		let cleanup = () => {};
		loadEngine().then(({ viewer }) => {
			if (cancelled || !container.current || !viewerEl.current) return;
			const eventBus = new viewer.EventBus();
			const linkService = new viewer.PDFLinkService({
				eventBus,
				externalLinkTarget: viewer.LinkTarget.BLANK,
				externalLinkRel: "noopener noreferrer nofollow",
			});
			const findController: PDFFindController = new viewer.PDFFindController({
				eventBus,
				linkService,
			});
			const v = new viewer.PDFViewer({
				container: container.current,
				viewer: viewerEl.current,
				eventBus,
				linkService,
				findController,
				// Pages run edge to edge: fit width means the width of the
				// screen, with nothing spent on side margins.
				removePageBorders: true,
				maxCanvasPixels: MAX_CANVAS,
				annotationMode: ANNOTATIONS_SHOWN,
			});
			linkService.setViewer(v);
			pdfViewer.current = v;
			bus.current = eventBus;
			links.current = linkService;

			eventBus.on("pagesinit", () => {
				const saved = positionRef.current;
				if (spreadRef.current) v.spreadMode = SPREAD_ODD;
				if (saved?.kind === "pdf" && rememberRef.current) {
					v.pagesRotation = saved.rotation;
					const numeric = /^[\d.]+$/.test(saved.scale);
					v.currentScaleValue = numeric
						? String(Number(saved.scale) / 100)
						: saved.scale;
					v.scrollPageIntoView({
						pageNumber: Math.min(saved.page, doc.numPages),
						destArray: [null, { name: "XYZ" }, saved.left, saved.top, null],
						allowNegativeOffset: true,
					});
				} else {
					v.currentScaleValue = defaultZoom.current;
				}
				setRotation(v.pagesRotation);
			});
			eventBus.on(
				"pagechanging",
				(e: { pageNumber: number; pageLabel?: string | null }) => {
					setPage(e.pageNumber);
					setPageLabel(e.pageLabel ?? null);
				},
			);
			eventBus.on("rotationchanging", (e: { pagesRotation: number }) =>
				setRotation(e.pagesRotation),
			);
			eventBus.on(
				"scalechanging",
				(e: { scale: number; presetValue?: string }) => {
					// "Automatic" is fit width until that passes 125%.
					const fitsWidth =
						e.presetValue === "page-width" ||
						(e.presetValue === "auto" &&
							Math.abs(e.scale - fitWidthRef.current()) < 0.01);
					setScale(e.scale);
					setPresetName(fitsWidth ? "page-width" : (e.presetValue ?? ""));
					setScaleLabel(
						fitsWidth
							? t("Fit width")
							: e.presetValue === "page-fit"
								? t("Whole page")
								: `${Math.round(e.scale * 100)}%`,
					);
				},
			);
			let saveTimer = 0;
			eventBus.on(
				"updateviewarea",
				(e: {
					location?: {
						pageNumber: number;
						scale: number | string;
						top: number;
						left: number;
						rotation: number;
					};
				}) => {
					const loc = e.location;
					if (!loc || !rememberRef.current) return;
					window.clearTimeout(saveTimer);
					saveTimer = window.setTimeout(() => {
						const pos: Position = {
							kind: "pdf",
							page: loc.pageNumber,
							scale: String(loc.scale),
							top: loc.top,
							left: loc.left,
							rotation: loc.rotation,
							...(spreadRef.current ? { spread: true } : {}),
						};
						positionRef.current = pos;
						onPositionRef.current(pos);
					}, 400);
				},
			);
			eventBus.on(
				"updatefindmatchescount",
				(e: { matchesCount: { current: number; total: number } }) =>
					setFind((f) => ({
						...f,
						total: e.matchesCount.total,
						current: e.matchesCount.current - 1,
						busy: false,
					})),
			);
			eventBus.on(
				"updatefindcontrolstate",
				(e: {
					state: number;
					matchesCount: { current: number; total: number };
				}) =>
					setFind((f) => ({
						...f,
						busy: e.state === 3, // FindState.PENDING
						total: e.matchesCount?.total ?? f.total,
						current: (e.matchesCount?.current ?? f.current + 1) - 1,
					})),
			);

			v.setDocument(doc);
			linkService.setDocument(doc);
			// A document that numbers its own pages ("iv", "A-3") is read by
			// those numbers.
			doc
				.getPageLabels()
				.then((labels) => {
					if (cancelled || !labels) return;
					v.setPageLabels(labels);
					setPageLabel(v.currentPageLabel);
				})
				.catch(() => {});
			cleanup = () => {
				window.clearTimeout(saveTimer);
				v.cleanup();
			};
		});
		return () => {
			cancelled = true;
			cleanup();
			pdfViewer.current = null;
		};
	}, [doc]);

	// --- zoom: the shared engine drives pdf.js's scale ---
	const setPreset = (value: "page-width" | "page-fit") => {
		if (pdfViewer.current) pdfViewer.current.currentScaleValue = value;
	};
	const commit = useCallback((z: number) => {
		const v = pdfViewer.current;
		if (!v) return;
		// Pages resize at once and keep their stretched bitmap until the
		// sharp one is ready, so nothing blanks while it re-renders.
		v.updateScale({ scaleFactor: z / v.currentScale, drawingDelay: 120 });
	}, []);
	/** The scale at which the current page (or pair) fills the width. */
	const fitWidthScale = () => {
		const v = pdfViewer.current;
		const box = container.current;
		const view = v?.getPageView(v.currentPageNumber - 1) as
			| { width: number; scale: number }
			| undefined;
		if (!v || !box || !view?.width) return 1;
		const across = v.spreadMode === SPREAD_NONE ? 1 : 2;
		return (box.clientWidth / (view.width * across)) * view.scale;
	};
	fitWidthRef.current = fitWidthScale;
	const { zoomBy, zoomTo } = useZoom({
		scroller: container,
		content: viewerEl,
		stage: viewerEl,
		zoom: 1,
		get: () => pdfViewer.current?.currentScale ?? 1,
		commit,
		hud,
		min: MIN_SCALE,
		max: MAX_SCALE,
		// Pages scale; the gaps between them do not. Anchor to the page.
		anchor: (x, y) =>
			document.elementFromPoint(x, y)?.closest<HTMLElement>(".page") ??
			(pdfViewer.current?.getPageView(pdfViewer.current.currentPageNumber - 1)
				?.div as HTMLElement | undefined) ??
			null,
		onTap: () => setChromeHidden((h) => !h),
		onDoubleTap: (x, y) => {
			const v = pdfViewer.current;
			if (!v) return;
			const fitted = ["page-width", "page-fit", "auto"].includes(
				v.currentScaleValue,
			);
			if (fitted) zoomBy(2, [x, y]);
			else zoomTo(fitWidthScale(), [x, y], () => setPreset("page-width"));
		},
		onReset: () =>
			zoomTo(fitWidthScale(), undefined, () => setPreset("page-width")),
		enabled: status === "ready",
		active,
	});

	// --- find ---
	const runFind = useCallback(
		(query: string, again: boolean, previous = false) => {
			bus.current?.dispatch("find", {
				source: null,
				type: again ? "again" : "",
				query,
				caseSensitive: matchCase,
				entireWord: wholeWords,
				highlightAll: true,
				findPrevious: previous,
				matchDiacritics: false,
			});
		},
		[matchCase, wholeWords],
	);
	useEffect(() => {
		if (!findOpen) return;
		const t = window.setTimeout(() => runFind(find.query, false), 200);
		return () => window.clearTimeout(t);
	}, [find.query, findOpen, runFind]);
	const openFind = (query?: string) => {
		if (query) setFind((f) => ({ ...f, query, busy: true }));
		setFindOpen(true);
	};
	const closeFind = () => {
		setFindOpen(false);
		setFind({ query: "", total: 0, current: -1 });
		runFind("", false);
	};

	const goTo = (n: number) => {
		const v = pdfViewer.current;
		if (v && n >= 1 && n <= pages) v.currentPageNumber = n;
	};
	const rotate = (by: 90 | -90) => {
		const v = pdfViewer.current;
		if (v) v.pagesRotation = (v.pagesRotation + by + 360) % 360;
	};
	const toggleSpread = () => {
		const v = pdfViewer.current;
		if (!v) return;
		const next = !spreadRef.current;
		setSpread(next);
		v.spreadMode = next ? SPREAD_ODD : SPREAD_NONE;
		// A pair needs the width one page had: fit it again.
		v.currentScaleValue = "page-width";
	};

	// Ctrl+] and Ctrl+[ turn the pages, as in other desktop readers.
	const rotateRef = useRef(rotate);
	rotateRef.current = rotate;
	useEffect(() => {
		if (!active || status !== "ready") return;
		const onKey = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
			if (e.key === "]") rotateRef.current(90);
			else if (e.key === "[") rotateRef.current(-90);
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, status]);

	const darkPages = settings.darkPages && isDarkTheme(theme);
	// Two pages side by side need the room: a wide window, a tablet or an
	// unfolded phone held sideways.
	const [roomForTwo, setRoomForTwo] = useState(false);
	useEffect(() => {
		const el = container.current;
		if (!el) return;
		const measure = () =>
			setRoomForTwo(el.clientWidth >= 700 && el.clientWidth > el.clientHeight);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const pdfMenu = (close: () => void) => (
		<>
			{!isDesktop && (
				<>
					<SheetItem
						icon={<StretchHorizontal size={20} />}
						onClick={() => {
							setPreset("page-width");
							close();
						}}
					>
						{t("Fit width")}
					</SheetItem>
					<SheetItem
						icon={<Maximize size={20} />}
						onClick={() => {
							setPreset("page-fit");
							close();
						}}
					>
						{t("Whole page")}
					</SheetItem>
				</>
			)}
			{(roomForTwo || spread) && (
				<SheetItem
					icon={<BookOpen size={20} />}
					checked={spread}
					onClick={() => {
						toggleSpread();
						close();
					}}
					testId="pdf-spread"
				>
					{t("Two pages side by side")}
				</SheetItem>
			)}
			<SheetItem
				icon={<RotateCw size={20} />}
				shortcut="Ctrl+]"
				onClick={() => {
					rotate(90);
					close();
				}}
			>
				{t("Rotate")}
			</SheetItem>
			{isDesktop && (
				<SheetItem
					icon={<RotateCcw size={20} />}
					shortcut="Ctrl+["
					onClick={() => {
						rotate(-90);
						close();
					}}
				>
					{t("Rotate left")}
				</SheetItem>
			)}
			{!isDesktop && (
				<>
					<SheetItem
						icon={<LayoutGrid size={20} />}
						onClick={() => {
							close();
							setThumbsOpen(true);
						}}
						testId="pdf-pages"
					>
						{t("Pages")}
					</SheetItem>
					<SheetItem
						icon={<ListTree size={20} />}
						disabled={!outline?.length}
						hint={
							outline && !outline.length
								? t("This PDF has no outline")
								: undefined
						}
						onClick={() => {
							close();
							setOutlineOpen(true);
						}}
					>
						{t("Contents")}
					</SheetItem>
				</>
			)}
		</>
	);

	// --- printing ---
	// Which pages: asked first, so a long file is not drawn in full to
	// print two sheets of it.
	const [printAsk, setPrintAsk] = useState<{
		answer: (choice: PrintChoice | null) => void;
	} | null>(null);
	const [range, setRange] = useState({ from: "1", to: "1" });

	/** The chosen pages as images at print resolution: the screen only
	 * ever holds the few pages around the reader. */
	const printPages = async (root: HTMLElement) => {
		if (!doc) return;
		let choice: PrintChoice = { from: 1, to: doc.numPages };
		if (doc.numPages > ASK_PAGES_OVER) {
			setRange({ from: String(page), to: String(page) });
			const picked = await new Promise<PrintChoice | null>((answer) =>
				setPrintAsk({ answer }),
			);
			setPrintAsk(null);
			if (!picked) throw new PrintCancelled();
			choice = picked;
		}
		const count = choice.to - choice.from + 1;
		if (count > 20) toast(t("Preparing {n} pages for printing…", { n: count }));
		// A short job can afford sharper pages (about 225 dpi on A4/Letter);
		// a long one is held to about 150 so it fits in memory.
		const target = count <= 20 ? 2480 : 1650;
		for (let n = choice.from; n <= choice.to; n++) {
			const pdfPage = await doc.getPage(n);
			const turn =
				(pdfPage.rotate + (pdfViewer.current?.pagesRotation ?? 0)) % 360;
			const base = pdfPage.getViewport({ scale: 1, rotation: turn });
			const scale = Math.min(
				count <= 20 ? 3.3 : 2.2,
				target / Math.max(base.width, base.height),
			);
			const viewport = pdfPage.getViewport({ scale, rotation: turn });
			const canvas = document.createElement("canvas");
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			const context = canvas.getContext("2d");
			if (!context) continue;
			// The "print" intent also draws without waiting on animation
			// frames, so a large file is not paced by the display.
			await pdfPage.render({
				canvasContext: context,
				viewport,
				intent: "print",
			}).promise;
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, "image/jpeg", 0.92),
			);
			canvas.width = canvas.height = 0;
			if (!blob) continue;
			const image = new Image();
			image.className = "pw-page";
			image.src = URL.createObjectURL(blob);
			image.onload = () => URL.revokeObjectURL(image.src);
			root.appendChild(image);
		}
	};
	const answerPrint = (choice: PrintChoice | null) => printAsk?.answer(choice);
	const typedRange = (): PrintChoice | null => {
		const from = Math.round(Number(range.from));
		const to = Math.round(Number(range.to));
		return from >= 1 && to >= from && to <= pages ? { from, to } : null;
	};

	// --- the panel beside the document (desktop) ---
	const side = useMemo<SideTab[]>(() => {
		if (!doc || status !== "ready") return [];
		const pick = (dest: unknown) =>
			links.current?.goToDestination(dest as string);
		return [
			{
				id: "pages",
				label: t("Pages"),
				content: (
					<PdfThumbs
						doc={doc}
						current={page}
						rotation={rotation}
						onPick={(n) => {
							const v = pdfViewer.current;
							if (v) v.currentPageNumber = n;
						}}
						follow
					/>
				),
			},
			{
				id: "contents",
				label: t("Contents"),
				content: outline?.length ? (
					<OutlineList items={outline} depth={0} onPick={pick} compact />
				) : (
					<p className={shellStyles.sideEmpty}>
						{t("This PDF has no outline")}
					</p>
				),
			},
		];
	}, [doc, status, page, rotation, outline]);

	const presets: ZoomPreset[] = [
		{
			label: t("Fit width"),
			run: () => setPreset("page-width"),
			on: preset === "page-width",
		},
		{
			label: t("Whole page"),
			run: () => setPreset("page-fit"),
			on: preset === "page-fit",
		},
		...percentPresets(ZOOM_LEVELS, preset ? 0 : scale, (z) => zoomTo(z)),
	];

	const actions = (
		<>
			<IconButton
				label={t("Find")}
				shortcut="Ctrl+F"
				onClick={() => setFindOpen(true)}
				active={findOpen}
				data-testid="pdf-find"
			>
				<Search size={20} />
			</IconButton>
		</>
	);

	const pager =
		status === "ready" ? (
			<>
				<PageJump
					page={page}
					pages={pages}
					onGo={goTo}
					label={pageLabel}
					onGoText={(text) => {
						const v = pdfViewer.current;
						// pdf.js takes a label or a plain number.
						if (v) v.currentPageLabel = text;
					}}
					testId="pdf"
				/>
				<ZoomControl
					label={scaleLabel || t("Fit width")}
					onOut={() => zoomBy(1 / 1.25)}
					onIn={() => zoomBy(1.25)}
					onReset={() =>
						setPreset(
							pdfViewer.current?.currentScaleValue === "page-width"
								? "page-fit"
								: "page-width",
						)
					}
					resetLabel={t("Switch between fit width and whole page")}
					presets={presets}
					testId="pdf"
				/>
			</>
		) : undefined;

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			progressOf={container}
			actions={actions}
			pager={pager}
			side={side}
			details={details}
			onStep={(dir) => goTo(page + dir)}
			onFind={status === "ready" ? openFind : undefined}
			menu={status === "ready" ? pdfMenu : undefined}
			onPrint={doc ? printPages : undefined}
			chromeHidden={chromeHidden && !findOpen}
			find={
				findOpen ? (
					<FindBar
						state={find}
						onQuery={(query) =>
							setFind((f) => ({ ...f, query, busy: !!query }))
						}
						onStep={(dir) => runFind(find.query, true, dir === -1)}
						onClose={closeFind}
						options={
							isDesktop ? (
								<>
									<button
										type="button"
										className={shellStyles.findOption}
										aria-pressed={matchCase}
										title={t("Match case")}
										aria-label={t("Match case")}
										onClick={() => setMatchCase((v) => !v)}
										data-testid="find-case"
									>
										Aa
									</button>
									<button
										type="button"
										className={shellStyles.findOption}
										aria-pressed={wholeWords}
										title={t("Whole words")}
										aria-label={t("Whole words")}
										onClick={() => setWholeWords((v) => !v)}
										data-testid="find-words"
									>
										“ab”
									</button>
								</>
							) : undefined
						}
					/>
				) : undefined
			}
		>
			<div
				ref={container}
				className={`${s.container} ${darkPages ? s.dark : ""}`}
				data-testid="pdf-scroll"
				tabIndex={-1}
			>
				<div ref={viewerEl} className="pdfViewer" />
			</div>
			<Scrubber
				of={container}
				label={`${page} / ${pages}`}
				enabled={status === "ready"}
			/>

			{status === "loading" && (
				<StateView>
					<Spinner label={t("Opening PDF")} />
				</StateView>
			)}
			{status === "error" && (
				<StateView
					icon={<ErrorArt />}
					title={t("Can't open this PDF")}
					action={<Button onClick={onClose}>{t("Close")}</Button>}
					testId="pdf-error"
				>
					{t("The file is damaged or isn't a valid PDF.")}
				</StateView>
			)}

			<PasswordDialog
				open={status === "password"}
				name={name}
				wrong={passwordWrong}
				onSubmit={(password) => {
					setStatus("loading");
					unlock.current?.(password);
				}}
				onCancel={onClose}
				testId="pdf"
			/>

			<Dialog
				open={printAsk !== null}
				title={t("Print")}
				onClose={() => answerPrint(null)}
				testId="print-range"
				actions={
					<>
						<Button variant="ghost" onClick={() => answerPrint(null)}>
							{t("Cancel")}
						</Button>
						<Button
							variant="secondary"
							onClick={() => answerPrint({ from: page, to: page })}
							data-testid="print-current"
						>
							{t("This page")}
						</Button>
						<Button
							onClick={() => answerPrint({ from: 1, to: pages })}
							data-testid="print-all"
						>
							{tn(pages, "All {n} page", "All {n} pages")}
						</Button>
					</>
				}
			>
				<form
					className={s.range}
					onSubmit={(e) => {
						e.preventDefault();
						const typed = typedRange();
						if (typed) answerPrint(typed);
					}}
				>
					<span>{t("Pages")}</span>
					<input
						className={shellStyles.input}
						type="number"
						inputMode="numeric"
						min={1}
						max={pages}
						value={range.from}
						onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
						aria-label={t("First page to print")}
						data-testid="print-from"
					/>
					<span>{t("to")}</span>
					<input
						className={shellStyles.input}
						type="number"
						inputMode="numeric"
						min={1}
						max={pages}
						value={range.to}
						onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
						aria-label={t("Last page to print")}
						data-testid="print-to"
					/>
					<Button
						type="submit"
						variant="secondary"
						disabled={!typedRange()}
						data-testid="print-range-go"
					>
						{t("Print these")}
					</Button>
				</form>
			</Dialog>

			<Sheet
				open={thumbsOpen}
				title={tn(pages, "{n} page", "{n} pages")}
				onClose={() => setThumbsOpen(false)}
				wide
			>
				{doc && (
					<PdfThumbs
						doc={doc}
						current={page}
						rotation={rotation}
						onPick={(n) => {
							goTo(n);
							setThumbsOpen(false);
						}}
					/>
				)}
			</Sheet>

			<Sheet
				open={outlineOpen}
				title={t("Contents")}
				onClose={() => setOutlineOpen(false)}
				wide
			>
				<OutlineList
					items={outline ?? []}
					depth={0}
					onPick={(dest) => {
						links.current?.goToDestination(dest as string);
						setOutlineOpen(false);
					}}
				/>
			</Sheet>
		</Shell>
	);
}

function OutlineList({
	items,
	depth,
	onPick,
	compact = false,
}: {
	items: Outline[];
	depth: number;
	onPick: (dest: unknown) => void;
	/** The narrow list of the side panel. */
	compact?: boolean;
}) {
	return (
		<>
			{items.map((item, i) => (
				<div key={`${depth}-${i}-${item.title}`}>
					<button
						type="button"
						className={compact ? shellStyles.sideItem : s.outline}
						style={{
							paddingInlineStart:
								(compact ? 8 : 12) + depth * (compact ? 12 : 16),
						}}
						title={compact ? item.title : undefined}
						onClick={() => onPick(item.dest)}
					>
						{item.title}
					</button>
					{item.items?.length > 0 && (
						<OutlineList
							items={item.items}
							depth={depth + 1}
							onPick={onPick}
							compact={compact}
						/>
					)}
				</div>
			))}
		</>
	);
}
