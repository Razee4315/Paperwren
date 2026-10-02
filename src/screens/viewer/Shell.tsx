import { backend } from "@/lib/backend";
import type { FileFormat } from "@/lib/formats";
import { t, uiDir } from "@/lib/i18n";
import { IconButton, formatColor } from "@/ui";
import {
	ArrowLeft,
	ChevronDown,
	ChevronUp,
	Minus,
	Plus,
	X,
} from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { FileMenu } from "./FileMenu";
import s from "./Shell.module.css";

export { s as shellStyles };

/** React 18 has no typed `inert` prop; an empty attribute enables it. */
const inert = (on: boolean) => (on ? ({ inert: "" } as object) : {});

/** Split so the extension stays visible when the name is truncated. */
function Title({ name, format }: { name: string; format: FileFormat }) {
	const dot = name.lastIndexOf(".");
	const hasExt = dot > 0 && name.length - dot <= 6;
	return (
		<span className={s.title} title={name}>
			<span
				className={s.dot}
				style={{ background: formatColor(format) }}
				aria-hidden="true"
			/>
			<span className={s.name} dir="auto">
				<span className={s.stem}>{hasExt ? name.slice(0, dot) : name}</span>
				{hasExt && <span className={s.ext}>{name.slice(dot)}</span>}
			</span>
		</span>
	);
}

/** How far through the document the reader is: a hairline under the
 * top bar, driven straight from scroll events (no re-renders). */
function Progress({ of }: { of: RefObject<HTMLElement | null> }) {
	const bar = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = of.current;
		if (!el) return;
		const update = () => {
			const range = el.scrollHeight - el.clientHeight;
			const ratio = range > 1 ? Math.min(1, el.scrollTop / range) : 0;
			if (bar.current) bar.current.style.transform = `scaleX(${ratio})`;
		};
		update();
		el.addEventListener("scroll", update, { passive: true });
		return () => el.removeEventListener("scroll", update);
	}, [of]);
	return <div ref={bar} className={s.progress} aria-hidden="true" />;
}

export function Shell({
	name,
	format,
	onClose,
	actions,
	bottom,
	find,
	onFind,
	menu,
	onPrint,
	hud,
	progressOf,
	chromeHidden = false,
	children,
	active,
	pageKeys = true,
}: {
	name: string;
	format: FileFormat;
	onClose: () => void;
	actions?: ReactNode;
	bottom?: ReactNode;
	find?: ReactNode;
	/** Ctrl/Cmd+F opens the viewer's find bar. */
	onFind?: () => void;
	/** The viewer's own entries in the "more" menu. */
	menu?: (close: () => void) => ReactNode;
	/** Lay the document out for paper; enables Print. */
	onPrint?: (root: HTMLElement) => Promise<void> | void;
	/** Where `useZoom` writes the level during a gesture. */
	hud?: RefObject<HTMLDivElement>;
	/** The scroller whose reading progress the top bar shows. */
	progressOf?: RefObject<HTMLElement | null>;
	chromeHidden?: boolean;
	children: ReactNode;
	active: boolean;
	/** False when the viewer turns pages itself with Page Up / Down. */
	pageKeys?: boolean;
}) {
	// The window is named after the document, as in every desktop reader.
	useEffect(() => {
		if (!active) return;
		backend.setTitle(`${name} - Paperwren`);
		return () => backend.setTitle("Paperwren");
	}, [active, name]);

	// The button that opened the document (on Home, now underneath) lets
	// go of the keyboard, so the keys below reach the document.
	const shell = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const held = document.activeElement;
		if (active && held instanceof HTMLElement && !shell.current?.contains(held))
			held.blur();
	}, [active]);

	// The keyboard scrolls the document from the moment it opens, without
	// a click into it first: Space, Page Up / Down, Home, End, the arrows.
	useEffect(() => {
		if (!active || !progressOf) return;
		const onKey = (e: KeyboardEvent) => {
			const el = progressOf.current;
			// Only when nothing else has the keyboard (a field, a dialog,
			// the document itself, which scrolls on its own).
			if (!el || document.activeElement !== document.body) return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const page = el.clientHeight * 0.9;
			const by: Record<string, number> = {
				ArrowDown: 48,
				ArrowUp: -48,
				" ": e.shiftKey ? -page : page,
				...(pageKeys ? { PageDown: page, PageUp: -page } : {}),
			};
			if (e.key === "Home") el.scrollTop = 0;
			else if (e.key === "End") el.scrollTop = el.scrollHeight;
			else if (e.key in by) el.scrollTop += by[e.key];
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, progressOf, pageKeys]);

	const findRef = useRef(onFind);
	findRef.current = onFind;
	useEffect(() => {
		if (!active) return;
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
				if (!findRef.current) return;
				e.preventDefault();
				findRef.current();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active]);

	return (
		<div
			ref={shell}
			className={s.shell}
			data-testid="viewer"
			style={active ? undefined : { display: "none" }}
		>
			<header
				className={`${s.top} ${chromeHidden ? s.hiddenTop : ""}`}
				{...inert(chromeHidden)}
			>
				<div className={s.row}>
					<IconButton
						label={t("Back")}
						onClick={onClose}
						data-testid="viewer-back"
					>
						<ArrowLeft size={22} className="pw-flip" />
					</IconButton>
					<Title name={name} format={format} />
					{actions}
					<FileMenu extra={menu} onPrint={onPrint} active={active} />
				</div>
				{find}
				{progressOf && <Progress of={progressOf} />}
			</header>
			<div className={s.body} dir="ltr">
				{children}
				{hud && (
					<div ref={hud} className={s.hud} dir={uiDir()} aria-hidden="true" />
				)}
			</div>
			{bottom && (
				<footer
					className={`${s.bottom} ${chromeHidden ? s.hiddenBottom : ""}`}
					{...inert(chromeHidden)}
				>
					{bottom}
				</footer>
			)}
		</div>
	);
}

