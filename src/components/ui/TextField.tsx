import { motion, radius, type } from "@/theme";
import styled from "styled-components";

/** Filled text field (docs/02 section 6): surface-2 fill, radius-m,
 * ember focus underline. 16px font on mobile via the global rule. */

const Wrap = styled.div`
	display: flex;
	flex-direction: column;
	gap: 6px;
	width: 100%;
`;

const Label = styled.label`
	${type.small};
	color: var(--ink-2);
	font-weight: 600;
`;

const Box = styled.input<{ $hasError: boolean }>`
	min-height: 48px;
	padding: 12px;
	font-size: inherit;
	color: var(--ink-1);
	background: var(--surface-2);
	border: none;
	border-bottom: 2px solid
		${({ $hasError }) => ($hasError ? "var(--danger)" : "transparent")};
	border-radius: ${radius.m};
	outline: none;
	width: 100%;
	transition: border-color ${motion.dur.fast} ${motion.ease.standard};

	&::placeholder {
		color: var(--ink-3);
	}
	&:focus {
		border-bottom-color: ${({ $hasError }) =>
			$hasError ? "var(--danger)" : "var(--accent)"};
	}
`;

const ErrorText = styled.span`
	${type.small};
	color: var(--danger);
`;

export function TextField({
	label,
	value,
	onChange,
	placeholder,
	type = "text",
	errorText,
	autoFocus,
	inputMode,
	maxLength,
}: {
	label?: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: string;
	errorText?: string;
	autoFocus?: boolean;
	inputMode?: "text" | "numeric";
	maxLength?: number;
}) {
	return (
		<Wrap>
			{label && <Label>{label}</Label>}
			<Box
				type={type}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				autoFocus={autoFocus}
				inputMode={inputMode}
				maxLength={maxLength}
				$hasError={!!errorText}
				aria-label={label}
				aria-invalid={!!errorText}
			/>
			{errorText && <ErrorText role="alert">{errorText}</ErrorText>}
		</Wrap>
	);
}
