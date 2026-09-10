import { useEffect, useId, useState } from "react";
import styled from "styled-components";

/**
 * The Paperwren brand tile — the launcher icon (assets/brand/
 * app-icon.svg) inlined as React so it renders crisp at any size on
 * any surface with zero image fetches. One rounded tile, one
 * folded-paper wren. Defs are prefixed per instance (useId) so any
 * number of marks can coexist on a page without gradient collisions.
 *
 * Two variants:
 *  - "tile"  — the launcher look: black tile, white wren. Right on
 *              light surfaces and on glowing brand moments.
 *  - "paper" — inverted: warm paper tile, ink wren. The same mark
 *              on dark themes, where a black tile would melt into
 *              the background.
 */

const WREN_PATH = `
	M 104 164
	L 220 226
	L 293 184
	C 306 176 318 173 331 174
	C 352 175 369 190 376 210
	L 408 225
	L 375 239
	C 372 263 359 284 340 300
	L 300 330
	C 279 346 251 349 229 337
	C 211 328 198 313 186 294
	L 144 278
	Z`;

interface BrandPalette {
	bg0: string;
	bg1: string;
	bg2: string;
	ambient: string;
	rim: [number, number, number];
	paper: [string, string];
	tailFold: [string, string];
	facetTop: string;
	facetLeft: string;
	foldLine: string;
	bodyShade: string;
	wedge: string;
	wedgeOpacity: number;
	wing: [string, string];
	fold: [string, string];
	wingStroke: number;
	foldGuide: string;
	foldGuideOpacity: number;
	ribStroke: number;
	beak: string;
	eye: string;
}

const PALETTES: Record<"tile" | "paper", BrandPalette> = {
	tile: {
		bg0: "#2B2B2B",
		bg1: "#141414",
		bg2: "#000000",
		ambient: "#FFFFFF",
		rim: [0.22, 0.05, 0.1],
		paper: ["#FFFFFF", "#EDEDED"],
		tailFold: ["#EFEFEF", "#C4C4C4"],
		facetTop: "#F7F7F7",
		facetLeft: "#D9D9D9",
		foldLine: "#FFFFFF",
		bodyShade: "#E3E3E3",
		wedge: "#8C8C8C",
		wedgeOpacity: 0.12,
		wing: ["#F8F8F8", "#DCDCDC"],
		fold: ["#D6D6D6", "#ADADAD"],
		wingStroke: 0.8,
		foldGuide: "#9A9A9A",
		foldGuideOpacity: 0.3,
		ribStroke: 0.6,
		beak: "#DADADA",
		eye: "#0A0A0A",
	},
	paper: {
		bg0: "#FFFFFF",
		bg1: "#F1ECE2",
		bg2: "#E5DFD3",
		ambient: "#000000",
		rim: [0.09, 0.03, 0.06],
		paper: ["#454545", "#191919"],
		tailFold: ["#565656", "#2A2A2A"],
		facetTop: "#5E5E5E",
		facetLeft: "#424242",
		foldLine: "#FFFFFF",
		bodyShade: "#383838",
		wedge: "#FFFFFF",
		wedgeOpacity: 0.08,
		wing: ["#6E6E6E", "#3E3E3E"],
		fold: ["#5A5A5A", "#303030"],
		wingStroke: 0.35,
		foldGuide: "#FFFFFF",
		foldGuideOpacity: 0.16,
		ribStroke: 0.22,
		beak: "#DADADA",
		eye: "#F2EDE4",
	},
};

