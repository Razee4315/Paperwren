import { backend } from "@/lib/backend";
import { isDesktop, isTouch } from "@/lib/env";
import { unreadNote } from "@/lib/errors";
import { t, tn } from "@/lib/i18n";
import { SCAN_MARK, scansToPdf } from "@/lib/pdfTools";
import { findPage, warmUp } from "@/lib/scan/detect";
import { scaleQuad } from "@/lib/scan/geometry";
import { ScanJob, decodePhoto, photoScale } from "@/lib/scan/job";
import type { OpenRequest } from "@/lib/types";
import { Button, IconButton, Switch, toast } from "@/ui";
import {
	ArrowLeft,
	ArrowRight,
	Camera,
	Crop,
	FileDown,
	Images,
	Pencil,
	Sparkles,
	Trash2,
} from "lucide-react";
import {
	Component,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Choice, Go, useRun } from "../kit";
import s from "./Scan.module.css";
import { type EditResult, type PageSetup, ScanEditor } from "./ScanEditor";

interface ScanPage extends PageSetup {
	key: number;
	/** The photo as it was taken or chosen. */
	source: Blob;
	state: "working" | "ready" | "failed";
	/** A small picture of the page, to show. */
	thumb: string | null;
	/** The finished page. */
	jpeg?: Blob;
	width?: number;
	height?: number;
	/** Bumped on each change, so a slow old render never wins. */
	version: number;
}

let keys = 0;
const MARK_KEY = "paperwren.scanMark";

function markSetting(): boolean {
	try {
		return localStorage.getItem(MARK_KEY) !== "off";
	} catch {
		return true;
	}
}

/** "Scan 2026-10-18 14.05.pdf", in the reader's language. */
function scanName(): string {
	const d = new Date();
	const two = (n: number) => String(n).padStart(2, "0");
	return `${t("Scan")} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.pdf`;
}

/** The phone's camera is offered where there is one to hand over to. */
const hasCamera = isTouch && !isDesktop;

/**
 * Paper to PDF: photograph each page (or choose photos already taken),
 * check its edges and pick its look, then save the pages as one PDF.
 * The camera is the phone's own camera app, handed the job: Paperwren
 * itself asks for no permission to use it.
 */
