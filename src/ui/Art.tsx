import { useId } from "react";
import s from "./Art.module.css";

/** Gradient definition that follows the chosen accent palette. */
function Grad({ id }: { id: string }) {
	return (
		<linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" style={{ stopColor: "var(--grad-a)" }} />
			<stop offset="0.55" style={{ stopColor: "var(--grad-b)" }} />
			<stop offset="1" style={{ stopColor: "var(--grad-c)" }} />
		</linearGradient>
	);
}

function Sparkle({
	x,
	y,
	size,
	fill,
}: { x: number; y: number; size: number; fill: string }) {
	const h = size / 2;
	return (
		<path
			className={s.spark}
			d={`M${x} ${y - h} Q${x} ${y} ${x + h} ${y} Q${x} ${y} ${x} ${y + h} Q${x} ${y} ${x - h} ${y} Q${x} ${y} ${x} ${y - h}Z`}
			fill={fill}
		/>
	);
}

/** A document card: coloured header band, text lines, folded corner. */
function Card({
	x,
	y,
	r,
	color,
	kind,
}: {
	x: number;
	y: number;
	r: number;
	color: string;
	kind: "lines" | "grid" | "slide";
}) {
	return (
		<g className={s.card} style={{ ["--r" as string]: `${r}deg` }}>
			<g transform={`translate(${x} ${y})`}>
				<rect
					width="62"
					height="78"
					rx="10"
					fill="var(--surface)"
					stroke="var(--line-strong)"
					strokeWidth="1"
				/>
				<path
					d="M44 0 H52 A10 10 0 0 1 62 10 V18 Z"
					fill={color}
					opacity="0.35"
				/>
				<rect x="10" y="12" width="26" height="7" rx="3.5" fill={color} />
				{kind === "lines" &&
					[28, 38, 48, 58].map((ly, i) => (
						<rect
							key={ly}
							x="10"
							y={ly}
							width={i === 3 ? 26 : 42}
							height="4"
							rx="2"
							fill="var(--surface-3)"
						/>
					))}
				{kind === "grid" && (
					<g fill="none" stroke={color} strokeOpacity="0.45" strokeWidth="1.5">
						<rect x="10" y="28" width="42" height="36" rx="3" />
						<path d="M10 40 H52 M10 52 H52 M24 28 V64 M38 28 V64" />
					</g>
				)}
				{kind === "slide" && (
					<g>
						<rect
							x="10"
							y="28"
							width="42"
							height="28"
							rx="4"
							fill={color}
							opacity="0.18"
						/>
						<circle cx="22" cy="42" r="6" fill={color} opacity="0.7" />
						<path d="M30 50 L38 38 L48 50 Z" fill={color} opacity="0.55" />
						<rect
							x="10"
							y="62"
							width="30"
							height="4"
							rx="2"
							fill="var(--surface-3)"
						/>
					</g>
				)}
			</g>
		</g>
	);
}

/** Home empty state: floating documents, a paper wren gliding along a
 * dashed trail, twinkling sparkles. */
export function EmptyScene() {
	const id = useId().replace(/:/g, "");
	const grad = `g${id}`;
	const soft = `s${id}`;
	const flight = "M18 150 C 70 60, 150 190, 214 96 S 280 40, 292 58";
	return (
		<svg
			className={`${s.art} ${s.scene}`}
			viewBox="0 0 300 210"
			aria-hidden="true"
		>
			<defs>
				<Grad id={grad} />
				<radialGradient id={soft} cx="0.5" cy="0.5" r="0.5">
					<stop
						offset="0"
						style={{ stopColor: "var(--grad-b)", stopOpacity: 0.22 }}
					/>
					<stop
						offset="1"
						style={{ stopColor: "var(--grad-b)", stopOpacity: 0 }}
					/>
				</radialGradient>
			</defs>
			<ellipse cx="150" cy="112" rx="140" ry="92" fill={`url(#${soft})`} />
			<Card x={46} y={70} r={-12} color="var(--fmt-doc)" kind="lines" />
			<Card x={94} y={52} r={-3} color="var(--fmt-pdf)" kind="lines" />
			<Card x={144} y={60} r={7} color="var(--fmt-sheet)" kind="grid" />
			<Card x={192} y={82} r={14} color="var(--fmt-slides)" kind="slide" />
			<path
				className={s.trail}
				d={flight}
				fill="none"
				stroke={`url(#${grad})`}
				strokeWidth="2"
				strokeLinecap="round"
				opacity="0.7"
			/>
			{/* The paper wren: a folded-paper bird riding the trail. */}
			<g>
				<path d="M-11 -2 L12 -8 L-2 9 L-3 1 Z" fill={`url(#${grad})`} />
				<path d="M-3 1 L12 -8 L-11 -2 Z" fill="#fff" opacity="0.35" />
				<animateMotion
					dur="6s"
					repeatCount="indefinite"
					rotate="auto"
					path={flight}
					keyPoints="0;1"
					keyTimes="0;1"
					calcMode="spline"
					keySplines="0.4 0 0.2 1"
				/>
			</g>
			<Sparkle x={34} y={52} size={14} fill="var(--grad-a)" />
			<Sparkle x={262} y={150} size={12} fill="var(--grad-c)" />
			<Sparkle x={250} y={34} size={10} fill="var(--grad-b)" />
			<Sparkle x={70} y={176} size={9} fill="var(--grad-b)" />
		</svg>
	);
}

