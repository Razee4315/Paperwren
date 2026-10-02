import { t } from "@/lib/i18n";
import s from "./Art.module.css";

/**
 * Paperwren's artwork: flat shapes in solid theme colours, no
 * gradients and no idle animation.
 */

export interface WrenColors {
	body: string;
	dark: string;
	belly: string;
	beak: string;
	eye: string;
}

/** Theme-driven colours for the in-app wren. */
const THEMED: WrenColors = {
	body: "var(--accent)",
	dark: "var(--brand-dark)",
	belly: "var(--brand-belly)",
	beak: "var(--brand-beak)",
	eye: "var(--brand-eye)",
};

/**
 * The wren on a 64×64 grid: one round silhouette with a cocked tail,
 * a darker wing, a light chest, a slim beak. Absolute path commands
 * only, so scripts/export-assets.tsx can re-place the coordinates for
 * the launcher icons.
 */
export const WREN = {
	tail: "M27 27.5 L12.6 9.6 Q10.8 7.4 8.6 8.8 L6.6 10.4 Q4.6 12 6 14.2 L19.5 33.5 Z",
	legs: "M29 53 L27.5 59 M35 53 L36 59",
	legWidth: 2.2,
	body: "M50.5 19 C48 12.5 39 11 35 17 C32.5 21 29 24.5 24 26.5 C15.5 30 13 38 15.5 44.5 C18.5 51.5 25.5 55 33 54.5 C44 54 51.5 45.5 51.5 34 C51.5 29.5 52.5 26 53.5 24 Z",
	belly:
		"M52.6 25 C51.6 28 51.5 31 51.5 34 C51.5 45.5 44 53.5 33 54.5 C39.5 50.5 43.5 44.5 44.8 37.5 C46 31.5 48.5 27 52.6 25 Z",
	wing: "M45 34 C41 27.5 29 27 21 33.5 L14.5 38 C23 45.5 38 45.5 45 34 Z",
	beak: "M51.4 19 Q56 20.2 59.5 22.6 Q55.5 23.6 52.4 24.4 Z",
	eye: { cx: 45, cy: 19.5, r: 2.1 },
} as const;

export function WrenShapes({ c = THEMED }: { c?: WrenColors }) {
	return (
		<g>
			<path d={WREN.tail} fill={c.dark} />
			<path
				d={WREN.legs}
				stroke={c.dark}
				strokeWidth={WREN.legWidth}
				strokeLinecap="round"
			/>
			<path d={WREN.body} fill={c.body} />
			<path d={WREN.belly} fill={c.belly} />
			<path d={WREN.wing} fill={c.dark} />
			<path d={WREN.beak} fill={c.beak} />
			<circle {...WREN.eye} fill={c.eye} />
		</g>
	);
}

/** The Paperwren mascot. */
export function Wren({
	size = 160,
	colors,
}: { size?: number; colors?: WrenColors }) {
	return (
		<svg
			className={s.art}
			width={size}
			height={size}
			viewBox="0 0 64 64"
			aria-hidden="true"
		>
			<WrenShapes c={colors} />
		</svg>
	);
}

/** A flat document card for the empty-state composition. */
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
		<g transform={`rotate(${r} ${x + 31} ${y + 39}) translate(${x} ${y})`}>
			<rect
				width="62"
				height="78"
				rx="9"
				fill="var(--surface)"
				stroke="var(--line-strong)"
				strokeWidth="1.5"
			/>
			<rect x="10" y="12" width="26" height="7" rx="3.5" fill={color} />
			{kind === "lines" &&
				[28, 37, 46, 55].map((ly, i) => (
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
				<g fill="none" stroke={color} strokeWidth="1.5">
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
						fill="var(--surface-2)"
					/>
					<circle cx="22" cy="40" r="5" fill={color} />
					<path d="M28 52 L37 38 L47 52 Z" fill={color} />
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
	);
}

/** Home empty state: a small fan of documents with the wren perched
 * on top. Static. */
export function EmptyScene() {
	return (
		<svg
			className={`${s.art} ${s.scene}`}
			viewBox="0 0 300 200"
			aria-hidden="true"
		>
			<circle cx="150" cy="118" r="78" fill="var(--accent-soft)" />
			<Card x={62} y={88} r={-14} color="var(--fmt-doc)" kind="lines" />
			<Card x={176} y={88} r={14} color="var(--fmt-sheet)" kind="grid" />
			<Card x={119} y={78} r={0} color="var(--fmt-pdf)" kind="slide" />
			<g transform="translate(114 13) scale(1.1)">
				<WrenShapes />
			</g>
			<rect x="40" y="186" width="220" height="3" rx="1.5" fill="var(--line)" />
		</svg>
	);
}

/** Loading: a still page with a calm indeterminate bar under it. */
export function PageLoader({ label = t("Opening") }: { label?: string }) {
	return (
		<div
			className={s.loader}
			// biome-ignore lint/a11y/useSemanticElements: a live region, not form output
			role="status"
			aria-label={label}
		>
			<svg className={s.art} viewBox="0 0 48 58" aria-hidden="true">
				<path
					d="M6 1 H32 L47 16 V52 A5 5 0 0 1 42 57 H6 A5 5 0 0 1 1 52 V6 A5 5 0 0 1 6 1 Z"
					fill="var(--surface)"
					stroke="var(--line-strong)"
					strokeWidth="1.5"
				/>
				<path d="M32 1 V16 H47 Z" fill="var(--surface-3)" />
				{[26, 34, 42].map((y, i) => (
					<rect
						key={y}
						x="10"
						y={y}
						width={i === 2 ? 18 : 28}
						height="3.5"
						rx="1.75"
						fill="var(--accent)"
						opacity={1 - i * 0.25}
					/>
				))}
			</svg>
			<span className={s.bar} aria-hidden="true">
				<i />
			</span>
			<span>{label}…</span>
		</div>
	);
}

/** Error illustration: a page with a notch torn from its corner. */
export function ErrorArt({ tone = "var(--danger)" }: { tone?: string }) {
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
			<path d="M62 4 V32 H90 Z" fill="var(--surface-3)" />
			{[44, 56, 68].map((y, i) => (
				<rect
					key={y}
					x="22"
					y={y}
					width={i === 2 ? 30 : 46}
					height="5"
					rx="2.5"
					fill="var(--surface-3)"
				/>
			))}
			<circle cx="72" cy="84" r="16" fill={tone} />
			<path
				d="M72 75 V85 M72 91 V91.5"
				stroke="var(--surface)"
				strokeWidth="4"
				strokeLinecap="round"
			/>
		</svg>
	);
}