/** The one zoom control every viewer shares: out, the current level
 * (tap it to go back to the natural fit), in. */
export function ZoomControl({
	label,
	onOut,
	onIn,
	onReset,
	resetLabel = t("Reset zoom"),
	testId,
}: {
	label: string;
	onOut: () => void;
	onIn: () => void;
	onReset: () => void;
	resetLabel?: string;
	testId: string;
}) {
	return (
		<div className={s.zoom}>
			<IconButton
				label={t("Zoom out")}
				onClick={onOut}
				data-testid={`${testId}-zoom-out`}
			>
				<Minus size={18} />
			</IconButton>
			<button
				type="button"
				className={s.zoomValue}
				onClick={onReset}
				aria-label={`${label}. ${resetLabel}`}
				title={resetLabel}
				data-testid={`${testId}-scale`}
			>
				{label}
			</button>
			<IconButton
				label={t("Zoom in")}
				onClick={onIn}
				data-testid={`${testId}-zoom-in`}
			>
				<Plus size={18} />
			</IconButton>
		</div>
	);
}

export interface FindState {
	query: string;
	total: number;
	current: number; // 0-based, -1 when none
	busy?: boolean;
}

export function FindBar({
	state,
	onQuery,
	onStep,
	onClose,
}: {
	state: FindState;
	onQuery: (q: string) => void;
	onStep: (dir: 1 | -1) => void;
	onClose: () => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => input.current?.focus(), []);
	const label = state.busy
		? "…"
		: state.query
			? state.total
				? t("{n} of {total}", { n: state.current + 1, total: state.total })
				: t("No results")
			: "";
	return (
		// biome-ignore lint/a11y/useSemanticElements: <search> is not yet in the React DOM typings
		<div className={s.find} role="search">
			<input
				ref={input}
				type="search"
				placeholder={t("Find in document")}
				value={state.query}
				onChange={(e) => onQuery(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") onStep(e.shiftKey ? -1 : 1);
					if (e.key === "Escape") onClose();
				}}
				aria-label={t("Find in document")}
				data-testid="find-input"
			/>
			<span className={s.findCount} aria-live="polite" data-testid="find-count">
				{label}
			</span>
			<IconButton
				label={t("Previous match")}
				disabled={!state.total}
				onClick={() => onStep(-1)}
			>
				<ChevronUp size={20} />
			</IconButton>
			<IconButton
				label={t("Next match")}
				disabled={!state.total}
				onClick={() => onStep(1)}
				data-testid="find-next"
			>
				<ChevronDown size={20} />
			</IconButton>
			<IconButton label={t("Close find")} onClick={onClose}>
				<X size={20} />
			</IconButton>
		</div>
	);
}
