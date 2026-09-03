import { motion } from "@/theme";
import styled from "styled-components";

/** Progress, ink-underline style (docs/02 section 6, docs/04
 * section 5): a 3px ember bar drawing left to right under the
 * toolbar. Replaces all spinners. Determinate when progress is
 * known; otherwise a slow indeterminate draw loop. */

const Bar = styled.div`
	height: 3px;
	background: transparent;
	overflow: hidden;
	position: relative;
`;

const Fill = styled.div<{ $progress: number | null }>`
	height: 100%;
	background: var(--accent);

	${({ $progress }) =>
		$progress !== null
			? `
				width: ${Math.min(100, Math.max(0, $progress * 100))}%;
				transition: width ${motion.dur.fast} ${motion.ease.standard};
			`
			: `
				width: 40%;
				animation: pw-ink-slide 1.4s ${motion.ease.standard} infinite;
				@keyframes pw-ink-slide {
					from { transform: translateX(-100%); }
					to { transform: translateX(350%); }
				}
			`}
`;

export function InkProgress({ progress }: { progress: number | null }) {
	return (
		<Bar role="progressbar">
			<Fill $progress={progress} />
		</Bar>
	);
}

/** Skeleton: surface-2 blocks with a subtle shimmer, used only
 * where content takes longer than 300ms. */
const Bone = styled.div<{ $width?: string; $height?: string }>`
	background: var(--surface-2);
	border-radius: 8px;
	width: ${({ $width }) => $width ?? "100%"};
	height: ${({ $height }) => $height ?? "16px"};
	position: relative;
	overflow: hidden;

	&::after {
		content: "";
		position: absolute;
		inset: 0;
		transform: translateX(-100%);
		background: linear-gradient(
			90deg,
			transparent,
			rgba(217, 84, 48, 0.08),
			transparent
		);
		animation: pw-shimmer 1.4s ease infinite;
	}
	@keyframes pw-shimmer {
		to {
			transform: translateX(100%);
		}
	}
`;

export function Skeleton({
	width,
	height,
}: {
	width?: string;
	height?: string;
}) {
	return <Bone $width={width} $height={height} />;
}
