import { motion, radius, type } from "@/theme";
import styled from "styled-components";

/** Page scrubber (docs/02 section 6): thin 4px track, ember fill,
 * 20px thumb growing to 24px while dragging, live caption bubble. */

const Wrap = styled.div`
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 0 16px;
	height: 56px;
	touch-action: none;
`;

const TrackWrap = styled.div`
	flex: 1;
	position: relative;
	height: 24px;
	display: flex;
	align-items: center;
`;

const Track = styled.div`
	position: absolute;
	left: 0;
	right: 0;
	height: 4px;
	border-radius: ${radius.full};
	background: var(--surface-2);
	overflow: hidden;
`;

const Fill = styled.div<{ $fraction: number }>`
	height: 100%;
	background: var(--accent);
	width: ${({ $fraction }) => Math.min(100, Math.max(0, $fraction * 100))}%;
	border-radius: ${radius.full};
`;

const Thumb = styled.div<{ $fraction: number; $dragging: boolean }>`
	position: absolute;
	left: ${({ $fraction }) => `calc(${Math.min(100, Math.max(0, $fraction * 100))}% - 10px)`};
	width: ${({ $dragging }) => ($dragging ? 24 : 20)}px;
	height: ${({ $dragging }) => ($dragging ? 24 : 20)}px;
	border-radius: ${radius.full};
	background: var(--accent);
	transition: width ${motion.dur.instant} ${motion.ease.standard},
		height ${motion.dur.instant} ${motion.ease.standard};
`;

const Bubble = styled.div`
	${type.caption};
	background: var(--surface-3);
	color: var(--ink-1);
	border-radius: ${radius.s};
	padding: 4px 8px;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
	min-width: 56px;
	text-align: center;
`;

export function Scrubber({
	value,
	max,
	onChange,
	label,
}: {
	value: number;
	max: number;
	onChange: (value: number) => void;
	label: string;
}) {
	const fraction = max > 1 ? value / (max - 1) : 0;

	const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const f = Math.min(1, Math.max(0, x / rect.width));
		onChange(Math.round(f * (max - 1)));
	};

	return (
		<Wrap>
			<TrackWrap
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					handlePointer(e);
				}}
				onPointerMove={(e) => {
					if (e.buttons > 0) handlePointer(e);
				}}
				role="slider"
				aria-label={label}
				aria-valuemin={1}
				aria-valuemax={max}
				aria-valuenow={value + 1}
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "ArrowLeft" && value > 0) onChange(value - 1);
					if (e.key === "ArrowRight" && value < max - 1) onChange(value + 1);
				}}
			>
				<Track>
					<Fill $fraction={fraction} />
				</Track>
				<Thumb $fraction={fraction} $dragging={false} />
			</TrackWrap>
			<Bubble aria-live="polite">
				{value + 1} / {max}
			</Bubble>
		</Wrap>
	);
}
