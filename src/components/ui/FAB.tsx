import { motion, radius } from "@/theme";
import styled from "styled-components";

/** 56 dp accent FAB (docs/02 section 6): rises in softly, lifts on
 * hover, settles under the finger on press, hides with the scroll. */
const Styled = styled.button`
	width: 56px;
	height: 56px;
	border: none;
	border-radius: ${radius.full};
	background: var(--accent);
	color: var(--on-accent);
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	box-shadow: var(--shadow-3);
	animation: pw-item-in ${motion.dur.standard} ${motion.ease.enter} 120ms both;
	transition:
		transform ${motion.dur.fast} ${motion.ease.standard},
		background-color ${motion.dur.instant} ${motion.ease.standard},
		box-shadow ${motion.dur.standard} ${motion.ease.standard};
	user-select: none;
	-webkit-user-select: none;

	&:hover:not(:disabled) {
		background: var(--accent-strong);
		box-shadow: 0 8px 28px rgba(60, 42, 20, 0.22);
	}
	&:active:not(:disabled) {
		transform: scale(0.92);
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

export function FAB({
	onClick,
	hidden = false,
	label,
	children,
}: {
	onClick?: () => void;
	hidden?: boolean;
	label: string;
	children: React.ReactNode;
}) {
	return (
		<Positioned $hidden={hidden}>
			<Styled onClick={onClick} aria-label={label} title={label}>
				{children}
			</Styled>
		</Positioned>
	);
}
