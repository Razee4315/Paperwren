import type { Position } from "@/lib/types";
import { useSettings } from "@/state/settings";
import {
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";

export interface ZoomOptions {
	/** The scrolling viewport. */
	scroller: RefObject<HTMLElement | null>;
	/** The element whose box grows and shrinks with the zoom. */
	content: RefObject<HTMLElement | null>;
	/** Wrapper that is GPU-scaled while a gesture is in flight; the
	 * real layout happens once, when the gesture ends. Leave it out for
	 * layouts cheap enough to re-flow on every frame (the sheet grid). */
	stage?: RefObject<HTMLElement | null>;
	zoom: number;
	/** Apply a zoom. Layout must be up to date when this returns. */
	commit: (zoom: number) => void;
	min: number;
	max: number;
	/** The zoom double-tap and Ctrl+0 return to. */
	home?: number;
	/** Live zoom, when it is not React state (pdf.js owns its scale). */
	get?: () => number;
	/** The box to hold still under a point, when `content` does not
	 * scale uniformly (PDF pages sit between fixed-size gaps). */
	anchor?: (x: number, y: number) => HTMLElement | null;
	/** Runs after the scroll offsets were corrected for a new zoom. */
	onSettle?: () => void;
	/** Badge that shows the level while a gesture is in flight. */
	hud?: RefObject<HTMLElement | null>;
	/** How a zoom reads in the badge (default: a percentage). */
	label?: (zoom: number) => string;
	onTap?: (target: HTMLElement) => void;
	/** Replaces the default double-tap (zoom in / back to `home`). */
	onDoubleTap?: (x: number, y: number) => void;
	/** Replaces the default Ctrl+0 (back to `home`). */
	onReset?: () => void;
	doubleTap?: boolean;
	/** Listen at all (the viewport exists). */
	enabled?: boolean;
	/** Own the keyboard shortcuts (this viewer is on top). */
	active?: boolean;
}

export interface ZoomApi {
	zoomTo(zoom: number, origin?: [number, number], after?: () => void): void;
	zoomBy(factor: number, origin?: [number, number]): void;
}

const ZOOM_MS = 170;
const EASE = "cubic-bezier(0.2, 0, 0, 1)";
/** One wheel notch on a mouse is deltaY 100; a trackpad pinch sends
 * single digits. Capping keeps a notch to a gentle step. */
const WHEEL_CAP = 26;

type GestureKind = "pinch" | "wheel" | "glide";

interface Gesture {
	kind: GestureKind;
	/** Zoom when the gesture began, and the factor applied since. */
	base: number;
	f: number;
	/** Where it began, where it is now, and (live) was last applied. */
	sx: number;
	sy: number;
	x: number;
	y: number;
	px: number;
	py: number;
	raf: number;
	/** Where an animated step is heading; an interruption lands there. */
	goal?: number;
	after?: () => void;
}

/**
 * Zoom for every viewer: two-finger pinch, Ctrl+wheel / trackpad
 * pinch, double-tap, Ctrl +/-/0 and the toolbar buttons.
 *
 * The point under the fingers (or cursor) stays put. While a gesture
 * is in flight the page is only scaled on the compositor, so it tracks
 * the fingers at full frame rate however heavy the document is; the
 * document is laid out again once, when the gesture ends.
 */
export function useZoom(options: ZoomOptions): ZoomApi {
	const o = useRef(options);
	o.current = options;
	const api = useRef<ZoomApi | null>(null);
	const { scroller, content, stage, enabled = true, active = true } = options;

	useEffect(() => {
		const box = scroller.current;
		const body = content.current;
		if (!enabled || !box || !body) return;
		const layer = stage?.current ?? null;
		const get = () => o.current.get?.() ?? o.current.zoom;
		const clamp = (z: number) =>
			Math.min(o.current.max, Math.max(o.current.min, z));
		const calm = () =>
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

		/** Set the zoom so the content at (fx, fy) lands on (tx, ty). */
		const apply = (z: number, fx: number, fy: number, tx = fx, ty = fy) => {
			const el = o.current.anchor?.(fx, fy) ?? body;
			const before = el.getBoundingClientRect();
			const u = before.width ? (fx - before.left) / before.width : 0;
			const v = before.height ? (fy - before.top) / before.height : 0;
			if (layer) {
				layer.style.transition = "";
				layer.style.transform = "";
				layer.style.transformOrigin = "";
				layer.style.willChange = "";
			}
			if (Math.abs(z - get()) > 0.0005) o.current.commit(z);
			if (!el.isConnected) return;
			const after = el.getBoundingClientRect();
			box.scrollLeft += after.left + u * after.width - tx;
			box.scrollTop += after.top + v * after.height - ty;
			o.current.onSettle?.();
		};

		let g: Gesture | null = null;
		let timer = 0;
		let hudTimer = 0;
		const flash = (z: number) => {
			const el = o.current.hud?.current;
			if (!el) return;
			el.textContent = o.current.label?.(z) ?? `${Math.round(z * 100)}%`;
			el.dataset.on = "";
			window.clearTimeout(hudTimer);
			hudTimer = window.setTimeout(() => delete el.dataset.on, 700);
		};

		const paint = () => {
			if (!g) return;
			g.raf = 0;
			flash(clamp(g.base * g.f));
			if (layer) {
				layer.style.transform = `translate(${g.x - g.sx}px, ${g.y - g.sy}px) scale(${g.f})`;
			} else {
				apply(clamp(g.base * g.f), g.px, g.py, g.x, g.y);
				g.px = g.x;
				g.py = g.y;
			}
		};
		const finish = () => {
			window.clearTimeout(timer);
			if (!g) return;
			cancelAnimationFrame(g.raf);
			const done = g;
			g = null;
			const z = clamp(done.base * (done.goal ?? done.f));
			flash(z);
			if (layer) apply(z, done.x, done.y);
			else apply(z, done.px, done.py, done.x, done.y);
			done.after?.();
		};
		const begin = (kind: GestureKind, x: number, y: number): Gesture => {
			finish();
			const next: Gesture = {
				kind,
				base: get(),
				f: 1,
				sx: x,
				sy: y,
				x,
				y,
				px: x,
				py: y,
				raf: 0,
			};
			g = next;
			if (layer) {
				const r = layer.getBoundingClientRect();
				layer.style.transformOrigin = `${x - r.left}px ${y - r.top}px`;
				layer.style.willChange = "transform";
			}
			return next;
		};
		const update = (factor: number, x: number, y: number) => {
			if (!g) return;
			g.f = clamp(g.base * factor) / g.base;
			g.x = x;
			g.y = y;
			if (!g.raf) g.raf = requestAnimationFrame(paint);
		};

		const zoomTo: ZoomApi["zoomTo"] = (zoom, origin, after) => {
			finish();
			const from = get();
			const to = clamp(zoom);
			if (Math.abs(to - from) < 0.0005) {
				after?.();
				return;
			}
			const r = box.getBoundingClientRect();
			const [x, y] = origin ?? [r.left + r.width / 2, r.top + r.height / 2];
			const glide = begin("glide", x, y);
			glide.goal = to / from;
			glide.after = after;
			if (calm()) {
				finish();
			} else if (layer) {
				glide.f = glide.goal;
				layer.style.transition = `transform ${ZOOM_MS}ms ${EASE}`;
				layer.getBoundingClientRect(); // start the transition from rest
				layer.style.transform = `scale(${glide.f})`;
				timer = window.setTimeout(finish, ZOOM_MS + 20);
			} else {
				const t0 = performance.now();
				const step = (now: number) => {
					if (g !== glide) return;
					const t = Math.min(1, Math.max(0, (now - t0) / ZOOM_MS));
					glide.f = (to / from) ** (1 - (1 - t) ** 3);
					glide.raf = 0;
					paint();
					if (t < 1) glide.raf = requestAnimationFrame(step);
					else finish();
				};
				glide.raf = requestAnimationFrame(step);
				// Frames can stall (a backgrounded window); still arrive.
				timer = window.setTimeout(finish, ZOOM_MS * 2);
			}
		};
		api.current = {
			zoomTo,
			zoomBy: (factor, origin) => zoomTo(get() * factor, origin),
		};

		// --- touch: pinch, tap, double tap ---
		const mid = (t: TouchList): [number, number] => [
			(t[0].clientX + t[1].clientX) / 2,
			(t[0].clientY + t[1].clientY) / 2,
		];
		const spread = (t: TouchList) =>
			Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
		let spread0 = 1;
		let tap: { x: number; y: number; t: number; moved: boolean } | null = null;
		let lastTap = 0;
		let tapTimer = 0;

		const onStart = (e: TouchEvent) => {
			if (e.touches.length === 2) {
				e.preventDefault();
				tap = null;
				window.clearTimeout(tapTimer);
				begin("pinch", ...mid(e.touches));
				spread0 = spread(e.touches) || 1;
			} else if (e.touches.length === 1) {
				tap = {
					x: e.touches[0].clientX,
					y: e.touches[0].clientY,
					t: e.timeStamp,
					moved: false,
				};
			}
		};
		const onMove = (e: TouchEvent) => {
			if (tap && e.touches.length === 1) {
				const dx = e.touches[0].clientX - tap.x;
				const dy = e.touches[0].clientY - tap.y;
				if (Math.hypot(dx, dy) > 10) tap.moved = true;
			}
			if (g?.kind !== "pinch" || e.touches.length !== 2) return;
			e.preventDefault();
			update(spread(e.touches) / spread0, ...mid(e.touches));
		};
		const onEnd = (e: TouchEvent) => {
			if (g?.kind === "pinch") {
				if (e.touches.length < 2) finish();
				return;
			}
			const done = tap;
			tap = null;
			if (
				!done ||
				done.moved ||
				e.touches.length > 0 ||
				e.timeStamp - done.t > 300
			)
				return;
			const target = e.target as HTMLElement;
			if (target.closest("a, button, input, .annotationLayer section")) return;
			const twice = o.current.doubleTap !== false;
			if (twice && e.timeStamp - lastTap < 300) {
				window.clearTimeout(tapTimer);
				lastTap = 0;
				if (o.current.onDoubleTap) o.current.onDoubleTap(done.x, done.y);
				else {
					const home = o.current.home ?? 1;
					const near = Math.abs(get() / home - 1) < 0.02;
					zoomTo(near ? home * 2.5 : home, [done.x, done.y]);
				}
				return;
			}
			lastTap = e.timeStamp;
			if (!o.current.onTap || window.getSelection()?.toString()) return;
			// Wait out a possible second tap before acting on the first.
			tapTimer = window.setTimeout(
				() => o.current.onTap?.(target),
				twice ? 280 : 0,
			);
		};

		// --- Ctrl+wheel, which is also how a trackpad pinch arrives ---
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			const wheel =
				g?.kind === "wheel" ? g : begin("wheel", e.clientX, e.clientY);
			if (layer) layer.style.transition = "transform 90ms ease-out";
			const delta = Math.max(-WHEEL_CAP, Math.min(WHEEL_CAP, e.deltaY));
			update(wheel.f * Math.exp(-delta * 0.01), wheel.x, wheel.y);
			window.clearTimeout(timer);
			timer = window.setTimeout(finish, 180);
		};

		box.addEventListener("touchstart", onStart, { passive: false });
		box.addEventListener("touchmove", onMove, { passive: false });
		box.addEventListener("touchend", onEnd);
		box.addEventListener("touchcancel", onEnd);
		box.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			finish();
			window.clearTimeout(tapTimer);
			window.clearTimeout(hudTimer);
			api.current = null;
			box.removeEventListener("touchstart", onStart);
			box.removeEventListener("touchmove", onMove);
			box.removeEventListener("touchend", onEnd);
			box.removeEventListener("touchcancel", onEnd);
			box.removeEventListener("wheel", onWheel);
		};
	}, [scroller, content, stage, enabled]);

	// --- Ctrl/Cmd with + - 0, as in every desktop reader ---
	useEffect(() => {
		if (!enabled || !active) return;
		const onKey = (e: KeyboardEvent) => {
			if ((!e.ctrlKey && !e.metaKey) || e.altKey) return;
			const z = api.current;
			if (!z) return;
			if (e.key === "=" || e.key === "+") z.zoomBy(1.25);
			else if (e.key === "-" || e.key === "_") z.zoomBy(1 / 1.25);
			else if (e.key === "0") {
				if (o.current.onReset) o.current.onReset();
				else z.zoomTo(o.current.home ?? 1);
			} else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled, active]);

	return useMemo<ZoomApi>(
		() => ({
			zoomTo: (...args) => api.current?.zoomTo(...args),
			zoomBy: (...args) => api.current?.zoomBy(...args),
		}),
		[],
	);
}

/**
 * A viewer's zoom level as React state, starting from the one saved
 * with the reading position. `commit` applies a zoom at once: `useZoom`
 * measures the page straight after calling it.
 */
export function useZoomLevel(
	position?: Position,
): [zoom: number, commit: (zoom: number) => void] {
	const [zoom, setZoom] = useState(1);
	useEffect(() => {
		if (position?.kind === "scroll" && position.zoom) setZoom(position.zoom);
	}, [position]);
	const commit = useCallback((z: number) => flushSync(() => setZoom(z)), []);
	return [zoom, commit];
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
