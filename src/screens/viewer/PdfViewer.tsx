import { formatCssVar } from "@/components/FormatBadge";
import { Button, Dialog, IconButton, Sheet, TextField } from "@/components/ui";
import {
	type CanonicalPoint,
	type DisplayBox,
	type FitMode,
	MAX_ZOOM,
	type PageMeta,
	ZOOM_STEP_FACTOR,
	type ZoomBounds,
	buildCanonicalAnchor,
	canonicalToDisplay,
	clampManualScale,
	computeAnchoredScroll,
	computeOutputScale,
	computePageDisplayBox,
	displayToCanonical,
	manualZoomBounds,
	nextFitMode,
	totalRotation,
} from "@/lib/pdfLayout";
import { isVersionedPosition, positionPageIndex } from "@/lib/recents";
import type { FilePosition } from "@/lib/types";
import { haptic, useSettings } from "@/state/SettingsContext";
import {
	Grid3x3,
	List,
	Maximize,
	Maximize2,
	MoreVertical,
	RotateCw,
	Search,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import styled from "styled-components";
// pdf.js text-layer styles scope everything under .textLayer; they
// cannot reset the app (audit PDF-09).
import "pdfjs-dist/web/pdf_viewer.css";
import { PdfSearchSheet, type SearchHit } from "./PdfSearchSheet";
import { ViewerShell, useViewerChrome, useViewportWidth } from "./ViewerShell";
import {
	type GestureController,
	type GestureEvent,
	createGestureController,
} from "./documentGestures";
import type { OutlineNode, PdfDocument, RenderTaskLike } from "./pdfTypes";
import { useViewerViewport } from "./useViewerViewport";

async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist");
	pdfjs.GlobalWorkerOptions.workerSrc = new URL(
		"pdfjs-dist/build/pdf.worker.min.mjs",
		import.meta.url,
	).toString();
	return pdfjs;
}

/**
 * SCR-07 PDF viewer (docs/07 section 2): continuous vertical scroll,
 * virtualized page rendering, zoom controls, page scrubber, outline,
 * thumbnails, password unlock, position memory, dark reading.
 * Engine: pdf.js.
 *
 * Zoom is a transaction (docs/14 audit PDF-01): a gesture or control
 * captures a canonical page-local anchor BEFORE any transform, may
 * preview with a transform whose origin is the anchor, and commits by
 * re-rendering the layout, clearing the preview transform, and only
 * then measuring the final page box to solve the anchored scroll —
 * all in one pre-paint layout effect. Rotating, resizing, and late
 * page metadata reuse the same correction path (PDF-04/05), because
 * anchors are canonical ratios of the unrotated page and are
 * converted with the total (intrinsic + user) rotation at finalize
 * time.
 *
 * Gestures are a state machine (PDF-03) with `touch-action: none` on
 * the reading surface: the app owns single-finger pan with inertia,
 * two-finger pinch/pan, tap arbitration, and cancellation. Wheel
 * scrolling and scrollbars remain native.
 */

const PAGE_GAP = 8;
/** Delay before a single tap toggles chrome, so a double-tap zoom
 * can cancel it (audit PDF-03). */
const SINGLE_TAP_CHROME_MS = 280;

const ScrollWrap = styled.div`
	position: absolute;
	inset: 0;
	overflow: auto;
	padding: 8px;
	/* The first page must start below the toolbar and the last page
	   must clear the bottom bar (audit section 8). */
	padding-top: calc(var(--viewer-top-height, 56px) + 8px);
	padding-bottom: calc(
		var(--viewer-bottom-height, 0px) + var(--viewer-bottom-reserve, 0px) +
			16px
	);
	scroll-padding-top: calc(var(--viewer-top-height, 56px) + 12px);
	scroll-padding-bottom: calc(var(--viewer-bottom-height, 0px) + 12px);
	background: var(--bg);
	/* The gesture controller owns touch panning/zooming end to end
	   (audit PDF-03): no native pan may fight the custom pinch, and
	   the browser's scroll anchoring must not fight the app-owned
	   anchor corrections. Wheel scroll and scrollbars stay native. */
	touch-action: none;
	overflow-anchor: none;
	overscroll-behavior: contain;
	scrollbar-gutter: stable;
	direction: ltr;
`;

/* max-content wrapper (audit section 7): when a page is wider than
   the scroller the wrapper grows so scrollLeft 0 is the true left
   edge; when pages are narrower, min-width 100% + auto margins
   center them. Flex centering of an overflowing child is what made
   the left side unreachable. The pinch preview transform is applied
   here and always cleared before final measurement (audit PDF-01). */
const Pages = styled.div<{ $darken: boolean }>`
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: ${PAGE_GAP}px;
	width: max-content;
	min-width: 100%;
	filter: ${({ $darken }) => ($darken ? "invert(0.92) hue-rotate(180deg)" : "none")};
	will-change: transform;
`;

const PageBox = styled.div<{ $width: number; $height: number }>`
	width: ${({ $width }) => $width}px;
	height: ${({ $height }) => $height}px;
	background: white;
	border-radius: 2px;
	box-shadow: var(--shadow-1);
	position: relative;
	overflow: hidden;
	flex-shrink: 0;
	/* Centers when narrower than the wrapper; harmless when the
	   wrapper is exactly the page width. */
	margin-inline: auto;

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
`;

const ListPanel = styled.div`
	display: flex;
	flex-direction: column;
`;

const OutlineButton = styled.button<{ $depth: number }>`
	background: none;
	border: none;
	text-align: left;
	padding: 12px 8px;
	padding-left: ${({ $depth }) => 8 + $depth * 16}px;
	border-radius: 8px;
	color: var(--ink-1);
	font-size: 0.9375rem;
	cursor: pointer;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-height: 44px;

	&:hover {
		background: var(--surface-2);
	}
`;

const PanelNote = styled.p`
	color: var(--ink-2);
	font-size: 0.9375rem;
	padding: 8px;
`;

const ToolButton = styled.button`
	display: flex;
	align-items: center;
	gap: 14px;
	width: 100%;
	min-height: 52px;
	padding: 10px 8px;
	border: 0;
	border-radius: 10px;
	background: transparent;
	color: var(--ink-1);
	font: inherit;
	text-align: left;
	cursor: pointer;

	&:hover {
		background: var(--surface-2);
	}

	&:disabled {
		opacity: 0.45;
		cursor: default;
	}
`;

const ThumbGrid = styled.div`
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
	gap: 12px;
`;

/* Sized from real page geometry after total rotation, not a fixed
   0.707: landscape and non-A-series pages must not be stretched
   (audit 11.5, PDF-05). */
const Thumb = styled.button<{ $current: boolean; $ratio: number }>`
	border: 2px solid
		${({ $current }) => ($current ? "var(--accent)" : "var(--border)")};
	border-radius: 8px;
	background: white;
	padding: 0;
	cursor: pointer;
	overflow: hidden;
	aspect-ratio: ${({ $ratio }) => $ratio};

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
`;

/** Render concurrency limit for page rasters: two keeps a phone's
 * main thread responsive while still pre-rendering neighbors. */
const RENDER_CONCURRENCY = 2;

const FALLBACK_PAGE: PageMeta = { width: 612, height: 792, rotation: 0 };

interface ZoomTransaction {
	pageNumber: number;
	canonical: CanonicalPoint;
	clientX: number;
	clientY: number;
}

interface PinchState {
	startScale: number;
	targetScale: number;
	tx: ZoomTransaction;
	/** Anchor point in pages-element coordinates (untransformed). */
	pagesPoint: { x: number; y: number };
	/** Client position of the pages element origin at pinch start. */
	pagesClient: { x: number; y: number };
}

