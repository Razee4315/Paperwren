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
} from "@/ui";
import {
	ListTree,
	Maximize,
	MoreVertical,
	RotateCw,
	Search,
	StretchHorizontal,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
	EventBus,
	PDFFindController,
	PDFLinkService,
	PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { useCallback, useEffect, useRef, useState } from "react";
import s from "./PdfView.module.css";
import { FindBar, type FindState, Shell, shellStyles } from "./Shell";
import type { ViewerProps } from "./types";

/**
 * PDF on pdf.js's own viewer component (the engine behind Firefox's
 * reader): virtualised page rendering, text selection, links, find
 * with highlighting, and anchored zoom all come from pdf.js. This
 * file only adds the chrome, touch gestures and position memory.
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

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

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
	const pdfViewer = useRef<PDFViewer | null>(null);
	const bus = useRef<EventBus | null>(null);
	const links = useRef<PDFLinkService | null>(null);

	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
	const [status, setStatus] = useState<
		"loading" | "ready" | "password" | "error"
	>("loading");
	const [password, setPassword] = useState("");
	const [passwordWrong, setPasswordWrong] = useState(false);
	const [page, setPage] = useState(1);
	const [pages, setPages] = useState(0);
	const [scaleLabel, setScaleLabel] = useState("");
	const [chromeHidden, setChromeHidden] = useState(false);
	const [menu, setMenu] = useState(false);
	const [outline, setOutline] = useState<Outline[] | null>(null);
	const [outlineOpen, setOutlineOpen] = useState(false);
	const [jumpOpen, setJumpOpen] = useState(false);
	const [jumpValue, setJumpValue] = useState("");
	const [findOpen, setFindOpen] = useState(false);
	const [find, setFind] = useState<FindState>({
		query: "",
		total: 0,
		current: -1,
	});

	const positionRef = useRef(position);
	const onPositionRef = useRef(onPosition);
	onPositionRef.current = onPosition;
	const rememberRef = useRef(settings.rememberPosition);
	rememberRef.current = settings.rememberPosition;
	const defaultZoom = useRef(settings.pdfZoom);

	// --- open the document (retries with a password) ---
	const openDoc = useCallback(
		async (pwd?: string) => {
			setStatus("loading");
			try {
				const { pdfjs } = await loadEngine();
				// pdf.js transfers the buffer it gets; keep ours for retries.
				const task = pdfjs.getDocument({
					data: new Uint8Array(data.slice(0)),
					password: pwd,
					isEvalSupported: false,
				});
				const pdf = await task.promise;
				setDoc(pdf);
				setPages(pdf.numPages);
				setStatus("ready");
				pdf
					.getOutline()
					.then((o) => setOutline((o as unknown as Outline[]) ?? []))
					.catch(() => setOutline([]));
			} catch (err) {
				const e = err as { name?: string; code?: number };
				if (e?.name === "PasswordException") {
					setPasswordWrong(pwd !== undefined);
					setStatus("password");
				} else {
					setStatus("error");
				}
			}
		},
		[data],
	);

	useEffect(() => {
		openDoc();
	}, [openDoc]);

	useEffect(() => () => void doc?.destroy(), [doc]);

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
				removePageBorders: false,
				maxCanvasPixels: 2 ** 24,
			});
			linkService.setViewer(v);
			pdfViewer.current = v;
			bus.current = eventBus;
			links.current = linkService;

			eventBus.on("pagesinit", () => {
				const saved = positionRef.current;
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
			});
			eventBus.on("pagechanging", (e: { pageNumber: number }) =>
				setPage(e.pageNumber),
			);
			eventBus.on(
				"scalechanging",
				(e: { scale: number; presetValue?: string }) =>
					setScaleLabel(
						e.presetValue === "page-width"
							? "Fit width"
							: e.presetValue === "page-fit"
								? "Whole page"
								: `${Math.round(e.scale * 100)}%`,
					),
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

	// --- zoom helpers ---
	const zoomBy = useCallback((factor: number, origin?: [number, number]) => {
		const v = pdfViewer.current;
		if (!v) return;
		const target = Math.min(
			MAX_SCALE,
			Math.max(MIN_SCALE, v.currentScale * factor),
		);
		v.updateScale({
			scaleFactor: target / v.currentScale,
			origin,
			drawingDelay: 250,
		});
	}, []);
	const setPreset = (value: "page-width" | "page-fit") => {
		if (pdfViewer.current) pdfViewer.current.currentScaleValue = value;
	};

	// --- touch: pinch zoom around the fingers, tap toggles chrome,
	// double tap zooms in / back to fit ---
	useEffect(() => {
		const el = container.current;
		if (!el || status !== "ready") return;
		let pinch: {
			dist: number;
			pending: number;
			raf: number;
			origin: [number, number];
		} | null = null;
		let tap: { x: number; y: number; t: number; moved: boolean } | null = null;
		let lastTap = 0;
		let tapTimer = 0;
		const dist = (t: TouchList) =>
			Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

		const onStart = (e: TouchEvent) => {
			if (e.touches.length === 2) {
				e.preventDefault();
				tap = null;
				pinch = { dist: dist(e.touches), pending: 1, raf: 0, origin: [0, 0] };
			} else if (e.touches.length === 1) {
				tap = {
					x: e.touches[0].clientX,
					y: e.touches[0].clientY,
					t: e.timeStamp,
					moved: false,
				};
			}
		};
		const onMove = (e: TouchEvent) => {
			if (tap && e.touches.length === 1) {
				const dx = e.touches[0].clientX - tap.x;
				const dy = e.touches[0].clientY - tap.y;
				if (Math.hypot(dx, dy) > 10) tap.moved = true;
			}
			if (!pinch || e.touches.length !== 2) return;
			e.preventDefault();
			const d = dist(e.touches);
			pinch.pending *= d / pinch.dist;
			pinch.dist = d;
			pinch.origin = [
				(e.touches[0].clientX + e.touches[1].clientX) / 2,
				(e.touches[0].clientY + e.touches[1].clientY) / 2,
			];
			if (!pinch.raf) {
				pinch.raf = requestAnimationFrame(() => {
					if (!pinch) return;
					pinch.raf = 0;
					if (Math.abs(pinch.pending - 1) > 0.01) {
						zoomBy(pinch.pending, pinch.origin);
						pinch.pending = 1;
					}
				});
			}
		};
		const onEnd = (e: TouchEvent) => {
			if (pinch && e.touches.length < 2) {
				cancelAnimationFrame(pinch.raf);
				if (Math.abs(pinch.pending - 1) > 0.01)
					zoomBy(pinch.pending, pinch.origin);
				pinch = null;
				return;
			}
			if (
				!tap ||
				tap.moved ||
				e.touches.length > 0 ||
				e.timeStamp - tap.t > 300
			) {
				tap = null;
				return;
			}
			const target = e.target as HTMLElement;
			if (target.closest("a, button, input, .annotationLayer section")) return;
			const { x, y } = tap;
			tap = null;
			if (e.timeStamp - lastTap < 300) {
				window.clearTimeout(tapTimer);
				lastTap = 0;
				const v = pdfViewer.current;
				if (!v) return;
				if (
					v.currentScaleValue === "page-width" ||
					v.currentScaleValue === "page-fit" ||
					v.currentScaleValue === "auto"
				)
					zoomBy(2, [x, y]);
				else v.currentScaleValue = "page-width";
				return;
			}
			lastTap = e.timeStamp;
			if (window.getSelection()?.toString()) return;
			tapTimer = window.setTimeout(() => setChromeHidden((h) => !h), 280);
		};
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			zoomBy(Math.exp(-e.deltaY * 0.01), [e.clientX, e.clientY]);
		};
		el.addEventListener("touchstart", onStart, { passive: false });
		el.addEventListener("touchmove", onMove, { passive: false });
		el.addEventListener("touchend", onEnd);
		el.addEventListener("touchcancel", onEnd);
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			window.clearTimeout(tapTimer);
			el.removeEventListener("touchstart", onStart);
			el.removeEventListener("touchmove", onMove);
			el.removeEventListener("touchend", onEnd);
			el.removeEventListener("touchcancel", onEnd);
			el.removeEventListener("wheel", onWheel);
		};
	}, [status, zoomBy]);

	// --- find ---
	const runFind = useCallback(
		(query: string, again: boolean, previous = false) => {
			bus.current?.dispatch("find", {
				source: null,
				type: again ? "again" : "",
				query,
				caseSensitive: false,
				entireWord: false,
				highlightAll: true,
				findPrevious: previous,
				matchDiacritics: false,
			});
		},
		[],
	);
	useEffect(() => {
		if (!findOpen) return;
		const t = window.setTimeout(() => runFind(find.query, false), 200);
		return () => window.clearTimeout(t);
	}, [find.query, findOpen, runFind]);
	const closeFind = () => {
		setFindOpen(false);
		setFind({ query: "", total: 0, current: -1 });
		runFind("", false);
	};

	const goTo = (n: number) => {
		const v = pdfViewer.current;
		if (v && n >= 1 && n <= pages) v.currentPageNumber = n;
	};

	const darkPages = settings.darkPages && theme !== "light";

	const actions = (
		<>
			<IconButton
				label="Find"
				onClick={() => setFindOpen(true)}
				active={findOpen}
				data-testid="pdf-find"
			>
				<Search size={20} />
			</IconButton>
			<IconButton
				label="More"
				onClick={() => setMenu(true)}
				data-testid="pdf-more"
			>
				<MoreVertical size={20} />
			</IconButton>
		</>
	);

	const bottom =
		status === "ready" ? (
			<div className={shellStyles.pager}>
				<button
					type="button"
					className={shellStyles.pill}
					onClick={() => {
						setJumpValue(String(page));
						setJumpOpen(true);
					}}
					aria-label="Go to page"
					data-testid="pdf-page"
				>
					{page} / {pages}
				</button>
				<div className={shellStyles.group}>
					<IconButton
						label="Zoom out"
						onClick={() => zoomBy(1 / 1.25)}
						data-testid="pdf-zoom-out"
					>
						<ZoomOut size={20} />
					</IconButton>
					<button
						type="button"
						className={shellStyles.pill}
						onClick={() =>
							setPreset(
								pdfViewer.current?.currentScaleValue === "page-width"
									? "page-fit"
									: "page-width",
							)
						}
						aria-label="Toggle fit"
						data-testid="pdf-scale"
					>
						{scaleLabel || "Fit width"}
					</button>
					<IconButton
						label="Zoom in"
						onClick={() => zoomBy(1.25)}
						data-testid="pdf-zoom-in"
					>
						<ZoomIn size={20} />
					</IconButton>
				</div>
			</div>
		) : undefined;

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			actions={actions}
			bottom={bottom}
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

			{status === "loading" && (
				<StateView>
					<Spinner label="Opening PDF" />
				</StateView>
			)}
			{status === "error" && (
				<StateView
					icon={<ErrorArt />}
					title="Can't open this PDF"
					action={<Button onClick={onClose}>Close</Button>}
					testId="pdf-error"
				>
					The file is damaged or isn't a valid PDF.
				</StateView>
			)}

			<Dialog
				open={status === "password"}
				title="Password protected"
				onClose={onClose}
				actions={
					<>
						<Button variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button
							onClick={() => openDoc(password)}
							disabled={!password}
							data-testid="pdf-unlock"
						>
							Open
						</Button>
					</>
				}
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (password) openDoc(password);
					}}
				>
					<p className={s.passwordHint}>
						{passwordWrong
							? "That password didn't work. Try again."
							: `Enter the password for “${name}”.`}
					</p>
					<input
						className={s.input}
						type="password"
						autoComplete="off"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						aria-label="Password"
						data-testid="pdf-password"
					/>
				</form>
			</Dialog>

			<Dialog
				open={jumpOpen}
				title="Go to page"
				onClose={() => setJumpOpen(false)}
				actions={
					<>
						<Button variant="ghost" onClick={() => setJumpOpen(false)}>
							Cancel
						</Button>
						<Button
							onClick={() => {
								goTo(Number(jumpValue));
								setJumpOpen(false);
							}}
							data-testid="pdf-jump-go"
						>
							Go
						</Button>
					</>
				}
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						goTo(Number(jumpValue));
						setJumpOpen(false);
					}}
				>
					<input
						className={s.input}
						type="number"
						inputMode="numeric"
						min={1}
						max={pages}
						value={jumpValue}
						onChange={(e) => setJumpValue(e.target.value)}
						aria-label={`Page number, 1 to ${pages}`}
						data-testid="pdf-jump-input"
					/>
				</form>
			</Dialog>

			<Sheet
				open={menu}
				title="PDF"
				onClose={() => setMenu(false)}
				testId="pdf-menu"
			>
				<SheetItem
					icon={<StretchHorizontal size={20} />}
					onClick={() => {
						setPreset("page-width");
						setMenu(false);
					}}
				>
					Fit width
				</SheetItem>
				<SheetItem
					icon={<Maximize size={20} />}
					onClick={() => {
						setPreset("page-fit");
						setMenu(false);
					}}
				>
					Whole page
				</SheetItem>
				<SheetItem
					icon={<RotateCw size={20} />}
					onClick={() => {
						const v = pdfViewer.current;
						if (v) v.pagesRotation = (v.pagesRotation + 90) % 360;
						setMenu(false);
					}}
				>
					Rotate
				</SheetItem>
				<SheetItem
					icon={<ListTree size={20} />}
					disabled={!outline?.length}
					hint={
						outline && !outline.length ? "This PDF has no outline" : undefined
					}
					onClick={() => {
						setMenu(false);
						setOutlineOpen(true);
					}}
				>
					Contents
				</SheetItem>
			</Sheet>

			<Sheet
				open={outlineOpen}
				title="Contents"
				onClose={() => setOutlineOpen(false)}
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
}: { items: Outline[]; depth: number; onPick: (dest: unknown) => void }) {
	return (
		<>
			{items.map((item, i) => (
				<div key={`${depth}-${i}-${item.title}`}>
					<button
						type="button"
						className={s.outline}
						style={{ paddingLeft: 12 + depth * 16 }}
						onClick={() => onPick(item.dest)}
					>
						{item.title}
					</button>
					{item.items?.length > 0 && (
						<OutlineList items={item.items} depth={depth + 1} onPick={onPick} />
					)}
				</div>
			))}
		</>
	);
}
