import styled from "styled-components";
import { motion, radius } from "@/theme";

/**
 * SCR-01 Splash (docs/04 section 3.1): the launcher mark's top
 * sheet rotates from -12deg to 0 while the wordmark fades up,
 * total 480ms, then straight to content.
 */

const Container = styled.div`
	position: fixed;
	inset: 0;
	background: var(--bg);
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 24px;
	z-index: 2000;
`;

const Stack = styled.div`
	position: relative;
	width: 96px;
	height: 96px;
	animation: pw-settle ${motion.dur.settle} ${motion.ease.enter};
	@keyframes pw-settle {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
`;

const SheetBase = styled.div`
	position: absolute;
	inset: 8px;
	border-radius: ${radius.m};
`;

const SheetBack = styled(SheetBase)`
	background: var(--fmt-xlsx);
	transform: rotate(-12deg);
	opacity: 0.85;
`;

const SheetMid = styled(SheetBase)`
	background: var(--fmt-docx);
	opacity: 0.85;
`;

const SheetTop = styled(SheetBase)`
	background: var(--fmt-pdf);
	transform-origin: center;
	animation: pw-unfold ${motion.dur.settle} ${motion.ease.enter};
	@keyframes pw-unfold {
		from {
			transform: rotate(-12deg);
		}
		to {
			transform: rotate(12deg);
		}
	}
`;

const Wordmark = styled.h1`
	font-family: var(--font-display);
	font-size: 32px;
	font-weight: 600;
	letter-spacing: -0.01em;
	color: var(--ink-1);
	animation: pw-fade-up ${motion.dur.settle} ${motion.ease.enter};
	@keyframes pw-fade-up {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	span {
		color: var(--accent);
	}
`;

export function Splash() {
	return (
		<Container data-testid="splash">
			<Stack aria-hidden="true">
				<SheetBack />
				<SheetMid />
				<SheetTop />
			</Stack>
			<Wordmark>
				Paper<span>wren</span>
			</Wordmark>
		</Container>
	);
}