/** Loading: a page whose lines write themselves, in the accent gradient. */
export function PageLoader({ label = "Opening" }: { label?: string }) {
	const id = useId().replace(/:/g, "");
	return (
		<div
			className={s.loader}
			// biome-ignore lint/a11y/useSemanticElements: a live region, not form output
			role="status"
			aria-label={label}
		>
			<svg className={s.art} viewBox="0 0 58 72" aria-hidden="true">
				<defs>
					<Grad id={`l${id}`} />
				</defs>
				<path
					d="M6 2 H38 L56 20 V66 A4 4 0 0 1 52 70 H6 A4 4 0 0 1 2 66 V6 A4 4 0 0 1 6 2 Z"
					fill="var(--surface)"
					stroke="var(--line-strong)"
					strokeWidth="1.5"
				/>
				<path
					d="M38 2 V16 A4 4 0 0 0 42 20 H56"
					fill="var(--surface-2)"
					stroke="var(--line-strong)"
					strokeWidth="1.5"
				/>
				{[30, 40, 50, 60].map((y) => (
					<line
						key={y}
						className={s.line}
						x1="12"
						y1={y}
						x2="46"
						y2={y}
						stroke={`url(#l${id})`}
						strokeWidth="4"
						strokeLinecap="round"
					/>
				))}
			</svg>
			<span>{label}…</span>
		</div>
	);
}

/** Error illustration: a puzzled page. */
export function ErrorArt({ tone = "var(--fmt-pdf)" }: { tone?: string }) {
	return (
		<svg
			className={`${s.art} ${s.error}`}
			viewBox="0 0 96 104"
			aria-hidden="true"
		>
			<path
				d="M14 4 H62 L90 32 V96 A6 6 0 0 1 84 102 H14 A6 6 0 0 1 8 96 V10 A6 6 0 0 1 14 4 Z"
				fill="var(--surface)"
				stroke="var(--line-strong)"
				strokeWidth="2"
			/>
			<path
				d="M62 4 V26 A6 6 0 0 0 68 32 H90"
				fill="var(--surface-2)"
				stroke="var(--line-strong)"
				strokeWidth="2"
			/>
			<circle cx="36" cy="54" r="4.5" fill="var(--text-2)" />
			<circle cx="62" cy="54" r="4.5" fill="var(--text-2)" />
			<path
				d="M34 78 Q41 70 49 78 T64 78"
				fill="none"
				stroke={tone}
				strokeWidth="4"
				strokeLinecap="round"
			/>
			<path
				d="M22 40 L30 36 M76 40 L68 36"
				stroke="var(--text-3)"
				strokeWidth="3"
				strokeLinecap="round"
			/>
		</svg>
	);
}

/** Slowly drifting colour blobs behind a screen's header. */
export function Blobs() {
	return (
		<div className={s.blobs} aria-hidden="true">
			<span className={s.blob} />
			<span className={s.blob} />
			<span className={s.blob} />
		</div>
	);
}

/**
 * The Paperwren mascot: an origami wren. Each facet folds into place
 * in turn (`animate`), then the bird hops. Colours follow the accent.
 */
export function Wren({
	size = 160,
	animate = true,
}: { size?: number; animate?: boolean }) {
	const id = useId().replace(/:/g, "");
	const facet = animate ? s.facet : undefined;
	return (
		<svg
			className={`${s.art} ${animate ? s.wren : ""}`}
			width={size}
			height={(size * 100) / 120}
			viewBox="0 0 120 100"
			aria-hidden="true"
		>
			<defs>
				<Grad id={`w${id}`} />
			</defs>
			<ellipse
				cx="60"
				cy="92"
				rx="30"
				ry="3.5"
				fill="var(--grad-b)"
				opacity="0.18"
				className={animate ? s.shadow : undefined}
			/>
			<g className={animate ? s.hop : undefined}>
				<path
					className={facet}
					style={{ animationDelay: "0ms" }}
					d="M8 20 L40 56 L27 63 Z"
					fill="var(--grad-c)"
				/>
				<path
					className={facet}
					style={{ animationDelay: "90ms" }}
					d="M8 20 L27 63 L20 44 Z"
					fill="var(--grad-c)"
					opacity="0.7"
				/>
				<path
					className={facet}
					style={{ animationDelay: "180ms" }}
					d="M27 63 L40 56 L86 52 L70 78 L40 77 Z"
					fill={`url(#w${id})`}
				/>
				<path
					className={facet}
					style={{ animationDelay: "270ms" }}
					d="M40 77 L70 78 L58 84 Z"
					fill="var(--grad-b)"
					opacity="0.75"
				/>
				<path
					className={facet}
					style={{ animationDelay: "360ms" }}
					d="M80 38 L97 32 L101 50 L86 54 Z"
					fill="var(--grad-a)"
				/>
				<path
					className={facet}
					style={{ animationDelay: "420ms" }}
					d="M101 41 L114 45.5 L101 48 Z"
					fill="#fbbf24"
				/>
				<path
					className={facet}
					style={{ animationDelay: "480ms" }}
					d="M42 57 L80 38 L70 67 Z"
					fill="#fff"
					opacity="0.92"
				/>
				<path
					className={facet}
					style={{ animationDelay: "540ms" }}
					d="M42 57 L70 67 L58 70 Z"
					fill="#fff"
					opacity="0.6"
				/>
				<circle
					className={facet}
					style={{ animationDelay: "600ms" }}
					cx="92"
					cy="41.5"
					r="2.3"
					fill="#17161c"
				/>
				<path
					d="M52 78 L50 90 M62 78 L63 90"
					stroke="var(--text-2)"
					strokeWidth="2"
					strokeLinecap="round"
				/>
			</g>
		</svg>
	);
}
