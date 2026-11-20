import { type RefObject, useEffect, useRef } from "react";
import s from "./Shell.module.css";

const KNOB = 44;
/** Deliberate hold or vertical drag required before grabbing the scrubber,
 * so a thumb grazing the edge while scrolling does not hijack the page. */
const HOLD_MS = 80;
const DRAG_Y = 4;
const CANCEL_X = 10;
const MOMENTUM_MS = 80;
const MOMENTUM_PX = 8;

/**
 * A handle on the edge for moving through a long document by thumb:
 * it appears while the page scrolls, and a deliberate press or vertical
 * drag scrubs the whole length with the page number beside it. Touch
 * screens only: a mouse already has a scrollbar to drag.
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
		let grab: { pointerId: number; offsetY: number } | null = null;
		let pending: {
			pointerId: number;
			startX: number;
			startY: number;
			offsetY: number;
			timer: number;
		} | null = null;
		let tracking = false;
		let lastScrollTop = el.scrollTop;
		let lastScrollAt = 0;
		let lastScrollDelta = 0;
		let scrollStreak = 0;

		const range = () => el.scrollHeight - el.clientHeight;
		const travel = () => rail.clientHeight - KNOB;
		const place = () => {
			const ratio = range() > 0 ? Math.min(1, el.scrollTop / range()) : 0;
			handle.style.transform = `translateY(${ratio * travel()}px)`;
		};
		const inMomentum = () =>
			scrollStreak >= 2 &&
			performance.now() - lastScrollAt < MOMENTUM_MS &&
			lastScrollDelta > MOMENTUM_PX;
		const rest = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				if (grab === null && pending === null) delete rail.dataset.on;
			}, 1400);
		};
		const scrubTo = (clientY: number) => {
			if (!grab) return;
			const span = travel();
			if (span <= 0) return;
			const y = clientY - rail.getBoundingClientRect().top - grab.offsetY;
			el.scrollTop = Math.min(1, Math.max(0, y / span)) * range();
		};
		const cancelPending = () => {
			if (!pending) return;
			window.clearTimeout(pending.timer);
			pending = null;
		};
		const stopTracking = () => {
			if (!tracking) return;
			tracking = false;
			window.removeEventListener("pointerdown", onWindowDown);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
		const startTracking = () => {
			if (tracking) return;
			tracking = true;
			window.addEventListener("pointerdown", onWindowDown);
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			window.addEventListener("pointercancel", onUp);
		};
		const engage = (pointerId: number, offsetY: number, clientY?: number) => {
			cancelPending();
			grab = { pointerId, offsetY };
			try {
				handle.setPointerCapture(pointerId);
			} catch {
				// Pointer may have already ended or been cancelled.
			}
			rail.dataset.held = "";
			if (clientY !== undefined) scrubTo(clientY);
		};
		const onScroll = () => {
			const top = el.scrollTop;
			if (grab === null) {
				const now = performance.now();
				const delta = Math.abs(top - lastScrollTop);
				scrollStreak =
					now - lastScrollAt < MOMENTUM_MS && delta > MOMENTUM_PX
						? scrollStreak + 1
						: 0;
				lastScrollDelta = delta;
				lastScrollAt = now;
			}
			lastScrollTop = top;
			// Not worth a handle until there are a few screens to cross.
			if (range() < el.clientHeight * 2) return;
			place();
			rail.dataset.on = "";
			rest();
		};
		const onDown = (e: PointerEvent) => {
			if (!e.isPrimary || grab !== null || pending !== null) return;
			// Do not hijack when the document is already in active momentum scrolling.
			if (inMomentum()) return;
			const pointerId = e.pointerId;
			const offsetY = e.clientY - handle.getBoundingClientRect().top;
			window.clearTimeout(timer);
			const holdTimer = window.setTimeout(() => {
				if (pending?.pointerId === pointerId && !inMomentum()) {
					engage(pointerId, offsetY);
				} else {
					cancelPending();
					stopTracking();
					rest();
				}
			}, HOLD_MS);
			pending = {
				pointerId,
				startX: e.clientX,
				startY: e.clientY,
				offsetY,
				timer: holdTimer,
			};
			startTracking();
		};
		const onWindowDown = (e: PointerEvent) => {
			if (pending && e.pointerId === pending.pointerId) return;
			if (grab && e.pointerId === grab.pointerId) return;
			// A second finger (e.g. pinch-to-zoom) cancels any pending scrub check.
			cancelPending();
			if (!grab) {
				stopTracking();
				rest();
			}
		};
		const onMove = (e: PointerEvent) => {
			if (grab) {
				if (e.pointerId !== grab.pointerId) return;
				scrubTo(e.clientY);
				return;
			}
			if (!pending || e.pointerId !== pending.pointerId) return;
			const dx = Math.abs(e.clientX - pending.startX);
			const dy = Math.abs(e.clientY - pending.startY);
			// Moving horizontally away from the edge is a swipe or pan, not a scrub.
			if (dx > CANCEL_X) {
				cancelPending();
				stopTracking();
				rest();
				return;
			}
			if (dy >= DRAG_Y) {
				if (inMomentum()) {
					cancelPending();
					stopTracking();
					rest();
					return;
				}
				engage(pending.pointerId, pending.offsetY, e.clientY);
			}
		};
		const onUp = (e: PointerEvent) => {
			if (pending && e.pointerId === pending.pointerId) {
				cancelPending();
				stopTracking();
				rest();
				return;
			}
			if (grab && e.pointerId === grab.pointerId) {
				grab = null;
				delete rail.dataset.held;
				stopTracking();
				rest();
			}
		};
		const onLostCapture = (e: PointerEvent) => {
			if (grab && e.pointerId === grab.pointerId) {
				grab = null;
				delete rail.dataset.held;
				stopTracking();
				rest();
			}
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		handle.addEventListener("pointerdown", onDown);
		handle.addEventListener("lostpointercapture", onLostCapture);
		return () => {
			window.clearTimeout(timer);
			cancelPending();
			stopTracking();
			delete rail.dataset.held;
			delete rail.dataset.on;
			el.removeEventListener("scroll", onScroll);
			handle.removeEventListener("pointerdown", onDown);
			handle.removeEventListener("lostpointercapture", onLostCapture);
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