export function PdfViewer({
	data,
	name,
	initialPosition,
	onPosition,
	onClose,
	onNeedData,
	darkenPages,
}: {
	data: ArrayBuffer;
	name: string;
	initialPosition?: FilePosition;
	onPosition?: (pos: FilePosition) => void;
	onClose: () => void;
	/** Fresh bytes for a password retry: the first buffer is handed
	 * to pdf.js, which detaches it. */
	onNeedData?: () => Promise<ArrayBuffer | null>;
	darkenPages: boolean;
}) {
	const { settings } = useSettings();
	const chrome = useViewerChrome();
	const shellWidth = useViewportWidth();

	const [doc, setDoc] = useState<PdfDocument | null>(null);
	const [loadProgress, setLoadProgress] = useState<number | null>(0);
	const [openError, setOpenError] = useState(false);
	const [currentPage, setCurrentPage] = useState(
		positionPageIndex(initialPosition) ?? 0,
	);
	// Fit and manual zoom are separate (audit PDF-02): fit modes carry
	// no hidden multiplier; manual is one absolute CSS-px-per-point
	// scale for the whole document.
	const [fitMode, setFitMode] = useState<FitMode>("width");
	const [manualScale, setManualScale] = useState(1);
	const settingsMode = settings["viewer.zoom_mode_pdf"];
	const [fitModeInitialized, setFitModeInitialized] = useState(false);
	const [outline, setOutline] = useState<OutlineNode[] | null>(null);
	const [outlineOpen, setOutlineOpen] = useState(false);
	const [thumbsOpen, setThumbsOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [toolsOpen, setToolsOpen] = useState(false);
	const [jumpOpen, setJumpOpen] = useState(false);
	const [jumpValue, setJumpValue] = useState("");
	const [passwordOpen, setPasswordOpen] = useState(false);
	const [password, setPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [userRotation, setUserRotation] = useState(0);
	const [pageMetas, setPageMetas] = useState<PageMeta[]>([]);
	// Bumped on every layout transaction commit so the pre-paint
	// finalizer runs even when the numeric zoom value did not change
	// (no-op or clamped transactions must still clean up, audit PDF-01).
	const [txNonce, setTxNonce] = useState(0);

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const pagesRef = useRef<HTMLDivElement | null>(null);
	const pageRefs = useRef(new Map<number, HTMLDivElement>());
	const dataRef = useRef(data);
	const initialPositionRef = useRef(initialPosition);
	const positionTimer = useRef<number | null>(null);
	const restored = useRef(false);
	// Render registry: keyed by page, each entry owned by the task
	// that created it plus the render generation, so stale completions
	// can neither evict newer entries nor publish (audit PDF-07).
	const renderTasks = useRef(
		new Map<number, { generation: number; task: RenderTaskLike }>(),
	);
	const renderGenerationRef = useRef(0);
	// Set by the render effect: manual re-demand for the Retry action.
	const retryDemandRef = useRef<((pageNum: number) => void) | null>(null);
	// Link annotations resolve their destination lazily at click time.
	const goToPageRef = useRef<((pageNum: number) => void) | null>(null);
	const chromeToggleTimer = useRef<number | null>(null);
	// Pages whose last render genuinely failed (not cancelled): they
	// show a Retry affordance instead of staying white (PDF-07 item 4).
	const [pageErrors, setPageErrors] = useState<Set<number>>(() => new Set());
	// Active search session: the full hit list plus which match is
	// highlighted (audit PDF-09). Non-null also shows the document-view
	// next/previous controls.
	const [search, setSearch] = useState<{
		hits: SearchHit[];
		activeIndex: number;
	} | null>(null);

	// Mirrors for handlers that must read committed state without
	// re-creating on every render.
	const pageBoxesRef = useRef<DisplayBox[]>([]);
	const pageTopsRef = useRef<number[]>([]);
	const pageMetasRef = useRef<PageMeta[]>([]);
	const boundsRef = useRef<ZoomBounds>({ min: 0.1, max: MAX_ZOOM });
	const fitModeRef = useRef(fitMode);
	const manualScaleRef = useRef(manualScale);
	const userRotationRef = useRef(userRotation);
	const currentPageRef = useRef(currentPage);
	const desiredScaleRef = useRef(1);
	fitModeRef.current = fitMode;
	manualScaleRef.current = manualScale;
	userRotationRef.current = userRotation;
	currentPageRef.current = currentPage;
	pageMetasRef.current = pageMetas;

	// --- layout transactions (audit PDF-01) ---
	const txRef = useRef<ZoomTransaction | null>(null);
	const lastStableAnchorRef = useRef<
		(CanonicalPoint & { pageNumber: number }) | null
	>(null);

	// --- gesture state (audit PDF-03) ---
	const pinchRef = useRef<PinchState | null>(null);
	const previewRef = useRef<{
		ox: number;
		oy: number;
		k: number;
		tx: number;
		ty: number;
	} | null>(null);
	const previewRafRef = useRef<number | null>(null);
	const flingRafRef = useRef<number | null>(null);
	const gestureHandlersRef = useRef<(e: GestureEvent) => void>(() => {});
	const gestureRef = useRef<GestureController | null>(null);
	if (!gestureRef.current) {
		gestureRef.current = createGestureController((e) =>
			gestureHandlersRef.current(e),
		);
	}

	// --- aggregate raster accounting (audit PDF-08 item 8): byte
	// estimates (w*h*4) of application-owned page canvases. The bounds
	// are assertable from tests; engine/GPU memory is additional. ---
	const rasterBytesRef = useRef({ bytes: 0, peak: 0 });
	const retainRaster = useCallback((bytes: number) => {
		const t = rasterBytesRef.current;
		t.bytes += bytes;
		t.peak = Math.max(t.peak, t.bytes);
	}, []);
	const releaseRaster = useCallback((bytes: number) => {
		const t = rasterBytesRef.current;
		t.bytes = Math.max(0, t.bytes - bytes);
	}, []);

	const totalRotationFor = useCallback((pageNumber: number): number => {
		const meta =
			pageMetasRef.current[pageNumber - 1] ?? pageMetasRef.current[0];
		return totalRotation(meta ?? FALLBACK_PAGE, userRotationRef.current);
	}, []);

	// --- usable viewport (audit PDF-04): measured between the real
	// chrome insets, one padding convention, stable while chrome
	// slides; every geometry change re-anchors through the same
	// transaction path. ---
	const viewport = useViewerViewport(scrollRef, () => {
		if (gestureRef.current?.phase === "pinching") return;
		const tx = captureCorrection();
		if (tx) commitAnchor(tx);
	});

	// --- document loading (audit PDF-07): each attempt gets a
	// generation; pdf.js takes ownership of a COPY of the bytes so a
	// StrictMode replay or close-while-loading can never hand a
	// detached buffer to a new attempt, and stale completions are
	// destroyed instead of published. ---
	const loadGenerationRef = useRef(0);
	const loadingTaskRef = useRef<{
		task: { destroy: () => Promise<void> };
	} | null>(null);

	const load = useCallback(async (dataSource: ArrayBuffer, pwd?: string) => {
		const generation = ++loadGenerationRef.current;
		// A superseded attempt's task must not win the slot.
		loadingTaskRef.current = null;
		setLoadProgress(0.05);
		try {
			const pdfjs = await loadPdfjs();
			if (generation !== loadGenerationRef.current) return;
			// pdf.js transfers (detaches) the buffer it is handed. Every
			// attempt therefore receives its own copy, and the stored
			// bytes stay valid for later retries.
			const task = pdfjs.getDocument({
				data: dataSource.slice(0),
				password: pwd,
			});
			loadingTaskRef.current = { task };
			task.onProgress = (p: { loaded: number; total: number }) => {
				if (p.total > 0 && generation === loadGenerationRef.current) {
					setLoadProgress(Math.max(0.05, p.loaded / p.total));
				}
			};
			const pdf = await task.promise;
			loadingTaskRef.current = null;
			if (generation !== loadGenerationRef.current) {
				// A newer attempt superseded this one; destroy the stale
				// document instead of publishing it (audit PDF-07).
				pdf.destroy().catch(() => {});
				return;
			}
			setDoc(pdf);
			setLoadProgress(null);
			pdf
				.getOutline()
				.then((o) => setOutline(o as unknown as OutlineNode[]))
				.catch(() => setOutline([]));
		} catch (e) {
			if (generation !== loadGenerationRef.current) return;
			const err = e as { name?: string };
			if (err?.name === "PasswordException") {
				if (pwd !== undefined) {
					setPasswordError("That password didn't work. Try again.");
				}
				setPasswordOpen(true);
				setLoadProgress(null);
				return;
			}
			setOpenError(true);
			setLoadProgress(null);
		}
	}, []);

	useEffect(() => {
		load(dataRef.current);
		return () => {
			// Invalidate in-flight work and destroy the pending loading
			// task (StrictMode replay and real close-while-loading both
			// land here, audit PDF-07 item 1).
			loadGenerationRef.current++;
			const pending = loadingTaskRef.current;
			loadingTaskRef.current = null;
			pending?.task.destroy().catch(() => {});
		};
	}, [load]);

	useEffect(
		() => () => {
			doc?.destroy().catch(() => {});
		},
		[doc],
	);

	const unlock = useCallback(() => {
		setPasswordOpen(false);
		setPasswordError(null);
		setLoadProgress(0.05);
		// The previous attempt's buffer was handed to pdf.js and
		// detached by it; a retry needs fresh bytes from the source. A
		// failed re-read is a recoverable read error — never a fall
		// back to detached bytes (audit PDF-07 item 2).
		const retry = async () => {
			try {
				const fresh = onNeedData ? await onNeedData() : null;
				if (fresh && fresh.byteLength > 0) {
					load(fresh, password);
					return;
				}
				if (dataRef.current.byteLength > 0) {
					// The stored bytes are still valid: each attempt got
					// its own copy, so this buffer was never detached.
					load(dataRef.current, password);
					return;
				}
			} catch {
				// fall through to the read-error path
			}
			setOpenError(true);
			setLoadProgress(null);
		};
		retry();
	}, [load, password, onNeedData]);

	// --- page metadata: intrinsic size + intrinsic /Rotate per page
	// (audit PDF-05). Priority pages first so the reader's target page
	// never sits on a placeholder; the sweep publishes in bounded
	// batches with per-page failure fallbacks (audit PDF-04). ---
	useEffect(() => {
		if (!doc) return;
		let cancelled = false;
		const metas: PageMeta[] = [];
		const publish = () => {
			if (cancelled) return;
			// Relayout must not move the reading point. Skip while a
			// pinch is previewing; the pinch commit re-anchors anyway.
			if (gestureRef.current?.phase !== "pinching") {
				const tx = captureCorrection();
				if (tx) commitAnchor(tx);
			}
			setPageMetas([...metas]);
		};
		const readPage = async (n: number): Promise<PageMeta> => {
			try {
				const page = await doc.getPage(n);
				// rotation: 0 replaces the intrinsic rotation, giving the
				// unrotated point box; page.rotate carries /Rotate.
				const vp = page.getViewport({ scale: 1, rotation: 0 });
				return {
					width: vp.width,
					height: vp.height,
					rotation: page.rotate ?? 0,
				};
			} catch {
				// A page that cannot be measured still gets a sane box
				// instead of losing every later page (audit PDF-04).
				return FALLBACK_PAGE;
			}
		};
		const run = async () => {
			const priority = new Set<number>([1]);
			const restoredPage =
				(positionPageIndex(initialPositionRef.current) ?? 0) + 1;
			if (restoredPage >= 1 && restoredPage <= doc.numPages) {
				priority.add(restoredPage);
			}
			priority.add(Math.min(doc.numPages, currentPageRef.current + 1));
			for (const n of [...priority].sort((a, b) => a - b)) {
				metas[n - 1] = await readPage(n);
				if (cancelled) return;
			}
			publish();
			for (let start = 1; start <= doc.numPages; start += 12) {
				const end = Math.min(doc.numPages, start + 11);
				const batch = await Promise.all(
					Array.from({ length: end - start + 1 }, (_, i) =>
						readPage(start + i),
					),
				);
				batch.forEach((meta, i) => {
					metas[start - 1 + i] = meta;
				});
				if (cancelled) return;
				publish();
			}
		};
		run();
		return () => {
			cancelled = true;
		};
	}, [doc]);

	// --- one geometry model (audit PDF-02) ---
	const bounds = useMemo(
		() =>
			manualZoomBounds({
				pages: pageMetas.length > 0 ? pageMetas : [FALLBACK_PAGE],
				userRotation,
				containerWidth: viewport.width || 600,
				containerHeight: viewport.height || 800,
			}),
		[pageMetas, userRotation, viewport],
	);
	boundsRef.current = bounds;

	const pageBoxes = useMemo(() => {
		if (!doc || viewport.width <= 0) return [];
		return Array.from({ length: doc.numPages }, (_, index) => {
			const meta = pageMetas[index] ?? pageMetas[0] ?? FALLBACK_PAGE;
			return computePageDisplayBox({
				page: meta,
				userRotation,
				containerWidth: viewport.width,
				containerHeight: viewport.height,
				fitMode,
				manualScale,
				bounds,
			});
		});
	}, [doc, fitMode, manualScale, pageMetas, userRotation, viewport, bounds]);
	pageBoxesRef.current = pageBoxes;

	// Absolute content-space tops of every page, refreshed whenever the
	// layout changes; drives current-page tracking and anchor capture
	// without per-page DOM reads (audit PDF-08 item 9).
	useLayoutEffect(() => {
		const pages = pagesRef.current;
		if (!pages || pageBoxes.length === 0) {
			pageTopsRef.current = [];
			return;
		}
		const base = pages.offsetTop;
		const tops: number[] = new Array(pageBoxes.length);
		let acc = 0;
		for (let i = 0; i < pageBoxes.length; i++) {
			tops[i] = base + acc;
			acc += pageBoxes[i].height + PAGE_GAP;
		}
		pageTopsRef.current = tops;
	}, [pageBoxes]);

	const pageAtContentY = useCallback((contentY: number): number | null => {
		const tops = pageTopsRef.current;
		if (tops.length === 0) return null;
		let lo = 0;
		let hi = tops.length - 1;
		let ans = 0;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (tops[mid] <= contentY) {
				ans = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		return ans + 1;
	}, []);

	// --- transaction capture and commit ---
	const captureAnchorAt = useCallback(
		(clientX: number, clientY: number): ZoomTransaction | null => {
			const el = scrollRef.current;
			if (!el) return null;
			const srect = el.getBoundingClientRect();
			const contentY = el.scrollTop + (clientY - srect.top);
			const pageNumber = pageAtContentY(contentY);
			if (!pageNumber) return null;
			const node = pageRefs.current.get(pageNumber);
			if (!node) return null;
			const rect = node.getBoundingClientRect();
			const canonical = buildCanonicalAnchor({
				pageNumber,
				pageRect: rect,
				rotation: totalRotationFor(pageNumber),
				clientX,
				clientY,
			});
			if (!canonical) return null;
			return { pageNumber, canonical, clientX, clientY };
		},
		[pageAtContentY, totalRotationFor],
	);

	/** Capture the last stable reading anchor (kept from scroll state)
	 * with its current on-screen client position. Used when the change
	 * was caused by something that already resized the DOM (resize,
	 * metadata), where capturing fresh "before" geometry is impossible
	 * (audit PDF-04). */
	const captureCorrection = useCallback((): ZoomTransaction | null => {
		const stable = lastStableAnchorRef.current;
		const el = scrollRef.current;
		if (!stable || !el) return null;
		const node = pageRefs.current.get(stable.pageNumber);
		if (!node) return null;
		const rect = node.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		const display = canonicalToDisplay(
			{ x: stable.x, y: stable.y },
			totalRotationFor(stable.pageNumber),
		);
		return {
			pageNumber: stable.pageNumber,
			canonical: { x: stable.x, y: stable.y },
			clientX: rect.left + display.x * rect.width,
			clientY: rect.top + display.y * rect.height,
		};
	}, [totalRotationFor]);

	const commitAnchor = useCallback((tx: ZoomTransaction) => {
		txRef.current = tx;
		setTxNonce((n) => n + 1);
	}, []);

	// Pre-paint finalizer: clear any preview transform FIRST, then
	// measure the committed layout, then solve and apply the anchored
	// scroll — all before paint, so no intermediate frame is visible
	// (audit PDF-01 contract step 4).
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useLayoutEffect(() => {
		const pages = pagesRef.current;
		if (pages) {
			pages.style.transform = "";
			pages.style.transformOrigin = "";
		}
		previewRef.current = null;
		const tx = txRef.current;
		if (!tx) return;
		txRef.current = null;
		const el = scrollRef.current;
		const node = pageRefs.current.get(tx.pageNumber);
		if (!el || !node) return;
		const rect = node.getBoundingClientRect();
		const srect = el.getBoundingClientRect();
		const display = canonicalToDisplay(
			tx.canonical,
			totalRotationFor(tx.pageNumber),
		);
		const { left, top } = computeAnchoredScroll({
			anchor: display,
			pageRect: rect,
			scrollerRect: { left: srect.left, top: srect.top },
			scrollLeft: el.scrollLeft,
			scrollTop: el.scrollTop,
			clientWidth: el.clientWidth,
			clientHeight: el.clientHeight,
			scrollWidth: el.scrollWidth,
			scrollHeight: el.scrollHeight,
			clientX: tx.clientX,
			clientY: tx.clientY,
		});
		el.scrollLeft = left;
		el.scrollTop = top;
		lastStableAnchorRef.current = {
			pageNumber: tx.pageNumber,
			x: tx.canonical.x,
			y: tx.canonical.y,
		};
		// Runs on transaction commits; reads fresh refs by design.
	}, [txNonce, totalRotationFor]);

	// --- preview transform plumbing ---
	const clearPreviewNow = useCallback(() => {
		const pages = pagesRef.current;
		if (pages) {
			pages.style.transform = "";
			pages.style.transformOrigin = "";
		}
		previewRef.current = null;
	}, []);

	const schedulePreview = useCallback(() => {
		if (previewRafRef.current !== null) return;
		previewRafRef.current = requestAnimationFrame(() => {
			previewRafRef.current = null;
			const p = previewRef.current;
			const pages = pagesRef.current;
			if (!p || !pages) return;
			pages.style.transformOrigin = `${p.ox}px ${p.oy}px`;
			pages.style.transform = `translate(${p.tx}px, ${p.ty}px) scale(${p.k})`;
		});
	}, []);

	// --- zoom operations ---
	const captureAtCenter = useCallback((): ZoomTransaction | null => {
		const el = scrollRef.current;
		if (!el) return null;
		const rect = el.getBoundingClientRect();
		return captureAnchorAt(
			rect.left + rect.width / 2,
			rect.top + rect.height / 2,
		);
	}, [captureAnchorAt]);

	const zoomFactorAt = useCallback(
		(clientX: number, clientY: number, factor: number) => {
			const tx = captureAnchorAt(clientX, clientY);
			if (!tx) return;
			// Converting from fit starts at the anchor page's honest
			// display scale; manual zoom continues from the last
			// requested scale so rapid wheel events accumulate smoothly
			// (audit PDF-02: never clamp or round the starting scale).
			const committed = pageBoxesRef.current[tx.pageNumber - 1]?.scale ?? 1;
			const base =
				fitModeRef.current === "none" && desiredScaleRef.current > 0
					? desiredScaleRef.current
					: committed;
			const target = clampManualScale(base * factor, boundsRef.current);
			desiredScaleRef.current = target;
			setFitMode("none");
			setManualScale(target);
			commitAnchor(tx);
		},
		[captureAnchorAt, commitAnchor],
	);

	const stepZoom = useCallback(
		(direction: 1 | -1) => {
			haptic(settings);
			const el = scrollRef.current;
			if (!el) return;
			const rect = el.getBoundingClientRect();
			zoomFactorAt(
				rect.left + rect.width / 2,
				rect.top + rect.height / 2,
				direction === 1 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR,
			);
		},
		[settings, zoomFactorAt],
	);

	const cycleZoomAt = useCallback(
		(clientX: number, clientY: number) => {
			haptic(settings);
			const tx = captureAnchorAt(clientX, clientY);
			const next = nextFitMode(fitModeRef.current);
			if (next === "none") {
				// fit -> manual keeps the anchor page's actual scale exactly
				// (audit PDF-02: conversion must not round or clamp away
				// sub-0.5 fit scales).
				const boxIndex =
					tx?.pageNumber != null ? tx.pageNumber - 1 : currentPageRef.current;
				const committed = pageBoxesRef.current[boxIndex]?.scale ?? 1;
				desiredScaleRef.current = committed;
				setManualScale(committed);
			}
			if (tx) commitAnchor(tx);
			setFitMode(next);
		},
		[settings, captureAnchorAt, commitAnchor],
	);

	const setExplicitFit = useCallback(
		(mode: FitMode) => {
			haptic(settings);
			const tx = captureAtCenter();
			if (tx) commitAnchor(tx);
			setFitMode(mode);
		},
		[settings, captureAtCenter, commitAnchor],
	);

	const rotateClockwise = useCallback(() => {
		haptic(settings);
		// Canonical anchors survive rotation by conversion (audit
		// PDF-05); prefer the stable reading point over the viewport
		// center.
		const tx = captureCorrection() ?? captureAtCenter();
		setUserRotation((value) => (value + 90) % 360);
		if (tx) commitAnchor(tx);
	}, [settings, captureCorrection, captureAtCenter, commitAnchor]);

	// --- fling (audit PDF-03: custom pan owns inertia and bounds) ---
	const stopFling = useCallback(() => {
		if (flingRafRef.current !== null) {
			cancelAnimationFrame(flingRafRef.current);
			flingRafRef.current = null;
		}
	}, []);

	const startFling = useCallback(
		(vx: number, vy: number) => {
			const el = scrollRef.current;
			if (!el) return;
			stopFling();
			if (Math.hypot(vx, vy) < 0.05) return;
			let last = performance.now();
			let v = { x: vx, y: vy };
			const step = (now: number) => {
				const dt = Math.min(64, now - last);
				last = now;
				const beforeX = el.scrollLeft;
				const beforeY = el.scrollTop;
				el.scrollLeft -= v.x * dt;
				el.scrollTop -= v.y * dt;
				v = {
					x: v.x * Math.exp(-dt / 280),
					y: v.y * Math.exp(-dt / 280),
				};
				const stuckX = el.scrollLeft === beforeX;
				const stuckY = el.scrollTop === beforeY;
				const slowX = Math.abs(v.x) < 0.02;
				const slowY = Math.abs(v.y) < 0.02;
				if ((stuckX || slowX) && (stuckY || slowY)) {
					flingRafRef.current = null;
					return;
				}
				flingRafRef.current = requestAnimationFrame(step);
			};
			flingRafRef.current = requestAnimationFrame(step);
		},
		[stopFling],
	);

	// --- pinch preview lifecycle ---
	const beginPinch = useCallback(
		(x: number, y: number) => {
			const pages = pagesRef.current;
			if (!pages) return;
			const anchor = captureAnchorAt(x, y);
			if (!anchor) return;
			const node = pageRefs.current.get(anchor.pageNumber);
			if (!node) return;
			// Both rects are untransformed: no preview exists yet.
			const pagesRect = pages.getBoundingClientRect();
			const pageRect = node.getBoundingClientRect();
			const display = canonicalToDisplay(
				anchor.canonical,
				totalRotationFor(anchor.pageNumber),
			);
			const scale = pageBoxesRef.current[anchor.pageNumber - 1]?.scale ?? 1;
			pinchRef.current = {
				startScale: scale,
				targetScale: scale,
				tx: anchor,
				pagesPoint: {
					x: pageRect.left - pagesRect.left + display.x * pageRect.width,
					y: pageRect.top - pagesRect.top + display.y * pageRect.height,
				},
				pagesClient: { x: pagesRect.left, y: pagesRect.top },
			};
			stopFling();
		},
		[captureAnchorAt, totalRotationFor, stopFling],
	);

	const updatePinch = useCallback(
		(x: number, y: number, scale: number) => {
			const st = pinchRef.current;
			if (!st) return;
			const target = clampManualScale(st.startScale * scale, boundsRef.current);
			st.targetScale = target;
			// Two-finger translation moves the target client point; the
			// same content point stays under the moving midpoint (audit
			// PDF-01 step 2).
			st.tx = { ...st.tx, clientX: x, clientY: y };
			previewRef.current = {
				ox: st.pagesPoint.x,
				oy: st.pagesPoint.y,
				k: target / st.startScale,
				tx: x - st.pagesClient.x - st.pagesPoint.x,
				ty: y - st.pagesClient.y - st.pagesPoint.y,
			};
			schedulePreview();
		},
		[schedulePreview],
	);

	const commitPinch = useCallback(() => {
		const st = pinchRef.current;
		pinchRef.current = null;
		if (!st) {
			clearPreviewNow();
			return;
		}
		// A no-op or clamped scale still commits the transaction so the
		// finalizer clears the preview and re-anchors (audit PDF-01
		// step 5).
		desiredScaleRef.current = st.targetScale;
		setFitMode("none");
		setManualScale(st.targetScale);
		commitAnchor(st.tx);
	}, [clearPreviewNow, commitAnchor]);

	const cancelPinch = useCallback(() => {
		pinchRef.current = null;
		// Roll back to committed geometry without generating a tap.
		clearPreviewNow();
	}, [clearPreviewNow]);

	// --- tap handling: delayed chrome toggle, double-tap zoom ---
	const handleTap = useCallback(
		(x: number, y: number, double: boolean) => {
			if (double) {
				if (chromeToggleTimer.current !== null) {
					window.clearTimeout(chromeToggleTimer.current);
					chromeToggleTimer.current = null;
				}
				cycleZoomAt(x, y);
				return;
			}
			if (chromeToggleTimer.current !== null) {
				window.clearTimeout(chromeToggleTimer.current);
			}
			chromeToggleTimer.current = window.setTimeout(() => {
				chromeToggleTimer.current = null;
				chrome.toggleChrome();
			}, SINGLE_TAP_CHROME_MS);
		},
		[cycleZoomAt, chrome],
	);

	// --- gesture event dispatch ---
	const handleGestureEvent = useCallback(
		(e: GestureEvent) => {
			const el = scrollRef.current;
			if (!el) return;
			switch (e.type) {
				case "panStart":
					stopFling();
					break;
				case "pan":
					el.scrollLeft -= e.dx;
					el.scrollTop -= e.dy;
					break;
				case "panEnd":
					startFling(e.vx, e.vy);
					break;
				case "pinchStart":
					beginPinch(e.x, e.y);
					break;
				case "pinchMove":
					updatePinch(e.x, e.y, e.scale);
					break;
				case "pinchCommit":
					commitPinch();
					break;
				case "tap":
					handleTap(e.x, e.y, e.double);
					break;
				case "cancel":
					cancelPinch();
					break;
			}
		},
		[
			stopFling,
			startFling,
			beginPinch,
			updatePinch,
			commitPinch,
			handleTap,
			cancelPinch,
		],
	);
	gestureHandlersRef.current = handleGestureEvent;

	// Reset stale pointer/preview state when the document changes;
	// the doc dependency is the trigger, not a value the body reads.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		gestureRef.current?.reset();
		stopFling();
		clearPreviewNow();
		pinchRef.current = null;
		setPageErrors(new Set());
		rasterBytesRef.current = { bytes: 0, peak: 0 };
	}, [doc, stopFling, clearPreviewNow]);

	useEffect(
		() => () => {
			if (previewRafRef.current !== null) {
				cancelAnimationFrame(previewRafRef.current);
			}
			if (flingRafRef.current !== null) {
				cancelAnimationFrame(flingRafRef.current);
			}
			if (chromeToggleTimer.current !== null) {
				window.clearTimeout(chromeToggleTimer.current);
			}
		},
		[],
	);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			// Mouse keeps native selection/click behavior; touch and pen
			// go through the gesture controller (audit PDF-03 ownership).
			if (e.pointerType === "mouse") return;
			stopFling();
			e.currentTarget.setPointerCapture(e.pointerId);
			gestureRef.current?.down({
				pointerId: e.pointerId,
				x: e.clientX,
				y: e.clientY,
				t: e.timeStamp,
			});
		},
		[stopFling],
	);

	const onPointerMove = useCallback((e: React.PointerEvent) => {
		if (e.pointerType === "mouse") return;
		gestureRef.current?.move({
			pointerId: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			t: e.timeStamp,
		});
	}, []);

	const onPointerUp = useCallback((e: React.PointerEvent) => {
		if (e.pointerType === "mouse") return;
		gestureRef.current?.up({
			pointerId: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			t: e.timeStamp,
		});
	}, []);

	const onPointerCancel = useCallback((e: React.PointerEvent) => {
		if (e.pointerType === "mouse") return;
		gestureRef.current?.cancel(e.pointerId);
	}, []);

	const onLostPointerCapture = useCallback((e: React.PointerEvent) => {
		if (e.pointerType === "mouse") return;
		gestureRef.current?.cancel(e.pointerId);
	}, []);

	// Ctrl+wheel zooms through the same anchored transaction; ordinary
	// wheel stays native. Non-passive so the browser's page-zoom
	// default can be cancelled (audit PDF-03).
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey) return;
			e.preventDefault();
			zoomFactorAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.002));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			el.removeEventListener("wheel", onWheel);
		};
	}, [zoomFactorAt]);

	// --- position persistence (docs/14 audit PDF-06 + section 8): a
	// versioned v2 payload is written from committed refs, never a
	// stale event closure; writes stay suppressed until the initial
	// restoration finished; a pending write flushes on unmount and on
	// document hidden (background) instead of being dropped. ---
	const onPositionRef = useRef(onPosition);
	onPositionRef.current = onPosition;
	const rememberRef = useRef(settings["viewer.remember_position"]);
	rememberRef.current = settings["viewer.remember_position"];

	const snapshotPosition = useCallback((): FilePosition => {
		const anchor = lastStableAnchorRef.current;
		const mode = fitModeRef.current;
		const location = {
			pageIndex: currentPageRef.current,
			x: anchor?.x ?? 0,
			y: anchor?.y ?? 0,
			// The stable anchor is captured at the viewport center.
			viewportX: 0.5,
			viewportY: 0.5,
		};
		return {
			version: 2,
			kind: "pdf",
			location,
			// The v2 mode vocabulary has no "none": the absolute scale is
			// called manual (audit section 8).
			mode: mode === "none" ? "manual" : mode,
			scale: mode === "none" ? manualScaleRef.current : undefined,
			rotation: userRotationRef.current,
		};
	}, []);

	const flushPosition = useCallback(() => {
		if (!rememberRef.current || !restored.current) return;
		if (positionTimer.current !== null) {
			window.clearTimeout(positionTimer.current);
			positionTimer.current = null;
		}
		onPositionRef.current?.(snapshotPosition());
	}, [snapshotPosition]);

	const persistPositionSoon = useCallback(() => {
		if (!rememberRef.current || !restored.current) return;
		if (positionTimer.current !== null) {
			window.clearTimeout(positionTimer.current);
		}
		positionTimer.current = window.setTimeout(() => {
			positionTimer.current = null;
			onPositionRef.current?.(snapshotPosition());
		}, 500);
	}, [snapshotPosition]);

	// Flush on explicit close (unmount) and when the app is
	// backgrounded; both write the latest committed state and are
	// idempotent.
	useEffect(
		() => () => {
			if (positionTimer.current !== null) {
				flushPosition();
			}
		},
		[flushPosition],
	);

	useEffect(() => {
		const onHidden = () => {
			if (document.visibilityState === "hidden") flushPosition();
		};
		document.addEventListener("visibilitychange", onHidden);
		return () => {
			document.removeEventListener("visibilitychange", onHidden);
		};
	}, [flushPosition]);

	// --- restore position once geometry is known (audit PDF-06):
	// v2 payloads restore mode, scale, rotation, and the exact page
	// point through the same anchored-transaction finalizer used by
	// zoom; legacy payloads fall back to page top (zoom = manual) or
	// scroll ratio. Writes stay suppressed until this ran. ---
	useEffect(() => {
		if (!doc || restored.current || pageBoxes.length === 0) return;
		if (viewport.width <= 0 || pageBoxes[0].width < 50) return;
		restored.current = true;
		const pos = initialPositionRef.current;
		if (!pos || !settings["viewer.remember_position"]) {
			return;
		}
		const el = scrollRef.current;
		if (!el) return;

		if (isVersionedPosition(pos) && pos.kind === "pdf") {
			const pageIndex = Math.min(pos.location.pageIndex, doc.numPages - 1);
			setUserRotation(((pos.rotation % 360) + 360) % 360);
			if (pos.mode === "manual" && pos.scale) {
				const scale = clampManualScale(pos.scale, boundsRef.current);
				desiredScaleRef.current = scale;
				setManualScale(scale);
				setFitMode("none");
			} else if (pos.mode === "width" || pos.mode === "page") {
				setFitMode(pos.mode);
			}
			const srect = el.getBoundingClientRect();
			commitAnchor({
				pageNumber: pageIndex + 1,
				canonical: { x: pos.location.x, y: pos.location.y },
				clientX: srect.left + pos.location.viewportX * el.clientWidth,
				clientY: srect.top + pos.location.viewportY * el.clientHeight,
			});
			currentPageRef.current = pageIndex;
			setCurrentPage(pageIndex);
			return;
		}

		// Legacy fallback: a saved zoom means manual mode; page top when
		// only the page is reliable; ratio when no page exists.
		const legacy = pos as {
			page?: number;
			zoom?: number;
			scrollRatio?: number;
		};
		if (legacy.page !== undefined && legacy.page >= 0) {
			const target = Math.min(legacy.page, doc.numPages - 1);
			if (legacy.zoom && Number.isFinite(legacy.zoom) && legacy.zoom > 0) {
				const scale = clampManualScale(legacy.zoom, boundsRef.current);
				desiredScaleRef.current = scale;
				setManualScale(scale);
				setFitMode("none");
			}
			pageRefs.current.get(target + 1)?.scrollIntoView({ block: "start" });
			currentPageRef.current = target;
			setCurrentPage(target);
		} else if (legacy.scrollRatio) {
			el.scrollTop = legacy.scrollRatio * (el.scrollHeight - el.clientHeight);
		}
	}, [doc, pageBoxes, viewport.width, settings, commitAnchor]);

	// --- current page tracking (prefix geometry + binary search, one
	// rect read per frame for the stable anchor; audit PDF-08 item 9) ---
	const onScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el || pageTopsRef.current.length === 0) return;
		const centerY = el.scrollTop + el.clientHeight / 2;
		const pageNumber = pageAtContentY(centerY);
		if (pageNumber && pageNumber - 1 !== currentPageRef.current) {
			currentPageRef.current = pageNumber - 1;
			setCurrentPage(pageNumber - 1);
		}
		// Keep the stable anchor fresh, at most one rect read per frame;
		// skipped while a preview transform is applied.
		if (!previewRef.current && pageNumber) {
			const node = pageRefs.current.get(pageNumber);
			if (node) {
				const rect = node.getBoundingClientRect();
				if (rect.width > 0 && rect.height > 0) {
					const srect = el.getBoundingClientRect();
					const display = {
						x: (srect.left + el.clientWidth / 2 - rect.left) / rect.width,
						y: (srect.top + el.clientHeight / 2 - rect.top) / rect.height,
					};
					const canonical = displayToCanonical(
						display,
						totalRotationFor(pageNumber),
					);
					lastStableAnchorRef.current = { pageNumber, ...canonical };
				}
			}
		}
		persistPositionSoon();
	}, [pageAtContentY, totalRotationFor, persistPositionSoon]);

	const goToPage = useCallback(
		(pageNum: number) => {
			haptic(settings);
			stopFling();
			const el = pageRefs.current.get(pageNum);
			if (el) {
				el.scrollIntoView({ block: "start" });
				currentPageRef.current = pageNum - 1;
				setCurrentPage(pageNum - 1);
			}
		},
		[settings, stopFling],
	);
	goToPageRef.current = goToPage;

	// --- virtualized rendering with cancellation and a small
	// concurrency limit (audit PDF-07): render tasks are stored with
	// their owning generation so a stale completion can neither
	// delete a newer task's registry entry nor publish its canvas;
	// pages that fail show a recoverable Retry state; demand that
	// arrives while a cancelled task settles is re-enqueued in
	// `finally`. ---
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		if (!doc || pageBoxes.length === 0) return;
		const generation = ++renderGenerationRef.current;
		let cancelled = false;
		const inflight = new Set<number>();
		const queue: Array<{ pageNum: number; el: HTMLElement }> = [];
		const visiblePages = new Set<number>();
		let active = 0;

		const cancelAll = () => {
			for (const entry of renderTasks.current.values()) {
				entry.task.cancel();
			}
			renderTasks.current.clear();
			queue.length = 0;
		};

		const pump = () => {
			if (cancelled) return;
			while (active < RENDER_CONCURRENCY && queue.length > 0) {
				// Visible pages first, then their neighbors.
				queue.sort(
					(a, b) =>
						Number(visiblePages.has(b.pageNum)) -
						Number(visiblePages.has(a.pageNum)),
				);
				const next = queue.shift();
				if (!next) return;
				renderPage(next.pageNum, next.el);
			}
		};

		// Semantic layers per page (audit PDF-09): a selectable text
		// layer rendered by pdf.js's own TextLayer at CSS scale (not
		// the raster's DPR scale), plus read-only link annotations.
		// Both are separate children — a raster swap never erases them.
		const semanticCancels = new Map<number, () => void>();
		const attachSemanticLayers = async (
			pageNum: number,
			page: Awaited<ReturnType<PdfDocument["getPage"]>>,
			el: HTMLElement,
			cssScale: number,
		) => {
			semanticCancels.get(pageNum)?.();
			semanticCancels.delete(pageNum);
			let disposed = false;
			semanticCancels.set(pageNum, () => {
				disposed = true;
				textLayerRef?.cancel();
			});
			let textLayerRef: { cancel: () => void } | null = null;
			try {
				const pdfjs = await loadPdfjs();
				// CSS-space viewport: same rotation, raster-independent scale.
				const cssViewport = page.getViewport({
					scale: cssScale,
					rotation: totalRotationFor(pageNum),
				});
				// Links first (under the text layer's transparent spans).
				el.querySelector(".pw-link-layer")?.remove();
				const linkLayer = document.createElement("div");
				linkLayer.className = "pw-link-layer";
				const annotations = await page.getAnnotations();
				if (disposed) return;
				for (const a of annotations) {
					if (a.subtype !== "Link") continue;
					const rect = cssViewport.convertToViewportRectangle(
						a.rect as number[],
					);
					const left = Math.min(rect[0], rect[2]);
					const top = Math.min(rect[1], rect[3]);
					const width = Math.abs(rect[2] - rect[0]);
					const height = Math.abs(rect[3] - rect[1]);
					if (width < 2 || height < 2) continue;
					const box = document.createElement(a.url ? "a" : "button");
					box.className = "pw-link";
					box.style.left = `${left}px`;
					box.style.top = `${top}px`;
					box.style.width = `${width}px`;
					box.style.height = `${height}px`;
					if (a.url) {
						// External links: deliberate navigation, new context,
						// no referrer (audit PDF-09).
						(box as HTMLAnchorElement).href = a.url as string;
						(box as HTMLAnchorElement).target = "_blank";
						(box as HTMLAnchorElement).rel = "noopener noreferrer";
						box.setAttribute("aria-label", `Open link: ${String(a.url)}`);
					} else {
						box.setAttribute("aria-label", "Go to link target");
						box.addEventListener("click", (ev) => {
							ev.preventDefault();
							const dest = (a.dest ?? null) as unknown;
							void (async () => {
								try {
									if (Array.isArray(dest) && dest.length > 0) {
										const target =
											typeof dest[0] === "number"
												? dest[0]
												: await doc.getPageIndex(dest[0]);
										goToPageRef.current?.(target + 1);
									} else if (typeof dest === "string") {
										const explicit = await doc.getDestination(dest);
										if (Array.isArray(explicit) && explicit.length > 0) {
											const target =
												typeof explicit[0] === "number"
													? explicit[0]
													: await doc.getPageIndex(explicit[0]);
											goToPageRef.current?.(target + 1);
										}
									}
								} catch {
									// Unresolved destination: deliberately inert.
								}
							})();
						});
					}
					linkLayer.appendChild(box);
				}
				el.appendChild(linkLayer);
				// Selectable text layer.
				el.querySelector(".textLayer")?.remove();
				const textDiv = document.createElement("div");
				textDiv.className = "textLayer";
				const textContent = await page.getTextContent();
				if (disposed) return;
				const tl = new pdfjs.TextLayer({
					textContentSource: textContent,
					container: textDiv,
					viewport: cssViewport,
				});
				textLayerRef = tl;
				await tl.render();
				if (disposed) {
					textDiv.remove();
					return;
				}
				el.appendChild(textDiv);
			} catch {
				// Text/links are enhancements; a failure leaves the raster
				// readable. Cancelled runs are normal.
			}
		};

		const renderPage = async (pageNum: number, el: HTMLElement) => {
			if (inflight.has(pageNum)) return;
			inflight.add(pageNum);
			active++;
			let canvas: HTMLCanvasElement | null = null;
			try {
				const page = await doc.getPage(pageNum);
				if (cancelled || !visiblePages.has(pageNum)) return;
				const displayBox = pageBoxes[pageNum - 1] ?? pageBoxes[0];
				const outputScale = computeOutputScale(
					displayBox.width,
					displayBox.height,
					window.devicePixelRatio,
				);
				// Total rotation includes the page's intrinsic /Rotate so
				// the raster agrees with the placeholder box, the text
				// space, and the thumbnails (audit PDF-05).
				const renderViewport = page.getViewport({
					scale: displayBox.scale * outputScale,
					rotation: totalRotationFor(pageNum),
				});
				canvas = document.createElement("canvas");
				canvas.width = Math.max(1, Math.floor(renderViewport.width));
				canvas.height = Math.max(1, Math.floor(renderViewport.height));
				const ctx = canvas.getContext("2d");
				if (!ctx) return;
				const task = page.render({
					canvasContext: ctx,
					viewport: renderViewport,
				});
				// Registry entries are owned by the task that created
				// them: only the same task may delete its entry, so an
				// old completion cannot evict a newer render's slot.
				renderTasks.current.set(pageNum, { generation, task });
				await task.promise;
				const entry = renderTasks.current.get(pageNum);
				if (entry?.task === task) {
					renderTasks.current.delete(pageNum);
				}
				if (cancelled || !visiblePages.has(pageNum)) {
					// Superseded or left the margin: drop the raster, the
					// page will be re-rendered on demand.
					return;
				}
				// Replace only the raster child; semantic layers (text,
				// links, highlights) survive a raster swap (audit PDF-09).
				const previous = el.querySelector("canvas");
				if (previous) {
					releaseRaster(previous.width * previous.height * 4);
					el.replaceChild(canvas, previous);
				} else {
					el.replaceChildren(canvas);
				}
				retainRaster(canvas.width * canvas.height * 4);
				await attachSemanticLayers(pageNum, page, el, displayBox.scale);
			} catch (e) {
				const err = e as { name?: string };
				const cancelledRender =
					err?.name === "RenderingCancelledException" ||
					cancelled ||
					!visiblePages.has(pageNum);
				if (!cancelledRender) {
					// A real failure must be visible and recoverable, not
					// a permanently white page (audit PDF-07 item 4).
					setPageErrors((prev) => {
						if (prev.has(pageNum)) return prev;
						const next = new Set(prev);
						next.add(pageNum);
						return next;
					});
				}
			} finally {
				canvas = null;
				inflight.delete(pageNum);
				active--;
				pump();
				// Demand that arrived while this task was settling must
				// not be consumed silently: re-check and enqueue again.
				if (
					!cancelled &&
					visiblePages.has(pageNum) &&
					!renderTasks.current.has(pageNum) &&
					!queue.some((q) => q.pageNum === pageNum)
				) {
					const node = pageRefs.current.get(pageNum);
					if (node) {
						queue.push({ pageNum, el: node });
						pump();
					}
				}
			}
		};

		const enqueue = (pageNum: number, el: HTMLElement) => {
			if (!queue.some((q) => q.pageNum === pageNum)) {
				queue.push({ pageNum, el });
			}
			pump();
		};

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const pageNum = Number((entry.target as HTMLElement).dataset.page);
					if (entry.isIntersecting) {
						visiblePages.add(pageNum);
						setPageErrors((prev) => {
							if (!prev.has(pageNum)) return prev;
							const next = new Set(prev);
							next.delete(pageNum);
							return next;
						});
						enqueue(pageNum, entry.target as HTMLElement);
					} else {
						visiblePages.delete(pageNum);
						// Scanned PDFs have very large bitmaps. Releasing canvases
						// and cancelling queued work once pages leave the render
						// margin keeps memory and startup bounded.
						const registryEntry = renderTasks.current.get(pageNum);
						if (registryEntry) {
							registryEntry.task.cancel();
							renderTasks.current.delete(pageNum);
						}
						const qi = queue.findIndex((q) => q.pageNum === pageNum);
						if (qi !== -1) queue.splice(qi, 1);
						const rendered = entry.target.querySelector("canvas");
						if (rendered) {
							releaseRaster(rendered.width * rendered.height * 4);
						}
						entry.target.replaceChildren();
					}
				}
			},
			{ root: scrollRef.current, rootMargin: "600px 0px" },
		);

		pageRefs.current.forEach((el) => {
			observer.observe(el);
		});
		retryDemandRef.current = (pageNum: number) => {
			const node = pageRefs.current.get(pageNum);
			if (node) enqueue(pageNum, node);
		};

		return () => {
			cancelled = true;
			cancelAll();
			for (const cancel of semanticCancels.values()) cancel();
			semanticCancels.clear();
			observer.disconnect();
			retryDemandRef.current = null;
		};
	}, [doc, pageBoxes, totalRotationFor]);

	// Initialize the fit mode from settings once (manual zoom keeps an
	// absolute scale; the settings mode only picks the initial fit).
	useEffect(() => {
		if (fitModeInitialized) return;
		setFitModeInitialized(true);
		if (settingsMode === "fit_page") setFitMode("page");
		else if (settingsMode === "100") setFitMode("none");
		else setFitMode("width");
	}, [fitModeInitialized, settingsMode]);

	const outlineItems = (nodes: OutlineNode[], depth = 0): ReactNode =>
		nodes.map((node, i) => (
			<div key={`outline-${depth}-${node.title}-${i}`}>
				<OutlineButton
					$depth={depth}
					onClick={async () => {
						if (!doc) return;
						try {
							const dest: unknown =
								typeof node.dest === "string"
									? await doc.getDestination(node.dest)
									: node.dest;
							if (Array.isArray(dest) && dest.length > 0) {
								// A resolved destination may hold a numeric page
								// index directly or an object reference (audit
								// PDF-09).
								const pageIndex =
									typeof dest[0] === "number"
										? dest[0]
										: await doc.getPageIndex(dest[0] as never);
								goToPage(pageIndex + 1);
							}
						} catch {
							// Destination could not be resolved
						}
						setOutlineOpen(false);
					}}
				>
					{node.title}
				</OutlineButton>
				{node.items &&
					node.items.length > 0 &&
					outlineItems(node.items, depth + 1)}
			</div>
		));

	const progress = loadProgress;

	// Responsive action tiers (audit SH-01): seven 48px controls cannot
	// fit a 360px phone next to the filename, so zoom/fit live in the
	// tools sheet on narrow screens and only return to the row when the
	// measured shell width leaves real room for them. Budget per tier:
	// 5 buttons + chrome ≈ 288px (tier at 384), 7 buttons ≈ 392px
	// (tier at 560).
	const showZoomButtons = shellWidth >= 384;
	const showFitButtons = shellWidth >= 560;

	// Zoom controls disable at their actual bound in manual mode
	// (audit PDF-02); in fit mode they always convert to manual.
	const atMaxZoom = fitMode === "none" && manualScale >= bounds.max - 1e-9;
	const atMinZoom = fitMode === "none" && manualScale <= bounds.min + 1e-9;

	const thumbRatio = useCallback(
		(index: number) => {
			const meta = pageMetas[index] ?? pageMetas[0] ?? FALLBACK_PAGE;
			const swap = totalRotation(meta, userRotation) % 180 !== 0;
			const size = swap
				? { w: meta.height, h: meta.width }
				: { w: meta.width, h: meta.height };
			return size.w / size.h;
		},
		[pageMetas, userRotation],
	);

	return (
		<ViewerShell
			name={name}
			formatColor={formatCssVar("pdf").base}
			progress={progress}
			onClose={onClose}
			chromeAutohide={settings["viewer.chrome_autohide"]}
			contentTapTogglesChrome
			topActions={
				<>
					{showZoomButtons && (
						<IconButton
							label="Zoom out"
							onClick={() => stepZoom(-1)}
							disabled={atMinZoom}
							data-testid="pdf-zoom-out"
						>
							<ZoomOut size={20} />
						</IconButton>
					)}
					{showZoomButtons && (
						<IconButton
							label="Zoom in"
							onClick={() => stepZoom(1)}
							disabled={atMaxZoom}
							data-testid="pdf-zoom-in"
						>
							<ZoomIn size={20} />
						</IconButton>
					)}
					{showFitButtons && (
						<IconButton
							label="Fit width"
							onClick={() => setExplicitFit("width")}
						>
							<Maximize size={20} />
						</IconButton>
					)}
					{showFitButtons && (
						<IconButton label="Fit page" onClick={() => setExplicitFit("page")}>
							<Maximize2 size={20} />
						</IconButton>
					)}
					<IconButton
						label="Search"
						onClick={() => setSearchOpen(true)}
						data-testid="pdf-search"
					>
						<Search size={20} />
					</IconButton>
					<IconButton
						label="More PDF tools"
						onClick={() => setToolsOpen(true)}
						data-testid="pdf-more-tools"
					>
						<MoreVertical size={20} />
					</IconButton>
				</>
			}
			bottomBar={
				doc ? (
					<ReaderStatus>
						<StatusPill
							onClick={() => {
								const el = scrollRef.current;
								if (!el) return;
								const rect = el.getBoundingClientRect();
								cycleZoomAt(
									rect.left + rect.width / 2,
									rect.top + rect.height / 2,
								);
							}}
							aria-label="Change page fit"
							data-testid="pdf-fit-pill"
						>
							{fitMode === "width"
								? "Fit width"
								: fitMode === "page"
									? "Fit page"
									: `${Math.round(manualScale * 100)}%`}
						</StatusPill>
						<PagePill
							onClick={() => {
								setJumpValue(String(currentPage + 1));
								setJumpOpen(true);
							}}
							data-testid="pdf-page-pill"
						>
							{currentPage + 1} / {doc.numPages}
						</PagePill>
					</ReaderStatus>
				) : undefined
			}
		>
			<ScrollWrap
				ref={scrollRef}
				onScroll={onScroll}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerCancel}
				onLostPointerCapture={onLostPointerCapture}
				data-testid="pdf-scroll"
			>
				<Pages ref={pagesRef} $darken={darkenPages}>
					{doc &&
						Array.from({ length: doc.numPages }, (_, i) => (
							<PageBox
								key={`page-${i + 1}`}
								data-page={i + 1}
								ref={(el) => {
									if (el) pageRefs.current.set(i + 1, el);
									else pageRefs.current.delete(i + 1);
								}}
								$width={pageBoxes[i]?.width ?? 600}
								$height={pageBoxes[i]?.height ?? 800}
							>
								{pageErrors.has(i + 1) && (
									<PageError>
										<span>This page couldn't be rendered.</span>
										<RetryButton
											data-testid={`pdf-page-retry-${i + 1}`}
											onClick={() => {
												setPageErrors((prev) => {
													const next = new Set(prev);
													next.delete(i + 1);
													return next;
												});
												retryDemandRef.current?.(i + 1);
											}}
										>
											Retry
										</RetryButton>
									</PageError>
								)}
								{search && doc && (
									<PdfMatchLayer
										doc={doc}
										pageNum={i + 1}
										hits={search.hits
											.map((hit, index) => ({ hit, index }))
											.filter(({ hit }) => hit.page === i + 1)}
										activeIndex={search.activeIndex}
										scale={pageBoxes[i]?.scale ?? 1}
										rotation={totalRotationFor(i + 1)}
									/>
								)}
							</PageBox>
						))}
				</Pages>
			</ScrollWrap>

			<Sheet
				open={toolsOpen}
				title="PDF tools"
				id="pdf-tools"
				onDismiss={() => setToolsOpen(false)}
			>
				<ToolButton
					data-testid="pdf-tools-zoom-in"
					onClick={() => {
						stepZoom(1);
						setToolsOpen(false);
					}}
				>
					<ZoomIn size={20} /> Zoom in
				</ToolButton>
				<ToolButton
					data-testid="pdf-tools-zoom-out"
					onClick={() => {
						stepZoom(-1);
						setToolsOpen(false);
					}}
				>
					<ZoomOut size={20} /> Zoom out
				</ToolButton>
				<ToolButton
					data-testid="pdf-tools-fit-width"
					onClick={() => {
						setExplicitFit("width");
						setToolsOpen(false);
					}}
				>
					<Maximize size={20} /> Fit width
				</ToolButton>
				<ToolButton
					data-testid="pdf-tools-fit-page"
					onClick={() => {
						setExplicitFit("page");
						setToolsOpen(false);
					}}
				>
					<Maximize2 size={20} /> Fit page
				</ToolButton>
				<ToolButton
					data-testid="pdf-tools-pages"
					onClick={() => {
						setToolsOpen(false);
						setThumbsOpen(true);
					}}
				>
					<Grid3x3 size={20} /> Pages and thumbnails
				</ToolButton>
				<ToolButton
					disabled={!outline || outline.length === 0}
					onClick={() => {
						setToolsOpen(false);
						setOutlineOpen(true);
					}}
				>
					<List size={20} /> Document outline
				</ToolButton>
				<ToolButton
					onClick={() => {
						rotateClockwise();
						setToolsOpen(false);
					}}
				>
					<RotateCw size={20} /> Rotate clockwise
				</ToolButton>
			</Sheet>

			<Sheet
				open={outlineOpen}
				title="Outline"
				id="pdf-outline"
				onDismiss={() => setOutlineOpen(false)}
			>
				<ListPanel>
					{outline && outline.length > 0 ? (
						outlineItems(outline)
					) : (
						<PanelNote>
							No outline. This document doesn't include bookmarks.
						</PanelNote>
					)}
				</ListPanel>
			</Sheet>

			<Sheet
				open={thumbsOpen}
				title="Pages"
				id="pdf-thumbs"
				onDismiss={() => setThumbsOpen(false)}
			>
				<ThumbGrid data-testid="pdf-thumbs-grid">
					{doc &&
						Array.from({ length: doc.numPages }, (_, i) => (
							<Thumb
								key={`thumb-${i + 1}`}
								$current={i === currentPage}
								$ratio={thumbRatio(i)}
								onClick={() => {
									goToPage(i + 1);
									setThumbsOpen(false);
								}}
							>
								<ThumbPage
									doc={doc}
									pageNum={i + 1}
									rotation={totalRotationFor(i + 1)}
								/>
							</Thumb>
						))}
				</ThumbGrid>
			</Sheet>

			<PdfSearchSheet
				open={searchOpen}
				doc={doc}
				onDismiss={() => setSearchOpen(false)}
				onNavigateToMatches={(hits, activeIndex) => {
					setSearch({ hits, activeIndex });
					setSearchOpen(false);
					const hit = hits[activeIndex];
					if (hit) goToPage(hit.page);
				}}
			/>

			{search && search.hits.length > 0 && (
				<SearchNav data-testid="pdf-search-nav">
					<SearchNavButton
						aria-label="Previous match"
						data-testid="pdf-search-prev"
						onClick={() => {
							const next =
								(search.activeIndex - 1 + search.hits.length) %
								search.hits.length;
							setSearch({ ...search, activeIndex: next });
							goToPage(search.hits[next].page);
						}}
					>
						‹
					</SearchNavButton>
					<span aria-live="polite">
						{search.activeIndex + 1} / {search.hits.length}
					</span>
					<SearchNavButton
						aria-label="Next match"
						data-testid="pdf-search-next"
						onClick={() => {
							const next = (search.activeIndex + 1) % search.hits.length;
							setSearch({ ...search, activeIndex: next });
							goToPage(search.hits[next].page);
						}}
					>
						›
					</SearchNavButton>
					<SearchNavButton
						aria-label="Clear search"
						data-testid="pdf-search-clear"
						onClick={() => setSearch(null)}
					>
						×
					</SearchNavButton>
				</SearchNav>
			)}

			<Sheet
				open={jumpOpen}
				title="Go to page"
				id="pdf-jump"
				onDismiss={() => setJumpOpen(false)}
			>
				<TextField
					label="Page number"
					value={jumpValue}
					onChange={setJumpValue}
					placeholder={`1 to ${doc?.numPages ?? 1}`}
					inputMode="numeric"
					autoFocus
				/>
				<Button
					onClick={() => {
						const n = Number.parseInt(jumpValue, 10);
						if (doc && n >= 1 && n <= doc.numPages) {
							goToPage(n);
							setJumpOpen(false);
							setJumpValue("");
						}
					}}
					disabled={jumpValue.trim().length === 0}
				>
					Go
				</Button>
			</Sheet>

			<Dialog
				open={passwordOpen}
				title="This PDF is password-protected"
				onDismiss={() => {
					setPasswordOpen(false);
					setPasswordError(null);
					onClose();
				}}
				actions={
					<>
						<Button variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button onClick={unlock} disabled={password.length === 0}>
							Unlock
						</Button>
					</>
				}
			>
				<TextField
					label="Password"
					type="password"
					value={password}
					onChange={setPassword}
					errorText={passwordError ?? undefined}
					autoFocus
				/>
			</Dialog>

			{openError && (
				<Dialog
					open
					title="Can't open this file"
					onDismiss={onClose}
					actions={<Button onClick={onClose}>OK</Button>}
				>
					The file seems to be damaged or isn't a valid PDF. It may not have
					downloaded completely.
				</Dialog>
			)}
		</ViewerShell>
	);
}