export function ScanTool({
	file,
	onOpen,
}: {
	file?: OpenRequest;
	onOpen: (request: OpenRequest) => void;
}) {
	const [pages, setPages] = useState<ScanPage[]>([]);
	const pagesRef = useRef(pages);
	pagesRef.current = pages;
	const [editing, setEditing] = useState<{
		source: Blob;
		key?: number;
		initial?: PageSetup;
	} | null>(null);
	const [paper, setPaper] = useState<"fit" | "a4" | "letter">("fit");
	const [mark, setMarkState] = useState(markSetting);
	const { running, run, feedback } = useRun(onOpen);
	const camera = useRef<HTMLInputElement>(null);
	const photos = useRef<HTMLInputElement>(null);
	const queue = useRef<Promise<unknown>>(Promise.resolve());

	const setMark = (on: boolean) => {
		setMarkState(on);
		try {
			localStorage.setItem(MARK_KEY, on ? "on" : "off");
		} catch {
			// Not remembered: on again next time.
		}
	};

	const update = useCallback(
		(key: number, change: (page: ScanPage) => Partial<ScanPage> | null) =>
			setPages((list) =>
				list.map((p) => {
					if (p.key !== key) return p;
					const next = change(p);
					if (!next) return p;
					if (next.thumb !== undefined && p.thumb && next.thumb !== p.thumb)
						URL.revokeObjectURL(p.thumb);
					return { ...p, ...next };
				}),
			),
		[],
	);

	/** Make the full-size page, then let the photo's worker go. */
	const renderNow = useCallback(
		async (key: number, version: number, job: ScanJob, setup: PageSetup) => {
			try {
				const made = await job.render(setup.quad, setup.quarters, setup.look);
				update(key, (p) =>
					p.version === version
						? {
								state: "ready",
								jpeg: made.jpeg,
								width: made.width,
								height: made.height,
								thumb: URL.createObjectURL(made.thumb),
							}
						: null,
				);
			} catch {
				update(key, (p) =>
					p.version === version ? { state: "failed" } : null,
				);
			} finally {
				job.close();
			}
		},
		[update],
	);
	/** The same in the background, one page at a time. */
	const render = useCallback(
		(key: number, version: number, job: ScanJob, setup: PageSetup) => {
			queue.current = queue.current.then(() =>
				renderNow(key, version, job, setup),
			);
		},
		[renderNow],
	);

	/** Several photos at once: each found, straightened and cleaned by
	 * itself, to be checked afterwards with a tap. */
	const addMany = useCallback(
		(files: Blob[]) => {
			const added = files.map<ScanPage>((source) => ({
				key: ++keys,
				source,
				quad: [
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
					{ x: 0, y: 0 },
				],
				quarters: 0,
				look: "clean",
				state: "working",
				thumb: null,
				version: 1,
			}));
			setPages((list) => [...list, ...added]);
			for (const page of added) {
				queue.current = queue.current.then(async () => {
					try {
						const photo = await decodePhoto(page.source);
						const found = await findPage(photo.find);
						const setup: PageSetup = {
							quad: scaleQuad(found.quad, photoScale(photo).find),
							quarters: 0,
							look: "clean",
						};
						update(page.key, () => setup);
						// Made now, not queued: only one photo is held at a time.
						await renderNow(page.key, 1, new ScanJob(photo.bitmap), setup);
					} catch {
						update(page.key, () => ({ state: "failed" }));
					}
				});
			}
		},
		[renderNow, update],
	);

	const take = (list: FileList | null) => {
		const files = [...(list ?? [])].filter(
			(f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name),
		);
		if (list?.length && !files.length) toast(t("Choose a photo or a picture"));
		if (files.length === 1) setEditing({ source: files[0] });
		else if (files.length > 1) addMany(files);
	};

	// A picture handed in from the viewer opens straight in the editor.
	const given = useRef(false);
	useEffect(() => {
		if (!file || given.current) return;
		given.current = true;
		backend
			.read(file.reopen)
			.then((bytes) => setEditing({ source: new Blob([bytes]) }))
			.catch((err) => toast(unreadNote(err, file.name)));
	}, [file]);

	useEffect(() => {
		warmUp();
		return () => {
			for (const p of pagesRef.current)
				if (p.thumb) URL.revokeObjectURL(p.thumb);
		};
	}, []);

	const done = (result: EditResult) => {
		const target = editing;
		setEditing(null);
		if (!target) return;
		const setup: PageSetup = {
			quad: result.quad,
			quarters: result.quarters,
			look: result.look,
		};
		const thumb = result.thumb ? URL.createObjectURL(result.thumb) : null;
		if (target.key !== undefined) {
			const key = target.key;
			const version =
				(pagesRef.current.find((p) => p.key === key)?.version ?? 0) + 1;
			update(key, () => ({ ...setup, state: "working", thumb, version }));
			render(key, version, result.job, setup);
			return;
		}
		const key = ++keys;
		setPages((list) => [
			...list,
			{
				key,
				source: target.source,
				...setup,
				state: "working",
				thumb,
				version: 1,
			},
		]);
		render(key, 1, result.job, setup);
	};

	const move = (key: number, by: -1 | 1) =>
		setPages((list) => {
			const at = list.findIndex((p) => p.key === key);
			const to = at + by;
			if (at < 0 || to < 0 || to >= list.length) return list;
			const next = [...list];
			[next[at], next[to]] = [next[to], next[at]];
			return next;
		});
	const remove = (key: number) =>
		setPages((list) => {
			const page = list.find((p) => p.key === key);
			if (page?.thumb) URL.revokeObjectURL(page.thumb);
			return list.filter((p) => p.key !== key);
		});

	const working = pages.filter((p) => p.state === "working").length;
	const failed = pages.some((p) => p.state === "failed");

	const save = () =>
		run(async () => {
			// Wait for pages still being made.
			for (;;) {
				const before = queue.current;
				await before;
				if (before === queue.current) break;
			}
			const ready = pagesRef.current;
			if (!ready.length || ready.some((p) => !p.jpeg || p.state !== "ready"))
				throw new Error("pages not ready");
			const scans = await Promise.all(
				ready.map(async (p) => ({
					bytes: new Uint8Array(await (p.jpeg as Blob).arrayBuffer()),
					width: p.width ?? 1,
					height: p.height ?? 1,
				})),
			);
			return {
				name: scanName(),
				bytes: await scansToPdf(scans, {
					paper,
					mark: mark ? SCAN_MARK : undefined,
				}),
				mime: "application/pdf",
			};
		});

	const inputs = (
		<>
			<input
				ref={camera}
				type="file"
				accept="image/*"
				capture="environment"
				hidden
				onChange={(e) => {
					take(e.target.files);
					e.target.value = "";
				}}
				data-testid="scan-camera-input"
			/>
			<input
				ref={photos}
				type="file"
				accept="image/*,.heic,.heif"
				multiple
				hidden
				onChange={(e) => {
					take(e.target.files);
					e.target.value = "";
				}}
				data-testid="scan-photos-input"
			/>
		</>
	);
	const openCamera = () => camera.current?.click();
	const openPhotos = () => photos.current?.click();

	return (
		<>
			{inputs}
			{!pages.length ? (
				<>
					<div className={s.start}>
						<ScanArt />
						<h3>{t("Turn paper into a PDF")}</h3>
						<p>
							{hasCamera
								? t(
										"Take a photo of the page, or choose photos you already have. Paperwren finds the edges, straightens the page and cleans it up.",
									)
								: t(
										"Choose photos of your pages. Paperwren finds the edges, straightens each page and cleans it up.",
									)}
						</p>
						<div className={s.buttons}>
							{hasCamera && (
								<Button onClick={openCamera} data-testid="scan-camera">
									<Camera size={18} />
									{t("Take a photo")}
								</Button>
							)}
							<Button
								variant={hasCamera ? "secondary" : "primary"}
								onClick={openPhotos}
								data-testid="scan-photos"
							>
								<Images size={18} />
								{t("Choose photos")}
							</Button>
						</div>
					</div>
					<ol className={s.howTo}>
						<li>
							<span>
								<Crop size={17} />
							</span>
							{t("We find the page's edges; drag them if you need to")}
						</li>
						<li>
							<span>
								<Sparkles size={17} />
							</span>
							{t("Pick a look: clean, grey or black & white")}
						</li>
						<li>
							<span>
								<FileDown size={17} />
							</span>
							{t("Save every page together as one PDF")}
						</li>
					</ol>
				</>
			) : (
				<>
					<div className={s.pagesHead}>
						<h3>{t("Your pages")}</h3>
						<span>{tn(pages.length, "{n} page", "{n} pages")}</span>
					</div>
					<div className={s.pages} data-testid="scan-pages">
						{pages.map((p, i) => (
							<div key={p.key} className={s.page} data-testid="scan-page">
								<button
									type="button"
									className={s.pageOpen}
									data-state={p.state}
									disabled={p.state === "working" && !p.thumb}
									aria-label={t("Change page {n}", { n: i + 1 })}
									onClick={() =>
										setEditing({
											source: p.source,
											key: p.key,
											initial:
												p.state === "failed"
													? undefined
													: {
															quad: p.quad,
															quarters: p.quarters,
															look: p.look,
														},
										})
									}
								>
									{p.thumb ? (
										<img src={p.thumb} alt="" />
									) : p.state === "failed" ? (
										t("Couldn't make this page. Tap to try again.")
									) : (
										<span className={s.placeholder} />
									)}
									<span className={s.pageNumber}>{i + 1}</span>
									{p.state === "working" ? (
										<span
											className={s.working}
											role="status"
											aria-label={t("Working…")}
										/>
									) : (
										p.state === "ready" && (
											<span className={s.pageEdit} aria-hidden="true">
												<Pencil size={14} />
											</span>
										)
									)}
								</button>
								<div className={s.pageTools}>
									<IconButton
										label={t("Move earlier")}
										disabled={i === 0}
										onClick={() => move(p.key, -1)}
									>
										<ArrowLeft size={17} className="pw-flip" />
									</IconButton>
									<IconButton
										label={t("Move later")}
										disabled={i === pages.length - 1}
										onClick={() => move(p.key, 1)}
									>
										<ArrowRight size={17} className="pw-flip" />
									</IconButton>
									<IconButton
										label={t("Remove page {n}", { n: i + 1 })}
										onClick={() => remove(p.key)}
										data-testid="scan-remove"
									>
										<Trash2 size={17} />
									</IconButton>
								</div>
							</div>
						))}
						<div className={s.addTile}>
							<span>{t("Add a page")}</span>
							{hasCamera && (
								<button type="button" onClick={openCamera}>
									<Camera size={17} />
									{t("Camera")}
								</button>
							)}
							<button
								type="button"
								onClick={openPhotos}
								data-testid="scan-add-photos"
							>
								<Images size={17} />
								{t("Photos")}
							</button>
						</div>
					</div>
					<p className={s.tapHint}>
						{failed
							? t("A page couldn't be made. Tap it to try again, or remove it.")
							: t("Tap a page to change its edges or its look.")}
					</p>
					<div className={s.options}>
						<Choice
							label={t("Page size")}
							value={paper}
							onChange={setPaper}
							options={[
								["fit", t("As scanned")],
								["a4", "A4"],
								["letter", "Letter"],
							]}
							testId="scan-paper"
						/>
						<div className={s.markRow}>
							<Switch
								label={t("Add “Scanned with Paperwren”")}
								hint={t(
									"A small grey line at the foot of each page. Turn it off for a clean page.",
								)}
								checked={mark}
								onChange={setMark}
								testId="scan-mark"
							/>
						</div>
					</div>
				</>
			)}
			{feedback}
			{pages.length > 0 && (
				<Go
					label={
						working
							? tn(working, "Finishing {n} page…", "Finishing {n} pages…")
							: t("Save PDF")
					}
					disabled={!pages.length || failed}
					running={running}
					onClick={save}
				/>
			)}
			{editing && (
				<EditorBoundary onFail={() => setEditing(null)}>
					<ScanEditor
						source={editing.source}
						initial={editing.initial}
						editing={editing.key !== undefined}
						page={
							editing.key !== undefined
								? pages.findIndex((p) => p.key === editing.key) + 1
								: pages.length + 1
						}
						onCancel={() => setEditing(null)}
						onDone={done}
					/>
				</EditorBoundary>
			)}
		</>
	);
}

