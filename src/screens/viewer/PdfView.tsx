import { backend, requestForBytes } from "@/lib/backend";
import { type DocMark, contentKey, fileSample } from "@/lib/docMarks";
import { isDesktop } from "@/lib/env";
import { copyName } from "@/lib/fileName";
import { locale, t, tn } from "@/lib/i18n";
import { hasOwnText } from "@/lib/ocr";
import { loadEngine, pdfAsset } from "@/lib/pdfEngine";
import { type TextPicture, addMarkup } from "@/lib/pdfMarkup";
import { PrintCancelled } from "@/lib/print";
import { resolvePageColor } from "@/lib/settings";
import { textPicture } from "@/lib/textBox";
import type { Position } from "@/lib/types";
import { useBackClose } from "@/state/navigation";
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
	ArrowLeft,
	BookOpen,
	BookOpenText,
	Crop,
	FileDown,
	GalleryHorizontal,
	Highlighter,
	ImageDown,
	Layers as LayersIcon,
	LayoutGrid,
	ListTree,
	Maximize,
	MessageSquare,
	MessageSquareText,
	Paperclip,
	PenLine,
	RotateCcw,
	RotateCw,
	ScanText,
	Search,
	StretchHorizontal,
	Wrench,
	X,
} from "lucide-react";
import type {
	PDFDocumentLoadingTask,
	PDFDocumentProxy,
	PDFPageProxy,
} from "pdfjs-dist";
import type {
	EventBus,
	PDFFindController,
	PDFHistory,
	PDFLinkService,
	PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { drawPage } from "@/lib/pagePicture";
import { FillSign } from "@/screens/tools/FillSign";
import { MarkUp } from "@/screens/tools/MarkUp";
import { ReadText } from "@/screens/tools/ReadText";
import { markHit } from "@/screens/tools/ink";
import { pdfSource } from "@/screens/tools/readSource";
import { announceSaved } from "@/screens/tools/saved";
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { PageJump, PasswordDialog } from "./Dialogs";
import { ViewerFileContext } from "./FileMenu";
import { Marking, type MarkingHandle } from "./Marking";
import { MarksPanel } from "./MarksPanel";
import {
	type Attachment,
	AttachmentList,
	type Comment,
	CommentList,
	type Layer,
	type LayerConfig,
	LayerList,
	pageSize,
	readAttachments,
	readLayers,
	useComments,
} from "./PdfExtras";
import { PdfThumbs } from "./PdfThumbs";
import s from "./PdfView.module.css";
import { Scrubber } from "./Scrubber";
import {
	type BookmarkSource,
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
import { canCrop, cropPages, whole } from "./pdfCrop";
import {
	type PageMap,
	drawMarks,
	pageMap,
	paintMarks,
	toDrawn,
	toShown,
} from "./pdfMarks";
import {
	type Box,
	findPictures,
	looksScanned,
	placePictures,
} from "./pdfPictures";
import { pageFileName, savePicture } from "./savePicture";
import { pdfSpeech } from "./speechSources";
import type { ViewerProps } from "./types";
import { useDocMarks } from "./useDocMarks";

/**
 * PDF on pdf.js's own viewer component (the engine behind Firefox's
 * reader): virtualised page rendering, text selection, links and find
 * with highlighting all come from pdf.js. This file adds the chrome,
 * the shared zoom gestures and position memory.
 */

interface Outline {
	title: string;
	dest: unknown;
	items: Outline[];
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
/** pdf.js's AnnotationMode.ENABLE: links and notes work, and a form's
 * fields are drawn as the file saved them. Its default makes them live
 * fields, and what a reader typed there would be neither saved nor
 * printed. A form is filled in with Fill & sign, which saves a copy. */
const ANNOTATIONS_SHOWN = 1;
/** pdf.js's SpreadMode: one page across, or two with odd pages first,
 * or two after a first page on its own (a book's cover). */
const SPREAD_NONE = 0;
const SPREAD_ODD = 1;
const SPREAD_EVEN = 2;
/** pdf.js's ScrollMode: pages down a long scroll, in a row, or one
 * (or one pair) at a time. */
const SCROLL_DOWN = 0;
const SCROLL_ACROSS = 1;
const SCROLL_ONE = 3;
/** pdf.js lays no pairs in a row: pairs are shown one at a time. */
const scrollMode = (across: boolean, pairs: boolean) =>
	across ? (pairs ? SCROLL_ONE : SCROLL_ACROSS) : SCROLL_DOWN;
/** A swipe this long, mostly sideways, turns a page shown on its own. */
const SWIPE = 60;
/** Where a followed link was left from, to go back to. */
type Spot = { page: number; top: number; left: number };
/** The steps kept to go back through. */
const TRAIL_MAX = 50;
/** How long "Back to page 3" stays on show after a link is followed. */
const TRAIL_HINT_MS = 8000;
/** The largest bitmap a page is drawn into before pdf.js stretches a
 * smaller one. A desktop has the memory for sharp pages at high zoom;
 * a phone is held to half of that. */
const MAX_CANVAS = isDesktop ? 2 ** 25 : 2 ** 24;
const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200, 400];
/** A file longer than this asks which pages to print before any are
 * drawn; a short one just prints. */
const ASK_PAGES_OVER = 10;

/** The files already said to restrict copying, this run. */
const toldNoCopy = new Set<string>();

/** pdf.js's RenderingStates.FINISHED. */
const RENDERED = 3;

/** What this file reads of pdf.js's page view. */
interface DrawnPage {
	id: number;
	div: HTMLElement;
	pdfPage?: PDFPageProxy;
	viewport: ReturnType<PDFPageProxy["getViewport"]>;
	renderingState: number;
}

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
	const { settings, theme, update } = useSettings();
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
	const [cover, setCover] = useState(
		() =>
			position?.kind === "pdf" &&
			settings.rememberPosition &&
			position.cover === true,
	);
	const [crop, setCrop] = useState(
		() =>
			position?.kind === "pdf" &&
			settings.rememberPosition &&
			position.crop === true,
	);
	const [cropAvailable, setCropAvailable] = useState(false);
	const across = settings.pdfFlow === "across";
	// A page that fits the screen snaps into place after a swipe; a
	// zoomed one is panned freely.
	const [fits, setFits] = useState(true);
	const [chromeHidden, setChromeHidden] = useState(false);
	const [outline, setOutline] = useState<Outline[] | null>(null);
	const [outlineOpen, setOutlineOpen] = useState(false);
	const [thumbsOpen, setThumbsOpen] = useState(false);
	const [details, setDetails] = useState<Array<[string, string]>>([]);
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [layers, setLayers] = useState<Layer[]>([]);
	// What the file's author allows done to it: marks on its pages,
	// filling in its form.
	const [rights, setRights] = useState({ mark: true, fill: true });
	const [filling, setFilling] = useState(false);
	const [markingUp, setMarkingUp] = useState(false);
	// The password the reader opened it with, held for saving copies.
	const passwordRef = useRef<string | undefined>(undefined);
	const layerConfig = useRef<LayerConfig | null>(null);
	/** The phone's sheets of comments, attachments and layers. */
	const [extra, setExtra] = useState<
		"comments" | "attachments" | "layers" | null
	>(null);
	const file = useContext(ViewerFileContext);
	// The file's content key, and whether its marks may be kept.
	const [markDoc, setMarkDoc] = useState<{
		key: string;
		persist: boolean;
	} | null>(null);
	const marks = useDocMarks(
		markDoc?.key ?? null,
		name,
		markDoc?.persist ?? false,
	);
	const marksRef = useRef(marks);
	marksRef.current = marks;
	const marking = useRef<MarkingHandle>(null);
	const [scrollBox, setScrollBox] = useState<HTMLDivElement | null>(null);
	const [marksOpen, setMarksOpen] = useState(false);
	const [readingText, setReadingText] = useState(false);
	// The page on show is a picture of a page: offer to read it.
	const [scanOffer, setScanOffer] = useState(false);
	const [scanRefused, setScanRefused] = useState(false);
	/** A mark to draw the eye to, once its page is drawn. */
	const pulse = useRef<string | null>(null);
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
	const coverRef = useRef(cover);
	coverRef.current = cover;
	const cropRef = useRef(crop);
	cropRef.current = crop;
	/** Puts the pages' own boxes back (crop margins off). */
	const cropStop = useRef<(() => void) | null>(null);
	/** Lays the pages out again (their boxes changed), where they were,
	 * at a zoom given or the one they had. */
	const relayout = useRef<(scale?: string) => void>(() => {});
	const relaidAt = useRef<{
		page: number;
		scale: string;
		rotation: number;
	} | null>(null);
	const acrossRef = useRef(across);
	acrossRef.current = across;
	/** Where the reader is now, and the places links were followed from
	 * (and, after going back, to). */
	const here = useRef<Spot | null>(null);
	const trail = useRef<{ back: Spot[]; forward: Spot[] }>({
		back: [],
		forward: [],
	});
	const [steps, setSteps] = useState({ back: 0, forward: 0 });
	const [trailHint, setTrailHint] = useState(false);
	const tintedRef = useRef(false);
	tintedRef.current =
		resolvePageColor(settings.pageColor, theme) !== "original";
	/** Leave a drawn page's pictures as they are on coloured paper. */
	const keepPictures = useRef<(view: DrawnPage) => void>(() => {});
	/** Draw the reader's marks on a page. */
	const paintPage = useRef<(view: DrawnPage) => void>(() => {});

	// --- open the document ---
	// pdf.js takes the bytes over: they move to its worker rather than
	// being copied, so a large file is held once, not twice. A locked
	// file asks for its password through the same load, so trying a
	// password never reads the file again.
	const unlock = useRef<((password: string) => void) | null>(null);
	const nameRef = useRef(name);
	nameRef.current = name;
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
				// Read before pdf.js takes the bytes away to its worker.
				const sample = fileSample(new Uint8Array(data));
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
					setMarkDoc({
						key: contentKey(sample),
						persist: !passwordRef.current,
					});
					pdf
						.getOutline()
						.then((o) => setOutline((o as unknown as Outline[]) ?? []))
						.catch(() => setOutline([]));
					readAttachments(pdf)
						.then((found) => alive && setAttachments(found))
						.catch(() => {});
					// What the file says about itself, for Details.
					Promise.all([
						pdf.getMetadata(),
						pdf.getPage(1).catch(() => null),
						pdf.getPermissions().catch(() => null),
					])
						.then(([{ info }, first, permissions]) => {
							if (!alive) return;
							const meta = info as Record<string, unknown>;
							const [x0, y0, x1, y1] = first?.view ?? [0, 0, 0, 0];
							const turned = (first?.rotate ?? 0) % 180 !== 0;
							const [w, h] = [Math.abs(x1 - x0), Math.abs(y1 - y0)];
							// Its author may ask that its text not be copied: the
							// reader is told, not stopped.
							const noCopy =
								Array.isArray(permissions) &&
								!permissions.includes(pdfjs.PermissionFlag.COPY);
							if (Array.isArray(permissions)) {
								const flag = pdfjs.PermissionFlag;
								const mark =
									permissions.includes(flag.MODIFY_CONTENTS) ||
									permissions.includes(flag.MODIFY_ANNOTATIONS);
								setRights({
									mark,
									fill:
										mark || permissions.includes(flag.FILL_INTERACTIVE_FORMS),
								});
							}
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
								[
									t("Page size"),
									w && h ? pageSize(turned ? h : w, turned ? w : h) : null,
								],
								[t("PDF version"), text("PDFFormatVersion")],
								[
									t("Copying"),
									noCopy
										? t("The author asks that its text not be copied")
										: null,
								],
							];
							// Said once a run for each file, not at every opening.
							if (noCopy && !toldNoCopy.has(nameRef.current)) {
								toldNoCopy.add(nameRef.current);
								toast(t("This PDF restricts copying"));
							}
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
		loadEngine().then(({ pdfjs, viewer }) => {
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
				// The icon of a note left on a page.
				imageResourcesPath: pdfAsset("images"),
			});
			linkService.setViewer(v);
			pdfViewer.current = v;
			bus.current = eventBus;
			links.current = linkService;

			// Following a link (or a contents entry) remembers where it was
			// followed from: Back returns there, as in a browser.
			const history = {
				pushCurrentPosition() {
					const spot = here.current;
					if (!spot) return;
					const { back } = trail.current;
					trail.current = {
						back: [...back, spot].slice(-TRAIL_MAX),
						forward: [],
					};
					setSteps({ back: trail.current.back.length, forward: 0 });
					setTrailHint(true);
				},
				push() {},
				pushPage() {},
				back: () => stepRef.current(-1),
				forward: () => stepRef.current(1),
			};
			linkService.setHistory(history as unknown as PDFHistory);

			eventBus.on("pagesinit", () => {
				// Layers the file lets a reader show or hide.
				v.optionalContentConfigPromise
					?.then((config) => {
						if (cancelled) return;
						layerConfig.current = config as unknown as LayerConfig;
						setLayers(readLayers(layerConfig.current));
					})
					.catch(() => {});
				const saved = positionRef.current;
				const again = relaidAt.current;
				relaidAt.current = null;
				v.scrollMode = scrollMode(acrossRef.current, spreadRef.current);
				if (spreadRef.current)
					v.spreadMode = coverRef.current ? SPREAD_EVEN : SPREAD_ODD;
				if (again) {
					v.pagesRotation = again.rotation;
					v.currentScaleValue = again.scale;
					v.currentPageNumber = again.page;
				} else if (saved?.kind === "pdf" && rememberRef.current) {
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
					// Pages in a row are read a whole page at a time.
					v.currentScaleValue = acrossRef.current
						? "page-fit"
						: defaultZoom.current;
				}
				setRotation(v.pagesRotation);
			});
			// The pictures of each page are read once, the first time it is
			// drawn on coloured paper.
			const pictures = new Map<number, Promise<Box[]>>();
			keepPictures.current = (view: DrawnPage) => {
				const page = view.pdfPage;
				if (!tintedRef.current || !page) return;
				let boxes = pictures.get(view.id);
				if (!boxes) {
					boxes = findPictures(page, pdfjs.OPS).catch(() => []);
					pictures.set(view.id, boxes);
				}
				boxes.then((found) => {
					if (!cancelled && view.div.isConnected)
						placePictures(page, view.div, found, view.viewport.rotation);
				});
			};
			eventBus.on("pagerendered", (e: { source: DrawnPage }) => {
				keepPictures.current(e.source);
				paintPage.current(e.source);
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
					if (loc)
						here.current = {
							page: loc.pageNumber,
							top: loc.top,
							left: loc.left,
						};
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
							...(spreadRef.current && coverRef.current ? { cover: true } : {}),
							...(cropRef.current ? { crop: true } : {}),
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

			relayout.current = (scale) => {
				pictures.clear();
				relaidAt.current = {
					page: v.currentPageNumber,
					scale: scale ?? v.currentScaleValue,
					rotation: v.pagesRotation,
				};
				v.setDocument(doc);
			};
			const show = () => {
				v.setDocument(doc);
				linkService.setDocument(doc);
			};
			doc
				.getPage(1)
				.then((first) => !cancelled && setCropAvailable(canCrop(first)))
				.catch(() => {});
			// A document read with its margins cropped opens that way.
			if (cropRef.current)
				cropPages(doc)
					.then((stop) => {
						if (cancelled) return stop();
						cropStop.current = stop;
						show();
					})
					.catch(show);
			else show();
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
				cropStop.current?.();
				cropStop.current = null;
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
		onTap: (_target, x, y) => {
			if (marking.current?.tap(x, y)) return;
			// Pages in a row turn with a tap on either side, and so do pages
			// down a scroll where the reader asked for it.
			const box = container.current?.getBoundingClientRect();
			if ((acrossRef.current || settings.tapToTurn) && box) {
				const at = (x - box.left) / box.width;
				if (at < 0.25) return turn(-1);
				if (at > 0.75) return turn(1);
			}
			setChromeHidden((h) => !h);
		},
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
	/** The next or the previous page, or pair of pages. */
	const turn = (dir: 1 | -1) => {
		const v = pdfViewer.current;
		if (dir > 0) v?.nextPage();
		else v?.previousPage();
	};
	const turnRef = useRef(turn);
	turnRef.current = turn;
	const rotate = (by: 90 | -90) => {
		const v = pdfViewer.current;
		if (v) v.pagesRotation = (v.pagesRotation + by + 360) % 360;
	};
	const toggleSpread = () => {
		const v = pdfViewer.current;
		if (!v) return;
		const next = !spreadRef.current;
		setSpread(next);
		v.scrollMode = scrollMode(acrossRef.current, next);
		v.spreadMode = next
			? coverRef.current
				? SPREAD_EVEN
				: SPREAD_ODD
			: SPREAD_NONE;
		// A pair needs the width one page had: fit it again.
		v.currentScaleValue = acrossRef.current ? "page-fit" : "page-width";
	};
	const toggleCrop = async () => {
		if (!doc) return;
		const next = !cropRef.current;
		cropRef.current = next;
		setCrop(next);
		if (next) {
			cropStop.current = await cropPages(doc);
		} else {
			cropStop.current?.();
			cropStop.current = null;
		}
		// The point of cropping is a page that fills the screen.
		relayout.current(acrossRef.current ? "page-fit" : "page-width");
	};
	const toggleCover = () => {
		const v = pdfViewer.current;
		if (!v) return;
		const next = !coverRef.current;
		setCover(next);
		v.spreadMode = next ? SPREAD_EVEN : SPREAD_ODD;
	};

	// The pages change from a scroll to a row, or back, while reading.
	const shownAcross = useRef(across);
	useEffect(() => {
		const v = pdfViewer.current;
		if (!v || shownAcross.current === across) return;
		shownAcross.current = across;
		const at = v.currentPageNumber;
		v.scrollMode = scrollMode(across, spreadRef.current);
		v.currentScaleValue = across ? "page-fit" : defaultZoom.current;
		v.currentPageNumber = at;
	}, [across]);

	// Whether the page on show fits the screen (then a swipe snaps to
	// the next one).
	const measureFit = useCallback(() => {
		const v = pdfViewer.current;
		const box = container.current;
		const view = v?.getPageView(v.currentPageNumber - 1) as
			| { width: number }
			| undefined;
		if (!v || !box || !view?.width) return;
		const across = v.spreadMode === SPREAD_NONE ? 1 : 2;
		setFits(view.width * across <= box.clientWidth + 2);
	}, []);

	// Back through the links followed, and forward again.
	const step = (dir: -1 | 1) => {
		const v = pdfViewer.current;
		const { back, forward } = trail.current;
		const from = dir < 0 ? back : forward;
		const to = from[from.length - 1];
		if (!v || !to) return;
		const now = here.current;
		trail.current =
			dir < 0
				? {
						back: back.slice(0, -1),
						forward: now ? [...forward, now] : forward,
					}
				: {
						back: now ? [...back, now] : back,
						forward: forward.slice(0, -1),
					};
		setSteps({
			back: trail.current.back.length,
			forward: trail.current.forward.length,
		});
		v.scrollPageIntoView({
			pageNumber: Math.min(Math.max(1, to.page), v.pagesCount),
			destArray: [null, { name: "XYZ" }, to.left, to.top, null],
			allowNegativeOffset: true,
		});
	};
	const stepRef = useRef(step);
	stepRef.current = step;
	// System Back (and Alt+Left, a mouse's back button) retraces a link
	// before it leaves the document; the arrow in the bar still closes it.
	useBackClose("pdf-trail", active && steps.back > 0, () =>
		stepRef.current(-1),
	);
	useEffect(() => {
		if (!trailHint) return;
		const timer = window.setTimeout(() => setTrailHint(false), TRAIL_HINT_MS);
		return () => window.clearTimeout(timer);
	}, [trailHint]);
	// Alt+Right goes forward again.
	useEffect(() => {
		if (!active || !steps.forward) return;
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || e.ctrlKey || e.metaKey || e.key !== "ArrowRight") return;
			e.preventDefault();
			stepRef.current(1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, steps.forward]);

	// A mouse wheel turns pages in a row when there is nothing to scroll
	// down to; a trackpad's small steps add up to a page.
	useEffect(() => {
		const el = container.current;
		if (!el || !across || status !== "ready") return;
		let sum = 0;
		let last = 0;
		const onWheel = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) return;
			if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
			// A page taller than the screen scrolls down first.
			if (el.scrollHeight > el.clientHeight + 8) return;
			e.preventDefault();
			if (e.timeStamp - last > 400) sum = 0;
			last = e.timeStamp;
			sum += e.deltaY;
			if (Math.abs(sum) < 60) return;
			turnRef.current(Math.sign(sum) as 1 | -1);
			sum = 0;
		};
		// Pages shown one (or one pair) at a time do not scroll: a swipe
		// across turns them. Pages in a row scroll and snap on their own.
		let start: { x: number; y: number } | null = null;
		const onStart = (e: TouchEvent) => {
			start =
				e.touches.length === 1
					? { x: e.touches[0].clientX, y: e.touches[0].clientY }
					: null;
		};
		const onEnd = (e: TouchEvent) => {
			const from = start;
			start = null;
			const touch = e.changedTouches[0];
			if (!from || !touch || el.scrollWidth > el.clientWidth + 1) return;
			const dx = touch.clientX - from.x;
			const dy = touch.clientY - from.y;
			if (Math.abs(dx) > SWIPE && Math.abs(dx) > 2 * Math.abs(dy))
				turnRef.current(dx < 0 ? 1 : -1);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		el.addEventListener("touchstart", onStart, { passive: true });
		el.addEventListener("touchend", onEnd);
		return () => {
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("touchstart", onStart);
			el.removeEventListener("touchend", onEnd);
		};
	}, [across, status]);

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

	// Pages already drawn when the paper takes a colour get their
	// pictures back now; the rest as they are drawn.
	const tinted = tintedRef.current;
	useEffect(() => {
		const v = pdfViewer.current;
		if (!tinted || !v) return;
		for (let i = 0; i < v.pagesCount; i++) {
			const view = v.getPageView(i) as DrawnPage | undefined;
			if (view?.renderingState === RENDERED) keepPictures.current(view);
		}
	}, [tinted]);
	// A scan has no words to search or select. Asked of the page on
	// show, a moment after it settles, so paging through costs nothing.
	useEffect(() => {
		if (!doc || status !== "ready" || scanRefused) return;
		let live = true;
		const timer = window.setTimeout(async () => {
			try {
				const proxy = await doc.getPage(page);
				const { items } = await proxy.getTextContent();
				if (hasOwnText(items as Array<{ str?: string }>)) {
					if (live) setScanOffer(false);
					return;
				}
				const { pdfjs } = await loadEngine();
				const scanned = await looksScanned(proxy, pdfjs.OPS);
				if (live) setScanOffer(scanned);
			} catch {
				if (live) setScanOffer(false);
			}
		}, 500);
		return () => {
			live = false;
			window.clearTimeout(timer);
		};
	}, [doc, status, page, scanRefused]);

	// --- marks on the pages ---
	const mapOf = (view: DrawnPage): PageMap | null =>
		view.pdfPage ? pageMap(view.pdfPage, view.viewport) : null;
	const measureLabel = useRef<(mark: DocMark) => string | undefined>(
		() => undefined,
	);
	paintPage.current = (view) => {
		const map = mapOf(view);
		if (!map) return;
		const index = view.id - 1;
		const list = marks.list.filter((mark) => mark.page === index);
		const target = pulse.current;
		paintMarks(view.div, list, map, {
			pulse: target,
			label: measureLabel.current,
		});
		if (target && list.some((mark) => mark.id === target)) pulse.current = null;
	};
	const markList = marks.list;
	// biome-ignore lint/correctness/useExhaustiveDependencies: drawn again whenever the marks change
	useEffect(() => {
		const v = pdfViewer.current;
		if (!v) return;
		for (let i = 0; i < v.pagesCount; i++) {
			const view = v.getPageView(i) as DrawnPage | undefined;
			if (view?.renderingState === RENDERED) paintPage.current(view);
		}
	}, [markList, marks.scales]);

	const spotOf = useCallback((pageNumber: number) => {
		const view = pdfViewer.current?.getPageView(pageNumber - 1) as
			| DrawnPage
			| undefined;
		const map = view?.pdfPage ? pageMap(view.pdfPage, view.viewport) : null;
		return view && map ? { div: view.div, map } : null;
	}, []);

	/** The mark under a point of the screen, the newest on top. */
	const markAt = useCallback(
		(x: number, y: number) => {
			const pageDiv = document
				.elementsFromPoint(x, y)
				.find((el) => el.classList.contains("page")) as HTMLElement | undefined;
			const n = Number(pageDiv?.dataset.pageNumber);
			const spot = n ? spotOf(n) : null;
			if (!spot) return null;
			const box = spot.div.getBoundingClientRect();
			const { map } = spot;
			const [u, v] = toShown(
				map,
				((x - box.left) / box.width) * map.width,
				((y - box.top) / box.height) * map.height,
			);
			// A finger's width, whatever the zoom.
			const reach = (8 * map.pw) / box.width;
			const list = marksRef.current.list;
			for (let i = list.length - 1; i >= 0; i--) {
				const mark = list[i];
				if (mark.page === n - 1 && markHit(mark, u, v, map.pw, map.ph, reach))
					return mark;
			}
			return null;
		},
		[spotOf],
	);

	// A click on a mark. A tap on a phone comes through `onTap`.
	useEffect(() => {
		if (!scrollBox) return;
		const onClick = (e: MouseEvent) => {
			if ((e as PointerEvent).pointerType === "touch" || e.button !== 0) return;
			if ((e.target as Element).closest("a, .annotationLayer section")) return;
			marking.current?.tap(e.clientX, e.clientY);
		};
		scrollBox.addEventListener("click", onClick);
		return () => scrollBox.removeEventListener("click", onClick);
	}, [scrollBox]);

	/** Go to a mark and draw the eye to it. */
	const showMark = (mark: DocMark) => {
		const v = pdfViewer.current;
		if (!v) return;
		setMarksOpen(false);
		pulse.current = mark.id;
		const spot = spotOf(mark.page + 1);
		const view = v.getPageView(mark.page) as DrawnPage | undefined;
		if (!spot || !view) {
			v.currentPageNumber = mark.page + 1;
			return;
		}
		const place =
			mark.kind === "ink" || mark.kind === "measure"
				? mark.points[0]
				: "boxes" in mark
					? ([mark.boxes[0].x, mark.boxes[0].y] as [number, number])
					: ([mark.x, mark.y] as [number, number]);
		const [x, y] = toDrawn(spot.map, place[0], place[1]);
		const [left, top] = view.viewport.convertToPdfPoint(x, y);
		v.scrollPageIntoView({
			pageNumber: mark.page + 1,
			destArray: [null, { name: "XYZ" }, left, top + 48, null],
			allowNegativeOffset: true,
		});
		paintPage.current(view);
	};

	const pageName = (index: number) => {
		const view = pdfViewer.current?.getPageView(index) as
			| { pageLabel?: string | null }
			| undefined;
		return t("p. {n}", { n: view?.pageLabel || index + 1 });
	};

	/** A new PDF with what the reader has marked; the file stays as it is. */
	const saveWithMarks = async () => {
		if (!doc) return;
		const list = marks.list;
		try {
			const pictures: Array<TextPicture | undefined> = [];
			for (const mark of list) {
				if (mark.kind !== "text") continue;
				const page = await doc.getPage(mark.page + 1);
				const shown = whole(page, () => page.getViewport({ scale: 1 }));
				pictures.push(await textPicture(mark, shown.width, shown.height));
			}
			const bytes = await addMarkup(await doc.getData(), {
				password: passwordRef.current,
				marks: list,
				pictures,
				labels: list
					.filter((mark) => mark.kind === "measure")
					.map((mark) => measureLabel.current(mark)),
			});
			const saved = await backend.saveFile(
				copyName(name, t("marked up")),
				bytes,
				"application/pdf",
			);
			if (saved) announceSaved(saved, file?.openOver);
		} catch {
			toast(t("Couldn't save a copy"));
		}
	};

	// Two pages side by side need the room: a wide window, a tablet or an
	// unfolded phone held sideways.
	const [roomForTwo, setRoomForTwo] = useState(false);
	useEffect(() => {
		const el = container.current;
		if (!el) return;
		const measure = () => {
			setRoomForTwo(el.clientWidth >= 700 && el.clientWidth > el.clientHeight);
			measureFit();
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [measureFit]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: measured again at each page and zoom
	useEffect(() => {
		measureFit();
	}, [page, scale, measureFit]);

	// --- save the page on show as a picture of its own ---
	const savingPage = useRef(false);
	const savePage = async () => {
		if (!doc || savingPage.current) return;
		savingPage.current = true;
		const n = page;
		await savePicture(async () => {
			const proxy = await doc.getPage(n);
			const picture = await drawPage(proxy, {
				dpi: 200,
				type: "image/png",
				// Turned as it is on screen; the whole page, cropped or not.
				rotation:
					(proxy.rotate + (pdfViewer.current?.pagesRotation ?? 0)) % 360,
				viewportOf: (params) => whole(proxy, () => proxy.getViewport(params)),
				after: (ctx, viewport) =>
					drawMarks(
						ctx,
						marks.list.filter((mark) => mark.page === n - 1),
						pageMap(proxy, viewport),
						measureLabel.current,
					),
			});
			return { ...picture, name: pageFileName(name, n, picture.type) };
		}, file?.openOver);
		savingPage.current = false;
	};

	const pdfMenu = (close: () => void) => (
		<>
			<SheetItem
				icon={<PenLine size={20} />}
				disabled={!rights.fill}
				hint={
					rights.fill
						? t("Fill in its form, sign it, add text or a date")
						: t("Its author doesn't allow changes")
				}
				onClick={() => {
					close();
					setFilling(true);
				}}
				testId="pdf-fill-sign"
			>
				{t("Fill & sign")}
			</SheetItem>
			<SheetItem
				icon={<Highlighter size={20} />}
				disabled={!rights.mark}
				hint={
					rights.mark
						? t("Write on it, highlight words, add notes")
						: t("Its author doesn't allow changes")
				}
				onClick={() => {
					close();
					setMarkingUp(true);
				}}
				testId="pdf-mark-up"
			>
				{t("Mark up")}
			</SheetItem>
			<SheetItem
				icon={<MessageSquareText size={20} />}
				hint={
					marks.list.length
						? String(marks.list.length)
						: t("Everything you marked, in one list")
				}
				onClick={() => {
					close();
					setMarksOpen(true);
				}}
				testId="pdf-highlights"
			>
				{t("Highlights and notes")}
			</SheetItem>
			{marks.list.length > 0 && (
				<SheetItem
					icon={<FileDown size={20} />}
					hint={t("A new PDF other apps can show them in")}
					onClick={() => {
						close();
						void saveWithMarks();
					}}
					testId="pdf-save-marks"
				>
					{t("Save a copy with my marks")}
				</SheetItem>
			)}
			<SheetItem
				icon={<ScanText size={20} />}
				hint={t("Copy its words, even from a scan")}
				onClick={() => {
					close();
					setReadingText(true);
				}}
				testId="pdf-read-text"
			>
				{t("Read text")}
			</SheetItem>
			{file?.openTools && (
				<SheetItem
					icon={<Wrench size={20} />}
					hint={t("Merge, split, organize pages, number them, add a password")}
					onClick={() => {
						close();
						file.openTools?.();
					}}
					testId="pdf-tools"
				>
					{t("More PDF tools")}
				</SheetItem>
			)}
			<SheetItem
				icon={<ImageDown size={20} />}
				hint={t("Page {n}, as a picture of its own", { n: page })}
				onClick={() => {
					close();
					void savePage();
				}}
				testId="pdf-save-page"
			>
				{t("Save page as picture")}
			</SheetItem>
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
			<SheetItem
				icon={<GalleryHorizontal size={20} />}
				checked={across}
				onClick={() => {
					update("pdfFlow", across ? "down" : "across");
					close();
				}}
				testId="pdf-across"
			>
				{t("Scroll pages sideways")}
			</SheetItem>
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
			{spread && (
				<SheetItem
					icon={<BookOpenText size={20} />}
					checked={cover}
					onClick={() => {
						toggleCover();
						close();
					}}
					testId="pdf-cover"
				>
					{t("First page on its own")}
				</SheetItem>
			)}
			{cropAvailable && (
				<SheetItem
					icon={<Crop size={20} />}
					checked={crop}
					onClick={() => {
						close();
						toggleCrop();
					}}
					testId="pdf-crop"
				>
					{t("Crop margins")}
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
					<SheetItem
						icon={<MessageSquare size={20} />}
						onClick={() => {
							close();
							setExtra("comments");
						}}
						testId="pdf-comments"
					>
						{t("Comments")}
					</SheetItem>
					{attachments.length > 0 && (
						<SheetItem
							icon={<Paperclip size={20} />}
							hint={String(attachments.length)}
							onClick={() => {
								close();
								setExtra("attachments");
							}}
							testId="pdf-attachments"
						>
							{t("Attachments")}
						</SheetItem>
					)}
					{layers.length > 0 && (
						<SheetItem
							icon={<LayersIcon size={20} />}
							onClick={() => {
								close();
								setExtra("layers");
							}}
							testId="pdf-layers"
						>
							{t("Layers")}
						</SheetItem>
					)}
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
			// Paper takes the whole page, margins and all.
			const base = whole(pdfPage, () =>
				pdfPage.getViewport({ scale: 1, rotation: turn }),
			);
			const scale = Math.min(
				count <= 20 ? 3.3 : 2.2,
				target / Math.max(base.width, base.height),
			);
			const viewport = whole(pdfPage, () =>
				pdfPage.getViewport({ scale, rotation: turn }),
			);
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
			drawMarks(
				context,
				marks.list.filter((mark) => mark.page === n - 1),
				pageMap(pdfPage, viewport),
				measureLabel.current,
			);
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

	// --- bookmarks: a page, and the spot on it ---
	const places = useMemo<BookmarkSource>(
		() => ({
			here: () => {
				const v = pdfViewer.current;
				const spot = here.current;
				if (!v || !spot) return null;
				return {
					// Named as the page counter shows it.
					label: t("Page {n}", {
						n: v.currentPageLabel || v.currentPageNumber,
					}),
					position: {
						kind: "pdf",
						page: spot.page,
						top: spot.top,
						left: spot.left,
						scale: String(v.currentScaleValue),
						rotation: v.pagesRotation,
					},
				};
			},
			go: (p) => {
				const v = pdfViewer.current;
				if (!v || p.kind !== "pdf") return;
				v.scrollPageIntoView({
					pageNumber: Math.min(Math.max(1, p.page), v.pagesCount),
					destArray: [null, { name: "XYZ" }, p.left, p.top, null],
					allowNegativeOffset: true,
				});
			},
		}),
		[],
	);

	// --- read aloud: the text of each page, from the one on show ---
	const speech = useMemo(
		() =>
			doc && status === "ready"
				? pdfSpeech(
						doc,
						() => pdfViewer.current?.currentPageNumber ?? 1,
						(n) => {
							const v = pdfViewer.current;
							if (v) v.currentPageNumber = n;
						},
					)
				: undefined,
		[doc, status],
	);

	// --- comments, attachments and layers ---
	const showComment = (item: Comment) => {
		const v = pdfViewer.current;
		if (!v) return;
		const [x0, , , y1] = item.rect;
		v.scrollPageIntoView({
			pageNumber: item.page,
			destArray:
				item.rect.length === 4
					? [null, { name: "XYZ" }, x0, y1 + 24, null]
					: undefined,
			allowNegativeOffset: true,
		});
		setExtra(null);
	};
	const openAttachment = (item: Attachment) => {
		setExtra(null);
		file?.openOver?.(requestForBytes(item.name, item.bytes));
	};
	const toggleLayer = (layer: Layer) => {
		const v = pdfViewer.current;
		const config = layerConfig.current;
		if (!v || !config) return;
		config.setVisibility(layer.id, !layer.visible);
		// Handing the config back makes pdf.js draw the pages again.
		v.optionalContentConfigPromise = Promise.resolve(
			config as unknown as NonNullable<
				Awaited<PDFViewer["optionalContentConfigPromise"]>
			>,
		);
		setLayers(readLayers(config));
	};

	// --- the panel beside the document (desktop) ---
	// biome-ignore lint/correctness/useExhaustiveDependencies: the handlers only read refs and the viewer
	const side = useMemo<SideTab[]>(() => {
		if (!doc || status !== "ready") return [];
		const pick = (dest: unknown) =>
			links.current?.goToDestination(dest as string);
		return [
			{
				id: "pages",
				label: t("Pages"),
				icon: <LayoutGrid size={16} />,
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
				icon: <ListTree size={16} />,
				content: outline?.length ? (
					<OutlineList items={outline} depth={0} onPick={pick} compact />
				) : (
					<p className={shellStyles.sideEmpty}>
						{t("This PDF has no outline")}
					</p>
				),
			},
			{
				id: "highlights",
				label: t("Highlights"),
				icon: <Highlighter size={16} />,
				content: (
					<MarksPanel
						store={marks}
						name={name}
						label={pageName}
						onShow={showMark}
						onSaveCopy={saveWithMarks}
					/>
				),
			},
			{
				id: "comments",
				label: t("Comments"),
				icon: <MessageSquare size={16} />,
				content: <Comments doc={doc} onPick={showComment} compact />,
			},
			...(attachments.length
				? [
						{
							id: "attachments",
							label: t("Attachments"),
							icon: <Paperclip size={16} />,
							content: (
								<AttachmentList
									items={attachments}
									onOpen={openAttachment}
									compact
								/>
							),
						},
					]
				: []),
			...(layers.length
				? [
						{
							id: "layers",
							label: t("Layers"),
							icon: <LayersIcon size={16} />,
							content: (
								<LayerList items={layers} onToggle={toggleLayer} compact />
							),
						},
					]
				: []),
		];
	}, [doc, status, page, rotation, outline, attachments, layers, marks, name]);

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
			{rights.mark && (
				<IconButton
					label={t("Mark up")}
					onClick={() => setMarkingUp(true)}
					disabled={status !== "ready"}
					data-testid="pdf-mark-button"
				>
					<PenLine size={20} />
				</IconButton>
			)}
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
			onStep={turn}
			bookmarks={status === "ready" ? places : undefined}
			speech={speech}
			turnPages={across}
			onEdge={across ? (end) => goTo(end ? pages : 1) : undefined}
			onFind={status === "ready" ? openFind : undefined}
			menu={status === "ready" ? pdfMenu : undefined}
			onPrint={doc ? printPages : undefined}
			paper
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
						options={{ matchCase, wholeWords }}
						onOptions={(o) => {
							setMatchCase(o.matchCase);
							setWholeWords(o.wholeWords);
						}}
					/>
				) : undefined
			}
		>
			<div
				ref={(el) => {
					(container as { current: HTMLDivElement | null }).current = el;
					setScrollBox(el);
				}}
				className={`${s.container} ${across && fits ? s.snap : ""}`}
				data-flow={across ? "across" : undefined}
				data-one={across && spread ? "" : undefined}
				data-testid="pdf-scroll"
				tabIndex={-1}
			>
				<div ref={viewerEl} className="pdfViewer" />
			</div>
			<Scrubber
				of={container}
				label={`${page} / ${pages}`}
				enabled={status === "ready" && !across}
			/>
			{steps.back > 0 && trailHint && (
				<button
					type="button"
					className={s.trail}
					onClick={() => step(-1)}
					data-testid="pdf-trail"
				>
					<ArrowLeft size={16} className="pw-flip" />
					{t("Back to page {n}", {
						n: trail.current.back[trail.current.back.length - 1]?.page ?? 1,
					})}
				</button>
			)}

			{scanOffer && !scanRefused && !readingText && status === "ready" && (
				<div className={s.scanOffer} data-testid="scan-offer">
					<ScanText size={18} aria-hidden="true" />
					<span>{t("This page is a scan.")}</span>
					<Button
						variant="secondary"
						onClick={() => setReadingText(true)}
						data-testid="scan-offer-read"
					>
						{t("Read its text")}
					</Button>
					<IconButton
						label={t("Close")}
						onClick={() => setScanRefused(true)}
						data-testid="scan-offer-close"
					>
						<X size={16} />
					</IconButton>
				</div>
			)}
			{status === "ready" && marks.ready && (
				<Marking
					ref={marking}
					container={scrollBox}
					store={marks}
					canMark={rights.mark}
					active={active && !markingUp && !filling && !readingText}
					spotOf={spotOf}
					markAt={markAt}
					onFind={openFind}
				/>
			)}
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

			{markingUp && doc && (
				<MarkUp
					doc={doc}
					name={name}
					password={passwordRef.current}
					store={marks}
					onClose={() => setMarkingUp(false)}
					onSaved={(saved) => announceSaved(saved, file?.openOver)}
				/>
			)}

			{readingText && doc && (
				<ReadText
					source={pdfSource(doc, name, passwordRef.current)}
					docKey={markDoc?.persist ? markDoc.key : null}
					start={page - 1}
					onClose={() => setReadingText(false)}
					onSaved={(saved) => announceSaved(saved, file?.openOver)}
				/>
			)}

			{filling && doc && (
				<FillSign
					doc={doc}
					name={name}
					password={passwordRef.current}
					canMark={rights.mark}
					onClose={() => setFilling(false)}
					onSaved={(saved) => announceSaved(saved, file?.openOver)}
				/>
			)}
			<PasswordDialog
				open={status === "password"}
				name={name}
				wrong={passwordWrong}
				onSubmit={(password) => {
					setStatus("loading");
					passwordRef.current = password;
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
				open={marksOpen}
				title={t("Highlights and notes")}
				onClose={() => setMarksOpen(false)}
				wide
				testId="marks-sheet"
			>
				<MarksPanel
					store={marks}
					name={name}
					label={pageName}
					onShow={showMark}
					onSaveCopy={saveWithMarks}
				/>
			</Sheet>

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

			<Sheet
				open={extra !== null}
				title={
					extra === "comments"
						? t("Comments")
						: extra === "attachments"
							? t("Attachments")
							: t("Layers")
				}
				onClose={() => setExtra(null)}
				wide
				testId="pdf-extra"
			>
				{extra === "comments" && doc && (
					<Comments doc={doc} onPick={showComment} />
				)}
				{extra === "attachments" && (
					<AttachmentList items={attachments} onOpen={openAttachment} />
				)}
				{extra === "layers" && (
					<LayerList items={layers} onToggle={toggleLayer} />
				)}
			</Sheet>
		</Shell>
	);
}

/** The comments of a document, read once this list is first shown. */
function Comments({
	doc,
	onPick,
	compact,
}: {
	doc: PDFDocumentProxy;
	onPick: (item: Comment) => void;
	compact?: boolean;
}) {
	const { items, done } = useComments(doc, true);
	return (
		<CommentList items={items} done={done} onPick={onPick} compact={compact} />
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
