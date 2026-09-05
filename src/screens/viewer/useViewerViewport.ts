import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Shared viewport contract (docs/14 audit PDF-04): the scroll
 * container's paddings encode the real chrome insets (toolbar, bottom
 * bar, safe areas) through CSS variables, so measuring client size
 * minus effective paddings yields the area actually visible between
 * the bars. One convention for every viewer: CSS owns the inset
 * values, geometry math reads the measured result.
 */

export interface UsableViewport {
	width: number;
	height: number;
}

export function measureUsableViewport(el: HTMLElement): UsableViewport {
	const style = getComputedStyle(el);
	const padLeft = Number.parseFloat(style.paddingLeft) || 0;
	const padRight = Number.parseFloat(style.paddingRight) || 0;
	const padTop = Number.parseFloat(style.paddingTop) || 0;
	const padBottom = Number.parseFloat(style.paddingBottom) || 0;
	return {
		width: Math.max(0, el.clientWidth - padLeft - padRight),
		height: Math.max(0, el.clientHeight - padTop - padBottom),
	};
}

/** Observe the container and report its usable viewport. `onResize`
 * runs synchronously inside the resize callback BEFORE the reported
 * state updates, so callers can capture pre-relayout anchors (the
 * DOM still carries the old geometry at that moment). */
export function useViewerViewport(
	ref: RefObject<HTMLElement | null>,
	onResize?: (next: UsableViewport, previous: UsableViewport) => void,
): UsableViewport {
	const [viewport, setViewport] = useState<UsableViewport>({
		width: 0,
		height: 0,
	});
	const onResizeRef = useRef(onResize);
	onResizeRef.current = onResize;
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		let previous = measureUsableViewport(el);
		const update = () => {
			const next = measureUsableViewport(el);
			if (next.width === previous.width && next.height === previous.height) {
				return;
			}
			onResizeRef.current?.(next, previous);
			previous = next;
			setViewport(next);
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		window.addEventListener("resize", update);
		return () => {
			ro.disconnect();
			window.removeEventListener("resize", update);
		};
	}, [ref]);
	return viewport;
}