export function BrandMark({
	size = 96,
	title = "Paperwren",
	rounded = true,
	variant = "tile",
}: {
	size?: number;
	title?: string;
	/** Square corners for edge-to-edge placements (Android adaptive). */
	rounded?: boolean;
	/** "tile" = launcher look (black tile, white wren); "paper" =
	 * inverted (paper tile, ink wren) for dark-theme surfaces. */
	variant?: "tile" | "paper";
}) {
	const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
	const p = PALETTES[variant];
	const id = {
		background: `pw-bg-${uid}`,
		ambient: `pw-amb-${uid}`,
		paper: `pw-paper-${uid}`,
		tailFold: `pw-tail-${uid}`,
		wing: `pw-wing-${uid}`,
		fold: `pw-fold-${uid}`,
		rim: `pw-rim-${uid}`,
		wren: `pw-wren-${uid}`,
	};
	const rx = rounded ? 112 : 0;

	return (
		<Svg
			width={size}
			height={size}
			viewBox="0 0 512 512"
			fill="none"
			role={title ? "img" : undefined}
			aria-label={title || undefined}
			aria-hidden={title ? undefined : true}
		>
			{title ? <title>{title}</title> : null}
			<defs>
				<linearGradient
					id={id.background}
					x1="64"
					y1="32"
					x2="448"
					y2="492"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor={p.bg0} />
					<stop offset="0.52" stopColor={p.bg1} />
					<stop offset="1" stopColor={p.bg2} />
				</linearGradient>
				<radialGradient
					id={id.ambient}
					cx="0"
					cy="0"
					r="1"
					gradientTransform="translate(164 116) rotate(48) scale(420)"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor={p.ambient} stopOpacity="0.07" />
					<stop offset="1" stopColor={p.ambient} stopOpacity="0" />
				</radialGradient>
				<linearGradient
					id={id.paper}
					x1="214"
					y1="168"
					x2="309"
					y2="350"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor={p.paper[0]} />
					<stop offset="1" stopColor={p.paper[1]} />
				</linearGradient>
				<linearGradient
					id={id.tailFold}
					x1="112"
					y1="172"
					x2="212"
					y2="291"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor={p.tailFold[0]} />
					<stop offset="1" stopColor={p.tailFold[1]} />
				</linearGradient>
				<linearGradient
					id={id.wing}
					x1="205"
					y1="249"
					x2="287"
					y2="333"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor={p.wing[0]} />
					<stop offset="1" stopColor={p.wing[1]} />
				</linearGradient>
				<linearGradient
					id={id.fold}
					x1="286"
					y1="214"
					x2="308"
					y2="257"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor={p.fold[0]} />
					<stop offset="1" stopColor={p.fold[1]} />
				</linearGradient>
				<linearGradient
					id={id.rim}
					x1="76"
					y1="24"
					x2="432"
					y2="492"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor={p.ambient} stopOpacity={p.rim[0]} />
					<stop offset="0.5" stopColor={p.ambient} stopOpacity={p.rim[1]} />
					<stop offset="1" stopColor={p.ambient} stopOpacity={p.rim[2]} />
				</linearGradient>
				<path id={id.wren} d={WREN_PATH} />
			</defs>

			{/* tile */}
			<rect width="512" height="512" rx={rx} fill={p.bg2} />
			<rect width="512" height="512" rx={rx} fill={`url(#${id.background})`} />
			<rect width="512" height="512" rx={rx} fill={`url(#${id.ambient})`} />
			<rect
				x="1"
				y="1"
				width="510"
				height="510"
				rx={Math.max(0, rx - 1)}
				stroke={`url(#${id.rim})`}
				strokeWidth="2"
			/>

			{/* folded-paper wren */}
			<g transform="translate(256 256) scale(1.4) translate(-256 -256)">
				<g>
					<use
						href={`#${id.wren}`}
						transform="translate(0 12)"
						fill="#000000"
						opacity="0.45"
					/>
					<use
						href={`#${id.wren}`}
						transform="translate(0 5)"
						fill="#000000"
						opacity="0.5"
					/>
				</g>
				<g>
					<use href={`#${id.wren}`} fill={`url(#${id.paper})`} />
					<path
						d="M104 164 L220 226 L186 294 L144 278 Z"
						fill={`url(#${id.tailFold})`}
					/>
					<path d="M104 164 L220 226 L167 249 Z" fill={p.facetTop} />
					<path d="M104 164 L167 249 L144 278 Z" fill={p.facetLeft} />
					<path
						d="M109 173 L167 249 L211 230"
						stroke={p.foldLine}
						strokeOpacity="0.4"
						strokeWidth="1.5"
						strokeLinejoin="round"
					/>
					<path
						d="
							M186 294
							L304 272
							L300 330
							C279 346 251 349 229 337
							C211 328 198 313 186 294
							Z
						"
						fill={p.bodyShade}
					/>
					<path
						d="M199 258 L287 213 L316 250 L265 339 Z"
						fill={p.wedge}
						opacity={p.wedgeOpacity}
					/>
					<path
						d="M194 252 L286 208 L310 247 L260 331 Z"
						fill={`url(#${id.wing})`}
					/>
					<path d="M286 208 L278 247 L310 247 Z" fill={`url(#${id.fold})`} />
					<path
						d="M194 252 L286 208 L310 247"
						stroke={p.foldLine}
						strokeOpacity={p.wingStroke}
						strokeWidth="2"
						strokeLinejoin="round"
					/>
					<path
						d="M278 247 L310 247"
						stroke={p.foldGuide}
						strokeOpacity={p.foldGuideOpacity}
						strokeWidth="1.5"
					/>
					<path
						d="M194 252 L260 331"
						stroke={p.foldLine}
						strokeOpacity={p.ribStroke}
						strokeWidth="1.5"
					/>
					<path d="M376 225 L408 225 L375 239 Z" fill={p.beak} />
					<circle cx="348" cy="211" r="5.5" fill={p.eye} />
				</g>
			</g>
		</Svg>
	);
}

const Svg = styled.svg`
	display: block;
	flex-shrink: 0;
`;

/**
 * The brand variant that reads well on the CURRENT app theme: the
 * launcher's black tile on light themes, the inverted paper tile on
 * dark ones (where a black tile melts into the background). Follows
 * the `data-theme` attribute the SettingsProvider writes to <html>,
 * so it stays correct for system-theme changes too.
 */
function brandVariantForTheme(): "tile" | "paper" {
	const theme = document.documentElement.getAttribute("data-theme");
	return theme === "paper" || theme === "sepia" || theme === null
		? "tile"
		: "paper";
}

export function useBrandVariant(): "tile" | "paper" {
	const [variant, setVariant] = useState<"tile" | "paper">(
		brandVariantForTheme,
	);
	useEffect(() => {
		const observer = new MutationObserver(() => {
			setVariant(brandVariantForTheme());
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => observer.disconnect();
	}, []);
	return variant;
}