/** Should the editor ever fail, it closes and says so; the pages
 * already made, and the rest of the app, stay as they were. */
class EditorBoundary extends Component<
	{ children: ReactNode; onFail: () => void },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch() {
		toast(t("Something went wrong with this photo."));
		this.props.onFail();
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}

/** A page with its corners found: the tool's picture. */
function ScanArt() {
	return (
		<svg className={s.startArt} viewBox="0 0 92 92" aria-hidden="true">
			<rect
				x="22"
				y="14"
				width="48"
				height="64"
				rx="4"
				fill="var(--surface)"
				stroke="var(--line-strong)"
				strokeWidth="1.5"
				transform="rotate(-6 46 46)"
			/>
			<g transform="rotate(-6 46 46)" fill="var(--accent)">
				<rect x="30" y="28" width="26" height="3.5" rx="1.75" />
				<rect x="30" y="36" width="32" height="3.5" rx="1.75" opacity="0.7" />
				<rect x="30" y="44" width="20" height="3.5" rx="1.75" opacity="0.5" />
			</g>
			<g
				fill="none"
				stroke="var(--accent)"
				strokeWidth="3.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M10 22V10h12" />
				<path d="M70 10h12v12" />
				<path d="M82 70v12H70" />
				<path d="M22 82H10V70" />
			</g>
		</svg>
	);
}
