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
import { Button, ErrorArt, IconButton, Spinner, StateView } from "@/ui";
import {
	ChevronLeft,
	ChevronRight,
	Maximize,
	Search,
	StickyNote,
} from "lucide-react";
import {
	type CSSProperties,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import "@/styles/office-fonts.css";
import d from "./Doc.module.css";
import { Present } from "./Present";
import { FindBar, Shell, ZoomControl, shellStyles } from "./Shell";
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

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			hud={hud}
			progressOf={scroller}
			chromeHidden={chromeHidden && !find.open}
			onFind={deck ? find.start : undefined}
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
						label={t("Full screen")}
						onClick={() => setPresenting(true)}
						disabled={!total}
						data-testid="slides-present"
					>
						<Maximize size={20} />
					</IconButton>
					<IconButton
						label={t("Find")}
						onClick={find.start}
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
			bottom={
				deck ? (
					<div className={shellStyles.pager}>
						<div className={shellStyles.group}>
							<IconButton
								label={t("Previous slide")}
								disabled={current === 0}
								onClick={() => goTo(current - 1)}
							>
								<ChevronLeft size={22} className="pw-flip" />
							</IconButton>
							<span className={shellStyles.count} data-testid="slide-counter">
								{current + 1} / {total}
							</span>
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
							testId="slides"
						/>
					</div>
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
									className={s.frame}
									style={{
										containIntrinsicSize: `${deck.width}px ${deck.height}px`,
									}}
									data-testid="slide"
								>
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
