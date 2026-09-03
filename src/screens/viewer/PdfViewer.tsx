import { formatCssVar } from "@/components/FormatBadge";
import {
	Button,
	Dialog,
	IconButton,
	Scrubber,
	Sheet,
	TextField,
} from "@/components/ui";
import type { FilePosition } from "@/lib/types";
import { haptic, useSettings } from "@/state/SettingsContext";
import { Grid3x3, List, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
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

type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;
type OutlineNode = { title: string; dest: unknown; items: OutlineNode[] };

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
`;

const Pages = styled.div<{ $darken: boolean }>`
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	filter: ${({ $darken }) => ($darken ? "invert(0.92) hue-rotate(180deg)" : "none")};
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
	const [zoom, setZoom] = useState(1);
	const [fitMode, setFitMode] = useState<"width" | "page">(
		settings["viewer.zoom_mode_pdf"] === "fit_page" ? "page" : "width",
	);
	const [outline, setOutline] = useState<OutlineNode[] | null>(null);
	const [outlineOpen, setOutlineOpen] = useState(false);
	const [thumbsOpen, setThumbsOpen] = useState(false);
	const [passwordOpen, setPasswordOpen] = useState(false);
	const [password, setPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [rotation, setRotation] = useState(0);
	const [box, setBox] = useState({ width: 600, height: 800 });

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const pageRefs = useRef(new Map<number, HTMLDivElement>());
	const containerWidth = useRef(800);
	const dataRef = useRef(data);
	const positionTimer = useRef<number | null>(null);
	const restored = useRef(false);

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
			pdf.getOutline().then((o) => setOutline(o as unknown as OutlineNode[]));
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

	const unlock = useCallback(() => {
		setPasswordOpen(false);
		setPasswordError(null);
		setLoadProgress(0.05);
		load(dataRef.current, password);
	}, [load, password]);

	// --- page geometry ---
	useEffect(() => {
		if (!doc) return;
		let cancelled = false;
		const el = scrollRef.current;
		if (el) containerWidth.current = el.clientWidth - 16;
		doc.getPage(1).then((page) => {
			if (cancelled) return;
			const vp = page.getViewport({ scale: 1, rotation });
			const scale =
				fitMode === "width"
					? containerWidth.current / vp.width
					: Math.min(
							containerWidth.current / vp.width,
							(window.innerHeight - 24) / vp.height,
						);
			setBox({
				width: Math.round(vp.width * scale * zoom),
				height: Math.round(vp.height * scale * zoom),
			});
		});
		return () => {
			cancelled = true;
		};
	}, [doc, fitMode, zoom, rotation]);

	// --- virtualized rendering: visible pages plus margin ---
	useEffect(() => {
		if (!doc || box.width < 50) return;
		let cancelled = false;
		const inflight = new Map<number, boolean>();

		const renderPage = async (pageNum: number, el: HTMLElement) => {
			if (inflight.get(pageNum)) return;
			inflight.set(pageNum, true);
			try {
				const page = await doc.getPage(pageNum);
				if (cancelled) return;
				const base = page.getViewport({ scale: 1, rotation });
				const scale =
					(box.width / base.width) * Math.min(2, window.devicePixelRatio);
				const viewport = page.getViewport({ scale, rotation });
				const canvas = document.createElement("canvas");
				canvas.width = Math.floor(viewport.width);
				canvas.height = Math.floor(viewport.height);
				const ctx = canvas.getContext("2d");
				if (!ctx) return;
				await page.render({ canvasContext: ctx, viewport }).promise;
				if (cancelled) return;
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
						renderPage(pageNum, entry.target as HTMLElement);
					}
				}
			},
			{ root: scrollRef.current, rootMargin: "600px 0px" },
		);

		pageRefs.current.forEach((el) => {
			observer.observe(el);
			if (!el.querySelector("canvas")) renderPage(Number(el.dataset.page), el);
		});

		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [doc, box, rotation]);

	// --- restore position once geometry is known ---
	useEffect(() => {
		if (!doc || restored.current || box.width < 50) return;
		restored.current = true;
		if (
			!initialPosition ||
			box.width < 50 ||
			!settings["viewer.remember_position"]
		) {
			return;
		}
		const el = scrollRef.current;
		if (!el) return;
		if (initialPosition.page && initialPosition.page > 0) {
			const target = pageRefs.current.get(initialPosition.page);
			target?.scrollIntoView({ block: "start" });
			setCurrentPage(initialPosition.page);
		} else if (initialPosition.scrollRatio) {
			el.scrollTop =
				initialPosition.scrollRatio * (el.scrollHeight - el.clientHeight);
		}
	}, [doc, box, initialPosition, settings]);

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
		if (fitMode !== "page") {
			setFitMode("page");
		} else {
			setFitMode("width");
			setZoom(1);
		}
	}, [fitMode, settings]);

	const stepZoom = useCallback(
		(delta: number) => {
			haptic(settings);
			setZoom((z) => Math.min(4, Math.max(0.5, z + delta)));
		},
		[settings],
	);

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
					<IconButton label="Zoom out" onClick={() => stepZoom(-0.25)}>
						<ZoomOut size={20} />
					</IconButton>
					<IconButton label="Zoom in" onClick={() => stepZoom(0.25)}>
						<ZoomIn size={20} />
					</IconButton>
					<IconButton
						label="Rotate"
						onClick={() => setRotation((r) => (r + 90) % 360)}
					>
						<RotateCw size={20} />
					</IconButton>
					<IconButton
						label="Outline"
						onClick={() => setOutlineOpen(true)}
						disabled={!outline || outline.length === 0}
					>
						<List size={20} />
					</IconButton>
					<IconButton
						label="Page thumbnails"
						onClick={() => setThumbsOpen(true)}
					>
						<Grid3x3 size={20} />
					</IconButton>
				</>
			}
			bottomBar={
				doc ? (
					<Scrubber
						value={currentPage}
						max={doc.numPages}
						onChange={goToPage}
						label="Page"
					/>
				) : undefined
			}
		>
			<ScrollWrap ref={scrollRef} onScroll={onScroll} onDoubleClick={cycleZoom}>
				<Pages $darken={darkenPages}>
					{doc &&
						Array.from({ length: doc.numPages }, (_, i) => (
							<PageBox
								key={`page-${i + 1}`}
								data-page={i + 1}
								ref={(el) => {
									if (el) pageRefs.current.set(i + 1, el);
									else pageRefs.current.delete(i + 1);
								}}
								$width={box.width}
								$height={box.height}
							/>
						))}
				</Pages>
			</ScrollWrap>

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
		doc.getPage(pageNum).then((page) => {
			if (cancelled || !ref.current) return;
			if (ref.current.querySelector("canvas")) return;
			const viewport = page.getViewport({ scale: 0.25 });
			const canvas = document.createElement("canvas");
			canvas.width = Math.floor(viewport.width);
			canvas.height = Math.floor(viewport.height);
			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			page.render({ canvasContext: ctx, viewport }).promise.then(() => {
				if (!cancelled && ref.current) {
					ref.current.replaceChildren(canvas);
				}
			});
		});
		return () => {
			cancelled = true;
		};
	}, [doc, pageNum]);

	return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
