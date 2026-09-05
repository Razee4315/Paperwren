import { formatCssVar } from "@/components/FormatBadge";
import { Button, IconButton, Sheet, TextField } from "@/components/ui";
import { isVersionedPosition } from "@/lib/recents";
import type { FilePosition } from "@/lib/types";
import { useSettings } from "@/state/SettingsContext";
import { Maximize, Search, ZoomIn, ZoomOut } from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import styled from "styled-components";
import { ViewerShell } from "./ViewerShell";
import {
	type DocxMatch,
	type DocxTextIndex,
	buildTextIndex,
	findMatches,
	matchToRange,
} from "./docxSearch";

/**
 * SCR-08 DOCX reader (docs/07 section 4): docx-preview renders the
 * document's own layout into paginated white "paper" pages, scaled
 * to fit the screen width. Pages stay white in every theme, like
 * PDF pages, so text keeps its document colors and stays readable
 * in dark mode.
 *
 * Lifecycle (docs/14 audit DOC-01/DOC-03): loading is explicit
 * state, never inferred from a fit value. Every document generation
 * renders into its own staging container — including the
 * renderer-owned style nodes — and attaches only if it is still the
 * current generation; stale output is discarded whole. Position
 * writes read committed refs, are gated on the remember-position
 * preference, and flush on unmount instead of being dropped.
 */

type DocxStatus = "loading" | "ready" | "error";

const ScrollWrap = styled.div`
	position: absolute;
	inset: 0;
	overflow: auto;
	background: var(--surface-2);
	padding: 16px;
	/* Shared viewport contract (audit 8): the real toolbar height,
	   safe area included, so the first line is never hidden. */
	padding-top: calc(var(--viewer-top-height, 56px) + 16px);
	padding-bottom: calc(
		var(--viewer-bottom-height, 0px) + var(--viewer-bottom-reserve, 0px) +
			24px
	);
`;

const DocContainer = styled.div<{ $zoom: number }>`
	width: max-content;
	margin: 0 auto;
	zoom: ${({ $zoom }) => $zoom};

	/* docx-preview injects gray chrome and dark defaults; the pages
	   are paper and stay paper in every theme. */
	.docx-wrapper {
		background: transparent !important;
		padding: 0 !important;
	}
	.docx-wrapper > section.docx {
		background: #ffffff !important;
		box-shadow: var(--shadow-1) !important;
		margin-bottom: 12px !important;
	}
	/* Only the section default ink is overridden; paragraphs the
	   document colors intentionally keep their authored color. */
	.docx-wrapper > section.docx {
		color: #211b15 !important;
	}
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

const PanelNote = styled.p`
	color: var(--ink-2);
	font-size: 0.9375rem;
	padding: 8px;
