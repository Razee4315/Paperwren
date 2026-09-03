import type React from "react";
import styled, { css } from "styled-components";
import { layout, motion, radius } from "@/theme";

export type ButtonVariant = "filled" | "tonal" | "ghost" | "destructive";

export interface ButtonProps {
	children: React.ReactNode;
	onClick?: () => void;
	type?: "button" | "submit";
	variant?: ButtonVariant;
	loading?: boolean;
	loadingText?: string;
	disabled?: boolean;
	fullWidth?: boolean;
	icon?: React.ReactNode;
	className?: string;
	"data-testid"?: string;
}

const buttonBase = css`
	min-height: ${layout.buttonHeight};
	padding: 0 20px;
	font-size: 0.9375rem;
	font-weight: 600;
	border: none;
	border-radius: ${radius.m};
	cursor: pointer;
	transition:
		transform ${motion.dur.instant} ${motion.ease.standard},
		background-color ${motion.dur.instant} ${motion.ease.standard},
		color ${motion.dur.instant} ${motion.ease.standard},
		opacity ${motion.dur.instant} ${motion.ease.standard};
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	white-space: nowrap;
	user-select: none;
	-webkit-user-select: none;
	font-family: inherit;

	&:active:not(:disabled) {
		transform: scale(0.97);
	}
	&:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	&:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
`;

export const StyledButton = styled.button<{
	$variant: ButtonVariant;
	$fullWidth: boolean;
}>`
	${buttonBase}
	width: ${({ $fullWidth }) => ($fullWidth ? "100%" : "auto")};

	${({ $variant }) => {
		switch ($variant) {
			case "filled":
				return css`
					background: var(--accent);
					color: var(--on-accent);
					&:hover:not(:disabled) {
						background: var(--accent-strong);
					}
				`;
			case "tonal":
				return css`
					background: var(--accent-container);
					color: var(--accent-strong);
					&:hover:not(:disabled) {
						background: var(--surface-3);
					}
				`;
			case "destructive":
				return css`
					background: transparent;
					color: var(--danger);
					&:hover:not(:disabled) {
						background: var(--surface-2);
					}
				`;
			default:
				return css`
					background: transparent;
					color: var(--ink-2);
					&:hover:not(:disabled) {
						color: var(--ink-1);
						background: var(--surface-2);
					}
				`;
		}
	}}
`;

const Spinner = styled.span`
	display: inline-block;
	width: 16px;
	height: 16px;
	border: 2px solid currentColor;
	border-top-color: transparent;
	border-radius: 50%;
	animation: pw-spin 0.6s linear infinite;
	@keyframes pw-spin {
		to {
			transform: rotate(360deg);
		}
	}
`;

export function Button({
	children,
	onClick,
	type = "button",
	variant = "filled",
	loading = false,
	loadingText,
	disabled = false,
	fullWidth = false,
	icon,
	className,
	"data-testid": testId,
}: ButtonProps) {
	return (
		<StyledButton
			type={type}
			onClick={!loading && !disabled ? onClick : undefined}
			disabled={disabled || loading}
			$variant={variant}
			$fullWidth={fullWidth}
			className={className}
			data-testid={testId}
		>
			{loading && <Spinner aria-label="Loading" />}
			{icon && !loading && icon}
			{loading && loadingText ? loadingText : children}
		</StyledButton>
	);
}
