import { isDesktop } from "@/lib/env";
import { t } from "@/lib/i18n";
import { holdScreen } from "@/lib/wake";
import { useBackClose } from "@/state/navigation";
import { IconButton } from "@/ui";
import { ChevronLeft, ChevronRight, StickyNote, X } from "lucide-react";
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
/** One notch of a mouse wheel turns one slide; a spin does not race
 * through the deck. */
const WHEEL_MS = 260;

/**
 * One slide at a time, as large as the screen allows, on black. Swipe
 * (or the arrow keys, or a tap on either side) moves through the deck;
 * a tap in the middle shows the controls; Escape or Back leaves. With
 * a mouse it behaves as a slide show does on a desk: a click or the
 * wheel goes on, a right click goes back.
 */
export function Present({
	width,
	height,
	total,
	start,
	render,
	skip,
	notes,
	onClose,
}: {
	/** Slide size in CSS px. */
	width: number;
	height: number;
	total: number;
	start: number;
	render: (index: number) => ReactNode;
	/** Slides the show passes over (the author hid them). */
	skip?: (index: number) => boolean;
	/** A slide's speaker notes, if it has any. */
	notes?: (index: number) => string | undefined;
	/** Called with the slide that was showing. */
	onClose: (index: number) => void;
}) {
	const [index, setIndex] = useState(start);
	const [from, setFrom] = useState<1 | -1 | 0>(0);
	const [scale, setScale] = useState(1);
	const [controls, setControls] = useState(true);
	const [noted, setNoted] = useState(false);
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

	// The real full screen. On Android the webview turns a page's request
	// for it down, so the shell is asked instead: it hides the status and
	// navigation bars and turns the screen to suit the slides. Elsewhere
	// the page's own full screen is used (on Windows the shell follows
	// it); where there is none, the overlay already covers the app.
	const closeRef = useRef(close);
	closeRef.current = close;
	useEffect(() => {
		const el = root.current;
		el?.focus();
		const shell = window.__paperwrenAndroidExtras;
		if (typeof shell?.immersive === "function") {
			try {
				shell.immersive(true, width > height);
			} catch {
				// An older shell: the overlay still covers the app.
			}
			return () => {
				try {
					shell.immersive?.(false, false);
				} catch {
					// Nothing to undo.
				}
			};
		}
		let entered = false;
		// Leaving full screen (Escape, taken by the webview itself) ends
		// the show. Desktop only: a webview that refuses full screen
		// reports leaving it at once, which would end the show as it opens.
		const onChange = () => {
			if (document.fullscreenElement === el) entered = true;
			else if (entered) closeRef.current();
		};
		if (isDesktop) document.addEventListener("fullscreenchange", onChange);
		el?.requestFullscreen?.().catch(() => {});
		return () => {
			document.removeEventListener("fullscreenchange", onChange);
			if (document.fullscreenElement === el)
				document.exitFullscreen?.().catch(() => {});
		};
	}, [width, height]);

	// A slide show is watched, not touched: the screen stays on for it
	// whatever the reading setting says.
	useEffect(() => holdScreen(), []);

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

	const skipRef = useRef(skip);
	skipRef.current = skip;
	/** The next slide in a direction that the show does not pass over. */
	const beyond = useCallback(
		(at: number, dir: 1 | -1) => {
			let next = at + dir;
			while (next >= 0 && next < total && skipRef.current?.(next)) next += dir;
			return next >= 0 && next < total ? next : -1;
		},
		[total],
	);
	const step = useCallback(
		(dir: 1 | -1) => {
			const next = beyond(indexRef.current, dir);
			if (next < 0) return false;
			setFrom(dir);
			setIndex(next);
			return true;
		},
		[beyond],
	);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key))
				step(1);
			else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key))
				step(-1);
			else if (e.key === "Home") setIndex(Math.max(0, beyond(-1, 1)));
			else if (e.key === "End") setIndex(Math.max(0, beyond(total, -1)));
			else if (e.key === "Escape") close();
			else return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [step, beyond, close, total]);

	// The wheel turns slides, a notch at a time.
	const wheeled = useRef(0);
	const onWheel = (e: React.WheelEvent) => {
		if (e.ctrlKey || Math.abs(e.deltaY) < 4) return;
		if (e.timeStamp - wheeled.current < WHEEL_MS) return;
		wheeled.current = e.timeStamp;
		step(e.deltaY > 0 ? 1 : -1);
	};

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
		// The right button goes back (see onContextMenu), it does not drag.
		if (e.pointerType === "mouse" && e.button !== 0) return;
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
			(dx > 0 && beyond(indexRef.current, -1) < 0) ||
			(dx < 0 && beyond(indexRef.current, 1) < 0);
		d.dx = edge ? dx * 0.25 : dx;
		shift(d.dx, false);
	};
	const onUp = (e: React.PointerEvent) => {
		const d = drag.current;
		drag.current = null;
		if (!d) return;
		if (!d.moved) {
			if (isDesktop && e.pointerType === "mouse") {
				// A click goes on, as in any slide show.
				step(1);
				return;
			}
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

	const note = noted ? notes?.(index) : undefined;
	const hasNotes = !!notes;
	const first = beyond(index, -1) < 0;
	const last = beyond(index, 1) < 0;

	return createPortal(
		<div
			ref={root}
			className={s.present}
			// biome-ignore lint/a11y/useSemanticElements: a full-screen surface, not a native dialog
			role="dialog"
			aria-modal="true"
			aria-label={t("Slide {n} of {total}", { n: index + 1, total })}
			tabIndex={-1}
			data-idle={controls ? undefined : ""}
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={() => {
				drag.current = null;
				shift(0, true);
			}}
			onWheel={onWheel}
			onContextMenu={(e) => {
				e.preventDefault();
				if (isDesktop) step(-1);
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
			{noted && (
				<div className={s.presentNotes} dir="auto" data-testid="present-notes">
					{note || t("No notes for this slide")}
				</div>
			)}
			<div className={s.presentBar} data-on={controls ? "" : undefined}>
				<IconButton
					label={t("Previous slide")}
					disabled={first}
					onClick={() => step(-1)}
				>
					<ChevronLeft size={22} className="pw-flip" />
				</IconButton>
				<span className={s.presentCount} data-testid="present-counter">
					{index + 1} / {total}
				</span>
				<IconButton
					label={t("Next slide")}
					disabled={last}
					onClick={() => step(1)}
				>
					<ChevronRight size={22} className="pw-flip" />
				</IconButton>
				{hasNotes && (
					<IconButton
						label={noted ? t("Hide speaker notes") : t("Show speaker notes")}
						active={noted}
						onClick={() => setNoted((v) => !v)}
						data-testid="present-notes-toggle"
					>
						<StickyNote size={20} />
					</IconButton>
				)}
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
