import { isDesktop } from "@/lib/env";
import { locale, t } from "@/lib/i18n";
import { holdScreen } from "@/lib/wake";
import { useBackClose } from "@/state/navigation";
import { IconButton } from "@/ui";
import {
	ChevronLeft,
	ChevronRight,
	Crosshair,
	PanelsLeftRight,
	Pause,
	Play,
	RotateCcw,
	StickyNote,
	X,
} from "lucide-react";
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

/** "4:05", or "1:04:05" past the hour. */
export function clockOf(ms: number): string {
	const all = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(all / 3600);
	const m = Math.floor((all % 3600) / 60);
	const sec = String(all % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The time the show has run, which can be paused and started again. */
function useStopwatch() {
	const [, tick] = useState(0);
	const run = useRef({ since: Date.now(), banked: 0, paused: false });
	useEffect(() => {
		const id = window.setInterval(() => tick((n) => n + 1), 500);
		return () => window.clearInterval(id);
	}, []);
	const now = run.current;
	const elapsed = now.banked + (now.paused ? 0 : Date.now() - now.since);
	return {
		elapsed,
		paused: now.paused,
		toggle: () => {
			const r = run.current;
			if (r.paused) r.since = Date.now();
			else r.banked += Date.now() - r.since;
			r.paused = !r.paused;
			tick((n) => n + 1);
		},
		reset: () => {
			run.current = {
				since: Date.now(),
				banked: 0,
				paused: run.current.paused,
			};
			tick((n) => n + 1);
		},
	};
}

/** The stopwatch and the time of day, ticking on their own so the
 * slides are not drawn again every second. */
function PresenterTime() {
	const watch = useStopwatch();
	return (
		<div className={s.presenterTime}>
			<span className={s.presenterWatch} data-testid="presenter-watch">
				{clockOf(watch.elapsed)}
			</span>
			<IconButton
				label={watch.paused ? t("Start the timer") : t("Pause the timer")}
				onClick={watch.toggle}
				data-testid="presenter-pause"
			>
				{watch.paused ? <Play size={18} /> : <Pause size={18} />}
			</IconButton>
			<IconButton
				label={t("Reset the timer")}
				onClick={watch.reset}
				data-testid="presenter-reset"
			>
				<RotateCcw size={18} />
			</IconButton>
			<span className={s.presenterClock}>
				{new Date().toLocaleTimeString(locale(), {
					hour: "numeric",
					minute: "2-digit",
				})}
			</span>
		</div>
	);
}

/**
 * One slide at a time, as large as the screen allows, on black. Swipe
 * (or the arrow keys, or a tap on either side) moves through the deck;
 * a tap in the middle shows the controls; Escape or Back leaves. With
 * a mouse it behaves as a slide show does on a desk: a click or the
 * wheel goes on, a right click goes back.
 *
 * Presenter view (P) rehearses or gives the talk from one screen: the
 * slide, the next one, the speaker notes, a stopwatch and the time of
 * day. The laser pointer (L) turns the pointer, or a finger, into a red
 * dot to point with; while it is on, a click or a tap points instead of
 * turning the slide.
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
	const [presenter, setPresenter] = useState(false);
	const [laser, setLaser] = useState(false);
	const [dot, setDot] = useState<{ x: number; y: number } | null>(null);
	const [room, setRoom] = useState({
		w: window.innerWidth,
		h: window.innerHeight,
	});

	const root = useRef<HTMLDivElement>(null);
	const track = useRef<HTMLDivElement>(null);
	const indexRef = useRef(index);
	indexRef.current = index;

	const close = useCallback(() => onClose(indexRef.current), [onClose]);
	useBackClose("present", true, close);

	useLayoutEffect(() => {
		const fit = () => {
			setScale(
				Math.min(window.innerWidth / width, window.innerHeight / height),
			);
			setRoom({ w: window.innerWidth, h: window.innerHeight });
		};
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
	const bar = useRef<HTMLDivElement>(null);
	const wake = useCallback(() => {
		setControls(true);
		window.clearTimeout(hide.current);
		hide.current = window.setTimeout(() => {
			// A control the keyboard is on stays in sight.
			if (!bar.current?.contains(document.activeElement)) setControls(false);
		}, CONTROLS_MS);
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
			// Enter and Space press the show's own buttons; Tab brings them back.
			const control = (e.target as HTMLElement | null)?.closest?.(
				"button, a[href], input, select, textarea",
			);
			if (control && (e.key === " " || e.key === "Enter")) {
				wake();
				return;
			}
			if (e.key === "Tab") {
				wake();
				return;
			}
			if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key))
				step(1);
			else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key))
				step(-1);
			else if (e.key === "Home") setIndex(Math.max(0, beyond(-1, 1)));
			else if (e.key === "End") setIndex(Math.max(0, beyond(total, -1)));
			else if (e.key === "Escape") close();
			else if (e.key === "p" || e.key === "P") setPresenter((v) => !v);
			else if (e.key === "l" || e.key === "L") {
				setLaser((v) => !v);
				setDot(null);
			} else return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [step, beyond, close, total, wake]);

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
	const point = (e: React.PointerEvent) => {
		const box = track.current?.getBoundingClientRect();
		if (!box) return;
		setDot({ x: e.clientX - box.left, y: e.clientY - box.top });
	};
	const onDown = (e: React.PointerEvent) => {
		// The presenter's panel is for reading (and selecting) the notes.
		if ((e.target as HTMLElement).closest("button, aside")) return;
		if (laser) {
			point(e);
			return;
		}
		// The right button goes back (see onContextMenu), it does not drag.
		if (e.pointerType === "mouse" && e.button !== 0) return;
		drag.current = { x: e.clientX, y: e.clientY, dx: 0, moved: false };
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onMove = (e: React.PointerEvent) => {
		if (laser) {
			// A mouse points wherever it is; a finger while it is down.
			if (e.pointerType === "mouse" || e.buttons) point(e);
			return;
		}
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
		if (laser) {
			if (e.pointerType !== "mouse") setDot(null);
			return;
		}
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

	const note = noted || presenter ? notes?.(index) : undefined;
	const hasNotes = !!notes;
	const first = beyond(index, -1) < 0;
	const last = beyond(index, 1) < 0;
	const next = beyond(index, 1);
	// In presenter view the slide takes the left of the screen; the next
	// one, the time and the notes share the right.
	const wide = room.w >= room.h;
	const shown = presenter
		? Math.min(
				(room.w * (wide ? 0.62 : 1) - 32) / width,
				(room.h * (wide ? 1 : 0.5) - 120) / height,
			)
		: scale;
	const small = Math.min(
		(room.w * (wide ? 0.34 : 0.5) - 24) / width,
		(room.h * (wide ? 0.3 : 0.2)) / height,
	);

	return createPortal(
		<div
			ref={root}
			className={s.present}
			// biome-ignore lint/a11y/useSemanticElements: a full-screen surface, not a native dialog
			role="dialog"
			aria-modal="true"
			aria-label={t("Slide {n} of {total}", { n: index + 1, total })}
			tabIndex={-1}
			data-idle={controls && !laser ? undefined : ""}
			data-presenter={presenter ? "" : undefined}
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
					style={{ zoom: shown }}
					data-testid="present-slide"
				>
					{render(index)}
				</div>
				{laser && dot && (
					<span
						className={s.laser}
						style={{ left: dot.x, top: dot.y }}
						aria-hidden="true"
						data-testid="present-laser"
					/>
				)}
			</div>
			{presenter && (
				<aside className={s.presenter} data-testid="presenter">
					<PresenterTime />
					<p className={s.presenterLabel}>
						{next >= 0
							? t("Next: slide {n}", { n: next + 1 })
							: t("End of the show")}
					</p>
					{next >= 0 && (
						<div
							className={s.presenterNext}
							style={{ width: width * small, height: height * small }}
							data-testid="presenter-next"
						>
							<div style={{ zoom: small }}>{render(next)}</div>
						</div>
					)}
					<div
						className={s.presenterNotes}
						dir="auto"
						data-testid="presenter-notes"
					>
						{note || t("No notes for this slide")}
					</div>
				</aside>
			)}
			{noted && !presenter && (
				<div className={s.presentNotes} dir="auto" data-testid="present-notes">
					{note || t("No notes for this slide")}
				</div>
			)}
			<div
				ref={bar}
				className={s.presentBar}
				data-on={controls ? "" : undefined}
				onFocus={wake}
			>
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
				<IconButton
					label={t("Laser pointer")}
					shortcut="L"
					active={laser}
					className={laser ? s.presentOn : undefined}
					onClick={() => {
						setLaser((v) => !v);
						setDot(null);
					}}
					data-testid="present-laser-toggle"
				>
					<Crosshair size={20} />
				</IconButton>
				<IconButton
					label={t("Presenter view")}
					shortcut="P"
					active={presenter}
					className={presenter ? s.presentOn : undefined}
					onClick={() => setPresenter((v) => !v)}
					data-testid="present-presenter"
				>
					<PanelsLeftRight size={20} />
				</IconButton>
				{hasNotes && !presenter && (
					<IconButton
						label={noted ? t("Hide speaker notes") : t("Show speaker notes")}
						active={noted}
						className={noted ? s.presentOn : undefined}
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
