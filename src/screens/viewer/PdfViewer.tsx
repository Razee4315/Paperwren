import { formatCssVar } from "@/components/FormatBadge";
import { Button, Dialog, IconButton, Sheet, TextField } from "@/components/ui";
import {
	type FitMode,
	type ZoomAnchor,
	buildZoomAnchor,
	clampZoom,
	computeAnchoredScroll,
	computeOutputScale,
	computePageDisplayBox,
	nextFitMode,
	stepZoom as stepZoomClamped,
} from "@/lib/pdfLayout";
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
import { ViewerShell } from "./ViewerShell";

/**
 * SCR-07 PDF viewer (docs/07 section 2): continuous vertical
 * scroll, virtualized page rendering, zoom controls, page
 * scrubber, outline, thumbnails, password unlock, position
 * memory, dark reading. Engine: pdf.js.
 *
 * Zoom is anchored to a page-local point (audit section 6): every
 * zoom entry point (pinch, wheel, buttons, double-tap) captures an
 * anchor before changing geometry and restores the scroll so the
 * anchored point stays under the same client coordinate. Pages are
 * laid out in a max-content wrapper so zoomed-in pages never leave
 * their left edge in unreachable negative overflow (audit 7).
 */

import { PdfSearchSheet } from "./PdfSearchSheet";
import type { OutlineNode, PdfDocument, RenderTaskLike } from "./pdfTypes";

async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist");
	pdfjs.GlobalWorkerOptions.workerSrc = new URL(
		"pdfjs-dist/build/pdf.worker.min.mjs",
		import.meta.url,
	).toString();
	return pdfjs;
}

const ScrollWrap = styled.div`
	position: absolute;
	inset: 0;
	overflow: auto;
	padding: 8px;
	/* The first page must start below the toolbar and the last page
	   must clear the bottom bar (audit section 8). */
	padding-top: calc(var(--viewer-top-height, 56px) + 8px);
	padding-bottom: calc(var(--viewer-bottom-height, 0px) + 16px);
	scroll-padding-top: calc(var(--viewer-top-height, 56px) + 12px);
	scroll-padding-bottom: calc(var(--viewer-bottom-height, 0px) + 12px);
	background: var(--bg);
	/* Pans stay native; two-finger pinch comes to JS as pointer
	   events so the document re-renders crisply at the new zoom
	   instead of the browser scaling the whole app. */
	touch-action: pan-x pan-y;
	overscroll-behavior: contain;
	scrollbar-gutter: stable;
	direction: ltr;
`;

/* max-content wrapper (audit section 7): when a page is wider than
   the scroller the wrapper grows so scrollLeft 0 is the true left
   edge; when pages are narrower, min-width 100% + auto margins
   center them. Flex centering of an overflowing child is what made
   the left side unreachable. */
