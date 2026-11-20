import { msg, t } from "@/lib/i18n";
import { findPage, warmUp } from "@/lib/scan/detect";
import {
	type Quad,
	fullQuad,
	isConvex,
	quadGap,
	scaleQuad,
} from "@/lib/scan/geometry";
import { type Photo, ScanJob, decodePhoto, photoScale } from "@/lib/scan/job";
import { LOOKS, type Look } from "@/lib/scan/pixels";
import { useBackClose } from "@/state/navigation";
import { Button, IconButton, toast } from "@/ui";
import { useModalFocus } from "@/ui/Overlay";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	Info,
	Maximize,
	RotateCcw,
	RotateCw,
	ScanSearch,
	TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Corners, useFit, usePainted } from "./Corners";
import s from "./Scan.module.css";

export const LOOK_NAMES: Record<Look, string> = {
	clean: msg("Clean"),
	original: msg("Original"),
	gray: msg("Grey"),
	bw: msg("Black & white"),
};

/** How a page was set up: where it is in its photo (in the kept
 * photo's pixels), how far it is turned, and how it looks. */
export interface PageSetup {
	quad: Quad;
	quarters: number;
	look: Look;
}

export interface EditResult extends PageSetup {
	/** The photo's worker, handed over to make the full-size page. */
	job: ScanJob;
	/** A small picture of the page as it will look. */
	thumb: Blob | null;
}

type Phase = "opening" | "finding" | "edges" | "looking" | "look" | "failed";

const PREVIEW = 1200;
const reduced = () =>
	typeof window !== "undefined" &&
	window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A picture of the chosen look, small, turned as the page is. */
function thumbOf(bitmap: ImageBitmap, quarters: number): Promise<Blob | null> {
	const by = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * by);
	const h = Math.round(bitmap.height * by);
	const side = quarters % 2 === 1;
	const canvas = document.createElement("canvas");
	canvas.width = side ? h : w;
	canvas.height = side ? w : h;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		canvas.width = 0;
		canvas.height = 0;
		return Promise.resolve(null);
	}
	ctx.translate(canvas.width / 2, canvas.height / 2);
	ctx.rotate((quarters * Math.PI) / 2);
	ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
	return new Promise((done) =>
		canvas.toBlob(
			(blob) => {
				canvas.width = 0;
				canvas.height = 0;
				done(blob);
			},
			"image/jpeg",
			0.82,
		),
	);
}

/**
 * One page of a scan, full screen, in two steps: find the page's edges
 * in the photo (found by themselves where they can be, dragged into
 * place where they cannot), then choose how it looks.
 */
