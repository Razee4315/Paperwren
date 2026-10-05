import { isDesktop } from "@/lib/env";
import { t, uiDir } from "@/lib/i18n";
import type { DeckResult } from "@/lib/parseWorker";
import {
	type Gradient,
	type Para,
	type Presentation,
	type Slide,
	type SlideElement,
	type TextBody,
	parsePptxAsync,
} from "@/lib/pptx/parse";
import { fitted } from "@/lib/print";
import { useSettings } from "@/state/settings";
import {
	Button,
	ErrorArt,
	IconButton,
	Sheet,
	SheetItem,
	Spinner,
	StateView,
} from "@/ui";
import {
	ChevronLeft,
	ChevronRight,
	LayoutGrid,
	Maximize,
	Search,
	StickyNote,
} from "lucide-react";
import {
	type CSSProperties,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import "@/styles/office-fonts.css";
import { PageJump } from "./Dialogs";
import d from "./Doc.module.css";
import { Present } from "./Present";
import {
	FindBar,
	Shell,
	type SideTab,
	ZoomControl,
	percentPresets,
	shellStyles,
} from "./Shell";
import { SlideChart } from "./SlideChart";
import s from "./Slides.module.css";
import { useZoom, useZoomLevel } from "./hooks";
import { runWorker } from "./runWorker";
import type { ViewerProps } from "./types";
import { useDomFind } from "./useDomFind";

// The tail covers right-to-left scripts on phones and desktops.
const FALLBACK_FONTS =
	", Calibri, Carlito, 'Segoe UI', Arial, 'Noto Naskh Arabic', 'Noto Sans Arabic', Tahoma, sans-serif";

function Paragraph({ p }: { p: Para }) {
	const bullet =
		p.bullet && p.runs.some((r) => r.text.trim())
			? p.bullet === "#"
				? "•"
				: p.bullet
			: null;
	const first = p.runs[0];
	return (
		<p
			dir={p.rtl ? "rtl" : undefined}
			style={{
				textAlign: p.align,
				// Indent and bullet sit on the side the paragraph starts from.
				marginInlineStart: p.indent,
				paddingTop: p.spaceBefore,
				paddingBottom: p.spaceAfter,
				lineHeight: p.lineHeight ? p.lineHeight * 1.2 : undefined,
				fontSize: p.runs.length ? undefined : p.endSize,
				minHeight: p.runs.length ? undefined : `${p.endSize * 1.2}px`,
			}}
		>
			{bullet && (
				<span
					className={s.bullet}
					style={{ fontSize: first?.size, color: first?.color }}
				>
					{bullet}
				</span>
			)}
			{p.runs.map((r, i) => {
				if (r.br) return <br key={i} />;
				const style: CSSProperties = {
					fontSize: r.size,
					fontWeight: r.bold ? 700 : undefined,
					fontStyle: r.italic ? "italic" : undefined,
					textDecoration:
						[r.underline && "underline", r.strike && "line-through"]
							.filter(Boolean)
							.join(" ") || undefined,
					color: r.color,
					fontFamily: r.font ? `'${r.font}'${FALLBACK_FONTS}` : undefined,
				};
				return r.href ? (
					<a
						key={i}
						href={r.href}
						target="_blank"
						rel="noopener noreferrer nofollow"
						style={style}
					>
						{r.text}
					</a>
				) : (
					<span key={i} style={style}>
						{r.text}
					</span>
				);
			})}
		</p>
	);
}

function Text({ body, flow = false }: { body: TextBody; flow?: boolean }) {
	const [l, t, r, b] = body.insets;
	return (
		<div
			className={s.text}
			style={{
				// Table cells size to their text instead of overlaying it.
				position: flow ? "relative" : undefined,
				height: flow ? "100%" : undefined,
				padding: `${t}px ${r}px ${b}px ${l}px`,
				justifyContent:
					body.anchor === "middle"
						? "center"
						: body.anchor === "bottom"
							? "flex-end"
							: "flex-start",
				whiteSpace: body.wrap ? undefined : "nowrap",
				writingMode: body.vertical ? "vertical-rl" : undefined,
			}}
		>
			{body.paras.map((p, i) => (
				<Paragraph key={i} p={p} />
			))}
		</div>
	);
}

/** A gradient as an SVG paint server, so it fills any outline. */
function Paint({ id, gradient }: { id: string; gradient: Gradient }) {
	const stops = gradient.stops.map((stop, i) => (
		<stop key={i} offset={`${stop.at}%`} stopColor={stop.color} />
	));
	return (
		<defs>
			{gradient.kind === "radial" ? (
				<radialGradient id={id} cx="50%" cy="50%" r="71%">
					{stops}
				</radialGradient>
			) : (
				<linearGradient
					id={id}
					x1="0"
					y1="0"
					x2="1"
					y2="0"
					gradientTransform={`rotate(${gradient.angle} 0.5 0.5)`}
				>
					{stops}
				</linearGradient>
			)}
		</defs>
	);
}

function Geometry({ el }: { el: Extract<SlideElement, { kind: "shape" }> }) {
	const paint = `pw${useId().replace(/:/g, "")}`;
	if (!el.fill && !el.line) return null;
	const { w, h } = el;
	// A picture fill is painted by the box itself.
	const fill = el.image ? undefined : el.gradient ? `url(#${paint})` : el.fill;
	const defs = el.gradient && !el.image && (
		<Paint id={paint} gradient={el.gradient} />
	);
	const stroke = el.line?.color;
	const sw = el.line?.width ?? 0;
	const common = {
		fill: fill ?? "none",
		stroke: stroke ?? "none",
		strokeWidth: sw,
		strokeDasharray: el.line?.dash ? `${sw * 3} ${sw * 2}` : undefined,
		vectorEffect: "non-scaling-stroke" as const,
	};
	if (el.paths)
		return (
			<>
				{el.paths.map((p, i) => (
					<svg
						key={i}
						viewBox={`0 0 ${p.w} ${p.h}`}
						preserveAspectRatio="none"
						aria-hidden="true"
					>
						{i === 0 && defs}
						<path
							d={p.d}
							{...common}
							fill={p.fill ? common.fill : "none"}
							stroke={p.stroke ? common.stroke : "none"}
						/>
					</svg>
				))}
			</>
		);
	let shape: JSX.Element;
	switch (el.geom) {
		case "ellipse":
			shape = (
				<ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...common} />
			);
			break;
		case "line":
		case "straightConnector1":
		case "bentConnector3":
			shape = (
				<line
					x1={0}
					y1={0}
					x2={w}
					y2={h}
					{...common}
					fill="none"
					stroke={stroke ?? "#000"}
				/>
			);
			break;
		case "triangle":
			shape = <polygon points={`${w / 2},0 ${w},${h} 0,${h}`} {...common} />;
			break;
		case "rtTriangle":
			shape = <polygon points={`0,0 ${w},${h} 0,${h}`} {...common} />;
			break;
		case "diamond":
			shape = (
				<polygon
					points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
					{...common}
				/>
			);
			break;
		case "rightArrow":
			shape = (
				<polygon
					points={`0,${h * 0.25} ${w * 0.7},${h * 0.25} ${w * 0.7},0 ${w},${h / 2} ${w * 0.7},${h} ${w * 0.7},${h * 0.75} 0,${h * 0.75}`}
					{...common}
				/>
			);
			break;
		case "chevron":
		case "homePlate":
			shape = (
				<polygon
					points={`0,0 ${w * 0.8},0 ${w},${h / 2} ${w * 0.8},${h} 0,${h}${el.geom === "chevron" ? ` ${w * 0.2},${h / 2}` : ""}`}
					{...common}
				/>
			);
			break;
		default:
			shape = (
				<rect
					x={0}
					y={0}
					width={w}
					height={h}
					rx={el.radius ?? 0}
					{...common}
				/>
			);
	}
	return (
		<svg
			viewBox={`0 0 ${Math.max(w, 1)} ${Math.max(h, 1)}`}
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			{defs}
			{shape}
		</svg>
	);
}