const Pages = styled.div<{ $darken: boolean }>`
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 8px;
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

/* Sized from real page geometry, not a fixed 0.707: landscape and
   non-A-series pages must not be stretched (audit 11.5). */
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

export function PdfViewer({
	data,
	name,
	initialPosition,
	onPosition,
	onClose,
	darkenPages,
}: {
	data: ArrayBuffer;
	name: string;
	initialPosition?: FilePosition;
	onPosition?: (pos: FilePosition) => void;
	onClose: () => void;
	darkenPages: boolean;
}) {
	const { settings } = useSettings();

	const [doc, setDoc] = useState<PdfDocument | null>(null);
	const [loadProgress, setLoadProgress] = useState<number | null>(0);
	const [openError, setOpenError] = useState(false);
	const [currentPage, setCurrentPage] = useState(initialPosition?.page ?? 0);
	const [zoom, setZoom] = useState(
		settings["viewer.remember_position"]
			? clampZoom(initialPosition?.zoom ?? 1)
			: 1,
	);
	const settingsMode = settings["viewer.zoom_mode_pdf"];
	const [fitMode, setFitMode] = useState<FitMode>(
		settingsMode === "fit_page"
			? "page"
			: settingsMode === "100"
				? "none"
				: "width",
	);
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
	const [rotation, setRotation] = useState(0);
	const [pageSizes, setPageSizes] = useState<
		Array<{ width: number; height: number }>
	>([]);
	const [viewport, setViewport] = useState({ w: 0, h: 0 });

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const pagesRef = useRef<HTMLDivElement | null>(null);
	const pageRefs = useRef(new Map<number, HTMLDivElement>());
	const dataRef = useRef(data);
	const positionTimer = useRef<number | null>(null);
	const restored = useRef(false);
	const renderTasks = useRef(new Map<number, RenderTaskLike>());

	// Track the scroll container so geometry follows window resizes.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const update = () =>
			setViewport({ w: el.clientWidth - 16, h: el.clientHeight - 16 });
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// --- document loading, with password retry ---
	const load = useCallback(async (dataSource: ArrayBuffer, pwd?: string) => {
		setLoadProgress(0.05);
		try {
			const pdfjs = await loadPdfjs();
			// pdf.js takes ownership of the buffer it is handed; passing
			// the stored buffer directly avoids the extra full-file copy
			// (audit 10.2: transfer/own one buffer only). The caller
			// keeps no other reference to the same ArrayBuffer.
			const task = pdfjs.getDocument({
				data: dataSource,
				password: pwd,
			});
			task.onProgress = (p: { loaded: number; total: number }) => {
				if (p.total > 0) {
					setLoadProgress(Math.max(0.05, p.loaded / p.total));
				}
			};
			const pdf = await task.promise;
			setDoc(pdf);
			setLoadProgress(null);
			pdf
				.getOutline()
				.then((o) => setOutline(o as unknown as OutlineNode[]))
				.catch(() => setOutline([]));
		} catch (e) {
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
		load(dataRef.current, password);
	}, [load, password]);

	// Read each page's own media box. Using page 1 for every placeholder
	// breaks mixed portrait/landscape and differently cropped documents.
	useEffect(() => {
		if (!doc) return;
		let cancelled = false;
		const readSizes = async () => {
			try {
				const firstPage = await doc.getPage(1);
				const firstViewport = firstPage.getViewport({ scale: 1 });
				const sizes = [
					{ width: firstViewport.width, height: firstViewport.height },
				];
				if (!cancelled) setPageSizes(sizes);
				// Limit metadata concurrency so a thousand-page scan does not
				// queue ahead of rendering the page the reader can actually see.
				for (let start = 2; start <= doc.numPages; start += 12) {
					const end = Math.min(doc.numPages, start + 11);
					const batch = await Promise.all(
						Array.from({ length: end - start + 1 }, async (_, offset) => {
							const page = await doc.getPage(start + offset);
							const vp = page.getViewport({ scale: 1 });
							return { width: vp.width, height: vp.height };
						}),
					);
					sizes.push(...batch);
					if (cancelled) return;
				}
				if (!cancelled) setPageSizes(sizes);
			} catch {
				// Individual pages still render with the safe fallback box.
			}
		};
		readSizes();
		return () => {
			cancelled = true;
		};
	}, [doc]);

	const pageBoxes = useMemo(() => {
		if (!doc || viewport.w <= 0) return [];
		const fallback = pageSizes[0] ?? { width: 612, height: 792 };
		return Array.from({ length: doc.numPages }, (_, index) => {
			const size = pageSizes[index] ?? fallback;
			const sideways = rotation % 180 !== 0;
			return computePageDisplayBox({
				pageWidth: sideways ? size.height : size.width,
				pageHeight: sideways ? size.width : size.height,
				containerWidth: viewport.w,
				containerHeight: viewport.h || window.innerHeight - 24,
				fitMode,
				zoom,
			});
		});
	}, [doc, fitMode, pageSizes, rotation, viewport, zoom]);
	const firstBox = pageBoxes[0] ?? { width: 600, height: 800, scale: 1 };

	// --- virtualized rendering with cancellation and a small
	// concurrency limit (audit 10.2): stale renders are cancelled
	// when zoom/rotation changes, unmounts, or pages leave range. ---
	useEffect(() => {
		if (!doc || pageBoxes.length === 0) return;
		let cancelled = false;
		const inflight = new Set<number>();
		const queue: Array<{ pageNum: number; el: HTMLElement }> = [];
		const visiblePages = new Set<number>();
		let active = 0;

		const cancelAll = () => {
			for (const task of renderTasks.current.values()) {
				task.cancel();
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

		const renderPage = async (pageNum: number, el: HTMLElement) => {
			if (inflight.has(pageNum)) return;
			inflight.add(pageNum);
			active++;
			try {
				const page = await doc.getPage(pageNum);
				if (cancelled || !visiblePages.has(pageNum)) return;
				const displayBox = pageBoxes[pageNum - 1] ?? firstBox;
				const outputScale = computeOutputScale(
					displayBox.width,
					displayBox.height,
					window.devicePixelRatio,
				);
				const renderViewport = page.getViewport({
					scale: displayBox.scale * outputScale,
					rotation,
				});
				const canvas = document.createElement("canvas");
				canvas.width = Math.max(1, Math.floor(renderViewport.width));
				canvas.height = Math.max(1, Math.floor(renderViewport.height));
				const ctx = canvas.getContext("2d");
				if (!ctx) return;
				const task = page.render({
					canvasContext: ctx,
					viewport: renderViewport,
				});
				renderTasks.current.set(pageNum, task);
				await task.promise;
				renderTasks.current.delete(pageNum);
				if (cancelled || !visiblePages.has(pageNum)) return;
				el.replaceChildren(canvas);
			} catch {
				// cancelled or failed; the observer retries when visible
			} finally {
				inflight.delete(pageNum);
				active--;
				pump();
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
						enqueue(pageNum, entry.target as HTMLElement);
					} else {
						visiblePages.delete(pageNum);
						// Scanned PDFs have very large bitmaps. Releasing canvases
						// and cancelling queued work once pages leave the render
						// margin keeps memory and startup bounded.
						const task = renderTasks.current.get(pageNum);
						if (task) {
							task.cancel();
							renderTasks.current.delete(pageNum);
						}
						const qi = queue.findIndex((q) => q.pageNum === pageNum);
						if (qi !== -1) queue.splice(qi, 1);
						entry.target.replaceChildren();
					}
				}
			},
			{ root: scrollRef.current, rootMargin: "600px 0px" },
		);

		pageRefs.current.forEach((el) => {
			observer.observe(el);
		});

		return () => {
			cancelled = true;
			cancelAll();
			observer.disconnect();
		};
	}, [doc, firstBox, pageBoxes, rotation]);

	// --- focal anchor capture and restore (audit section 6.2) ---
	const anchorRef = useRef<ZoomAnchor | null>(null);

	const captureAnchor = useCallback((clientX: number, clientY: number) => {
		const el = scrollRef.current;
		if (!el) return;
		const scrollerRect = el.getBoundingClientRect();
		const pageRects = new Map<
			number,
			{ left: number; top: number; width: number; height: number }
		>();
		pageRefs.current.forEach((node, pageNum) => {
			pageRects.set(pageNum, node.getBoundingClientRect());
		});
		anchorRef.current = buildZoomAnchor({
			pageRects,
			scrollerRect: { left: scrollerRect.left, top: scrollerRect.top },
			clientX,
			clientY,
		});
	}, []);

	// After the new geometry commits, put the anchored page-local
	// point back under its saved client coordinate, then clear the
	// pinch preview transform in the same pre-paint pass so there is
	// no one-frame jump.
	useLayoutEffect(() => {
		const el = scrollRef.current;
		const anchor = anchorRef.current;
		if (!el || !anchor) return;
		const node = pageRefs.current.get(anchor.pageNumber);
		if (!node) {
			anchorRef.current = null;
			return;
		}
		anchorRef.current = null;
		const scrollerRect = el.getBoundingClientRect();
		const { left, top } = computeAnchoredScroll({
			anchor,
			pageRect: node.getBoundingClientRect(),
			scrollerRect: { left: scrollerRect.left, top: scrollerRect.top },
			scrollLeft: el.scrollLeft,
			scrollTop: el.scrollTop,
			clientWidth: el.clientWidth,
			clientHeight: el.clientHeight,
			scrollWidth: el.scrollWidth,
			scrollHeight: el.scrollHeight,
		});
		el.scrollLeft = left;
		el.scrollTop = top;
		if (pagesRef.current) pagesRef.current.style.transform = "";
	}, [zoom, fitMode, rotation, viewport, pageSizes]);

	/** Effective multiplier of the current fit base, so switching to
	 * manual zoom continues from what is on screen. */
	const effectiveZoom = useCallback(() => {
		const size = pageSizes[0] ?? { width: 612, height: 792 };
		const sideways = rotation % 180 !== 0;
		const pw = sideways ? size.height : size.width;
		const ph = sideways ? size.width : size.height;
		const cw = viewport.w || 600;
		const ch = viewport.h || 800;
		let base = 1;
		if (fitMode === "width") base = Math.min(cw / pw, 760 / pw);
		else if (fitMode === "page") base = Math.min(cw / pw, ch / ph);
		return clampZoom(base * zoom);
	}, [fitMode, pageSizes, rotation, viewport, zoom]);

	const persistPositionSoon = useCallback(() => {
		if (!settings["viewer.remember_position"]) return;
		if (positionTimer.current !== null) {
			window.clearTimeout(positionTimer.current);
		}
		const el = scrollRef.current;
		positionTimer.current = window.setTimeout(() => {
			positionTimer.current = null;
			onPosition?.({
				page: currentPage,
				zoom: fitMode === "none" ? zoom : undefined,
				scrollRatio: el
					? el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)
					: undefined,
			});
		}, 500);
	}, [settings, onPosition, currentPage, zoom, fitMode]);

	useEffect(
		() => () => {
			if (positionTimer.current !== null) {
				window.clearTimeout(positionTimer.current);
			}
		},
		[],
	);

	// --- restore position once geometry is known; the restored page
	// is clamped to the document that actually loaded ---
	useEffect(() => {
		if (!doc || restored.current || firstBox.width < 50) return;
		restored.current = true;
		if (
			!initialPosition ||
			firstBox.width < 50 ||
			!settings["viewer.remember_position"]
		) {
			return;
		}
		const el = scrollRef.current;
		if (!el) return;
		if (initialPosition.page !== undefined && initialPosition.page >= 0) {
			const target = Math.min(initialPosition.page, doc.numPages - 1);
			pageRefs.current.get(target + 1)?.scrollIntoView({ block: "start" });
			setCurrentPage(target);
		} else if (initialPosition.scrollRatio) {
			el.scrollTop =
				initialPosition.scrollRatio * (el.scrollHeight - el.clientHeight);
		}
	}, [doc, firstBox.width, initialPosition, settings]);

	// --- current page tracking (by visible area in the scroller,
	// not window.innerHeight) + position memory ---
	const onScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el || !doc) return;
		const scrollerRect = el.getBoundingClientRect();
		let best = 0;
		let bestArea = -1;
		pageRefs.current.forEach((node, pageNum) => {
			const rect = node.getBoundingClientRect();
			const overlapTop = Math.max(rect.top, scrollerRect.top);
			const overlapBottom = Math.min(rect.bottom, scrollerRect.bottom);
			const area =
				overlapBottom > overlapTop
					? (overlapBottom - overlapTop) * Math.min(rect.width, el.clientWidth)
					: 0;
			if (area > bestArea) {
				bestArea = area;
				best = pageNum - 1;
			}
		});
		setCurrentPage(best);
		persistPositionSoon();
	}, [doc, persistPositionSoon]);

	const goToPage = useCallback(
		(pageNum: number) => {
			haptic(settings);
			const el = pageRefs.current.get(pageNum);
			if (el) {
				el.scrollIntoView({ block: "start" });
				setCurrentPage(pageNum - 1);
			}
		},
		[settings],
	);

	// --- zoom controls, all through the same anchor transaction ---
	const stepZoom = useCallback(
		(direction: 1 | -1) => {
			haptic(settings);
			const el = scrollRef.current;
			if (!el) return;
			const rect = el.getBoundingClientRect();
			captureAnchor(rect.left + rect.width / 2, rect.top + rect.height / 2);
			const manual = effectiveZoom();
			setFitMode("none");
			setZoom((z) => {
				const base = fitMode === "none" ? z : manual;
				return stepZoomClamped(base, direction);
			});
			persistPositionSoon();
		},
		[settings, captureAnchor, effectiveZoom, fitMode, persistPositionSoon],
	);

	/** Double-tap and toolbar fit actions: cycle fit mode anchored at
	 * the tap point instead of jumping to page top. */
	const cycleZoomAt = useCallback(
		(clientX: number, clientY: number) => {
			haptic(settings);
			captureAnchor(clientX, clientY);
			const next = nextFitMode(fitMode);
			if (fitMode === "none") {
				// manual -> fit: reset the multiplier so the fit is honest.
				setZoom(1);
			}
			setFitMode(next);
			persistPositionSoon();
		},
		[settings, captureAnchor, fitMode, persistPositionSoon],
	);

	const setExplicitFit = useCallback(
		(mode: FitMode) => {
			haptic(settings);
			const el = scrollRef.current;
			if (el) {
				const rect = el.getBoundingClientRect();
				captureAnchor(rect.left + rect.width / 2, rect.top + rect.height / 2);
			}
			if (fitMode === "none" && mode !== "none") setZoom(1);
			setFitMode(mode);
			persistPositionSoon();
		},
		[settings, captureAnchor, fitMode, persistPositionSoon],
	);

	// --- pinch to zoom: two pointers scale the document around the
	// pinch midpoint; pans stay native via touch-action ---
	const pointers = useRef(new Map<number, [number, number]>());
	const pinchRef = useRef<{
		baseDist: number;
		startZoom: number;
		startFit: FitMode;
		previewZoom: number;
	} | null>(null);
	const previewOriginSet = useRef(false);
	const lastMidpoint = useRef<{ x: number; y: number } | null>(null);

	const pointerDistance = useCallback(() => {
		const [a, b] = [...pointers.current.values()];
		return Math.hypot(a[0] - b[0], a[1] - b[1]);
	}, []);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			e.currentTarget.setPointerCapture(e.pointerId);
			pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
			if (pointers.current.size === 2) {
				pinchRef.current = {
					baseDist: pointerDistance(),
					startZoom: effectiveZoom(),
					startFit: fitMode,
					previewZoom: effectiveZoom(),
				};
				previewOriginSet.current = false;
			}
		},
		[pointerDistance, effectiveZoom, fitMode],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!pointers.current.has(e.pointerId)) return;
			pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
			if (pointers.current.size !== 2 || !pinchRef.current) return;
			e.preventDefault();
			const pages = pagesRef.current;
			if (!pages) return;
			const [a, b] = [...pointers.current.values()];
			const midX = (a[0] + b[0]) / 2;
			const midY = (a[1] + b[1]) / 2;
			lastMidpoint.current = { x: midX, y: midY };
			const next = clampZoom(
				pinchRef.current.startZoom *
					(pointerDistance() / Math.max(1, pinchRef.current.baseDist)),
			);
			pinchRef.current.previewZoom = next;
			// Preview with a cheap transform and render sharply only once
			// the fingers lift. The preview scales around the pinch
			// midpoint, not top-center (audit 6.1).
			if (!previewOriginSet.current) {
				previewOriginSet.current = true;
				const rect = pages.getBoundingClientRect();
				pages.style.transformOrigin = `${midX - rect.left}px ${midY - rect.top}px`;
			}
			pages.style.transform = `scale(${next / pinchRef.current.startZoom})`;
		},
		[pointerDistance],
	);

	// Double-tap detection with pointer timing/movement thresholds
	// (audit 6.1: mouse dblclick is not a mobile gesture).
	const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);

	const onPointerUp = useCallback(
		(e: React.PointerEvent) => {
			const completedPinch = pinchRef.current;
			if (e.currentTarget.hasPointerCapture(e.pointerId)) {
				e.currentTarget.releasePointerCapture(e.pointerId);
			}
			pointers.current.delete(e.pointerId);
			if (pointers.current.size < 2 && completedPinch) {
				pinchRef.current = null;
				// Keep the preview transform until the sharp layout is
				// committed and the anchored scroll applied; the layout
				// effect clears it pre-paint, so no one-frame flash.
				const mid = lastMidpoint.current ?? { x: e.clientX, y: e.clientY };
				captureAnchor(mid.x, mid.y);
				setFitMode("none");
				setZoom(completedPinch.previewZoom);
				persistPositionSoon();
				return;
			}
			if (pointers.current.size === 0 && !completedPinch) {
				const prev = lastTap.current;
				const now = performance.now();
				const moved =
					prev && Math.hypot(prev.x - e.clientX, prev.y - e.clientY) > 24;
				if (prev && !moved && now - prev.t < 320) {
					lastTap.current = null;
					cycleZoomAt(e.clientX, e.clientY);
				} else {
					lastTap.current = { x: e.clientX, y: e.clientY, t: now };
				}
			}
		},
		[captureAnchor, cycleZoomAt, persistPositionSoon],
	);

	const onWheel = useCallback(
		(e: React.WheelEvent) => {
			if (!e.ctrlKey) return;
			e.preventDefault();
			captureAnchor(e.clientX, e.clientY);
			const manual = effectiveZoom();
			setFitMode("none");
			setZoom((z) => {
				const base = fitMode === "none" ? z : manual;
				return clampZoom(base * Math.exp(-e.deltaY * 0.002));
			});
		},
		[captureAnchor, effectiveZoom, fitMode],
	);

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
								const pageIndex = await doc.getPageIndex(dest[0] as never);
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

	const thumbRatio = useCallback(
		(index: number) => {
			const size = pageSizes[index] ??
				pageSizes[0] ?? {
					width: 612,
					height: 792,
				};
			return size.width / size.height;
		},
		[pageSizes],
	);

	return (
		<ViewerShell
			name={name}
			formatColor={formatCssVar("pdf").base}
			progress={progress}
			onClose={onClose}
			chromeAutohide={settings["viewer.chrome_autohide"]}
			topActions={
				<>
					<IconButton
						label="Zoom out"
						onClick={() => stepZoom(-1)}
						data-testid="pdf-zoom-out"
					>
						<ZoomOut size={20} />
					</IconButton>
					<IconButton
						label="Zoom in"
						onClick={() => stepZoom(1)}
						data-testid="pdf-zoom-in"
					>
						<ZoomIn size={20} />
					</IconButton>
					<IconButton label="Fit width" onClick={() => setExplicitFit("width")}>
						<Maximize size={20} />
					</IconButton>
					<IconButton label="Fit page" onClick={() => setExplicitFit("page")}>
						<Maximize2 size={20} />
					</IconButton>
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
									: `${Math.round(zoom * 100)}%`}
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
				onPointerCancel={onPointerUp}
				onWheel={onWheel}
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
								$width={pageBoxes[i]?.width ?? firstBox.width}
								$height={pageBoxes[i]?.height ?? firstBox.height}
							/>
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
						setRotation((value) => (value + 90) % 360);
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
								<ThumbPage doc={doc} pageNum={i + 1} />
							</Thumb>
						))}
				</ThumbGrid>
			</Sheet>

			<PdfSearchSheet
				open={searchOpen}
				doc={doc}
				onDismiss={() => setSearchOpen(false)}
				onGoToPage={goToPage}
			/>

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

function ThumbPage({ doc, pageNum }: { doc: PdfDocument; pageNum: number }) {
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		let task: RenderTaskLike | null = null;
		const el = ref.current;
		if (!el) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				doc
					.getPage(pageNum)
					.then((page) => {
						if (cancelled || !ref.current) return;
						const viewport = page.getViewport({ scale: 0.25 });
						const canvas = document.createElement("canvas");
						canvas.width = Math.max(1, Math.floor(viewport.width));
						canvas.height = Math.max(1, Math.floor(viewport.height));
						const ctx = canvas.getContext("2d");
						if (!ctx) return;
						task = page.render({ canvasContext: ctx, viewport });
						return task.promise.then(() => {
							if (!cancelled && ref.current) {
								ref.current.replaceChildren(canvas);
							}
						});
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
			// sheet closes (audit 11.5).
			task?.cancel();
		};
	}, [doc, pageNum]);

	return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}

const ReaderStatus = styled.div`
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 8px 12px calc(8px + var(--safe-area-bottom, 0px));
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
