import type { Position } from "@/lib/types";
import { useSettings } from "@/state/settings";
import { type RefObject, useEffect, useRef } from "react";

/**
 * Two-finger pinch and Ctrl+wheel zoom for DOM-rendered documents.
 * The zoom is applied by the caller (CSS `zoom`); this hook keeps the
 * point under the fingers stable by adjusting the scroll offsets.
 */
export function usePinchZoom(
	scroller: RefObject<HTMLElement | null>,
	zoom: number,
	setZoom: (z: number) => void,
	min = 0.25,
	max = 5,
) {
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	const setRef = useRef(setZoom);
	setRef.current = setZoom;

	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const apply = (factor: number, cx: number, cy: number) => {
			const from = zoomRef.current;
			const to = Math.min(max, Math.max(min, from * factor));
			if (Math.abs(to - from) < 0.001) return;
			const rect = el.getBoundingClientRect();
			const x = el.scrollLeft + cx - rect.left;
			const y = el.scrollTop + cy - rect.top;
			zoomRef.current = to;
			setRef.current(to);
			requestAnimationFrame(() => {
				el.scrollLeft = (x * to) / from - (cx - rect.left);
				el.scrollTop = (y * to) / from - (cy - rect.top);
			});
		};
		let last = 0;
		const dist = (t: TouchList) =>
			Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
		const onStart = (e: TouchEvent) => {
			if (e.touches.length === 2) {
				e.preventDefault();
				last = dist(e.touches);
			}
		};
		const onMove = (e: TouchEvent) => {
			if (e.touches.length !== 2 || !last) return;
			e.preventDefault();
			const d = dist(e.touches);
			const factor = d / last;
			if (Math.abs(factor - 1) < 0.02) return;
			last = d;
			apply(
				factor,
				(e.touches[0].clientX + e.touches[1].clientX) / 2,
				(e.touches[0].clientY + e.touches[1].clientY) / 2,
			);
		};
		const onEnd = (e: TouchEvent) => {
			if (e.touches.length < 2) last = 0;
		};
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			apply(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
		};
		el.addEventListener("touchstart", onStart, { passive: false });
		el.addEventListener("touchmove", onMove, { passive: false });
		el.addEventListener("touchend", onEnd);
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			el.removeEventListener("touchstart", onStart);
			el.removeEventListener("touchmove", onMove);
			el.removeEventListener("touchend", onEnd);
			el.removeEventListener("wheel", onWheel);
		};
	}, [scroller, min, max]);
}

/**
 * Restore and persist a scroll ratio (plus zoom) for reflowing
 * viewers. Restores once `ready` turns true; saves debounced.
 */
export function useScrollMemory(
	scroller: RefObject<HTMLElement | null>,
	ready: boolean,
	position: Position | undefined,
	onPosition: (p: Position) => void,
	zoom?: number,
) {
	const { settings } = useSettings();
	const restored = useRef(false);
	const onPositionRef = useRef(onPosition);
	onPositionRef.current = onPosition;
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	const remember = settings.rememberPosition;

	useEffect(() => {
		const el = scroller.current;
		if (!ready || !el || restored.current) return;
		restored.current = true;
		if (remember && position?.kind === "scroll") {
			requestAnimationFrame(() => {
				el.scrollTop = position.ratio * (el.scrollHeight - el.clientHeight);
			});
		}
	}, [ready, scroller, position, remember]);

	useEffect(() => {
		const el = scroller.current;
		if (!ready || !el || !remember) return;
		let timer = 0;
		const save = () => {
			const range = el.scrollHeight - el.clientHeight;
			onPositionRef.current({
				kind: "scroll",
				ratio: range > 0 ? el.scrollTop / range : 0,
				zoom: zoomRef.current,
			});
		};
		const onScroll = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(save, 400);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			window.clearTimeout(timer);
			el.removeEventListener("scroll", onScroll);
		};
	}, [ready, scroller, remember]);
}