/** Bounded concurrency for thumbnail rasters (audit PDF-08 item 10):
 * opening the Pages sheet on a huge document must not queue hundreds
 * of renders against the same engine as the reader. */
const THUMB_CONCURRENCY = 2;
const thumbQueue: Array<() => void> = [];
let thumbActive = 0;

async function acquireThumbSlot(): Promise<() => void> {
	return new Promise((resolve) => {
		const start = () => {
			thumbActive++;
			resolve(() => {
				thumbActive = Math.max(0, thumbActive - 1);
				const next = thumbQueue.shift();
				next?.();
			});
		};
		if (thumbActive < THUMB_CONCURRENCY) start();
		else thumbQueue.push(start);
	});
}

function ThumbPage({
	doc,
	pageNum,
	rotation,
}: {
	doc: PdfDocument;
	pageNum: number;
	rotation: number;
}) {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		let task: RenderTaskLike | null = null;
		const el = ref.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries.some((entry) => entry.isIntersecting);
				if (!visible) {
					// Retention window: a tile that scrolls out releases its
					// raster and cancels pending work; it re-renders on
					// re-entry (audit PDF-08 item 10).
					if (task) {
						task.cancel();
						task = null;
					}
					const canvas = el.querySelector("canvas");
					if (canvas) el.replaceChildren();
					return;
				}
				if (task || el.querySelector("canvas")) return;
				doc
					.getPage(pageNum)
					.then(async (page) => {
						if (cancelled) return;
						// Same total rotation as the reader: thumbnails match
						// the displayed orientation and aspect (audit PDF-05).
						const viewport = page.getViewport({ scale: 0.25, rotation });
						const canvas = document.createElement("canvas");
						canvas.width = Math.max(1, Math.floor(viewport.width));
						canvas.height = Math.max(1, Math.floor(viewport.height));
						const ctx = canvas.getContext("2d");
						if (!ctx) return;
						const release = await acquireThumbSlot();
						try {
							if (cancelled) return;
							task = page.render({ canvasContext: ctx, viewport });
							await task.promise;
							if (!cancelled && ref.current) {
								ref.current.replaceChildren(canvas);
							}
						} finally {
							release();
							task = null;
						}
					})
					.catch(() => {});
			},
			{ rootMargin: "240px" },
		);
		observer.observe(el);
		return () => {
			cancelled = true;
			observer.disconnect();
			// Cancel a thumbnail render when its tile leaves range or the
			// sheet closes (audit 11.5); its slot releases in the render
			// path's finally block.
			task?.cancel();
		};
	}, [doc, pageNum, rotation]);

	return (
		<div
			ref={ref}
			style={{ width: "100%", height: "100%" }}
			role="img"
			aria-label={`Page ${pageNum}`}
		/>
	);
}

