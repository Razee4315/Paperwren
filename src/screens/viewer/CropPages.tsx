/**
 * Crop by hand: one page large, with the box of what is kept over it to
 * drag by its corners and edges (or move with the arrow keys), and which
 * pages the box is for. It starts from the crop the pages have, or from
 * the app's own when they have none. Only the view changes: the file is
 * never touched.
 */

import {
	type CropChoice,
	type CropScope,
	MIN_SHARE,
	boxByHand,
	clearBoxes,
	cropOn,
	setBox,
} from "@/lib/crop";
import { msg, t } from "@/lib/i18n";
import { Button, Dialog, IconButton, Spinner, Switch } from "@/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { useFit, usePainted } from "../tools/scan/Corners";
import s from "./CropPages.module.css";
import {
	type AutoCrop,
	type Box,
	autoCrop,
	fromShare,
	fullView,
	ownPage,
	toShare,
	whole,
} from "./pdfCrop";

type PageViewport = ReturnType<PDFPageProxy["getViewport"]>;

/** Left, top, right, bottom, in the drawing's pixels. */
interface Rect {
	l: number;
	t: number;
	r: number;
	b: number;
}

/** The longer side of the page's drawing, in pixels. */
const DRAWN = 1400;

const HANDLES = [
	msg("Top left corner"),
	msg("Top right corner"),
	msg("Bottom right corner"),
	msg("Bottom left corner"),
	msg("Top edge"),
	msg("Right edge"),
	msg("Bottom edge"),
	msg("Left edge"),
];
/** Which sides each handle moves: corners, then edges. */
const MOVES: Array<{ l?: true; t?: true; r?: true; b?: true }> = [
	{ l: true, t: true },
	{ r: true, t: true },
	{ r: true, b: true },
	{ l: true, b: true },
	{ t: true },
	{ r: true },
	{ b: true },
	{ l: true },
];
/** The whole box, dragged from inside it. */
const WHOLE = 8;

const SCOPES: Array<[CropScope, string]> = [
	["all", msg("All pages")],
	["odd", msg("Odd pages")],
	["even", msg("Even pages")],
	["page", msg("This page")],
];

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(hi, Math.max(lo, v));

/** Where a handle is drawn on the box. */
function handleAt(rect: Rect, i: number): { x: number; y: number } {
	const mx = (rect.l + rect.r) / 2;
	const my = (rect.t + rect.b) / 2;
	return [
		{ x: rect.l, y: rect.t },
		{ x: rect.r, y: rect.t },
		{ x: rect.r, y: rect.b },
		{ x: rect.l, y: rect.b },
		{ x: mx, y: rect.t },
		{ x: rect.r, y: my },
		{ x: mx, y: rect.b },
		{ x: rect.l, y: my },
	][i];
}

/** `start` with handle `which` moved by (dx, dy), kept on the page and
 * no smaller than the smallest box. */
export function movedRect(
	start: Rect,
	which: number,
	dx: number,
	dy: number,
	width: number,
	height: number,
): Rect {
	if (which === WHOLE) {
		const mx = clamp(dx, -start.l, width - start.r);
		const my = clamp(dy, -start.t, height - start.b);
		return {
			l: start.l + mx,
			t: start.t + my,
			r: start.r + mx,
			b: start.b + my,
		};
	}
	const side = MOVES[which];
	const minW = width * MIN_SHARE;
	const minH = height * MIN_SHARE;
	const next = { ...start };
	if (side.l) next.l = clamp(start.l + dx, 0, start.r - minW);
	if (side.r) next.r = clamp(start.r + dx, start.l + minW, width);
	if (side.t) next.t = clamp(start.t + dy, 0, start.b - minH);
	if (side.b) next.b = clamp(start.b + dy, start.t + minH, height);
	return next;
}

function toRect(viewport: PageViewport, box: Box): Rect {
	const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(box);
	return {
		l: Math.min(x1, x2),
		t: Math.min(y1, y2),
		r: Math.max(x1, x2),
		b: Math.max(y1, y2),
	};
}

function toBox(viewport: PageViewport, rect: Rect): Box {
	const [ax, ay] = viewport.convertToPdfPoint(rect.l, rect.t);
	const [bx, by] = viewport.convertToPdfPoint(rect.r, rect.b);
	return [
		Math.min(ax, bx),
		Math.min(ay, by),
		Math.max(ax, bx),
		Math.max(ay, by),
	];
}

interface Drawn {
	n: number;
	image: HTMLCanvasElement;
	viewport: PageViewport;
	full: Box;
}

interface Drag {
	which: number;
	from: { x: number; y: number };
	start: Rect;
	id: number;
}

