import { formatCssVar } from "@/components/FormatBadge";
import { Button, Dialog, IconButton, Sheet, TextField } from "@/components/ui";
import {
	type FitMode,
	clampZoom,
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
 */

import { PdfSearchSheet } from "./PdfSearchSheet";
import type { OutlineNode, PdfDocument } from "./pdfTypes";

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
	background: var(--bg);
	/* Pans stay native; two-finger pinch comes to JS as pointer
	   events so the document re-renders crisply at the new zoom
	   instead of the browser scaling the whole app. */
	touch-action: pan-x pan-y;
	overscroll-behavior: contain;
	scrollbar-gutter: stable;
`;

const Pages = styled.div<{ $darken: boolean }>`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	filter: ${({ $darken }) => ($darken ? "invert(0.92) hue-rotate(180deg)" : "none")};
	transform-origin: 50% 0;
	wil-change: transform;
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

const Thumb = styled.button<{ $current: boolean }>`
	border: 2px solid
		${({ $current }) => ($current ? "var(--accent)" : "var(--border)")};
	border-radius: 8px;
	background: white;
	padding: 0;
	cursor: pointer;
	overflow: hidden;
	aspect-ratio: 0.707;

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
`;

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
			const task = pdfjs.getDocument({
				data: dataSource.slice(0),
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

	// --- virtualized rendering: visible pages plus margin ---
	useEffect(() => {
		if (!doc || pageBoxes.length === 0) return;
		let cancelled = false;
		const inflight = new Map<number, boolean>();
		const visiblePages = new Set<number>();

		const renderPage = async (pageNum: number, el: HTMLElement) => {
			if (inflight.get(pageNum)) return;
			inflight.set(pageNum, true);
			try {
				const page = await doc.getPage(pageNum);
				if (cancelled) return;
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
				await page.render({ canvasContext: ctx, viewport: renderViewport })
					.promise;
				if (cancelled || !visiblePages.has(pageNum)) return;
				el.replaceChildren(canvas);
			} catch {
				// cancelled or failed; the observer retries when visible
			} finally {
				inflight.delete(pageNum);
			}
		};

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const pageNum = Number((entry.target as HTMLElement).dataset.page);
					if (entry.isIntersecting) {
						visiblePages.add(pageNum);
						renderPage(pageNum, entry.target as HTMLElement);
					} else {
						visiblePages.delete(pageNum);
						// Scanned PDFs have very large bitmaps. Releasing canvases once
						// they leave the render margin keeps memory and startup bounded.
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
			observer.disconnect();
		};
	}, [doc, firstBox, pageBoxes, rotation]);

	// --- restore position once geometry is known ---
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
			const target = pageRefs.current.get(initialPosition.page + 1);
			target?.scrollIntoView({ block: "start" });
			setCurrentPage(initialPosition.page);
		} else if (initialPosition.scrollRatio) {
			el.scrollTop =
				initialPosition.scrollRatio * (el.scrollHeight - el.clientHeight);
		}
	}, [doc, firstBox.width, initialPosition, settings]);

	// --- current page tracking + position memory ---
	const onScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el || !doc) return;
		let current = 0;
		pageRefs.current.forEach((node, pageNum) => {
			const rect = node.getBoundingClientRect();
			if (rect.top <= window.innerHeight / 2) current = pageNum - 1;
		});
		setCurrentPage(current);
		if (settings["viewer.remember_position"]) {
			if (positionTimer.current !== null) {
				window.clearTimeout(positionTimer.current);
			}
			positionTimer.current = window.setTimeout(() => {
				positionTimer.current = null;
				onPosition?.({
					page: current,
					zoom,
					scrollRatio:
						el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
				});
			}, 500);
		}
	}, [doc, settings, zoom, onPosition]);

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

	const cycleZoom = useCallback(() => {
		haptic(settings);
		setZoom(1);
		setFitMode((f) => nextFitMode(f));
	}, [settings]);

	const stepZoom = useCallback(
		(direction: 1 | -1) => {
			haptic(settings);
			focal.current = null;
			setZoom((z) => stepZoomClamped(z, direction));
		},
		[settings],
	);

	// --- pinch to zoom: two pointers scale the document around the
	// pinch midpoint; pans stay native via touch-action ---
	const pointers = useRef(new Map<number, [number, number]>());
	const pinchRef = useRef<{
		baseDist: number;
		startZoom: number;
		previewZoom: number;
	} | null>(null);
	const focal = useRef<{ xRatio: number; yRatio: number } | null>(null);

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
					startZoom: zoom,
					previewZoom: zoom,
				};
			}
		},
		[pointerDistance, zoom],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!pointers.current.has(e.pointerId)) return;
			pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
			if (pointers.current.size !== 2 || !pinchRef.current) return;
			e.preventDefault();
			const el = scrollRef.current;
			if (!el) return;
			const [a, b] = [...pointers.current.values()];
			const midX = (a[0] + b[0]) / 2;
			const midY = (a[1] + b[1]) / 2;
			focal.current = {
				xRatio:
					(el.scrollLeft + midX - el.clientLeft) / Math.max(1, el.scrollWidth),
				yRatio:
					(el.scrollTop + midY - el.clientTop) / Math.max(1, el.scrollHeight),
			};
			const next = clampZoom(
				pinchRef.current.startZoom *
					(pointerDistance() / Math.max(1, pinchRef.current.baseDist)),
			);
			pinchRef.current.previewZoom = next;
			// Preview with a cheap transform and render sharply only once
			// the fingers lift. Re-rendering canvases every pointer event
			// made image-heavy PDFs feel frozen.
			if (pagesRef.current) {
				pagesRef.current.style.transform = `scale(${next / pinchRef.current.startZoom})`;
			}
		},
		[pointerDistance],
	);

	const onPointerUp = useCallback((e: React.PointerEvent) => {
		const completedPinch = pinchRef.current;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
		pointers.current.delete(e.pointerId);
		if (pointers.current.size < 2 && completedPinch) {
			pinchRef.current = null;
			if (pagesRef.current) pagesRef.current.style.transform = "";
			setZoom(completedPinch.previewZoom);
		}
	}, []);

	const onWheel = useCallback((e: React.WheelEvent) => {
		if (!e.ctrlKey) return;
		e.preventDefault();
		const el = scrollRef.current;
		if (!el) return;
		focal.current = {
			xRatio:
				(el.scrollLeft + e.clientX - el.clientLeft) /
				Math.max(1, el.scrollWidth),
			yRatio:
				(el.scrollTop + e.clientY - el.clientTop) /
				Math.max(1, el.scrollHeight),
		};
		setZoom((value) => clampZoom(value * Math.exp(-e.deltaY * 0.002)));
	}, []);

	// Keep the pinched content under the fingers after the re-render.
	useEffect(() => {
		const el = scrollRef.current;
		const f = focal.current;
		if (!el || !f || firstBox.width <= 0) return;
		focal.current = null;
		el.scrollLeft = f.xRatio * el.scrollWidth - el.clientWidth / 2;
		el.scrollTop = f.yRatio * el.scrollHeight - el.clientHeight / 2;
	}, [firstBox.width]);

	const outlineItems = (nodes: OutlineNode[], depth = 0): ReactNode =>
		nodes.map((node, i) => (
			<OutlineButton
				key={`outline-${depth}-${node.title}-${i}`}
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
		));

	const progress = loadProgress;

	return (
		<ViewerShell
			name={name}
			formatColor={formatCssVar("pdf").base}
			progress={progress}
			onClose={onClose}
			chromeAutohide={settings["viewer.chrome_autohide"]}
			topActions={
				<>
					<IconButton label="Zoom out" onClick={() => stepZoom(-1)}>
						<ZoomOut size={20} />
					</IconButton>
					<IconButton label="Zoom in" onClick={() => stepZoom(1)}>
						<ZoomIn size={20} />
					</IconButton>
					<IconButton
						label="Search"
						onClick={() => setSearchOpen(true)}
						data-testid="pdf-search"
					>
						<Search size={20} />
					</IconButton>
					<IconButton label="More PDF tools" onClick={() => setToolsOpen(true)}>
						<MoreVertical size={20} />
					</IconButton>
				</>
			}
			bottomBar={
				doc ? (
					<ReaderStatus>
						<StatusPill onClick={cycleZoom} aria-label="Change page fit">
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
				onDoubleClick={cycleZoom}
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
				onDismiss={() => setToolsOpen(false)}
			>
				<ToolButton
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
				onDismiss={() => setThumbsOpen(false)}
			>
				<ThumbGrid>
					{doc &&
						Array.from({ length: doc.numPages }, (_, i) => (
							<Thumb
								key={`thumb-${i + 1}`}
								$current={i === currentPage}
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
						page
							.render({ canvasContext: ctx, viewport })
							.promise.then(() => {
								if (!cancelled && ref.current) {
									ref.current.replaceChildren(canvas);
								}
							})
							.catch(() => {});
					})
					.catch(() => {});
			},
			{ rootMargin: "240px" },
		);
		observer.observe(el);
		return () => {
			cancelled = true;
			observer.disconnect();
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
