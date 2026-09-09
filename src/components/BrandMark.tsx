import { useId } from "react";
import styled from "styled-components";

/**
 * The Paperwren brand tile — the launcher icon (assets/brand/
 * app-icon.svg) inlined as React so it renders crisp at any size on
 * any surface with zero image fetches. One black rounded tile, one
 * folded-paper wren. Defs are prefixed per instance (useId) so any
 * number of marks can coexist on a page without gradient collisions.
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

export function BrandMark({
	size = 96,
	title = "Paperwren",
	rounded = true,
}: {
	size?: number;
	title?: string;
	/** Square corners for edge-to-edge placements (Android adaptive). */
	rounded?: boolean;
}) {
	const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
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
					<stop stopColor="#2B2B2B" />
					<stop offset="0.52" stopColor="#141414" />
					<stop offset="1" stopColor="#000000" />
				</linearGradient>
				<radialGradient
					id={id.ambient}
					cx="0"
					cy="0"
					r="1"
					gradientTransform="translate(164 116) rotate(48) scale(420)"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#FFFFFF" stopOpacity="0.07" />
					<stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
				</radialGradient>
				<linearGradient
					id={id.paper}
					x1="214"
					y1="168"
					x2="309"
					y2="350"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#FFFFFF" />
					<stop offset="1" stopColor="#EDEDED" />
				</linearGradient>
				<linearGradient
					id={id.tailFold}
					x1="112"
					y1="172"
					x2="212"
					y2="291"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#EFEFEF" />
					<stop offset="1" stopColor="#C4C4C4" />
				</linearGradient>
				<linearGradient
					id={id.wing}
					x1="205"
					y1="249"
					x2="287"
					y2="333"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#F8F8F8" />
					<stop offset="1" stopColor="#DCDCDC" />
				</linearGradient>
				<linearGradient
					id={id.fold}
					x1="286"
					y1="214"
					x2="308"
					y2="257"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#D6D6D6" />
					<stop offset="1" stopColor="#ADADAD" />
				</linearGradient>
				<linearGradient
					id={id.rim}
					x1="76"
					y1="24"
					x2="432"
					y2="492"
					gradientUnits="userSpaceOnUse"
				>
					<stop stopColor="#FFFFFF" stopOpacity="0.22" />
					<stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.05" />
					<stop offset="1" stopColor="#FFFFFF" stopOpacity="0.1" />
				</linearGradient>
				<path id={id.wren} d={WREN_PATH} />
			</defs>

			{/* tile */}
			<rect width="512" height="512" rx={rx} fill="#000000" />
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
					<path d="M104 164 L220 226 L167 249 Z" fill="#F7F7F7" />
					<path d="M104 164 L167 249 L144 278 Z" fill="#D9D9D9" />
					<path
						d="M109 173 L167 249 L211 230"
						stroke="#FFFFFF"
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
						fill="#E3E3E3"
					/>
					<path
						d="M199 258 L287 213 L316 250 L265 339 Z"
						fill="#8C8C8C"
						opacity="0.12"
					/>
					<path
						d="M194 252 L286 208 L310 247 L260 331 Z"
						fill={`url(#${id.wing})`}
					/>
					<path d="M286 208 L278 247 L310 247 Z" fill={`url(#${id.fold})`} />
					<path
						d="M194 252 L286 208 L310 247"
						stroke="#FFFFFF"
						strokeOpacity="0.8"
						strokeWidth="2"
						strokeLinejoin="round"
					/>
					<path
						d="M278 247 L310 247"
						stroke="#9A9A9A"
						strokeOpacity="0.3"
						strokeWidth="1.5"
					/>
					<path
						d="M194 252 L260 331"
						stroke="#FFFFFF"
						strokeOpacity="0.6"
						strokeWidth="1.5"
					/>
					<path d="M376 225 L408 225 L375 239 Z" fill="#DADADA" />
					<circle cx="348" cy="211" r="5.5" fill="#0A0A0A" />
				</g>
			</g>
		</Svg>
	);
}

const Svg = styled.svg`
	display: block;
	flex-shrink: 0;
`;