export function CropPages({
	doc,
	choice,
	page,
	rotation,
	onDone,
	onClose,
}: {
	doc: PDFDocumentProxy;
	/** The crop the pages have now. */
	choice: CropChoice | null;
	/** The page to start on. */
	page: number;
	/** How far the reader has turned the pages, in degrees. */
	rotation: number;
	onDone: (choice: CropChoice | null) => void;
	onClose: () => void;
}) {
	const total = doc.numPages;
	const [n, setN] = useState(() => clamp(page, 1, total));
	const [draft, setDraft] = useState<CropChoice>(
		() => choice ?? { auto: true },
	);
	const [scope, setScope] = useState<CropScope>("all");
	const [drawn, setDrawn] = useState<Drawn | null>(null);
	const [rect, setRect] = useState<Rect | null>(null);
	const [active, setActive] = useState<number | null>(null);
	const drag = useRef<Drag | null>(null);
	const autos = useRef(new Map<boolean, Promise<AutoCrop>>());

	const go = (to: number) => {
		const next = clamp(to, 1, total);
		setN(next);
		// A box for one side of a book follows the page to its side.
		setScope((was) =>
			was === "odd" || was === "even" ? (next % 2 ? "odd" : "even") : was,
		);
	};

	// The page, drawn whole, as the reader has it turned.
	useEffect(() => {
		let live = true;
		(async () => {
			const pg = await ownPage(doc, n);
			const turn = (pg.rotate + rotation) % 360;
			const at = (scale: number) =>
				whole(pg, () => pg.getViewport({ scale, rotation: turn }));
			const one = at(1);
			const viewport = at(DRAWN / Math.max(one.width, one.height));
			const image = document.createElement("canvas");
			image.width = Math.ceil(viewport.width);
			image.height = Math.ceil(viewport.height);
			const ctx = image.getContext("2d");
			if (!ctx) return;
			await pg.render({ canvasContext: ctx, viewport }).promise;
			if (live) setDrawn({ n, image, viewport, full: fullView(pg) });
		})().catch(() => {});
		return () => {
			live = false;
		};
	}, [doc, n, rotation]);

	// The box the page has as the crop stands.
	useEffect(() => {
		if (!drawn || drawn.n !== n) return;
		let live = true;
		const share = boxByHand(draft, n);
		const bare = !!draft.bare;
		const box: Promise<Box> = share
			? Promise.resolve(fromShare(share, drawn.full))
			: draft.auto
				? (() => {
						let auto = autos.current.get(bare);
						if (!auto) {
							auto = autoCrop(doc, bare);
							autos.current.set(bare, auto);
						}
						return auto.then((a) => a.boxOf(n));
					})()
				: Promise.resolve(drawn.full);
		box
			.then((b) => {
				if (live && !drag.current) setRect(toRect(drawn.viewport, b));
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [doc, drawn, draft, n]);

	const commit = (next: Rect) => {
		if (!drawn) return;
		const share = toShare(toBox(drawn.viewport, next), drawn.full);
		setDraft((d) => setBox(d, scope, n, share));
	};

	const width = drawn?.image.width ?? 0;
	const height = drawn?.image.height ?? 0;
	const ready = !!drawn && drawn.n === n && !!rect;

	return (
		<Dialog
			open
			fullScreen
			title={t("Crop pages")}
			onClose={onClose}
			testId="crop-pages"
			actions={
				<>
					<Button
						variant="ghost"
						onClick={() =>
							setDraft((d) => ({
								auto: false,
								...(d.bare ? { bare: true } : {}),
							}))
						}
						data-testid="crop-reset"
					>
						{t("No crop")}
					</Button>
					<Button
						variant="secondary"
						onClick={() => setDraft((d) => clearBoxes(d, scope, n))}
						data-testid="crop-auto"
					>
						{t("Auto")}
					</Button>
					<Button
						onClick={() => onDone(cropOn(draft) ? draft : null)}
						data-testid="crop-done"
					>
						{t("Done")}
					</Button>
				</>
			}
		>
			<div className={s.screen}>
				{drawn && rect && drawn.n === n ? (
					<CropStage
						image={drawn.image}
						rect={rect}
						active={active}
						onDown={(which, e, at) => {
							drag.current = { which, from: at, start: rect, id: e.pointerId };
							setActive(which);
						}}
						onMove={(e, at) => {
							const d = drag.current;
							if (!d || d.id !== e.pointerId) return;
							setRect(
								movedRect(
									d.start,
									d.which,
									at.x - d.from.x,
									at.y - d.from.y,
									width,
									height,
								),
							);
						}}
						onUp={(e) => {
							if (drag.current?.id !== e.pointerId) return;
							drag.current = null;
							setActive(null);
							commit(rect);
						}}
						onKey={(which, e) => {
							const step =
								Math.max(width, height) * (e.shiftKey ? 0.02 : 0.004);
							const by: Record<string, [number, number]> = {
								ArrowLeft: [-step, 0],
								ArrowRight: [step, 0],
								ArrowUp: [0, -step],
								ArrowDown: [0, step],
							};
							const d = by[e.key];
							if (!d) return;
							e.preventDefault();
							e.stopPropagation();
							const next = movedRect(rect, which, d[0], d[1], width, height);
							setRect(next);
							commit(next);
						}}
					/>
				) : (
					<div className={s.wait}>
						<Spinner />
					</div>
				)}
				<div className={s.controls}>
					<div className={s.stepper}>
						<IconButton
							label={t("Previous page")}
							onClick={() => go(n - 1)}
							disabled={n <= 1}
							data-testid="crop-prev"
						>
							<ChevronLeft size={20} className="pw-flip" />
						</IconButton>
						<span className={s.count} data-testid="crop-count">
							{t("Page {n} of {total}", { n, total })}
						</span>
						<IconButton
							label={t("Next page")}
							onClick={() => go(n + 1)}
							disabled={n >= total}
							data-testid="crop-next"
						>
							<ChevronRight size={20} className="pw-flip" />
						</IconButton>
					</div>
					<fieldset className={s.scopes} disabled={!ready}>
						<legend className={s.legend}>{t("Apply to")}</legend>
						{SCOPES.map(([value, label]) => (
							<button
								key={value}
								type="button"
								className={s.chip}
								aria-pressed={scope === value}
								onClick={() => setScope(value)}
								data-testid={`crop-scope-${value}`}
							>
								{t(label)}
							</button>
						))}
					</fieldset>
					<Switch
						label={t("Leave out headers and page numbers")}
						checked={!!draft.bare}
						onChange={(on) =>
							setDraft((d) => {
								const { bare: _, ...rest } = d;
								return on ? { ...rest, bare: true } : rest;
							})
						}
						testId="crop-bare"
					/>
				</div>
			</div>
		</Dialog>
	);
}

/** The page with the box over it: the rest dimmed, four corners and
 * four edges to drag, and the box itself to move. */
function CropStage({
	image,
	rect,
	active,
	onDown,
	onMove,
	onUp,
	onKey,
}: {
	image: HTMLCanvasElement;
	rect: Rect;
	active: number | null;
	onDown: (
		which: number,
		e: PointerEvent<SVGElement>,
		at: { x: number; y: number },
	) => void;
	onMove: (e: PointerEvent<SVGElement>, at: { x: number; y: number }) => void;
	onUp: (e: PointerEvent<SVGElement>) => void;
	onKey: (which: number, e: KeyboardEvent<SVGElement>) => void;
}) {
	const stage = useRef<HTMLDivElement>(null);
	const frame = useRef<HTMLDivElement>(null);
	const { width, height } = image;
	const fit = useFit(stage, width, height);
	const canvas = usePainted(image, width, height);
	const scale = fit.scale || 1;

	const toImage = (e: { clientX: number; clientY: number }) => {
		const box = frame.current?.getBoundingClientRect();
		if (!box || !box.width) return { x: 0, y: 0 };
		const k = box.width / width;
		return { x: (e.clientX - box.left) / k, y: (e.clientY - box.top) / k };
	};
	const down = (which: number) => (e: PointerEvent<SVGElement>) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		try {
			(e.currentTarget as Element).setPointerCapture(e.pointerId);
		} catch {
			// The svg still hears the moves while the pointer stays over it.
		}
		onDown(which, e, toImage(e));
	};

	const r = (px: number) => px / scale;
	const touch =
		typeof window !== "undefined" &&
		window.matchMedia?.("(pointer: coarse)").matches;
	// A finger gets a target 44 pixels across.
	const hit = r(touch ? 22 : 14);
	const outside = `M0 0H${width}V${height}H0Z M${rect.l} ${rect.t}H${rect.r}V${rect.b}H${rect.l}Z`;

	return (
		<div ref={stage} className={s.stage}>
			{fit.scale > 0 && (
				<div
					ref={frame}
					className={s.frame}
					style={{
						left: fit.left,
						top: fit.top,
						width: width * fit.scale,
						height: height * fit.scale,
					}}
				>
					<canvas ref={canvas} />
					<svg
						className={s.overlay}
						viewBox={`0 0 ${width} ${height}`}
						preserveAspectRatio="none"
						onPointerMove={(e) => onMove(e, toImage(e))}
						onPointerUp={onUp}
						onPointerCancel={onUp}
						data-testid="crop-stage"
					>
						<title>{t("What is kept of the page")}</title>
						<path className={s.mask} d={outside} />
						<rect
							className={s.box}
							x={rect.l}
							y={rect.t}
							width={rect.r - rect.l}
							height={rect.b - rect.t}
							onPointerDown={down(WHOLE)}
							data-testid="crop-box"
						/>
						{HANDLES.map((label, i) => {
							const at = handleAt(rect, i);
							const corner = i < 4;
							return (
								<g key={label}>
									<circle
										className={s.hit}
										cx={at.x}
										cy={at.y}
										r={hit}
										tabIndex={0}
										role="button"
										aria-label={t(label)}
										onPointerDown={down(i)}
										onKeyDown={(e) => onKey(i, e)}
										data-testid={`crop-handle-${i}`}
									/>
									<circle
										className={corner ? s.handle : s.edgeHandle}
										cx={at.x}
										cy={at.y}
										r={r(corner ? (active === i ? 12 : 9) : 6)}
									/>
								</g>
							);
						})}
					</svg>
				</div>
			)}
		</div>
	);
}