/* Recoverable per-page render failure (audit PDF-07 item 4): a
   lightweight overlay instead of a permanently white page. */
const PageError = styled.div`
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	background: var(--surface);
	color: var(--ink-2);
	font-size: 0.8125rem;
	text-align: center;
	padding: 16px;
`;

const RetryButton = styled.button`
	border: 1px solid var(--border);
	border-radius: 999px;
	background: var(--surface-2);
	color: var(--ink-1);
	padding: 8px 18px;
	font: inherit;
	font-weight: 600;
	cursor: pointer;

	&:hover {
		background: var(--surface-3);
	}
`;

/** Where one hit lands on its page: CSS px within the page box for
 * the current display scale and total rotation. Positions are
 * proportional approximations of character advances inside a text
 * item (pdf.js reports the item box, not per-glyph metrics). */
interface MatchRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Search-highlight overlay tied to exactly the page's display
 * viewport (audit PDF-09). Computed from the page's text content and
 * the same total rotation as the raster, so highlights agree with
 * what is on screen. */
function PdfMatchLayer({
	doc,
	pageNum,
	hits,
	activeIndex,
	scale,
	rotation,
}: {
	doc: PdfDocument;
	pageNum: number;
	hits: Array<{ hit: SearchHit; index: number }>;
	activeIndex: number;
	scale: number;
	rotation: number;
}) {
	const [rects, setRects] = useState<MatchRect[] | null>(null);
	const activeRef = useRef<HTMLDivElement | null>(null);
	const activeKey =
		hits.find(({ index }) => index === activeIndex)?.index ?? -1;

	useEffect(() => {
		let cancelled = false;
		setRects(null);
		const run = async () => {
			try {
				const pdfjs = await loadPdfjs();
				const page = await doc.getPage(pageNum);
				const viewport = page.getViewport({ scale, rotation });
				const content = await page.getTextContent();
				if (cancelled) return;
				const computed: MatchRect[] = [];
				for (const { hit } of hits) {
					const item = content.items[hit.itemIndex];
					if (!item || !("str" in item)) continue;
					const str = item.str;
					if (str.length === 0) continue;
					const m = pdfjs.Util.transform(viewport.transform, item.transform);
					// Text direction and glyph height in viewport space.
					const dirLen = Math.hypot(m[0], m[1]) || 1;
					const dir = { x: m[0] / dirLen, y: m[1] / dirLen };
					const fontHeight = Math.hypot(m[2], m[3]) || 10;
					const charAdvance = (item.width * viewport.scale) / str.length;
					const startAdvance = hit.startInItem * charAdvance;
					const endAdvance = (hit.startInItem + hit.length) * charAdvance;
					const origin = { x: m[4], y: m[5] };
					const start = {
						x: origin.x + dir.x * startAdvance,
						y: origin.y + dir.y * startAdvance,
					};
					const end = {
						x: origin.x + dir.x * endAdvance,
						y: origin.y + dir.y * endAdvance,
					};
					// Perpendicular "up" from the baseline.
					const pad = fontHeight * 0.85;
					const minX = Math.min(start.x, end.x);
					const maxX = Math.max(start.x, end.x);
					const top = Math.min(start.y, end.y) - pad;
					computed.push({
						left: minX,
						top,
						width: Math.max(2, maxX - minX),
						height: fontHeight,
					});
				}
				setRects(computed);
			} catch {
				// Highlight geometry is an enhancement; search navigation
				// still works without it.
			}
		};
		run();
		return () => {
			cancelled = true;
		};
	}, [doc, pageNum, hits, scale, rotation]);

	// Focus the actual match: the active highlight scrolls to center
	// whenever the active hit changes (audit PDF-09).
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		if (activeKey === -1) return;
		activeRef.current?.scrollIntoView({ block: "center" });
	}, [activeKey, rects]);

	const activeOnPage = hits.findIndex(({ index }) => index === activeIndex);

	return (
		<MatchLayer data-testid={`pdf-matches-${pageNum}`}>
			{(rects ?? []).map((rect, i) => {
				const isActive = i === activeOnPage;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: hit rects are positional and the list is immutable per render
						key={`match-${i}`}
						ref={isActive ? activeRef : undefined}
						data-active={isActive || undefined}
						className={`pw-match${isActive ? " pw-match-active" : ""}`}
						style={{
							left: rect.left,
							top: rect.top,
							width: rect.width,
							height: rect.height,
						}}
					/>
				);
			})}
		</MatchLayer>
	);
}

