import styled from "styled-components";
import { motion, radius, type } from "@/theme";

/** Toggle (docs/02 section 6): 52x32, ember track when on. */

const Row = styled.label`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	min-height: 48px;
	cursor: pointer;
	user-select: none;
	-webkit-user-select: none;
`;

const LabelWrap = styled.div`
	flex: 1;
`;

const Label = styled.span`
	${type.body};
	color: var(--ink-1);
	display: block;
`;

const Hint = styled.span`
	${type.small};
	color: var(--ink-2);
	display: block;
	margin-top: 2px;
`;

const HiddenInput = styled.input`
	position: absolute;
	opacity: 0;
	width: 1px;
	height: 1px;
`;

const Track = styled.span<{ $on: boolean }>`
	width: 52px;
	height: 32px;
	border-radius: ${radius.full};
	background: ${({ $on }) => ($on ? "var(--accent)" : "var(--surface-3)")};
	border: 1px solid ${({ $on }) => ($on ? "var(--accent)" : "var(--border)")};
	position: relative;
	flex-shrink: 0;
	transition: background-color ${motion.dur.fast} ${motion.ease.standard};
`;

const Thumb = styled.span<{ $on: boolean }>`
	position: absolute;
	top: 3px;
	left: ${({ $on }) => ($on ? "23px" : "3px")};
	width: 24px;
	height: 24px;
	border-radius: ${radius.full};
	background: ${({ $on }) => ($on ? "var(--surface)" : "var(--ink-3)")};
	transition: left ${motion.dur.fast} ${motion.ease.standard};
	box-shadow: 0 1px 2px rgba(60, 42, 20, 0.2);
`;

export function Toggle({
	checked,
	onChange,
	label,
	hint,
	disabled,
}: {
	checked: boolean;
	onChange: (value: boolean) => void;
	label: string;
	hint?: string;
	disabled?: boolean;
}) {
	return (
		<Row>
			<LabelWrap>
				<Label>{label}</Label>
				{hint && <Hint>{hint}</Hint>}
			</LabelWrap>
			<HiddenInput
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<Track $on={checked} aria-hidden="true">
				<Thumb $on={checked} />
			</Track>
		</Row>
	);
}
