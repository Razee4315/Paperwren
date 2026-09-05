import styled from "styled-components";

/**
 * The paper-wren mark from the brand icon (assets/brand/app-icon.svg)
 * as a single-path silhouette in currentColor, so any surface can
 * carry the bird in its own ink or accent.
 */

const BIRD_PATH =
	"M104 164 L220 226 L293 184 C306 176 318 173 331 174 C352 175 369 190 376 210 L408 225 L375 239 C372 263 359 284 340 300 L300 330 C279 346 251 349 229 337 C211 328 198 313 186 294 L144 278 Z";

const Svg = styled.svg`
	display: block;
	color: inherit;
`;

export function WrenMark({
	size = 96,
	title = "Paperwren",
}: {
	size?: number;
	title?: string;
}) {
	return (
		<Svg
			width={size}
			height={(size * 232) / 336}
			viewBox="88 140 336 232"
			fill="currentColor"
			role="img"
			aria-label={title}
		>
			<path d={BIRD_PATH} />
		</Svg>
	);
}
