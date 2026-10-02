import { t, tn } from "@/lib/i18n";
import { isDarkTheme } from "@/lib/settings";
import type { Position } from "@/lib/types";
import { useSettings } from "@/state/settings";
import {
	Button,
	ErrorArt,
	IconButton,
	Sheet,
	SheetItem,
	Spinner,
	StateView,
	toast,
} from "@/ui";
import {
	LayoutGrid,
	ListTree,
	Maximize,
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
import { useCallback, useEffect, useRef, useState } from "react";
import { PageJump, PasswordDialog } from "./Dialogs";
import { PdfThumbs } from "./PdfThumbs";
import s from "./PdfView.module.css";
import { Scrubber } from "./Scrubber";
import {
	FindBar,
	type FindState,
	Shell,
	ZoomControl,
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
	const [pages, setPages] = useState(0);
	const [scaleLabel, setScaleLabel] = useState("");
	const [chromeHidden, setChromeHidden] = useState(false);
	const [outline, setOutline] = useState<Outline[] | null>(null);
	const [outlineOpen, setOutlineOpen] = useState(false);
	const [thumbsOpen, setThumbsOpen] = useState(false);
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
							? t(t("Fit width"))
							: e.presetValue === "page-fit"
								? t(t("Whole page"))
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
	/** The scale at which the current page fills the width. */
	const fitWidthScale = () => {
		const v = pdfViewer.current;
		const box = container.current;
		const view = v?.getPageView(v.currentPageNumber - 1) as
			| { width: number; scale: number }
			| undefined;
		if (!v || !box || !view?.width) return 1;
		return ((box.clientWidth - 40) / view.width) * view.scale;
	};
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
			const preset = ["page-width", "page-fit", "auto"].includes(
				v.currentScaleValue,
			);
			if (preset) zoomBy(2, [x, y]);
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

	const darkPages = settings.darkPages && isDarkTheme(theme);

	const pdfMenu = (close: () => void) => (
		<>
			<SheetItem
				icon={<StretchHorizontal size={20} />}
				onClick={() => {
					setPreset("page-width");
					close();
				}}
			>
				{t(t("Fit width"))}
			</SheetItem>
			<SheetItem
				icon={<Maximize size={20} />}
				onClick={() => {
					setPreset("page-fit");
					close();
				}}
			>
				{t(t("Whole page"))}
			</SheetItem>
			<SheetItem
				icon={<RotateCw size={20} />}
				onClick={() => {
					const v = pdfViewer.current;
					if (v) v.pagesRotation = (v.pagesRotation + 90) % 360;
					close();
				}}
			>
				{t("Rotate")}
			</SheetItem>
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
						? t(t("This PDF has no outline"))
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
	);

	/** Every page as an image at print resolution: the screen only
	 * ever holds the few pages around the reader. */
	const printPages = async (root: HTMLElement) => {
		if (!doc) return;
		if (doc.numPages > 20)
			toast(t("Preparing {n} pages for printing…", { n: doc.numPages }));
		for (let n = 1; n <= doc.numPages; n++) {
			const pdfPage = await doc.getPage(n);
			const rotation =
				(pdfPage.rotate + (pdfViewer.current?.pagesRotation ?? 0)) % 360;
			const base = pdfPage.getViewport({ scale: 1, rotation });
			// About 150 dpi on A4/Letter, bounded for very large pages.
			const scale = Math.min(2.2, 1650 / Math.max(base.width, base.height));
			const viewport = pdfPage.getViewport({ scale, rotation });
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
				canvas.toBlob(resolve, "image/jpeg", 0.9),
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

	const actions = (
		<>
			<IconButton
				label={t("Find")}
				onClick={() => setFindOpen(true)}
				active={findOpen}
				data-testid="pdf-find"
			>
				<Search size={20} />
			</IconButton>
		</>
	);

	const bottom =
		status === "ready" ? (
			<div className={shellStyles.pager}>
				<PageJump page={page} pages={pages} onGo={goTo} testId="pdf" />
				<ZoomControl
					label={scaleLabel || t(t("Fit width"))}
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
					testId="pdf"
				/>
			</div>
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
			bottom={bottom}
			onFind={status === "ready" ? () => setFindOpen(true) : undefined}
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

			<Sheet
				open={thumbsOpen}
				title={tn(pages, "{n} page", "{n} pages")}
				onClose={() => setThumbsOpen(false)}
			>
				{doc && (
					<PdfThumbs
						doc={doc}
						current={page}
						rotation={pdfViewer.current?.pagesRotation ?? 0}
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
