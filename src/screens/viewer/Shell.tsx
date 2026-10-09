import { backend } from "@/lib/backend";
import { isDesktop } from "@/lib/env";
import type { FileFormat } from "@/lib/formats";
import { t, uiDir } from "@/lib/i18n";
import { FIND_EVENT, SELECT_ALL_EVENT } from "@/lib/signals";
import { useSettings } from "@/state/settings";
import { IconButton, Sheet, SheetItem, formatColor, modalOpen } from "@/ui";
import {
	ArrowLeft,
	ChevronDown,
	ChevronUp,
	Minus,
	PanelLeft,
	Plus,
	X,
} from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
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

/** One list beside the document: its pages, its contents, its slides. */
export interface SideTab {
	id: string;
	label: string;
	content: ReactNode;
}

/** The panel beside the document on a desktop. It stays open while
 * reading, and only the tab on show is drawn. */
function SidePanel({
	tabs,
	onClose,
}: { tabs: SideTab[]; onClose: () => void }) {
	const [id, setId] = useState(tabs[0]?.id);
	const tab = tabs.find((x) => x.id === id) ?? tabs[0];
	if (!tab) return null;
	return (
		<aside className={s.side} dir={uiDir()} data-testid="side-panel">
			<div className={s.sideHead}>
				<div className={s.sideTabs} role="tablist">
					{tabs.map((x) => (
						<button
							type="button"
							role="tab"
							key={x.id}
							aria-selected={x.id === tab.id}
							className={s.sideTab}
							onClick={() => setId(x.id)}
							data-testid={`side-tab-${x.id}`}
						>
							{x.label}
						</button>
					))}
				</div>
				<IconButton label={t("Close side panel")} onClick={onClose}>
					<X size={16} />
				</IconButton>
			</div>
			<div className={s.sideBody} key={tab.id}>
				{tab.content}
			</div>
		</aside>
	);
}

