import { motion, radius } from "@/theme";
import styled from "styled-components";

const Styled = styled.button<{ $extended: boolean }>`
	height: 56px;
	border: none;
	border-radius: ${radius.full};
	background: linear-gradient(
		135deg,
		var(--accent) 0%,
		var(--accent-strong) 100%
	);
	color: var(--on-accent);
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10px;
	padding: ${({ $extended }) => ($extended ? "0 22px 0 19px" : "0")};
	width: ${({ $extended }) => ($extended ? "auto" : "56px")};
	cursor: pointer;
	box-shadow: var(--shadow-3);
	animation: pw-item-in ${motion.dur.standard} ${motion.ease.enter} 120ms both;
	transition:
		transform ${motion.dur.fast} ${motion.ease.standard},
		filter ${motion.dur.instant} ${motion.ease.standard},
		box-shadow ${motion.dur.standard} ${motion.ease.standard};
	user-select: none;
	-webkit-user-select: none;

	&:hover:not(:disabled) {
		filter: brightness(1.07);
		box-shadow: 0 8px 28px rgba(60, 42, 20, 0.22);
	}
	&:active:not(:disabled) {
		transform: scale(0.94);
		box-shadow: var(--shadow-1);
	}
	&:disabled {
		opacity: 0.4;
	}
	&:focus-visible {
		outline: 2px solid var(--accent-deep);
		outline-offset: 3px;
	}
`;

const ExtendedLabel = styled.span`
	font-size: 0.9375rem;
	font-weight: 700;
	letter-spacing: -0.01em;
	white-space: nowrap;
`;

const Positioned = styled.div<{ $hidden: boolean }>`
	position: fixed;
	right: 20px;
	bottom: calc(20px + var(--safe-area-bottom, 0px) + var(--keyboard-inset, 0px));
	z-index: 500;
	transform: translateY(${({ $hidden }) => ($hidden ? "76px" : "0")});
	opacity: ${({ $hidden }) => ($hidden ? 0 : 1)};
	pointer-events: ${({ $hidden }) => ($hidden ? "none" : "auto")};
	transition:
		transform ${motion.dur.standard} ${motion.ease.standard},
		opacity ${motion.dur.standard} ${motion.ease.standard};
`;

/** 56 dp accent FAB (docs/02 section 6): circular by default, or an
 * extended pill carrying its label (`extended`). Rises in softly,
 * lifts on hover, settles under the finger on press, hides with the
 * scroll. */
export function FAB({
	onClick,
	hidden = false,
	label,
	extended = false,
	children,
}: {
	onClick?: () => void;
	hidden?: boolean;
	label: string;
	extended?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Positioned $hidden={hidden}>
			<Styled
				onClick={onClick}
				aria-label={label}
				title={label}
				$extended={extended}
			>
				{children}
				{extended && <ExtendedLabel>{label}</ExtendedLabel>}
			</Styled>
		</Positioned>
	);
}
