/**
 * Where two documents side by side meet: drag it (or move it with the
 * arrow keys) to give one more room; a double click shares the window
 * evenly again.
 */
import { t } from "@/lib/i18n";
import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import s from "./Pane.module.css";

export function SplitDivider({
	ratio,
	onRatio,
}: {
	/** Where the halves meet, as a share of the window's width. */
	ratio: number;
	onRatio: (ratio: number) => void;
}) {
	const dragging = useRef<number | null>(null);
	const frame = useRef(0);
	const to = (x: number) => {
		cancelAnimationFrame(frame.current);
		// One layout a frame, however fast the pointer moves.
		frame.current = requestAnimationFrame(() =>
			onRatio(x / Math.max(1, window.innerWidth)),
		);
	};
	const down = (e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		e.preventDefault();
		dragging.current = e.pointerId;
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const move = (e: PointerEvent<HTMLDivElement>) => {
		if (dragging.current === e.pointerId) to(e.clientX);
	};
	const up = (e: PointerEvent<HTMLDivElement>) => {
		if (dragging.current === e.pointerId) dragging.current = null;
	};
	const key = (e: KeyboardEvent<HTMLDivElement>) => {
		const step = e.shiftKey ? 0.1 : 0.02;
		const by: Record<string, number> = {
			ArrowLeft: -step,
			ArrowRight: step,
		};
		if (e.key === "Home" || e.key === "End" || e.key === "Enter") {
			e.preventDefault();
			onRatio(e.key === "Home" ? 0 : e.key === "End" ? 1 : 0.5);
			return;
		}
		if (!(e.key in by)) return;
		e.preventDefault();
		// The arrows move it on the screen, whichever way the words run.
		onRatio(ratio + by[e.key]);
	};
	return (
		<div
			className={s.divider}
			style={{ left: `${ratio * 100}%` }}
			// biome-ignore lint/a11y/useSemanticElements: a focusable splitter, which <hr> cannot be
			role="separator"
			aria-orientation="vertical"
			aria-label={t("Resize the two documents")}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(ratio * 100)}
			tabIndex={0}
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			onPointerCancel={up}
			onDoubleClick={() => onRatio(0.5)}
			onKeyDown={key}
			data-testid="split-divider"
		>
			<span aria-hidden="true" />
		</div>
	);
}