`;

/** Debounce before a scroll position is written (audit DOC-03). */
const POSITION_DEBOUNCE_MS = 500;

export function DocxViewer({
	data,
	name,
	initialPosition,
	onPosition,
	onClose,
}: {
	data: ArrayBuffer;
	name: string;
	initialPosition?: FilePosition;
	onPosition?: (pos: FilePosition) => void;
	onClose: () => void;
}) {
	const { settings } = useSettings();
	const [status, setStatus] = useState<DocxStatus>("loading");
	// Fit policy (audit DOC-02): one document scale computed from the
	// WIDEST rendered section, so a landscape section later in the file
	// cannot overflow while an early portrait section fits. Manual zoom
	// is an explicit mode and is never refitted away.
	const [fitMode, setFitMode] = useState<"width" | "manual">("width");
	const [manualScale, setManualScale] = useState(1);
	const [fitScale, setFitScale] = useState(1);
	const [generation, setGeneration] = useState(0);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const positionTimer = useRef<number | null>(null);
	const restored = useRef(false);
	const onPositionRef = useRef(onPosition);
	onPositionRef.current = onPosition;
	const rememberRef = useRef(settings["viewer.remember_position"]);
	rememberRef.current = settings["viewer.remember_position"];

	const zoom = fitMode === "width" ? fitScale : manualScale;
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	const fitModeRef = useRef(fitMode);
	fitModeRef.current = fitMode;
	const fitScaleRef = useRef(fitScale);
	fitScaleRef.current = fitScale;

	/** Fractions of a section box: the reading anchor (audit DOC-02
	 * "preserve the page-local reading point"). */
	interface DocxAnchor {
		sectionIndex: number;
		x: number;
		y: number;
		clientX: number;
		clientY: number;
	}
	const lastStableAnchorRef = useRef<DocxAnchor | null>(null);
	const pendingCorrectionRef = useRef<DocxAnchor | null>(null);

	/** Capture the current reading point (section-local fractions plus
	 * its on-screen client position) BEFORE a relayout commits. */
	const captureCorrection = useCallback((): DocxAnchor | null => {
		const container = containerRef.current;
		const el = scrollRef.current;
		if (!container || !el) return null;
		const sections = container.querySelectorAll<HTMLElement>("section.docx");
		if (sections.length === 0) return null;
		// Prefer the stable anchor from scroll state; fall back to the
		// section nearest the viewport center.
		const srect = el.getBoundingClientRect();
		const centerY = srect.top + el.clientHeight / 2;
		let best = 0;
		let bestDistance = Number.POSITIVE_INFINITY;
		sections.forEach((section, index) => {
			const r = section.getBoundingClientRect();
			if (r.height <= 0) return;
			const d = Math.abs(r.top + r.height / 2 - centerY);
			if (d < bestDistance) {
				bestDistance = d;
				best = index;
			}
		});
		const rect = sections[best].getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		const stable = lastStableAnchorRef.current;
		const anchor = stable?.sectionIndex === best ? stable : null;
		const fx = anchor ? anchor.x : 0.5;
		const fy = anchor ? anchor.y : 0.5;
		return {
			sectionIndex: best,
			x: fx,
			y: fy,
			clientX: rect.left + fx * rect.width,
			clientY: rect.top + fy * rect.height,
		};
	}, []);

	/** Re-align after a relayout: put the captured section point back
	 * under its client position, clamped to scroll bounds. */
	const applyCorrection = useCallback((tx: DocxAnchor) => {
		const container = containerRef.current;
		const el = scrollRef.current;
		if (!container || !el) return;
		const section =
			container.querySelectorAll<HTMLElement>("section.docx")[tx.sectionIndex];
		if (!section) return;
		const rect = section.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		const srect = el.getBoundingClientRect();
		const contentX = rect.left - srect.left + el.scrollLeft + tx.x * rect.width;
		const contentY = rect.top - srect.top + el.scrollTop + tx.y * rect.height;
		const desiredLeft = contentX - (tx.clientX - srect.left);
		const desiredTop = contentY - (tx.clientY - srect.top);
		el.scrollLeft = Math.max(
			0,
			Math.min(el.scrollWidth - el.clientWidth, desiredLeft),
		);
		el.scrollTop = Math.max(
			0,
			Math.min(el.scrollHeight - el.clientHeight, desiredTop),
		);
		lastStableAnchorRef.current = {
			sectionIndex: tx.sectionIndex,
			x: tx.x,
			y: tx.y,
			clientX: tx.clientX,
			clientY: tx.clientY,
		};
	}, []);

	// Pre-paint realignment after every zoom/relayout commit.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useLayoutEffect(() => {
		const tx = pendingCorrectionRef.current;
		if (!tx) return;
		pendingCorrectionRef.current = null;
		applyCorrection(tx);
	}, [zoom, applyCorrection]);

	/** Change zoom with anchor preservation. */
	const changeZoom = useCallback(
		(next: number) => {
			pendingCorrectionRef.current = captureCorrection();
			if (fitModeRef.current === "width") {
				setFitMode("manual");
				setManualScale(next);
			} else {
				setManualScale(next);
			}
		},
		[captureCorrection],
	);

	const stepZoom = useCallback(
		(direction: 1 | -1) => {
			const next =
				direction === 1 ? zoomRef.current * 1.25 : zoomRef.current / 1.25;
			changeZoom(Math.min(4, Math.max(0.1, next)));
		},
		[changeZoom],
	);

	const setFitWidth = useCallback(() => {
		pendingCorrectionRef.current = captureCorrection();
		// Resolve the honest fit NOW from the widest section: a stale
		// fitScale from an earlier viewport could be wrong (audit
		// DOC-02: explicit fit commands always resolve an honest fit).
		const el = scrollRef.current;
		const container = containerRef.current;
		if (el && container) {
			const sections = container.querySelectorAll<HTMLElement>("section.docx");
			let widest = 0;
			sections.forEach((section) => {
				widest = Math.max(widest, section.offsetWidth);
			});
			if (widest > 0) setFitScale((el.clientWidth - 32) / widest);
		}
		setFitMode("width");
	}, [captureCorrection]);

	// --- render each document generation into staging (audit DOC-03):
	// a started renderer cannot be stopped, so cancellation means
	// discarding its output wholesale instead of fighting it. ---
	useEffect(() => {
		let cancelled = false;
		setStatus("loading");
		setGeneration((g) => g + 1);
		const staging = document.createElement("div");
		const run = async () => {
			try {
				const docx = await import("docx-preview");
				if (cancelled) return;
				// Rendering is driven synchronously once imported; it
				// populates `staging` (content) and `staging` (styles —
				// passed as the style container so the style nodes travel
				// with the generation instead of leaking into <head>).
				await docx.renderAsync(data, staging, staging, {
					inWrapper: true,
					ignoreLastRenderedPageBreak: false,
					// Base64 avoids object-URL lifetime ownership; large
					// images cost more memory this way, which the corpus
					// work must profile before changing (audit DOC-03).
					useBase64URL: true,
				});
				if (cancelled) return;
				const container = containerRef.current;
				const scroller = scrollRef.current;
				if (!container || !scroller) return;
				const sections = staging.querySelectorAll("section.docx");
				if (sections.length === 0) {
					// Zero rendered pages: an honest terminal state, never
					// eternal loading (audit DOC-01).
					setStatus("error");
					return;
				}
				container.replaceChildren(...staging.childNodes);
				// One document scale from the widest rendered section
				// (audit DOC-02): scaling each section independently would
				// distort the document's relative page sizes.
				let widest = 0;
				sections.forEach((section) => {
					widest = Math.max(widest, (section as HTMLElement).offsetWidth);
				});
				if (widest > 0) {
					const available = scroller.clientWidth - 32;
					setFitScale(available / widest);
				}
				setStatus("ready");
			} catch {
				if (!cancelled) setStatus("error");
			}
		};
		run();
		return () => {
			cancelled = true;
			// Staging is detached; its content (and style nodes) are
			// garbage with no global leakage.
			staging.replaceChildren();
		};
	}, [data]);

	// Refit only in fit mode on rotation / resize (audit DOC-02):
	// manual scale stays manual, and the reading point survives the
	// refit through the pending-correction realignment. A second
	// observer on the document content catches late font/image layout;
	// in manual mode native scroll anchoring already keeps the view
	// stable when content grows, so no synthetic correction there.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const refit = () => {
			if (status !== "ready") return;
			if (fitModeRef.current !== "width") return;
			const container = containerRef.current;
			if (!container) return;
			const sections = container.querySelectorAll<HTMLElement>("section.docx");
			if (sections.length === 0) return;
			let widest = 0;
			sections.forEach((section) => {
				widest = Math.max(widest, section.offsetWidth);
			});
			if (widest <= 0) return;
			const available = el.clientWidth - 32;
			const nextFit = available / widest;
			if (Math.abs(nextFit - fitScaleRef.current) < 0.001) return;
			pendingCorrectionRef.current = captureCorrection();
			setFitScale(nextFit);
		};
		const ro = new ResizeObserver(refit);
		ro.observe(el);
		if (containerRef.current) ro.observe(containerRef.current);
		return () => ro.disconnect();
	}, [status, captureCorrection]);

	// --- position persistence (audit DOC-03 + section 8): a versioned
	// v2 docx payload written from committed refs, gated on the
	// remember-position preference, suppressed until restore finished,
	// and flushed on unmount / background. ---
	const snapshotPosition = useCallback((): FilePosition => {
		const anchor = lastStableAnchorRef.current;
		const mode = fitModeRef.current;
		return {
			version: 2,
			kind: "docx",
			location: {
				pageIndex: anchor?.sectionIndex ?? 0,
				x: anchor?.x ?? 0,
				y: anchor?.y ?? 0,
				viewportX: 0.5,
				viewportY: 0.5,
			},
			mode,
			scale: mode === "manual" ? zoomRef.current : undefined,
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
		}, POSITION_DEBOUNCE_MS);
	}, [snapshotPosition]);

	const onScroll = useCallback(() => {
		// Keep the stable reading anchor fresh: the section under the
		// viewport center with its on-screen point.
		const container = containerRef.current;
		const el = scrollRef.current;
		if (container && el) {
			const sections = container.querySelectorAll<HTMLElement>("section.docx");
			const srect = el.getBoundingClientRect();
			const centerY = srect.top + el.clientHeight / 2;
			const centerX = srect.left + el.clientWidth / 2;
			sections.forEach((section, index) => {
				const r = section.getBoundingClientRect();
				if (r.height <= 0) return;
				if (centerY >= r.top && centerY <= r.bottom) {
					setVisibleSection((prev) => (prev === index ? prev : index));
					lastStableAnchorRef.current = {
						sectionIndex: index,
						x: (centerX - r.left) / r.width,
						y: (centerY - r.top) / r.height,
						clientX: centerX,
						clientY: centerY,
					};
				}
			});
		}
		persistPositionSoon();
	}, [persistPositionSoon]);

	// Flush the pending write on unmount and backgrounding instead of
	// dropping it (audit section 8: close/background flushing).
	useEffect(() => {
		const onHidden = () => {
			if (document.visibilityState === "hidden") flushPosition();
		};
		document.addEventListener("visibilitychange", onHidden);
		return () => {
			document.removeEventListener("visibilitychange", onHidden);
			flushPosition();
		};
	}, [flushPosition]);

	// Restore once content has actually rendered and been measured —
	// gated on ready status, not on an incidental zoom re-render
	// (audit DOC-01), and disabled entirely when remember-position is
	// off (audit section 8). v2 payloads restore mode, scale, and the
	// saved section point through the pre-paint realignment; legacy
	// payloads fall back to scroll ratio. `generation` re-arms the
	// gate after each document change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		if (status !== "ready" || restored.current) return;
		restored.current = true;
		const pos = initialPosition;
		if (!pos || !rememberRef.current) return;
		const el = scrollRef.current;
		const container = containerRef.current;
		if (!el || !container) return;
		if (isVersionedPosition(pos) && pos.kind === "docx") {
			if (pos.mode === "manual" && pos.scale) {
				setFitMode("manual");
				setManualScale(Math.min(4, Math.max(0.1, pos.scale)));
			} else {
				setFitMode("width");
			}
			const section =
				container.querySelectorAll<HTMLElement>("section.docx")[
					pos.location.pageIndex
				];
			if (section) {
				const srect = el.getBoundingClientRect();
				// Fractions are scale-invariant; the realignment runs
				// pre-paint after the zoom state commits.
				pendingCorrectionRef.current = {
					sectionIndex: Math.min(
						pos.location.pageIndex,
						container.querySelectorAll("section.docx").length - 1,
					),
					x: pos.location.x,
					y: pos.location.y,
					clientX: srect.left + pos.location.viewportX * el.clientWidth,
					clientY: srect.top + pos.location.viewportY * el.clientHeight,
				};
			}
			return;
		}
		const legacy = pos as { scrollRatio?: number };
		if (legacy.scrollRatio && el.scrollHeight > el.clientHeight) {
			el.scrollTop = legacy.scrollRatio * (el.scrollHeight - el.clientHeight);
		}
	}, [status, generation, initialPosition]);

	// --- reading tools (audit DOC-04): search over a text-node index
	// with non-destructive highlighting, and a page indicator/jump
	// control. The renderer's innerHTML is never rewritten. ---
	const [searchOpen, setSearchOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [matches, setMatches] = useState<DocxMatch[]>([]);
	const [search, setSearch] = useState<{
		matches: DocxMatch[];
		active: number;
	} | null>(null);
	const [jumpOpen, setJumpOpen] = useState(false);
	const [jumpValue, setJumpValue] = useState("");
	const [pageCount, setPageCount] = useState(0);
	const [visibleSection, setVisibleSection] = useState(0);
	const searchIndexRef = useRef<DocxTextIndex | null>(null);
	const searchRunRef = useRef(0);

	// Measure the rendered page count and reset search per document.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		if (status !== "ready") return;
		const container = containerRef.current;
		if (!container) return;
		setPageCount(container.querySelectorAll("section.docx").length);
		searchIndexRef.current = null;
		setSearch(null);
		setMatches([]);
		setQuery("");
	}, [status, generation]);

	// Search runs debounced over the cached index; stale runs are
	// cancelled by generation.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		if (!searchOpen) return;
		const container = containerRef.current;
		if (!container) return;
		if (!searchIndexRef.current) {
			searchIndexRef.current = buildTextIndex(container);
		}
		const id = ++searchRunRef.current;
		const timer = window.setTimeout(() => {
			if (id !== searchRunRef.current) return;
			const index = searchIndexRef.current;
			if (!index) return;
			setMatches(findMatches(index, query));
			setSearch(null);
		}, 250);
		return () => {
			window.clearTimeout(timer);
			searchRunRef.current++;
		};
	}, [searchOpen, query, generation]);

	// Non-destructive highlights via the CSS Custom Highlight API;
	// without it, navigation still scrolls to the match.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		const css = CSS as unknown as {
			highlights?: Map<string, unknown>;
		} | null;
		const HighlightCtor = (
			window as unknown as { Highlight?: new (...r: Range[]) => unknown }
		).Highlight;
		if (!css?.highlights) return;
		css.highlights.delete("pw-docx-search");
		css.highlights.delete("pw-docx-active");
		const index = searchIndexRef.current;
		if (!search || !index || search.matches.length === 0) return;
		const ranges = search.matches
			.map((m) => matchToRange(index, m))
			.filter((r): r is Range => r !== null);
		if (ranges.length !== search.matches.length) {
			// Layout changed under the index: rebuild it and re-resolve.
			const container = containerRef.current;
			if (container) {
				searchIndexRef.current = buildTextIndex(container);
			}
		}
		if (HighlightCtor) {
			css.highlights.set("pw-docx-search", new HighlightCtor(...ranges));
			const activeRange = ranges[search.active];
			if (activeRange) {
				css.highlights.set("pw-docx-active", new HighlightCtor(activeRange));
			}
		}
		return () => {
			css.highlights?.delete("pw-docx-search");
			css.highlights?.delete("pw-docx-active");
		};
	}, [search, generation]);

	// The active match scrolls into view when navigation changes.
	useEffect(() => {
		if (!search) return;
		const index = searchIndexRef.current;
		if (!index) return;
		const range = matchToRange(index, search.matches[search.active]);
		const anchor = range?.startContainer.parentElement ?? null;
		anchor?.scrollIntoView({ block: "center" });
	}, [search]);

	return (
		<ViewerShell
			name={name}
			formatColor={formatCssVar("docx").base}
			progress={null}
			onClose={onClose}
			chromeAutohide={false}
			topActions={
				<>
					<IconButton
						label="Zoom out"
						onClick={() => stepZoom(-1)}
						data-testid="docx-zoom-out"
					>
						<ZoomOut size={20} />
					</IconButton>
					<IconButton
						label="Zoom in"
						onClick={() => stepZoom(1)}
						data-testid="docx-zoom-in"
					>
						<ZoomIn size={20} />
					</IconButton>
					<IconButton
						label="Fit width"
						onClick={setFitWidth}
						data-testid="docx-fit-width"
					>
						<Maximize size={20} />
					</IconButton>
					<IconButton
						label="Search"
						onClick={() => setSearchOpen(true)}
						data-testid="docx-search"
					>
						<Search size={20} />
					</IconButton>
				</>
			}
			bottomBar={
				status === "ready" && pageCount > 0 ? (
					<DocxStatus>
						<PagePill
							onClick={() => {
								setJumpValue(String(visibleSection + 1));
								setJumpOpen(true);
							}}
							data-testid="docx-page-pill"
						>
							Page {visibleSection + 1} / {pageCount}
						</PagePill>
					</DocxStatus>
				) : undefined
			}
		>
			<ScrollWrap ref={scrollRef} onScroll={onScroll} data-testid="docx-view">
				{/* The status note is a sibling: docx-preview replaces the
				   children of its container node, which used to swallow
				   this message's node mid-paint (audit 14.2). */}
				<DocContainer
					ref={containerRef}
					$zoom={zoom}
					data-zoom={zoom.toFixed(4)}
					data-testid="docx-container"
				/>
				{status === "loading" && <PanelNote>Loading document...</PanelNote>}
				{status === "error" && (
					<Center>
						Can't open this file. It seems to be damaged or isn't a valid Word
						document.
					</Center>
				)}
			</ScrollWrap>

			{search && search.matches.length > 0 && (
				<SearchNav data-testid="docx-search-nav">
					<SearchNavButton
						aria-label="Previous match"
						data-testid="docx-search-prev"
						onClick={() => {
							const next =
								(search.active - 1 + search.matches.length) %
								search.matches.length;
							setSearch({ ...search, active: next });
						}}
					>
						‹
					</SearchNavButton>
					<span aria-live="polite">
						{search.active + 1} / {search.matches.length}
					</span>
					<SearchNavButton
						aria-label="Next match"
						data-testid="docx-search-next"
						onClick={() => {
							const next = (search.active + 1) % search.matches.length;
							setSearch({ ...search, active: next });
						}}
					>
						›
					</SearchNavButton>
					<SearchNavButton
						aria-label="Clear search"
						data-testid="docx-search-clear"
						onClick={() => setSearch(null)}
					>
						×
					</SearchNavButton>
				</SearchNav>
			)}

			<Sheet
				open={searchOpen}
				title="Search"
				id="docx-search"
				onDismiss={() => setSearchOpen(false)}
			>
				<TextField
					label="Find in document"
					value={query}
					onChange={setQuery}
					placeholder="Search text"
					autoFocus
				/>
				<StatusLine aria-live="polite" data-testid="docx-search-status">
					{query.trim()
						? `${matches.length} ${matches.length === 1 ? "result" : "results"}${
								matches.length >= 5000 ? " (capped)" : ""
							}`
						: "Type to search the document."}
				</StatusLine>
				<Results>
					{matches.slice(0, 200).map((m, i) => (
						<HitButton
							key={`docx-hit-${m.start}`}
							$current={search?.active === i}
							data-testid={`docx-search-hit-${i}`}
							onClick={() => {
								setSearch({ matches, active: i });
								setSearchOpen(false);
							}}
						>
							{m.snippet}
						</HitButton>
					))}
					{query.trim() && matches.length === 0 && (
						<NoHits>No matches. Try a shorter or different word.</NoHits>
					)}
				</Results>
			</Sheet>

			<Sheet
				open={jumpOpen}
				title="Go to page"
				id="docx-jump"
				onDismiss={() => setJumpOpen(false)}
			>
				<TextField
					label="Page number"
					value={jumpValue}
					onChange={setJumpValue}
					placeholder={`1 to ${pageCount}`}
					inputMode="numeric"
					autoFocus
				/>
				<Button
					onClick={() => {
						const n = Number.parseInt(jumpValue, 10);
						if (n >= 1 && n <= pageCount) {
							containerRef.current
								?.querySelectorAll<HTMLElement>("section.docx")
								[n - 1]?.scrollIntoView({ block: "start" });
							setJumpOpen(false);
							setJumpValue("");
						}
					}}
					disabled={jumpValue.trim().length === 0}
				>
					Go
				</Button>
			</Sheet>
		</ViewerShell>
	);
}

/* Page indicator styled like the PDF reader's quiet pills (audit
   DOC-04: a page indicator/jump control). */
const DocxStatus = styled.div`
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 8px 12px;
`;

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

	&:active {
		transform: scale(0.95);
	}
`;

const SearchNav = styled.div`
	position: absolute;
	left: 50%;
	transform: translateX(-50%);
	bottom: calc(
		var(--viewer-bottom-height, 0px) + var(--viewer-bottom-reserve, 0px) + 12px
	);
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

const StatusLine = styled.p`
	color: var(--ink-2);
	font-size: 0.8125rem;
	padding: 4px 8px 12px;
	font-variant-numeric: tabular-nums;
`;

const Results = styled.div`
	display: flex;
	flex-direction: column;
	gap: 2px;
`;

const HitButton = styled.button<{ $current: boolean }>`
	background: ${({ $current }) => ($current ? "var(--surface-2)" : "none")};
	border: none;
	border-left: 3px solid
		${({ $current }) => ($current ? "var(--accent)" : "transparent")};
	text-align: left;
	padding: 10px 8px;
	border-radius: 8px;
	cursor: pointer;
	font-size: 0.8125rem;
	color: var(--ink-1);

	&:hover {
		background: var(--surface-2);
	}
`;

const NoHits = styled.p`
	color: var(--ink-2);
	font-size: 0.9375rem;
	padding: 8px;
`;