export function ScanEditor({
	source,
	initial,
	page,
	editing,
	onCancel,
	onDone,
}: {
	source: Blob;
	initial?: PageSetup;
	/** Which page of the scan this is, counting from 1. */
	page: number;
	/** True when an existing page is being changed. */
	editing: boolean;
	onCancel: () => void;
	onDone: (result: EditResult) => void;
}) {
	const root = useRef<HTMLDivElement>(null);
	const [phase, setPhase] = useState<Phase>("opening");
	const [photo, setPhoto] = useState<Photo | null>(null);
	/** In the editor's (view) pixels. */
	const [quad, setQuad] = useState<Quad | null>(null);
	const [found, setFound] = useState(true);
	const [quarters, setQuarters] = useState(initial?.quarters ?? 0);
	const [look, setLook] = useState<Look>(initial?.look ?? "clean");
	const [looks, setLooks] = useState<Record<Look, ImageBitmap> | null>(null);
	const looksFor = useRef<Quad | null>(null);
	const job = useRef<ScanJob | null>(null);
	const handedOver = useRef(false);
	const alive = useRef(true);

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	/** The glide under way; a hand on a corner stops it. */
	const gliding = useRef(0);
	/** Where the outline is gliding to, until it gets there. */
	const target = useRef<Quad | null>(null);
	/** Ease the outline from where it is to where it should be. */
	const glide = useCallback((from: Quad, to: Quad) => {
		const run = ++gliding.current;
		if (reduced()) {
			target.current = null;
			setQuad(to);
			return;
		}
		target.current = to;
		const start = performance.now();
		const step = (now: number) => {
			if (!alive.current || gliding.current !== run) return;
			const k = Math.min(1, (now - start) / 420);
			const e = 1 - (1 - k) ** 3;
			setQuad(
				from.map((p, i) => ({
					x: p.x + (to[i].x - p.x) * e,
					y: p.y + (to[i].y - p.y) * e,
				})) as Quad,
			);
			if (k < 1) requestAnimationFrame(step);
			else target.current = null;
		};
		requestAnimationFrame(step);
	}, []);
	/** Stop any glide where it was going: the outline as it will be. */
	const settle = (): Quad | null => {
		const to = target.current;
		if (!to) return quad;
		gliding.current++;
		target.current = null;
		setQuad(to);
		return to;
	};

	const find = useCallback(
		async (p: Photo, from: Quad) => {
			setPhase("finding");
			const started = performance.now();
			try {
				const result = await findPage(p.find);
				// Long enough to see what happened, never a flash.
				const wait = 650 - (performance.now() - started);
				if (wait > 0) await new Promise((r) => setTimeout(r, wait));
				if (!alive.current) return;
				const scale = photoScale(p);
				const to = scaleQuad(result.quad, scale.find / scale.view);
				setFound(result.found);
				setPhase("edges");
				glide(from, to);
			} catch {
				if (!alive.current) return;
				setFound(false);
				setPhase("edges");
			}
		},
		[glide],
	);

	// Open the photo, start its worker, look for the page: once, for the
	// editor's whole life.
	// biome-ignore lint/correctness/useExhaustiveDependencies: once per editor
	useEffect(() => {
		warmUp();
		let cancelled = false;
		decodePhoto(source)
			.then((p) => {
				if (cancelled) {
					p.bitmap.close();
					p.view.width = 0;
					p.view.height = 0;
					p.find.width = 0;
					p.find.height = 0;
					return;
				}
				const scale = photoScale(p);
				job.current = new ScanJob(p.bitmap);
				setPhoto(p);
				const whole = fullQuad(p.view.width, p.view.height);
				if (initial) {
					setQuad(scaleQuad(initial.quad, 1 / scale.view));
					setPhase("edges");
				} else {
					setQuad(whole);
					find(p, whole);
				}
			})
			.catch(() => {
				if (!cancelled && alive.current) setPhase("failed");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Let go of the worker, canvases and previews, unless the page was kept.
	useEffect(
		() => () => {
			if (!handedOver.current) job.current?.close();
		},
		[],
	);
	useEffect(
		() => () => {
			if (photo) {
				photo.view.width = 0;
				photo.view.height = 0;
				photo.find.width = 0;
				photo.find.height = 0;
			}
		},
		[photo],
	);
	useEffect(
		() => () => {
			if (looks) for (const b of Object.values(looks)) b.close();
		},
		[looks],
	);

	const scale = photo ? photoScale(photo) : null;
	const good = !!quad && isConvex(quad);

	const toLooks = async () => {
		// A tap on Next mid-glide means the outline where it was going.
		const outline = settle();
		if (!photo || !outline || !scale || !job.current || !isConvex(outline))
			return;
		// The same outline as last time: its looks are ready.
		if (looks && looksFor.current && quadGap(looksFor.current, outline) < 0.5) {
			setPhase("look");
			return;
		}
		setPhase("looking");
		try {
			const started = performance.now();
			const made = await job.current.looks(
				scaleQuad(outline, scale.view),
				0,
				PREVIEW,
			);
			const wait = 450 - (performance.now() - started);
			if (wait > 0) await new Promise((r) => setTimeout(r, wait));
			if (!alive.current) {
				for (const b of Object.values(made)) b.close();
				return;
			}
			looksFor.current = outline;
			setLooks(made);
			setPhase("look");
		} catch {
			// The outline stays as it was: try again, or change it first.
			if (!alive.current) return;
			setPhase("edges");
			toast(t("Something went wrong with this photo."));
		}
	};

	const [finishing, setFinishing] = useState(false);
	const finished = useRef(false);
	const finish = async () => {
		// The page is the one the looks were made from, made once.
		const outline = looksFor.current;
		if (finished.current || !looks || !outline || !scale || !job.current)
			return;
		finished.current = true;
		setFinishing(true);
		const thumb = await thumbOf(looks[look], quarters).catch(() => null);
		if (!alive.current) return;
		handedOver.current = true;
		onDone({
			quad: scaleQuad(outline, scale.view),
			quarters,
			look,
			job: job.current,
			thumb,
		});
	};

	const back = () => {
		if (phase === "look") setPhase("edges");
		else onCancel();
	};
	useBackClose("scan-editor", true, back);
	useModalFocus(root, back);

	const onEdges =
		phase === "opening" || phase === "finding" || phase === "edges";
	const stepTitle = onEdges ? t("Check the edges") : t("Choose a look");

	return createPortal(
		<div
			ref={root}
			tabIndex={-1}
			className={s.editor}
			// biome-ignore lint/a11y/useSemanticElements: a full-screen surface, not a native dialog
			role="dialog"
			aria-modal="true"
			aria-label={t("Scan a document")}
			data-testid="scan-editor"
		>
			<header className={s.bar} data-tauri-drag-region="deep">
				<IconButton label={t("Back")} onClick={back} data-testid="scan-back">
					<ArrowLeft size={22} className="pw-flip" />
				</IconButton>
				<div className={s.title}>
					<strong>{stepTitle}</strong>
					<span>{t("Page {n}", { n: page })}</span>
				</div>
				{!onEdges && (
					<div className={s.turns}>
						<IconButton
							label={t("Turn left")}
							onClick={() => setQuarters((q) => (q + 3) % 4)}
							disabled={phase !== "look"}
						>
							<RotateCcw size={20} />
						</IconButton>
						<IconButton
							label={t("Turn right")}
							onClick={() => setQuarters((q) => (q + 1) % 4)}
							disabled={phase !== "look"}
							data-testid="scan-turn-right"
						>
							<RotateCw size={20} />
						</IconButton>
					</div>
				)}
				<ol className={s.stepper} aria-label={t("Steps")}>
					<li
						aria-current={onEdges ? "step" : undefined}
						data-done={!onEdges || undefined}
					>
						<span>{onEdges ? 1 : <Check size={11} />}</span>
						{t("Edges")}
					</li>
					<li aria-current={!onEdges ? "step" : undefined}>
						<span>2</span>
						{t("Look")}
					</li>
				</ol>
			</header>
			<Hint phase={phase} found={found} good={good} />
			{phase === "failed" ? (
				<div className={s.stage}>
					<div className={s.failed} role="alert">
						<TriangleAlert size={32} />
						<p>{t("This photo couldn't be opened.")}</p>
						<Button variant="secondary" onClick={onCancel}>
							{t("Close")}
						</Button>
					</div>
				</div>
			) : !photo || !quad ? (
				<div className={s.stage}>
					<div className={s.opening}>
						<Busy label={t("Opening your photo…")} />
					</div>
				</div>
			) : onEdges ? (
				<Corners
					image={photo.view}
					quad={quad}
					onChange={(q) => {
						gliding.current++;
						target.current = null;
						setQuad(q);
					}}
					showHandles={phase === "edges"}
				>
					{phase === "finding" && (
						<div className={s.busy}>
							<div className={s.veil} />
							<div className={s.sweep} />
							<Busy label={t("Finding the page…")} />
						</div>
					)}
				</Corners>
			) : (
				<LookView
					bitmap={looks?.[look] ?? null}
					quarters={quarters}
					busy={phase === "looking"}
				/>
			)}
			{phase === "failed" ? null : onEdges ? (
				<div className={s.tools}>
					<Button
						variant="ghost"
						disabled={phase !== "edges" || !photo}
						onClick={() =>
							photo &&
							quad &&
							glide(quad, fullQuad(photo.view.width, photo.view.height))
						}
						data-testid="scan-whole"
					>
						<Maximize size={18} />
						{t("Whole photo")}
					</Button>
					<Button
						variant="ghost"
						disabled={phase !== "edges" || !photo}
						onClick={() => photo && quad && find(photo, quad)}
						data-testid="scan-find"
					>
						<ScanSearch size={18} />
						{t("Find edges")}
					</Button>
				</div>
			) : (
				<div className={s.looks} role="toolbar" aria-label={t("Looks")}>
					{LOOKS.map((name) => (
						<LookChoice
							key={name}
							name={name}
							bitmap={looks?.[name] ?? null}
							quarters={quarters}
							chosen={look === name}
							onPick={() => setLook(name)}
						/>
					))}
				</div>
			)}
			{phase !== "failed" && (
				<footer className={s.footer}>
					{onEdges ? (
						<>
							<Button variant="ghost" onClick={onCancel}>
								{t("Cancel")}
							</Button>
							<Button
								onClick={toLooks}
								disabled={phase !== "edges" || !good}
								data-testid="scan-next"
							>
								{t("Next")}
								<ArrowRight size={18} className="pw-flip" />
							</Button>
						</>
					) : (
						<>
							<Button variant="ghost" onClick={() => setPhase("edges")}>
								<ArrowLeft size={18} className="pw-flip" />
								{t("Edges")}
							</Button>
							<Button
								onClick={finish}
								disabled={phase !== "look" || finishing}
								data-testid="scan-done"
							>
								<Check size={18} />
								{editing ? t("Done") : t("Add page")}
							</Button>
						</>
					)}
				</footer>
			)}
		</div>,
		document.body,
	);
}

function Hint({
	phase,
	found,
	good,
}: {
	phase: Phase;
	found: boolean;
	good: boolean;
}) {
	const warn = phase === "edges" && (!good || !found);
	const text =
		phase === "opening"
			? t("Getting your photo ready.")
			: phase === "finding"
				? t("Looking for the edges of the page.")
				: phase === "edges"
					? !good
						? t(
								"The corners cross over. Move them back into the shape of the page.",
							)
						: found
							? t(
									"Drag the circles onto the corners of the page if they are not quite there.",
								)
							: t(
									"We couldn't find the page by ourselves. Drag the circles onto its corners.",
								)
					: phase === "failed"
						? t("Something went wrong with this photo.")
						: t("Pick the look you like. Turn the page if it is on its side.");
	return (
		<p
			className={s.hint}
			data-tone={warn ? "warn" : undefined}
			aria-live="polite"
			data-testid="scan-hint"
		>
			{warn ? <TriangleAlert size={17} /> : <Info size={17} />}
			{text}
		</p>
	);
}

function Busy({ label }: { label: string }) {
	return (
		<output className={s.pill} data-testid="scan-busy">
			<span className={s.spinner} aria-hidden="true" />
			{label}
		</output>
	);
}

/** The page as it will look, as large as the stage allows. */
function LookView({
	bitmap,
	quarters,
	busy,
}: {
	bitmap: ImageBitmap | null;
	quarters: number;
	busy: boolean;
}) {
	const stage = useRef<HTMLDivElement>(null);
	const side = quarters % 2 === 1;
	const w = bitmap ? (side ? bitmap.height : bitmap.width) : 3;
	const h = bitmap ? (side ? bitmap.width : bitmap.height) : 4;
	const box = useFit(stage, w, h);
	const canvas = usePainted(bitmap, w, h, quarters);
	return (
		<div ref={stage} className={s.stage}>
			{bitmap && box.scale > 0 && (
				<div
					key={`${quarters}`}
					className={s.frame}
					data-settle
					style={{
						left: box.left,
						top: box.top,
						width: w * box.scale,
						height: h * box.scale,
					}}
				>
					<canvas ref={canvas} data-testid="scan-preview" />
				</div>
			)}
			{busy && (
				<div className={s.busy}>
					<Busy label={t("Straightening the page…")} />
				</div>
			)}
		</div>
	);
}

function LookChoice({
	name,
	bitmap,
	quarters,
	chosen,
	onPick,
}: {
	name: Look;
	bitmap: ImageBitmap | null;
	quarters: number;
	chosen: boolean;
	onPick: () => void;
}) {
	const side = quarters % 2 === 1;
	const bw = bitmap ? (side ? bitmap.height : bitmap.width) : 56;
	const bh = bitmap ? (side ? bitmap.width : bitmap.height) : 72;
	const by = Math.min(112 / bw, 144 / bh);
	const canvas = usePainted(
		bitmap,
		Math.max(1, Math.round(bw * by)),
		Math.max(1, Math.round(bh * by)),
		quarters,
	);
	return (
		<button
			type="button"
			className={s.look}
			aria-pressed={chosen}
			onClick={onPick}
			disabled={!bitmap}
			data-testid={`scan-look-${name}`}
		>
			<canvas ref={canvas} />
			{t(LOOK_NAMES[name])}
		</button>
	);
}
