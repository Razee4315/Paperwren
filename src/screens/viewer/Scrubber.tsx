import { type RefObject, useEffect, useRef } from "react";
import s from "./Shell.module.css";

const KNOB = 44;

/**
 * A handle on the right edge for moving through a long document by
 * thumb: it appears while the page scrolls, and dragging it scrubs the
 * whole length with the page number beside it. Touch screens only: a
 * mouse already has a scrollbar to drag.
 */
export function Scrubber({
	of,
	label,
	enabled,
}: {
	/** The scrolling viewport. */
	of: RefObject<HTMLElement | null>;
	/** What the reader is looking at, e.g. "12 / 300". */
	label: string;
	enabled: boolean;
}) {
	const track = useRef<HTMLDivElement>(null);
	const knob = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = of.current;
		const rail = track.current;
		const handle = knob.current;
		if (!enabled || !el || !rail || !handle) return;
		let timer = 0;
		let grab: number | null = null;
		const range = () => el.scrollHeight - el.clientHeight;
		const travel = () => rail.clientHeight - KNOB;
		const place = () => {
			const ratio = range() > 0 ? Math.min(1, el.scrollTop / range()) : 0;
			handle.style.transform = `translateY(${ratio * travel()}px)`;
		};
		const rest = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				if (grab === null) delete rail.dataset.on;
			}, 1400);
		};
		const onScroll = () => {
			// Not worth a handle until there are a few screens to cross.
			if (range() < el.clientHeight * 2) return;
			place();
			rail.dataset.on = "";
			rest();
		};
		const onDown = (e: PointerEvent) => {
			grab = e.clientY - handle.getBoundingClientRect().top;
			handle.setPointerCapture(e.pointerId);
			rail.dataset.held = "";
			e.preventDefault();
		};
		const onMove = (e: PointerEvent) => {
			if (grab === null) return;
			const y = e.clientY - rail.getBoundingClientRect().top - grab;
			el.scrollTop = Math.min(1, Math.max(0, y / travel())) * range();
		};
		const onUp = () => {
			if (grab === null) return;
			grab = null;
			delete rail.dataset.held;
			rest();
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		handle.addEventListener("pointerdown", onDown);
		handle.addEventListener("pointermove", onMove);
		handle.addEventListener("pointerup", onUp);
		handle.addEventListener("pointercancel", onUp);
		return () => {
			window.clearTimeout(timer);
			el.removeEventListener("scroll", onScroll);
			handle.removeEventListener("pointerdown", onDown);
			handle.removeEventListener("pointermove", onMove);
			handle.removeEventListener("pointerup", onUp);
			handle.removeEventListener("pointercancel", onUp);
		};
	}, [of, enabled]);

	return (
		<div ref={track} className={s.scrub} aria-hidden="true">
			<div ref={knob} className={s.scrubKnob} data-testid="scrubber">
				<span className={s.scrubLabel}>{label}</span>
			</div>
		</div>
	);
}