/** Show only the kept part of a cropped picture, filling its frame. */
function cropStyle([l, t, r, b]: [number, number, number, number]) {
	const kw = 1 - l - r;
	const kh = 1 - t - b;
	return {
		position: "absolute",
		width: `${100 / kw}%`,
		height: `${100 / kh}%`,
		left: `${(-l / kw) * 100}%`,
		top: `${(-t / kh) * 100}%`,
	} satisfies CSSProperties;
}

function Element({ el }: { el: SlideElement }) {
	const transform = [
		el.rot ? `rotate(${el.rot}deg)` : "",
		el.flipH ? "scaleX(-1)" : "",
		el.flipV ? "scaleY(-1)" : "",
	]
		.join(" ")
		.trim();
	const style: CSSProperties = {
		left: el.x,
		top: el.y,
		width: el.w,
		height: el.h,
		transform: transform || undefined,
	};
	switch (el.kind) {
		case "shape":
			return (
				<div
					className={s.el}
					style={{
						...style,
						filter: el.shadow ? `drop-shadow(${el.shadow})` : undefined,
						background: el.image
							? `center / 100% 100% no-repeat url("${el.image}")`
							: undefined,
						borderRadius:
							el.geom === "ellipse"
								? "50%"
								: el.geom === "roundRect"
									? el.radius
									: undefined,
					}}
				>
					<Geometry el={el} />
					{el.text && (
						// Text is never mirrored with its shape.
						<div
							style={{
								position: "absolute",
								inset: 0,
								transform:
									el.flipH || el.flipV
										? `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})`
										: undefined,
							}}
						>
							<Text body={el.text} />
						</div>
					)}
				</div>
			);
		case "image":
			return (
				// The shadow is cast by the frame; the clip sits inside it.
				<div
					className={s.el}
					style={{
						...style,
						filter: el.shadow ? `drop-shadow(${el.shadow})` : undefined,
					}}
				>
					<div
						className={s.clip}
						style={{
							borderRadius: el.round === "ellipse" ? "50%" : el.round,
						}}
					>
						{el.src ? (
							<img
								className={s.img}
								src={el.src}
								alt=""
								draggable={false}
								style={el.crop ? cropStyle(el.crop) : undefined}
							/>
						) : (
							<div className={s.missing}>{t("Image")}</div>
						)}
					</div>
				</div>
			);
		case "table":
			return (
				<div className={s.el} style={style}>
					<table className={s.table} dir={el.rtl ? "rtl" : undefined}>
						<colgroup>
							{el.cols.map((w, i) => (
								<col key={i} style={{ width: w }} />
							))}
						</colgroup>
						<tbody>
							{el.rows.map((row, ri) => (
								<tr key={ri} style={{ height: row.h }}>
									{row.cells.map((c, ci) =>
										c.hidden ? null : (
											<td
												key={ci}
												colSpan={c.span}
												rowSpan={c.rowSpan}
												style={{ background: c.fill }}
											>
												<Text body={c.text} flow />
											</td>
										),
									)}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		case "chart":
			return (
				<div className={s.el} style={style}>
					<SlideChart chart={el.chart} w={el.w} h={el.h} />
				</div>
			);
		default:
			return (
				<div className={s.el} style={style}>
					<div className={s.placeholder}>{t(el.label)}</div>
				</div>
			);
	}
}

/** One slide at its own size; the caller scales it. */
function SlideCanvas({
	slide,
	width,
	height,
}: { slide: Slide; width: number; height: number }) {
	return (
		<div
			className={s.slide}
			style={{ width, height, background: slide.background }}
		>
			{slide.elements.map((el, j) => (
				<Element key={j} el={el} />
			))}
		</div>
	);
}

/** Width a slide is drawn at in the list of slides, in CSS pixels. */
const THUMB_WIDTH = 150;
const ZOOM_LEVELS = [50, 75, 100, 150, 200];

/**
 * Every slide as a small picture, to find one by its look: a strip
 * beside the deck on a desktop, a grid in a sheet on a phone. A slide
 * is only drawn once it has scrolled into view, so a long deck costs
 * no more than the slides looked at.
 */
function SlideThumbs({
	deck,
	current,
	onPick,
	follow = false,
}: {
	deck: Presentation;
	current: number;
	onPick: (index: number) => void;
	/** Keep the slide being read in view (the strip stays open). */
	follow?: boolean;
}) {
	const grid = useRef<HTMLDivElement>(null);
	const start = useRef(current);
	const [drawn, setDrawn] = useState<ReadonlySet<number>>(() => new Set());

	// biome-ignore lint/correctness/useExhaustiveDependencies: the cells are those of this deck
	useEffect(() => {
		const root = grid.current;
		if (!root) return;
		const seen = new IntersectionObserver(
			(entries) => {
				const fresh = entries
					.filter((entry) => entry.isIntersecting)
					.map((entry) => Number((entry.target as HTMLElement).dataset.index));
				if (!fresh.length) return;
				setDrawn((before) => {
					const after = new Set(before);
					for (const i of fresh) after.add(i);
					return after.size === before.size ? before : after;
				});
			},
			{ root: root.parentElement, rootMargin: "400px 0px" },
		);
		for (const cell of root.children) seen.observe(cell);
		root
			.querySelector(`[data-index="${start.current}"]`)
			?.scrollIntoView({ block: "center" });
		return () => seen.disconnect();
	}, [deck]);

	useEffect(() => {
		if (!follow) return;
		grid.current
			?.querySelector(`[data-index="${current}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [follow, current]);

	const k = THUMB_WIDTH / deck.width;
	return (
		<div ref={grid} className={s.thumbs} data-testid="slide-thumbs">
			{deck.slides.map((slide, i) => (
				<div
					key={i}
					data-index={i}
					className={`${s.thumb} ${slide.hidden ? s.hidden : ""}`}
					aria-current={i === current ? "true" : undefined}
				>
					<button
						type="button"
						className={s.thumbHit}
						aria-label={t("Slide {n}", { n: i + 1 })}
						onClick={() => onPick(i)}
						data-testid="slide-thumb"
					/>
					<span className={s.thumbNumber}>{i + 1}</span>
					<div
						className={s.thumbFrame}
						style={{ width: THUMB_WIDTH, height: deck.height * k }}
					>
						{drawn.has(i) && (
							<div style={{ zoom: k }}>
								<SlideCanvas
									slide={slide}
									width={deck.width}
									height={deck.height}
								/>
							</div>
						)}
					</div>
				</div>
			))}
		</div>
	);
}

type Loaded =
	| { deck: Presentation; textOnly: boolean }
	| { failed: "corrupt" | "password" };

/** Read a deck in whichever format it is. .pptx and .odp are XML and
 * parse here; binary .ppt parses in the worker and returns pictures
 * as bytes. */
async function loadDeck(
	format: ViewerProps["format"],
	data: ArrayBuffer,
	signal: AbortSignal,
): Promise<Loaded> {
	try {
		if (format === "ppt") {
			const result = await runWorker<DeckResult>(
				{ type: "ppt", buffer: data },
				signal,
			);
			if (!result.ok) return { failed: result.reason };
			const { materialize } = await import("@/lib/office/deck");
			return { deck: materialize(result.deck), textOnly: result.textOnly };
		}
		if (format === "odp") {
			const [{ parseOdp }, { materialize }] = await Promise.all([
				import("@/lib/office/odf"),
				import("@/lib/office/deck"),
			]);
			return {
				deck: materialize(parseOdp(new Uint8Array(data))),
				textOnly: false,
			};
		}
		return {
			deck: await parsePptxAsync(new Uint8Array(data), signal),
			textOnly: false,
		};
	} catch (err) {
		if ((err as Error)?.name === "AbortError") throw err;
		return {
			failed: String(err).includes("password") ? "password" : "corrupt",
		};
	}
}

/** Presentations (.pptx, .ppt, .odp): every slide drawn from the
 * file's own shapes, colours and text styles, scaled to the screen. */
export default function SlidesView({
	data,
	name,
	format,
	position,
	onPosition,
	onClose,
	active,
}: ViewerProps) {
	const { settings } = useSettings();
	const scroller = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const hud = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const [deck, setDeck] = useState<Presentation | null>(null);
	const [error, setError] = useState<"corrupt" | "password" | null>(null);
	const [textOnly, setTextOnly] = useState(false);
	const [fit, setFit] = useState(1);
	// The slides have their real size only once the width was measured.
	const [measured, setMeasured] = useState(false);
	const [zoom, commit] = useZoomLevel();
	const [current, setCurrent] = useState(0);
	const [notes, setNotes] = useState(false);
	const [chromeHidden, setChromeHidden] = useState(false);
	const [presenting, setPresenting] = useState(false);
	const [thumbsOpen, setThumbsOpen] = useState(false);
	const find = useDomFind(list, scroller);

	useEffect(() => {
		const abort = new AbortController();
		let loaded: Presentation | null = null;
		loadDeck(format, data, abort.signal)
			.then((result) => {
				if ("failed" in result) {
					setError(result.failed);
					return;
				}
				if (abort.signal.aborted) {
					result.deck.dispose();
					return;
				}
				loaded = result.deck;
				setTextOnly(result.textOnly);
				setDeck(result.deck);
			})
			.catch(() => {});
		return () => {
			abort.abort();
			loaded?.dispose();
		};
	}, [data, format]);

	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el || !deck) return;
		// A slide is looked at whole: it fits the width on a phone held
		// upright, and the height too on a wide window, where fitting
		// only the width would show half a slide. The list's padding sits
		// inside the zoomed box and scales with it.
		const measure = () => {
			setFit(
				Math.min(
					2,
					Math.floor((el.clientWidth / (deck.width + 24)) * 1e3) / 1e3,
					Math.floor((el.clientHeight / (deck.height + 32)) * 1e3) / 1e3,
				),
			);
			setMeasured(true);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [deck]);

	const { zoomBy, zoomTo } = useZoom({
		scroller,
		content: list,
		stage,
		zoom,
		commit,
		hud,
		min: 0.5,
		max: 5,
		enabled: !!deck,
		active,
		onTap: () => setChromeHidden((h) => !h),
	});
	const scale = fit * zoom;

	const goTo = (i: number) => {
		const frame = list.current?.children[i] as HTMLElement | undefined;
		frame?.scrollIntoView({ block: "start" });
	};

	// Restore the saved slide once the deck is laid out.
	const restored = useRef(false);
	useLayoutEffect(() => {
		if (!deck || restored.current || !measured) return;
		restored.current = true;
		if (
			settings.rememberPosition &&
			position?.kind === "slides" &&
			position.slide > 0
		) {
			requestAnimationFrame(() =>
				goTo(Math.min(position.slide, deck.slides.length - 1)),
			);
		}
	});

	// Current slide = the one crossing the upper third of the viewport.
	const saveTimer = useRef(0);
	const onScroll = () => {
		const el = scroller.current;
		const frames = list.current?.children;
		if (!el || !frames) return;
		const probe = el.getBoundingClientRect().top + el.clientHeight / 3;
		let idx = 0;
		for (let i = 0; i < frames.length; i++) {
			if ((frames[i] as HTMLElement).getBoundingClientRect().top <= probe)
				idx = i;
			else break;
		}
		// The last slide may never climb that high; the end of the list
		// is the last slide.
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2)
			idx = frames.length - 1;
		if (idx !== current) setCurrent(idx);
		if (!settings.rememberPosition) return;
		window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(
			() => onPosition({ kind: "slides", slide: idx }),
			400,
		);
	};
	useEffect(() => () => window.clearTimeout(saveTimer.current), []);

	// Left/right step through slides; up/down keep scrolling.
	const stepRef = useRef((_: number) => {});
	stepRef.current = (dir) => goTo(current + dir);
	useEffect(() => {
		if (!active || presenting) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if ((e.target as HTMLElement).closest?.("input, textarea")) return;
			if (e.key === "ArrowRight" || e.key === "PageDown") stepRef.current(1);
			else if (e.key === "ArrowLeft" || e.key === "PageUp") stepRef.current(-1);
			else if (e.key === "F5") setPresenting(true);
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, presenting]);

	const total = deck?.slides.length ?? 0;
	const hasNotes = deck?.slides.some((sl) => sl.notes) ?? false;
	// A deck that hides every slide still has to show something.
	const someShown = deck?.slides.some((sl) => !sl.hidden) ?? false;

	const goToRef = useRef(goTo);
	goToRef.current = goTo;
	const side = useMemo<SideTab[]>(
		() =>
			deck && deck.slides.length > 1
				? [
						{
							id: "slides",
							label: t("Slides"),
							content: (
								<SlideThumbs
									deck={deck}
									current={current}
									onPick={(i) => goToRef.current(i)}
									follow
								/>
							),
						},
					]
				: [],
		[deck, current],
	);

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			progressOf={scroller}
			// Page Up / Down step through the slides here.
			pageKeys={false}
			side={side}
			chromeHidden={chromeHidden && !find.open}
			onFind={deck ? find.start : undefined}
			menu={
				deck && total > 1 && !isDesktop
					? (close) => (
							<SheetItem
								icon={<LayoutGrid size={20} />}
								onClick={() => {
									close();
									setThumbsOpen(true);
								}}
								testId="slides-grid"
							>
								{t("All slides")}
							</SheetItem>
						)
					: undefined
			}
			onPrint={
				deck
					? (root) => {
							const clone = list.current?.cloneNode(true) as HTMLElement | null;
							if (!clone) return;
							clone.style.zoom = "";
							root.appendChild(fitted(clone, deck.width + 24));
						}
					: undefined
			}
			actions={
				<>
					{hasNotes && (
						<IconButton
							label={notes ? t("Hide speaker notes") : t("Show speaker notes")}
							active={notes}
							onClick={() => setNotes((n) => !n)}
						>
							<StickyNote size={20} />
						</IconButton>
					)}
					<IconButton
						label={t("Slide show")}
						shortcut="F5"
						onClick={() => setPresenting(true)}
						disabled={!total}
						data-testid="slides-present"
					>
						<Maximize size={20} />
					</IconButton>
					<IconButton
						label={t("Find")}
						shortcut="Ctrl+F"
						onClick={() => find.start()}
						active={find.open}
						disabled={!deck}
						data-testid="slides-find"
					>
						<Search size={20} />
					</IconButton>
				</>
			}
			find={
				find.open ? (
					<FindBar
						state={find.state}
						onQuery={find.setQuery}
						onStep={find.step}
						onClose={find.close}
					/>
				) : undefined
			}
			pager={
				deck ? (
					<>
						<div className={shellStyles.group}>
							<IconButton
								label={t("Previous slide")}
								disabled={current === 0}
								onClick={() => goTo(current - 1)}
							>
								<ChevronLeft size={22} className="pw-flip" />
							</IconButton>
							<PageJump
								page={Math.min(current + 1, Math.max(1, total))}
								pages={total}
								onGo={(n) => goTo(n - 1)}
								what="slide"
								testId="slide"
								counterTestId="slide-counter"
							/>
							<IconButton
								label={t("Next slide")}
								disabled={current >= total - 1}
								onClick={() => goTo(current + 1)}
							>
								<ChevronRight size={22} className="pw-flip" />
							</IconButton>
						</div>
						<ZoomControl
							label={
								Math.abs(zoom - 1) < 0.005
									? t("Fit")
									: `${Math.round(zoom * 100)}%`
							}
							onOut={() => zoomBy(1 / 1.25)}
							onIn={() => zoomBy(1.25)}
							onReset={() => zoomTo(1)}
							resetLabel={t("Fit to screen")}
							presets={[
								{
									label: t("Fit"),
									run: () => zoomTo(1),
									on: Math.abs(zoom - 1) < 0.005,
								},
								...percentPresets(ZOOM_LEVELS, scale, (to) => zoomTo(to / fit)),
							]}
							testId="slides"
						/>
					</>
				) : undefined
			}
		>
			<div
				ref={scroller}
				className={d.scroller}
				onScroll={onScroll}
				data-testid="slides-scroll"
			>
				{deck && (
					<div ref={stage} className={d.stage}>
						<div ref={list} className={s.list} style={{ zoom: scale }}>
							{deck.slides.map((slide, i) => (
								<div
									key={i}
									className={`${s.frame} ${slide.hidden ? s.hidden : ""}`}
									style={{
										containIntrinsicSize: `${deck.width}px ${deck.height}px`,
									}}
									data-testid="slide"
								>
									{slide.hidden && (
										<span className={s.tag} dir={uiDir()}>
											{t("Hidden slide")}
										</span>
									)}
									<SlideCanvas
										slide={slide}
										width={deck.width}
										height={deck.height}
									/>
									{notes && slide.notes && (
										<div className={s.notes} style={{ width: deck.width }}>
											{slide.notes}
										</div>
									)}
								</div>
							))}
						</div>
					</div>
				)}
			</div>
			{deck && presenting && (
				<Present
					width={deck.width}
					height={deck.height}
					total={total}
					start={current}
					skip={(i) => someShown && !!deck.slides[i]?.hidden}
					notes={hasNotes ? (i) => deck.slides[i]?.notes : undefined}
					render={(i) => (
						<SlideCanvas
							slide={deck.slides[i]}
							width={deck.width}
							height={deck.height}
						/>
					)}
					onClose={(at) => {
						setPresenting(false);
						goTo(at);
					}}
				/>
			)}
			<Sheet
				open={thumbsOpen}
				title={t("All slides")}
				onClose={() => setThumbsOpen(false)}
				wide
			>
				{deck && (
					<SlideThumbs
						deck={deck}
						current={current}
						onPick={(i) => {
							setThumbsOpen(false);
							goTo(i);
						}}
					/>
				)}
			</Sheet>
			{!deck && !error && (
				<StateView>
					<Spinner label={t("Opening presentation")} />
				</StateView>
			)}
			{deck && total === 0 && (
				<StateView title={t("This presentation has no slides")} />
			)}
			{deck && textOnly && (
				<div className={shellStyles.note} dir={uiDir()}>
					{t("This deck's layout couldn't be read; showing its text.")}
				</div>
			)}
			{error && (
				<StateView
					icon={<ErrorArt />}
					title={
						error === "password"
							? t("Password protected")
							: t("Can't open this presentation")
					}
					action={<Button onClick={onClose}>{t("Close")}</Button>}
				>
					{error === "password"
						? t(
								"This presentation is locked with a password and can't be opened.",
							)
						: t("The file is damaged or isn't a valid presentation.")}
				</StateView>
			)}
		</Shell>
	);
}
