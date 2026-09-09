import { BrandMark } from "@/components/BrandMark";
import { motion, radius, space } from "@/theme";
import styled from "styled-components";

/**
 * SCR-01 Splash (docs/04 section 3.1): the real brand tile settles
 * into place, the wordmark and tagline rise to meet it. One 480ms
 * gesture, then straight to content. Matches SPLASH_MS in App so
 * the reveal never stalls the start.
 */

const Container = styled.div`
	position: fixed;
	inset: 0;
	/* A whisper of brand warmth at the top; ink paper everywhere else. */
	background:
		radial-gradient(
			120% 80% at 50% -12%,
			var(--accent-tint) 0%,
			transparent 58%
		),
		var(--bg);
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: ${space[6]};
	z-index: 2000;
`;

const TileWrap = styled.div`
	animation: pw-tile-settle ${motion.dur.settle} ${motion.ease.enter} both;
	@keyframes pw-tile-settle {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.92);
		}
	}
	filter: drop-shadow(0 18px 32px rgba(20, 12, 4, 0.28));
	border-radius: ${radius.xl};
`;

const Wordmark = styled.h1`
	font-family: var(--font-display);
	font-size: 36px;
	font-weight: 600;
	letter-spacing: -0.015em;
	color: var(--ink-1);
	animation: pw-rise ${motion.dur.settle} ${motion.ease.enter} 90ms both;
	@keyframes pw-rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}

	span {
		color: var(--accent);
	}
`;

const Tagline = styled.p`
	font-family: var(--font-ui);
	font-size: 0.875rem;
	font-weight: 500;
	letter-spacing: 0.02em;
	color: var(--ink-3);
	animation: pw-rise ${motion.dur.settle} ${motion.ease.enter} 170ms both;
`;

export function Splash() {
	return (
		<Container data-testid="splash">
			<TileWrap aria-hidden="true">
				<BrandMark size={104} title="" />
			</TileWrap>
			<div>
				<Wordmark>
					Paper<span>wren</span>
				</Wordmark>
				<Tagline>Open anything. Instantly.</Tagline>
			</div>
		</Container>
	);
}
