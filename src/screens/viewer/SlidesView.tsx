import {
	type Para,
	type Presentation,
	type SlideElement,
	type TextBody,
	parsePptx,
} from "@/lib/pptx/parse";
import { useSettings } from "@/state/settings";
import { Button, IconButton, Spinner, StateView } from "@/ui";
import { ChevronLeft, ChevronRight, Search, StickyNote } from "lucide-react";
import {
	type CSSProperties,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import d from "./Doc.module.css";
import { FindBar, Shell, shellStyles } from "./Shell";
import s from "./Slides.module.css";
import { usePinchZoom } from "./hooks";
import type { ViewerProps } from "./types";
import { useDomFind } from "./useDomFind";

const FALLBACK_FONTS = ", Calibri, Carlito, 'Segoe UI', Arial, sans-serif";

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
			style={{
				textAlign: p.align,
				marginLeft: p.indent,
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

function Geometry({ el }: { el: Extract<SlideElement, { kind: "shape" }> }) {
	if (!el.fill && !el.line) return null;
	const { w, h } = el;
	const fill = el.fill?.startsWith("linear-gradient") ? undefined : el.fill;
	const stroke = el.line?.color;
	const sw = el.line?.width ?? 0;
	const common = {
		fill: fill ?? "none",
		stroke: stroke ?? "none",
		strokeWidth: sw,
		strokeDasharray: el.line?.dash ? `${sw * 3} ${sw * 2}` : undefined,
		vectorEffect: "non-scaling-stroke" as const,
	};
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
			{shape}
		</svg>
	);
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
						background: el.fill?.startsWith("linear-gradient")
							? el.fill
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
				<div className={s.el} style={style}>
					{el.src ? (
						<img className={s.img} src={el.src} alt="" draggable={false} />
					) : (
						<div className={s.missing}>Image</div>
					)}
				</div>
			);
		case "table":
			return (
				<div className={s.el} style={style}>
					<table className={s.table}>
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
		default:
			return (
				<div className={s.el} style={style}>
					<div className={s.placeholder}>{el.label}</div>
				</div>
			);
	}
}

/** PowerPoint (.pptx): every slide drawn from the file's own shapes,
 * theme colours and layouts, scaled to the screen. */
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
	const list = useRef<HTMLDivElement>(null);
	const [deck, setDeck] = useState<Presentation | null>(null);
	const [error, setError] = useState(false);
	const [fit, setFit] = useState(1);
	const [zoom, setZoom] = useState(1);
	const [current, setCurrent] = useState(0);
	const [notes, setNotes] = useState(false);
	const find = useDomFind(list, scroller);

	useEffect(() => {
		let p: Presentation | null = null;
		try {
			p = parsePptx(new Uint8Array(data));
			setDeck(p);
		} catch {
			setError(true);
		}
		return () => p?.dispose();
	}, [data]);

	useLayoutEffect(() => {
		const el = scroller.current;
		if (!el || !deck) return;
		const measure = () =>
			setFit(Math.min(2, (el.clientWidth - 24) / deck.width));
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [deck]);

	usePinchZoom(scroller, zoom, setZoom, 0.5, 4);
	const scale = fit * zoom;

	const goTo = (i: number) => {
		const frame = list.current?.children[i] as HTMLElement | undefined;
		frame?.scrollIntoView({ block: "start" });
	};

	// Restore the saved slide once the deck is laid out.
	const restored = useRef(false);
	useLayoutEffect(() => {
		if (!deck || restored.current || fit === 1) return;
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
		if (idx !== current) setCurrent(idx);
		window.clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(
			() => onPosition({ kind: "slides", slide: idx }),
			400,
		);
	};
	useEffect(() => () => window.clearTimeout(saveTimer.current), []);

	const total = deck?.slides.length ?? 0;
	const hasNotes = deck?.slides.some((sl) => sl.notes) ?? false;

	return (
		<Shell
			name={name}
			format={format}
			onClose={onClose}
			active={active}
			actions={
				<>
					{hasNotes && (
						<IconButton
							label={notes ? "Hide speaker notes" : "Show speaker notes"}
							active={notes}
							onClick={() => setNotes((n) => !n)}
						>
							<StickyNote size={20} />
						</IconButton>
					)}
					<IconButton
						label="Find"
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
						<IconButton
							label="Previous slide"
							disabled={current === 0}
							onClick={() => goTo(current - 1)}
						>
							<ChevronLeft size={22} />
						</IconButton>
						<span
							className={shellStyles.pill}
							style={{
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
							}}
							data-testid="slide-counter"
						>
							{current + 1} / {total}
						</span>
						<IconButton
							label="Next slide"
							disabled={current >= total - 1}
							onClick={() => goTo(current + 1)}
						>
							<ChevronRight size={22} />
						</IconButton>
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
								<div
									className={s.slide}
									style={{
										width: deck.width,
										height: deck.height,
										background: slide.background,
									}}
								>
									{slide.elements.map((el, j) => (
										<Element key={j} el={el} />
									))}
								</div>
								{notes && slide.notes && (
									<div className={s.notes} style={{ width: deck.width }}>
										{slide.notes}
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</div>
			{!deck && !error && (
				<StateView>
					<Spinner label="Opening presentation" />
				</StateView>
			)}
			{deck && total === 0 && (
				<StateView title="This presentation has no slides" />
			)}
			{error && (
				<StateView
					title="Can't open this presentation"
					action={<Button onClick={onClose}>Close</Button>}
				>
					The file is damaged or isn't a valid PowerPoint file.
				</StateView>
			)}
		</Shell>
	);
}
