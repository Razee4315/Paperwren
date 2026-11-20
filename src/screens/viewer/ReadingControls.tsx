import { t, uiDir } from "@/lib/i18n";
import { MAX_DIM, SCROLL_SPEEDS } from "@/lib/settings";
import { useSetting, useUpdateSetting } from "@/state/settings";
import { IconButton, Sheet } from "@/ui";
import { Pause, Play, Rabbit, Turtle, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import s from "./Shell.module.css";

/** A scroll by hand sets the reading aside this long before it goes on. */
const HAND_PAUSE_MS = 1500;

/**
 * The document scrolls by itself, at a pace the reader sets (and keeps):
 * for reading on without touching the screen, or a lyric sheet or a
 * speech. A touch or the wheel holds it for a moment; it stops at the end.
 */
export function AutoScroll({
	of,
	onClose,
}: {
	of: RefObject<HTMLElement | null>;
	onClose: () => void;
}) {
	const scrollSpeed = useSetting("scrollSpeed");
	const update = useUpdateSetting();
	const [running, setRunning] = useState(true);
	const speed = useRef(scrollSpeed);
	speed.current = scrollSpeed;

	useEffect(() => {
		const el = of.current;
		if (!el || !running) return;
		let raf = 0;
		let last = 0;
		let carry = 0;
		let heldUntil = 0;
		const frame = (now: number) => {
			raf = requestAnimationFrame(frame);
			const dt = last ? Math.min(100, now - last) : 0;
			last = now;
			if (now < heldUntil) return;
			carry += (speed.current * dt) / 1000;
			const whole = Math.floor(carry);
			if (!whole) return;
			carry -= whole;
			const before = el.scrollTop;
			el.scrollTop += whole;
			// At the end there is nothing more to scroll.
			if (el.scrollTop === before && before > 0) setRunning(false);
		};
		const hold = () => {
			heldUntil = performance.now() + HAND_PAUSE_MS;
		};
		raf = requestAnimationFrame(frame);
		el.addEventListener("touchstart", hold, { passive: true });
		el.addEventListener("touchmove", hold, { passive: true });
		el.addEventListener("wheel", hold, { passive: true });
		return () => {
			cancelAnimationFrame(raf);
			el.removeEventListener("touchstart", hold);
			el.removeEventListener("touchmove", hold);
			el.removeEventListener("wheel", hold);
		};
	}, [of, running]);

	const pace = (by: number) =>
		update(
			"scrollSpeed",
			Math.round(
				Math.min(
					SCROLL_SPEEDS[1],
					Math.max(SCROLL_SPEEDS[0], scrollSpeed * by),
				),
			),
		);

	return (
		<div
			className={s.speech}
			dir={uiDir()}
			role="toolbar"
			aria-label={t("Scroll by itself")}
			data-testid="auto-scroll"
		>
			<IconButton label={t("Slower")} onClick={() => pace(1 / 1.25)}>
				<Turtle size={18} />
			</IconButton>
			{running ? (
				<IconButton
					label={t("Pause")}
					onClick={() => setRunning(false)}
					data-testid="auto-scroll-pause"
				>
					<Pause size={20} />
				</IconButton>
			) : (
				<IconButton
					label={t("Resume")}
					onClick={() => setRunning(true)}
					data-testid="auto-scroll-play"
				>
					<Play size={20} />
				</IconButton>
			)}
			<IconButton
				label={t("Faster")}
				onClick={() => pace(1.25)}
				data-testid="auto-scroll-faster"
			>
				<Rabbit size={18} />
			</IconButton>
			<span className={s.speechRate} data-testid="auto-scroll-speed">
				{scrollSpeed}
			</span>
			<IconButton
				label={t("Stop scrolling")}
				onClick={onClose}
				data-testid="auto-scroll-stop"
			>
				<X size={18} />
			</IconButton>
		</div>
	);
}

/** How dark the screen is made over the document, for reading in a
 * dark room past what the phone's own brightness allows. An overlay: the
 * system's brightness is never touched (that would need a permission). */
export function DimSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const dim = useSetting("dim");
	const update = useUpdateSetting();
	const percent = Math.round((dim / MAX_DIM) * 100);
	return (
		<Sheet
			open={open}
			title={t("Dim the screen")}
			onClose={onClose}
			testId="dim-sheet"
		>
			<label className={s.dimField} dir={uiDir()}>
				<span>{t("{n}% darker", { n: percent })}</span>
				<input
					type="range"
					min={0}
					max={100}
					step={5}
					value={percent}
					onChange={(e) =>
						update("dim", (Number(e.target.value) / 100) * MAX_DIM)
					}
					aria-label={t("Dim the screen")}
					data-testid="dim-range"
				/>
			</label>
		</Sheet>
	);
}
