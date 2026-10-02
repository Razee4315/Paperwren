import { t } from "@/lib/i18n";
import { useBackClose } from "@/state/navigation";
import { IconButton } from "@/ui";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import s from "./Slides.module.css";

/** How long the controls stay after the last touch or mouse move. */
const CONTROLS_MS = 2600;

/**
 * One slide at a time, as large as the screen allows, on black. Swipe
 * (or the arrow keys, or a tap on either side) moves through the deck;
 * a tap in the middle shows the controls; Escape or Back leaves.
 */
export function Present({
	width,
	height,
	total,
	start,
	render,
	onClose,
}: {
	/** Slide size in CSS px. */
	width: number;
	height: number;
	total: number;
	start: number;
	render: (index: number) => ReactNode;
	/** Called with the slide that was showing. */
	onClose: (index: number) => void;
}) {
	const [index, setIndex] = useState(start);
	const [from, setFrom] = useState<1 | -1 | 0>(0);
	const [scale, setScale] = useState(1);
	const [controls, setControls] = useState(true);
	const root = useRef<HTMLDivElement>(null);
	const track = useRef<HTMLDivElement>(null);
	const indexRef = useRef(index);
	indexRef.current = index;

	const close = useCallback(() => onClose(indexRef.current), [onClose]);
	useBackClose("present", true, close);

	useLayoutEffect(() => {
		const fit = () =>
			setScale(
				Math.min(window.innerWidth / width, window.innerHeight / height),
			);
		fit();
		window.addEventListener("resize", fit);
		return () => window.removeEventListener("resize", fit);
	}, [width, height]);

	// The real full screen where the platform has one; the overlay
	// already covers the app where it does not.
	useEffect(() => {
		const el = root.current;
		el?.focus();
		el?.requestFullscreen?.().catch(() => {});
		return () => {
			if (document.fullscreenElement)
				document.exitFullscreen?.().catch(() => {});
		};
	}, []);

	const hide = useRef(0);
	const wake = useCallback(() => {
		setControls(true);
		window.clearTimeout(hide.current);
		hide.current = window.setTimeout(() => setControls(false), CONTROLS_MS);
	}, []);
	useEffect(() => {
		wake();
		return () => window.clearTimeout(hide.current);
	}, [wake]);

	const step = useCallback(
		(dir: 1 | -1) => {
			const next = indexRef.current + dir;
			if (next < 0 || next >= total) return false;
			setFrom(dir);
			setIndex(next);
			return true;
		},
		[total],
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key))
				step(1);
			else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key))
				step(-1);
			else if (e.key === "Home") setIndex(0);
			else if (e.key === "End") setIndex(total - 1);
			else if (e.key === "Escape") close();
			else return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [step, close, total]);

	// --- swipe: the slide follows the finger, then settles ---
	const drag = useRef<{
		x: number;
		y: number;
		dx: number;
		moved: boolean;
	} | null>(null);
	const shift = (dx: number, animate: boolean) => {
		const el = track.current;
		if (!el) return;
		el.style.transition = animate ? "transform 180ms ease-out" : "";
		el.style.transform = dx ? `translateX(${dx}px)` : "";
	};
	const onDown = (e: React.PointerEvent) => {
		if ((e.target as HTMLElement).closest("button")) return;
		drag.current = { x: e.clientX, y: e.clientY, dx: 0, moved: false };
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onMove = (e: React.PointerEvent) => {
		if (e.pointerType === "mouse") wake();
		const d = drag.current;
		if (!d) return;
		const dx = e.clientX - d.x;
		if (!d.moved && Math.hypot(dx, e.clientY - d.y) < 8) return;
		d.moved = true;
		// Nothing lies past the first and last slide: resist there.
		const edge =
			(dx > 0 && indexRef.current === 0) ||
			(dx < 0 && indexRef.current === total - 1);
		d.dx = edge ? dx * 0.25 : dx;
		shift(d.dx, false);
	};
	const onUp = (e: React.PointerEvent) => {
		const d = drag.current;
		drag.current = null;
		if (!d) return;
		if (!d.moved) {
			// A tap: the sides turn the page, the middle shows the controls.
			const at = e.clientX / window.innerWidth;
			if (at < 0.25) step(-1);
			else if (at > 0.75) step(1);
			else if (controls) setControls(false);
			else wake();
			return;
		}
		const far = Math.abs(d.dx) > Math.min(90, window.innerWidth * 0.18);
		if (far && step(d.dx < 0 ? 1 : -1)) shift(0, false);
		else shift(0, true);
	};

	return createPortal(
		<div
			ref={root}
			className={s.present}
			// biome-ignore lint/a11y/useSemanticElements: a full-screen surface, not a native dialog
			role="dialog"
			aria-modal="true"
			aria-label={t("Slide {n} of {total}", { n: index + 1, total })}
			tabIndex={-1}
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={() => {
				drag.current = null;
				shift(0, true);
			}}
			data-testid="present"
		>
			<div ref={track} className={s.presentTrack} dir="ltr">
				<div
					key={index}
					className={s.presentSlide}
					data-from={from || undefined}
					style={{ zoom: scale }}
					data-testid="present-slide"
				>
					{render(index)}
				</div>
			</div>
			<div className={s.presentBar} data-on={controls ? "" : undefined}>
				<IconButton
					label={t("Previous slide")}
					disabled={index === 0}
					onClick={() => step(-1)}
				>
					<ChevronLeft size={22} className="pw-flip" />
				</IconButton>
				<span className={s.presentCount} data-testid="present-counter">
					{index + 1} / {total}
				</span>
				<IconButton
					label={t("Next slide")}
					disabled={index >= total - 1}
					onClick={() => step(1)}
				>
					<ChevronRight size={22} className="pw-flip" />
				</IconButton>
				<IconButton
					label={t("Leave full screen")}
					onClick={close}
					data-testid="present-close"
				>
					<X size={22} />
				</IconButton>
			</div>
		</div>,
		document.body,
	);
}
