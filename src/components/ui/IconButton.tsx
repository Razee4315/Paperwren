import type React from "react";
import styled from "styled-components";
import { layout, motion, radius } from "@/theme";

/** Square icon-only button. The icon sits at 24px inside a 48px
 * touch target (docs/02 section 4 minimum target). */
const Styled = styled.button<{ $active?: boolean }>`
	width: ${layout.minTouch};
	height: ${layout.minTouch};
	border: none;
	border-radius: ${radius.full};
	background: transparent;
	color: ${({ $active }) => ($active ? "var(--ink-1)" : "var(--ink-2)")};
	display: inline-flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	flex-shrink: 0;
	transition:
		background-color ${motion.dur.instant} ${motion.ease.standard},
		color ${motion.dur.instant} ${motion.ease.standard},
		transform ${motion.dur.instant} ${motion.ease.standard};
	user-select: none;
	-webkit-user-select: none;

	&:hover:not(:disabled) {
		background: var(--surface-2);
		color: var(--ink-1);
	}
	&:active:not(:disabled) {
		transform: scale(0.94);
		background: var(--surface-3);
	}
	&:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	&:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
`;

export interface IconButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	children: React.ReactNode;
	"label": string;
	active?: boolean;
}

export function IconButton({
	children,
	"label": label,
	active = false,
	...rest
}: IconButtonProps) {
	return (
		<Styled aria-label={label} title={label} $active={active} {...rest}>
			{children}
		</Styled>
	);
}