const MatchLayer = styled.div`
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 2;
`;

const SearchNav = styled.div`
	position: absolute;
	left: 50%;
	transform: translateX(-50%);
	bottom: calc(var(--viewer-bottom-height, 0px) + var(--viewer-bottom-reserve, 0px) + 12px);
	z-index: 30;
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 8px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--ink-1) 85%, transparent);
	color: var(--bg);
	font-size: 0.8125rem;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	backdrop-filter: blur(6px);
`;

const SearchNavButton = styled.button`
	border: none;
	background: transparent;
	color: var(--bg);
	width: 40px;
	height: 40px;
	border-radius: 999px;
	font-size: 1.25rem;
	line-height: 1;
	cursor: pointer;

	&:hover {
		background: color-mix(in srgb, var(--bg) 20%, transparent);
	}
`;

const ReaderStatus = styled.div`
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	/* The shell bottom bar owns the safe-area padding; do not add it
   twice (audit SH-03). */
	padding: 8px 12px;
`;

const StatusPill = styled.button`
	padding: 8px 14px;
	border: 1px solid color-mix(in srgb, var(--ink-1) 18%, transparent);
	border-radius: 999px;
	background: color-mix(in srgb, var(--surface) 94%, transparent);
	color: var(--ink-1);
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
	backdrop-filter: blur(6px);
`;

/* Quiet page indicator, tappable to jump. */
const PagePill = styled.button`
	padding: 8px 18px;
	border: none;
	border-radius: 999px;
	background: color-mix(in srgb, var(--ink-1) 85%, transparent);
	color: var(--bg);
	font-size: 0.8125rem;
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
	backdrop-filter: blur(6px);
	transition: transform 100ms cubic-bezier(0.2, 0, 0, 1);
	user-select: none;
	-webkit-user-select: none;

	&:active {
		transform: scale(0.95);
	}
`;
