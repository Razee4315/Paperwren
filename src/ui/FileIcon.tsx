import type { FileFormat } from "@/lib/formats";
import { formatLabel, kindOf } from "@/lib/formats";
import { useId } from "react";

/**
 * Paperwren's file icons: a folded page in the format's colour, a
 * white glyph that says what is inside, and the extension. One
 * definition drives the app (theme-aware CSS variables) and the
 * exported asset files (scripts/export-assets.tsx passes fixed colours).
 */

type Glyph = "pdf" | "doc" | "sheet" | "slides" | "text" | "markdown" | "other";

const KIND_VAR: Record<ReturnType<typeof kindOf>, string> = {
	pdf: "var(--fmt-pdf)",
	doc: "var(--fmt-doc)",
	sheet: "var(--fmt-sheet)",
	slides: "var(--fmt-slides)",
	text: "var(--fmt-text)",
	other: "var(--fmt-text)",
};

function glyphFor(format: FileFormat): Glyph {
	if (format === "md") return "markdown";
	const kind = kindOf(format);
	return kind === "pdf"
		? "pdf"
		: kind === "doc"
			? "doc"
			: kind === "sheet"
				? "sheet"
				: kind === "slides"
					? "slides"
					: kind === "text"
						? "text"
						: "other";
}

function GlyphShape({ glyph }: { glyph: Glyph }) {
	const w = "#fff";
	switch (glyph) {
		case "pdf":
			// A bookmarked page: reading-first.
			return (
				<g>
					<rect x="14" y="15" width="20" height="3" rx="1.5" fill={w} />
					<rect
						x="14"
						y="21"
						width="14"
						height="3"
						rx="1.5"
						fill={w}
						opacity="0.8"
					/>
					<path d="M29 20 h6 v10 l-3 -2.2 l-3 2.2 Z" fill={w} />
				</g>
			);
		case "doc":
			return (
				<g fill={w}>
					<rect x="13" y="14" width="22" height="3" rx="1.5" />
					<rect x="13" y="20" width="22" height="3" rx="1.5" opacity="0.85" />
					<rect x="13" y="26" width="14" height="3" rx="1.5" opacity="0.7" />
				</g>
			);
		case "sheet":
			return (
				<g fill="none" stroke={w} strokeWidth="2.2" strokeLinejoin="round">
					<rect x="13" y="13" width="22" height="17" rx="2.5" />
					<path d="M13 19 H35 M13 24.5 H35 M20.5 13 V30" />
				</g>
			);
		case "slides":
			return (
				<g>
					<rect
						x="12.5"
						y="13"
						width="23"
						height="15"
						rx="2.5"
						fill="none"
						stroke={w}
						strokeWidth="2.2"
					/>
					<rect x="16.5" y="21" width="3" height="4" rx="1" fill={w} />
					<rect x="22.5" y="18" width="3" height="7" rx="1" fill={w} />
					<rect x="28.5" y="16" width="3" height="9" rx="1" fill={w} />
					<path
						d="M24 28 v3"
						stroke={w}
						strokeWidth="2.2"
						strokeLinecap="round"
					/>
				</g>
			);
		case "markdown":
			return (
				<g
					fill="none"
					stroke={w}
					strokeWidth="2.4"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M12 29 V16 L17 22 L22 16 V29" />
					<path d="M30 16 V28 M26 24 L30 28.5 L34 24" />
				</g>
			);
		case "text":
			return (
				<g fill={w}>
					<rect x="13" y="14" width="16" height="3" rx="1.5" />
					<rect x="13" y="20" width="22" height="3" rx="1.5" opacity="0.85" />
					<rect x="13" y="26" width="19" height="3" rx="1.5" opacity="0.7" />
				</g>
			);
		default:
			return (
				<path
					d="M20 18 a4 4 0 1 1 5.5 3.7 c-1.2 .5 -1.5 1.2 -1.5 2.3 M24 28.5 v.5"
					fill="none"
					stroke={w}
					strokeWidth="2.6"
					strokeLinecap="round"
				/>
			);
	}
}

export function FileIcon({
	format,
	size = 44,
	color,
	title,
}: {
	format: FileFormat;
	size?: number;
	/** Fixed colour for exports; defaults to the theme's format colour. */
	color?: string;
	title?: string;
}) {
	const id = `${format}${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
	const base = color ?? KIND_VAR[kindOf(format)];
	const label = formatLabel(format).slice(0, 4);
	return (
		<svg
			width={size}
			height={(size * 52) / 48}
			viewBox="0 0 48 52"
			role={title ? "img" : undefined}
			aria-hidden={title ? undefined : true}
			aria-label={title}
			style={{ flexShrink: 0, display: "block" }}
		>
			<defs>
				<linearGradient id={`b${id}`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" style={{ stopColor: base }} />
					<stop offset="1" style={{ stopColor: base, stopOpacity: 0.86 }} />
				</linearGradient>
			</defs>
			{/* soft floor shadow */}
			<ellipse cx="24" cy="49.5" rx="15" ry="2" fill={base} opacity="0.18" />
			{/* page with the top-right corner folded */}
			<path
				d="M11 2 H31 L42 13 V43 A5 5 0 0 1 37 48 H11 A5 5 0 0 1 6 43 V7 A5 5 0 0 1 11 2 Z"
				fill={`url(#b${id})`}
			/>
			<path d="M31 2 V9 A4 4 0 0 0 35 13 H42 Z" fill="#fff" opacity="0.45" />
			<GlyphShape glyph={glyphFor(format)} />
			<text
				x="24"
				y="42"
				textAnchor="middle"
				fontFamily="Manrope Variable, Manrope, Arial, sans-serif"
				fontWeight="800"
				fontSize={label.length > 3 ? 8 : 9}
				letterSpacing="0.4"
				fill="#fff"
			>
				{label}
			</text>
		</svg>
	);
}