export function Shell({
	name,
	format,
	onClose,
	actions,
	pager,
	bottom,
	find,
	onFind,
	menu,
	details,
	onPrint,
	hud,
	progressOf,
	chromeHidden = false,
	children,
	active,
	pageKeys = true,
	onStep,
	side,
}: {
	name: string;
	format: FileFormat;
	onClose: () => void;
	actions?: ReactNode;
	/** Where the reader is and how large: the page counter and the zoom
	 * control. A bar at the foot on a phone; part of the top bar on a
	 * desktop. */
	pager?: ReactNode;
	/** What always sits under the document (a workbook's sheet tabs). */
	bottom?: ReactNode;
	find?: ReactNode;
	/** Ctrl/Cmd+F opens the viewer's find bar, at a text when given one. */
	onFind?: (query?: string) => void;
	/** The viewer's own entries in the "more" menu. */
	menu?: (close: () => void) => ReactNode;
	/** What the viewer knows about the document, for Details. */
	details?: Array<[string, string]>;
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
	/** Left and Right turn a whole page, when the page fits the width. */
	onStep?: (dir: 1 | -1) => void;
	/** Lists for the panel beside the document (desktop). */
	side?: SideTab[];
}) {
	const { settings, update } = useSettings();

	// The window is named after the document, as in every desktop reader.
	useEffect(() => {
		if (!active) return;
		backend.setTitle(`${name} - Paperwren`);
		return () => backend.setTitle("Paperwren");
	}, [active, name]);

	// The button that opened the document (on Home, now underneath) lets
	// go of the keyboard, so the keys below reach the document.
	const shell = useRef<HTMLDivElement>(null);
	const main = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const held = document.activeElement;
		if (active && held instanceof HTMLElement && !shell.current?.contains(held))
			held.blur();
	}, [active]);

	// The keyboard scrolls the document from the moment it opens, without
	// a click into it first: Space, Page Up / Down, Home, End, the arrows.
	const stepRef = useRef(onStep);
	stepRef.current = onStep;
	useEffect(() => {
		if (!active) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || modalOpen() || e.altKey) return;
			// Only when nothing else wants the keys: a field does, and so does
			// the document once it has the keyboard (it scrolls on its own).
			// A button in the bars that was just clicked does not.
			const at = document.activeElement;
			const onBar =
				at instanceof HTMLElement &&
				!!at.closest("header, footer") &&
				!at.matches("input, textarea, select");
			if (at && at !== document.body && !onBar) return;
			const el = progressOf?.current ?? null;

			if (e.ctrlKey || e.metaKey) {
				// Ctrl+Home and Ctrl+End: the first and the last page. A Mac's
				// keyboard has neither key: there it is ⌘↑ and ⌘↓.
				const end =
					e.key === "End" || (e.metaKey && e.key === "ArrowDown")
						? true
						: e.key === "Home" || (e.metaKey && e.key === "ArrowUp")
							? false
							: null;
				if (!el || end === null || (e.ctrlKey && e.metaKey)) return;
				el.scrollTop = end ? el.scrollHeight : 0;
				e.preventDefault();
				return;
			}
			const turn = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
			if (turn && stepRef.current) {
				// Sideways keys pan a page wider than the screen instead.
				if (el && el.scrollWidth > el.clientWidth + 1) return;
				stepRef.current(turn);
				e.preventDefault();
				return;
			}
			if (!el) return;
			const page = el.clientHeight * 0.9;
			const by: Record<string, number> = {
				ArrowDown: 48,
				ArrowUp: -48,
				// Space presses the button that has the focus.
				...(onBar ? {} : { " ": e.shiftKey ? -page : page }),
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
	const finding = !!find;
	useEffect(() => {
		if (!active) return;
		const onKey = (e: KeyboardEvent) => {
			// ⌃⌘F is a Mac's full screen (App), not a ⌘F.
			if (modalOpen() || (e.ctrlKey && e.metaKey)) return;
			const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
			const key = e.key.toLowerCase();
			if (mod && key === "f") {
				if (!findRef.current) return;
				e.preventDefault();
				findRef.current();
			} else if (!finding && (e.key === "F3" || (mod && key === "g"))) {
				// "Find next" with no search yet opens one (the find bar takes
				// these keys itself once it is open).
				if (!findRef.current) return;
				e.preventDefault();
				findRef.current();
			} else if (isDesktop && mod && key === "a" && !e.defaultPrevented) {
				// Select the document, not the app around it.
				const at = document.activeElement;
				if (at instanceof HTMLElement && at.matches("input, textarea")) return;
				if (!main.current) return;
				e.preventDefault();
				window.getSelection()?.selectAllChildren(main.current);
			}
		};
		// The right-click menu on a selection asks for these two.
		const onAsk = (e: Event) => {
			const text = (e as CustomEvent<string>).detail;
			if (typeof text === "string") findRef.current?.(text);
		};
		const onSelectAll = () => {
			if (main.current) window.getSelection()?.selectAllChildren(main.current);
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener(FIND_EVENT, onAsk);
		window.addEventListener(SELECT_ALL_EVENT, onSelectAll);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener(FIND_EVENT, onAsk);
			window.removeEventListener(SELECT_ALL_EVENT, onSelectAll);
		};
	}, [active, finding]);

	const tabs = isDesktop ? (side ?? []) : [];
	const sideOpen = settings.sidePanel && tabs.length > 0;

	return (
		<div
			ref={shell}
			className={s.shell}
			data-testid="viewer"
			style={active ? undefined : { display: "none" }}
		>
			<header
				className={`${s.top} ${chromeHidden ? s.hiddenTop : ""} ${finding ? s.pinned : ""}`}
				{...inert(chromeHidden)}
			>
				{/* The bar is the window's title bar where the app draws its own
				 * frame: a press on it (not on a button) moves the window. */}
				<div className={s.row} data-tauri-drag-region="deep">
					<IconButton
						label={t("Back")}
						shortcut="Ctrl+W"
						onClick={onClose}
						data-testid="viewer-back"
					>
						<ArrowLeft size={isDesktop ? 20 : 22} className="pw-flip" />
					</IconButton>
					<Title name={name} format={format} />
					{isDesktop && pager && <div className={s.tools}>{pager}</div>}
					{tabs.length > 0 && (
						<IconButton
							label={sideOpen ? t("Hide side panel") : t("Show side panel")}
							active={sideOpen}
							onClick={() => update("sidePanel", !settings.sidePanel)}
							data-testid="side-toggle"
						>
							<PanelLeft size={18} className="pw-flip" />
						</IconButton>
					)}
					{actions}
					<FileMenu
						extra={menu}
						details={details}
						onPrint={onPrint}
						active={active}
					/>
				</div>
				{find}
				{progressOf && <Progress of={progressOf} />}
			</header>
			<div className={s.body}>
				{sideOpen && (
					<SidePanel tabs={tabs} onClose={() => update("sidePanel", false)} />
				)}
				<div ref={main} className={s.main} dir="ltr">
					{children}
					{hud && (
						<div ref={hud} className={s.hud} dir={uiDir()} aria-hidden="true" />
					)}
				</div>
			</div>
			{(bottom || (pager && !isDesktop)) && (
				<footer
					className={`${s.bottom} ${chromeHidden ? s.hiddenBottom : ""}`}
					{...inert(chromeHidden)}
				>
					{bottom}
					{pager && !isDesktop && <div className={s.pager}>{pager}</div>}
				</footer>
			)}
		</div>
	);
}

/** A zoom level offered by name in the zoom menu. */
export interface ZoomPreset {
	label: string;
	run: () => void;
	on?: boolean;
}

/** Percentages for a zoom menu. `scale` is the size on screen now,
 * `to` takes the size wanted (1 = 100%). */
export function percentPresets(
	levels: number[],
	scale: number,
	to: (scale: number) => void,
): ZoomPreset[] {
	return levels.map((level) => ({
		label: `${level}%`,
		run: () => to(level / 100),
		on: Math.abs(scale * 100 - level) < 0.5,
	}));
}

/** The one zoom control every viewer shares: out, the current level
 * (tap it to go back to the natural fit), in. On a desktop the level
 * opens a menu of sizes instead. */
export function ZoomControl({
	label,
	onOut,
	onIn,
	onReset,
	resetLabel = t("Reset zoom"),
	presets,
	testId,
}: {
	label: string;
	onOut: () => void;
	onIn: () => void;
	onReset: () => void;
	resetLabel?: string;
	presets?: ZoomPreset[];
	testId: string;
}) {
	const [open, setOpen] = useState(false);
	const menu = isDesktop && !!presets?.length;
	return (
		<div className={s.zoom}>
			<IconButton
				label={t("Zoom out")}
				shortcut="Ctrl+-"
				onClick={onOut}
				data-testid={`${testId}-zoom-out`}
			>
				<Minus size={18} />
			</IconButton>
			<button
				type="button"
				className={s.zoomValue}
				onClick={menu ? () => setOpen(true) : onReset}
				aria-label={`${label}. ${menu ? t("Zoom") : resetLabel}`}
				title={menu ? t("Zoom") : resetLabel}
				aria-haspopup={menu ? "menu" : undefined}
				data-testid={`${testId}-scale`}
			>
				{label}
			</button>
			<IconButton
				label={t("Zoom in")}
				shortcut="Ctrl++"
				onClick={onIn}
				data-testid={`${testId}-zoom-in`}
			>
				<Plus size={18} />
			</IconButton>
			{menu && (
				<Sheet
					open={open}
					title={t("Zoom")}
					onClose={() => setOpen(false)}
					testId={`${testId}-zoom-menu`}
				>
					{presets?.map((preset) => (
						<SheetItem
							key={preset.label}
							checked={preset.on}
							onClick={() => {
								setOpen(false);
								preset.run();
							}}
						>
							{preset.label}
						</SheetItem>
					))}
				</Sheet>
			)}
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
	options,
}: {
	state: FindState;
	onQuery: (q: string) => void;
	onStep: (dir: 1 | -1) => void;
	onClose: () => void;
	/** Further switches (match case, whole words). */
	options?: ReactNode;
}) {
	const input = useRef<HTMLInputElement>(null);
	useEffect(() => {
		input.current?.focus();
		input.current?.select();
	}, []);

	// While the bar is open its keys work from anywhere in the window:
	// Escape closes it, F3 and Ctrl+G step through the matches, Ctrl+F
	// goes back to the field.
	const stepRef = useRef(onStep);
	stepRef.current = onStep;
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (modalOpen() || e.defaultPrevented) return;
			if (e.ctrlKey && e.metaKey) return;
			const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
			const key = e.key.toLowerCase();
			if (e.key === "Escape") closeRef.current();
			else if (e.key === "F3" || (mod && key === "g"))
				stepRef.current(e.shiftKey ? -1 : 1);
			else if (mod && key === "f") {
				input.current?.focus();
				input.current?.select();
			} else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

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
				}}
				aria-label={t("Find in document")}
				data-testid="find-input"
			/>
			<span className={s.findCount} aria-live="polite" data-testid="find-count">
				{label}
			</span>
			{options}
			<IconButton
				label={t("Previous match")}
				shortcut="Shift+F3"
				disabled={!state.total}
				onClick={() => onStep(-1)}
			>
				<ChevronUp size={20} />
			</IconButton>
			<IconButton
				label={t("Next match")}
				shortcut="F3"
				disabled={!state.total}
				onClick={() => onStep(1)}
				data-testid="find-next"
			>
				<ChevronDown size={20} />
			</IconButton>
			<IconButton label={t("Close find")} shortcut="Esc" onClick={onClose}>
				<X size={20} />
			</IconButton>
		</div>
	);
}
