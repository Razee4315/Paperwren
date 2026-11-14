import { backend } from "@/lib/backend";
import type { Bookmark as Mark } from "@/lib/bookmarks";
import { isDesktop } from "@/lib/env";
import type { FindOptions } from "@/lib/find";
import type { FileFormat } from "@/lib/formats";
import { inFullscreen, toggleFullscreen } from "@/lib/fullscreen";
import { msg, t, uiDir } from "@/lib/i18n";
import { idForReopen } from "@/lib/recents";
import { screenStop } from "@/lib/screenStep";
import { MAX_DIM, PAGE_COLORS, resolvePageColor } from "@/lib/settings";
import { hintFor, matches } from "@/lib/shortcuts";
import { FIND_EVENT, SELECT_ALL_EVENT } from "@/lib/signals";
import { canSpeak } from "@/lib/speech";
import type { PageColor, Position } from "@/lib/types";
import { useBookmarks } from "@/state/bookmarks";
import { useBackClose } from "@/state/navigation";
import { useSettings } from "@/state/settings";
import {
	IconButton,
	Sheet,
	SheetDivider,
	SheetItem,
	formatColor,
	modalOpen,
	toast,
} from "@/ui";
import {
	ArrowLeft,
	Bookmark,
	BookmarkPlus,
	ChevronDown,
	ChevronUp,
	ListChecks,
	Maximize,
	Minimize,
	Minus,
	PanelLeft,
	Plus,
	ScrollText,
	SunDim,
	SwatchBook,
	Volume2,
	X,
} from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { ShortcutList } from "../settings/ShortcutList";
import { FileMenu, ViewerFileContext } from "./FileMenu";
import { ReadAloud } from "./ReadAloud";
import { AutoScroll, DimSheet } from "./ReadingControls";
import s from "./Shell.module.css";
import { PaneContext, onShow } from "./pane";
import type { SpeechSource } from "./speechSources";

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

/** Pages laid in a row (data-flow="across") are read sideways. */
const across = (el: HTMLElement) => el.dataset.flow === "across";

/** How far through the document the reader is: a hairline under the
 * top bar, driven straight from scroll events (no re-renders), or from
 * `value` where scrolling does not say it (one page shown at a time). */
function Progress({
	of,
	value,
}: { of: RefObject<HTMLElement | null>; value?: number }) {
	const bar = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (value === undefined || !bar.current) return;
		bar.current.style.transform = `scaleX(${Math.min(1, Math.max(0, value))})`;
	}, [value]);
	const given = value !== undefined;
	useEffect(() => {
		const el = of.current;
		if (!el || given) return;
		const update = () => {
			const sideways = across(el);
			const range = sideways
				? el.scrollWidth - el.clientWidth
				: el.scrollHeight - el.clientHeight;
			const at = sideways ? Math.abs(el.scrollLeft) : el.scrollTop;
			const ratio = range > 1 ? Math.min(1, at / range) : 0;
			if (bar.current) bar.current.style.transform = `scaleX(${ratio})`;
		};
		update();
		el.addEventListener("scroll", update, { passive: true });
		return () => el.removeEventListener("scroll", update);
	}, [of, given]);
	return <div ref={bar} className={s.progress} aria-hidden="true" />;
}

export const PAGE_COLOR_NAMES: Record<PageColor, string> = {
	original: msg("Original"),
	sepia: msg("Sepia"),
	dark: msg("Dark"),
	theme: msg("Match the theme"),
};

/** The paper the reader chose, as drawn: "original", "sepia" or "dark". */
export function usePageColor() {
	const { settings, theme } = useSettings();
	return resolvePageColor(settings.pageColor, theme);
}

/** The choice of paper, from a viewer's menu. It is the same setting
 * as in Settings: a reader who wants dark pages wants them in every
 * document. */
function PageColorSheet({
	open,
	onClose,
}: { open: boolean; onClose: () => void }) {
	const { settings, update } = useSettings();
	return (
		<Sheet
			open={open}
			title={t("Page colour")}
			onClose={onClose}
			testId="page-color-menu"
		>
			{PAGE_COLORS.map((value) => (
				<SheetItem
					key={value}
					checked={settings.pageColor === value}
					onClick={() => {
						update("pageColor", value);
						onClose();
					}}
					testId={`page-color-${value}`}
				>
					{t(PAGE_COLOR_NAMES[value])}
				</SheetItem>
			))}
		</Sheet>
	);
}

/** To the start or the end of a document, down or along its row. */
function toEnd(el: HTMLElement, end: boolean) {
	if (across(el)) el.scrollLeft = end ? el.scrollWidth : 0;
	else el.scrollTop = end ? el.scrollHeight : 0;
}

/** Where a viewer's reader is, and how to take them back there. */
export interface BookmarkSource {
	/** The place on show now, named ("Page 12", or the words there). */
	here: () => { label: string; position: Position } | null;
	go: (position: Position) => void;
}

function BookmarkList({
	list,
	onPick,
	onRemove,
	compact = false,
}: {
	list: Mark[];
	onPick: (mark: Mark) => void;
	onRemove: (mark: Mark) => void;
	compact?: boolean;
}) {
	if (!list.length)
		return (
			<p className={s.sideEmpty}>
				{isDesktop
					? t("No bookmarks yet. Add one from the menu, or with Ctrl+D.")
					: t("No bookmarks yet. Add one from the menu.")}
			</p>
		);
	return (
		<>
			{list.map((mark) => (
				<div key={mark.id} className={s.mark} data-testid="bookmark">
					<button
						type="button"
						className={compact ? s.sideItem : s.listItem}
						onClick={() => onPick(mark)}
						title={compact ? mark.label : undefined}
						dir="auto"
					>
						{mark.label}
					</button>
					<IconButton
						label={t("Remove bookmark")}
						onClick={() => onRemove(mark)}
						data-testid="bookmark-remove"
					>
						<X size={compact ? 14 : 18} />
					</IconButton>
				</div>
			))}
		</>
	);
}

/** One list beside the document: its pages, its contents, its slides. */
export interface SideTab {
	id: string;
	label: string;
	/** Shown in place of the label when more tabs than two share the
	 * panel's narrow head. */
	icon?: ReactNode;
	content: ReactNode;
}

/** The panel beside the document on a desktop. It stays open while
 * reading, and only the tab on show is drawn. */
function SidePanel({
	tabs,
	focus,
	onClose,
}: {
	tabs: SideTab[];
	/** A tab asked for: each new `at` brings it forward. */
	focus?: { id: string; at: number };
	onClose: () => void;
}) {
	const [id, setId] = useState(focus?.id ?? tabs[0]?.id);
	useEffect(() => {
		if (focus) setId(focus.id);
	}, [focus]);
	const tab = tabs.find((x) => x.id === id) ?? tabs[0];
	if (!tab) return null;
	const icons = tabs.length > 2 && tabs.every((x) => x.icon);
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
							className={`${s.sideTab} ${icons ? s.sideIcon : ""}`}
							onClick={() => setId(x.id)}
							title={icons ? x.label : undefined}
							aria-label={icons ? x.label : undefined}
							data-testid={`side-tab-${x.id}`}
						>
							{icons ? x.icon : x.label}
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

/** Full screen on or off, saying how to leave it as it starts. */
function fullscreen() {
	if (!inFullscreen()) toast(t("Press Esc to leave full screen"));
	toggleFullscreen();
}

/** Whether the reader is in full screen (<html data-fullscreen="page">,
 * which lib/fullscreen.ts keeps in step), as a value a render reads. */
function onFullscreenChange(then: () => void) {
	const watch = new MutationObserver(then);
	watch.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-fullscreen"],
	});
	return () => watch.disconnect();
}
const readingFullscreen = () =>
	document.documentElement.dataset.fullscreen === "page";

/** A phone's full screen (⋮, Full screen): the app's bars go and so do
 * the system's, and a tap on the page brings the app's back until the
 * next tap. It lasts the session, so the next document opens in it
 * too, but not past a restart. */
let phoneFull = false;
const phoneFullWatchers = new Set<() => void>();
function setPhoneFull(on: boolean) {
	if (phoneFull === on) return;
	phoneFull = on;
	for (const then of phoneFullWatchers) then();
}
function onPhoneFullChange(then: () => void) {
	phoneFullWatchers.add(then);
	return () => {
		phoneFullWatchers.delete(then);
	};
}
/** Whether a phone's full screen is on (a slide show that ends leaves
 * the system's bars as this says). */
export const inPhoneFull = () => phoneFull;

/** The system's bars over a phone's screen hidden, or shown again. A
 * browser has no shell to ask: there only the app's bars go. */
function systemBars(hidden: boolean) {
	try {
		window.__paperwrenAndroidExtras?.immersive?.(hidden, false);
	} catch {
		// An older shell: the app's bars still go.
	}
}

/** A window too narrow for full screen's button in the bar: it is in
 * the menu instead. */
const NARROW = "(max-width: 720px)";
function onNarrowChange(then: () => void) {
	const query = window.matchMedia?.(NARROW);
	query?.addEventListener("change", then);
	return () => query?.removeEventListener("change", then);
}
const narrowWindow = () => !!window.matchMedia?.(NARROW).matches;

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
	chromeHidden: chromeHiddenGiven,
	children,
	active,
	pageKeys = true,
	onStep,
	turnPages = false,
	onEdge,
	pageTops,
	progress,
	side,
	sideFocus,
	paper = false,
	bookmarks,
	speech,
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
	/** The viewer's own show and hide of the bars, turned over by a tap
	 * on the page. A viewer without it has no phone full screen: nothing
	 * would bring its bars back. */
	chromeHidden?: boolean;
	children: ReactNode;
	active: boolean;
	/** False when the viewer turns pages itself with Page Up / Down. */
	pageKeys?: boolean;
	/** Left and Right turn a whole page, when the page fits the width.
	 * `fromFoot`: show the page turned to from its foot (Page Up at the
	 * top of a page shown on its own). */
	onStep?: (dir: 1 | -1, fromFoot?: boolean) => void;
	/** Space, Page Up and Page Down turn a page too (`onStep`), for
	 * pages laid in a row. */
	turnPages?: boolean;
	/** Home and End (and Ctrl with them) go to the first or the last
	 * page this way, where scrolling does not reach them. */
	onEdge?: (end: boolean) => void;
	/** Where each page begins, in the scroller's positions, in order:
	 * Space and Page Up / Down stop there (`screenStop`). */
	pageTops?: () => readonly number[];
	/** How far through the document the reader is (0 to 1), where the
	 * scroll does not tell (pages shown one at a time). */
	progress?: number;
	/** Lists for the panel beside the document (desktop). */
	side?: SideTab[];
	/** Open the panel at one of its lists. */
	sideFocus?: { id: string; at: number };
	/** The document is read on paper whose colour the reader picks. */
	paper?: boolean;
	/** Places in the document can be bookmarked and gone back to. */
	bookmarks?: BookmarkSource;
	/** The document's text, to be read aloud from the place on show. */
	speech?: SpeechSource;
}) {
	const { settings, update } = useSettings();
	const chromeHidden = chromeHiddenGiven ?? false;
	const [colorOpen, setColorOpen] = useState(false);
	const [keysOpen, setKeysOpen] = useState(false);
	const full = useSyncExternalStore(onFullscreenChange, readingFullscreen);
	const pane = useContext(PaneContext);
	const narrow =
		useSyncExternalStore(onNarrowChange, narrowWindow) || !!pane?.narrow;
	useEffect(() => {
		if (sideFocus) update("sidePanel", true);
	}, [sideFocus, update]);
	// F for full screen and ? for the list of keys, on a keyboard (or
	// whatever keys the reader gave them).
	useEffect(() => {
		if (!active || !isDesktop) return;
		const onKey = (e: KeyboardEvent) => {
			if (modalOpen() || e.defaultPrevented) return;
			if (matches(e, "keys")) setKeysOpen(true);
			else if (matches(e, "fullscreen")) fullscreen();
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active]);
	const paperColor = usePageColor();
	const pageColor = paper ? paperColor : undefined;

	// --- bookmarks ---
	const viewing = useContext(ViewerFileContext);
	const fileId =
		bookmarks && viewing && viewing.file.reopen.kind !== "memory"
			? idForReopen(viewing.file.reopen)
			: null;
	const marks = useBookmarks(fileId);
	const [marksOpen, setMarksOpen] = useState(false);
	const sourceRef = useRef(bookmarks);
	sourceRef.current = bookmarks;
	const addMark = () => {
		const place = sourceRef.current?.here();
		if (!place || !fileId) return;
		const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
		marks.add({ id, ...place, at: Date.now() });
		toast(t("Bookmark added"), {
			label: t("Undo"),
			run: () => marks.remove(id),
		});
	};
	const addRef = useRef(addMark);
	addRef.current = addMark;
	const goMark = (mark: Mark) => {
		setMarksOpen(false);
		sourceRef.current?.go(mark.position);
	};
	// Ctrl+D, as a browser bookmarks a page.
	useEffect(() => {
		if (!active || !fileId) return;
		const onKey = (e: KeyboardEvent) => {
			if (modalOpen() || !matches(e, "bookmark")) return;
			e.preventDefault();
			addRef.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, fileId]);

	// --- read aloud ---
	const [voiced, setVoiced] = useState(() => canSpeak());
	useEffect(() => {
		// The list of voices can arrive a moment after the page.
		if (!voiced) canSpeak(() => setVoiced(canSpeak()));
	}, [voiced]);
	const [reading, setReading] = useState(false);
	const canRead = !!speech && voiced;
	useEffect(() => {
		if (!active || !canRead) return;
		// Ctrl+Shift+U, as in Edge.
		const onKey = (e: KeyboardEvent) => {
			if (modalOpen() || !matches(e, "readAloud")) return;
			e.preventDefault();
			setReading((r) => !r);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, canRead]);

	// --- reading on a phone: dimmer, scrolling by itself, the volume
	// keys, the bars out of the way ---
	const [dimOpen, setDimOpen] = useState(false);
	const [scrolling, setScrolling] = useState(false);
	const canScroll = !!progressOf && !turnPages;
	useEffect(() => {
		if (!active || !canScroll) setScrolling(false);
	}, [active, canScroll]);
	const turnPage = useRef<(dir: 1 | -1) => void>(() => {});
	turnPage.current = (dir) => {
		if (stepRef.current) stepRef.current(dir);
		else {
			const el = progressOf?.current;
			if (el) el.scrollTop += dir * el.clientHeight * 0.9;
		}
	};
	useEffect(() => {
		const bridge = window.__paperwrenAndroidExtras;
		if (!active || !settings.volumeKeys || !bridge?.volumeKeys) return;
		bridge.volumeKeys(true);
		window.__paperwrenVolumeKey = (dir) => {
			if (!modalOpen()) turnPage.current(dir < 0 ? -1 : 1);
		};
		return () => {
			bridge.volumeKeys?.(false);
			window.__paperwrenVolumeKey = undefined;
		};
	}, [active, settings.volumeKeys]);
	// What the bars do while reading (Settings, "Bars while reading"):
	// stay; go as the reader scrolls on and come back as they scroll
	// back or tap; or go as they scroll on and come back only for a tap.
	// A computer keeps them.
	const barMode = isDesktop ? "always" : settings.readingBars;
	// Only where a tap can bring the bars back: a spreadsheet opened in
	// a session in full screen keeps its bars.
	const canFull = !isDesktop && chromeHiddenGiven !== undefined;
	const immersed =
		useSyncExternalStore(onPhoneFullChange, inPhoneFull) && canFull;
	// The viewer's tap turns its own switch over: a tap while the bars
	// went by themselves must bring them back, so then the switch reads
	// the other way round.
	const [autoHidden, setAutoHidden] = useState(false);
	const [tapShows, setTapShows] = useState(false);
	const autoHiddenRef = useRef(autoHidden);
	autoHiddenRef.current = autoHidden;
	const chromeHiddenRef = useRef(chromeHidden);
	chromeHiddenRef.current = chromeHidden;
	useEffect(() => {
		if (!autoHiddenRef.current) return;
		setTapShows(chromeHidden);
		setAutoHidden(false);
	}, [chromeHidden]);
	useEffect(() => {
		const el = progressOf?.current;
		if (barMode === "always" || immersed || !el || !active) return;
		const comeBack = barMode === "scroll";
		let last = el.scrollTop;
		const onScroll = () => {
			const y = el.scrollTop;
			if (y - last > 24) {
				setAutoHidden(true);
				last = y;
			} else if (last - y > 48) {
				// Shown only on a tap: scrolling back leaves them gone.
				if (comeBack) setAutoHidden(false);
				last = y;
			} else if (y < last) last = Math.max(y, last - 48);
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [progressOf, barMode, immersed, active]);
	// In full screen the bars are gone until a tap turns the viewer's
	// switch over, and back after the next: they show while it reads the
	// other way from where it was on the way in. On the way out they show.
	const [fullFrom, setFullFrom] = useState(chromeHidden);
	const wasImmersed = useRef(immersed);
	useLayoutEffect(() => {
		if (wasImmersed.current === immersed) return;
		wasImmersed.current = immersed;
		if (immersed) setFullFrom(chromeHiddenRef.current);
		else {
			setTapShows(chromeHiddenRef.current);
			setAutoHidden(false);
		}
	}, [immersed]);
	const fullHere = immersed && active;
	useEffect(() => {
		if (!fullHere) return;
		systemBars(true);
		// Leaving the document, or another screen over it, gives the
		// system its bars back; coming back to it takes them again.
		return () => systemBars(false);
	}, [fullHere]);
	// Back leaves full screen before it closes the document.
	useBackClose("phone-fullscreen", fullHere, () => setPhoneFull(false));
	const togglePhoneFull = () => {
		if (!phoneFull) toast(t("Tap the page to show the bars"));
		setPhoneFull(!phoneFull);
	};
	// Bars that go while reading float over the document and slide away,
	// so the document keeps its size and nothing is laid out again as
	// they move (#82). Its scroller keeps room for them, as padding of
	// --bars-top and --bars-bottom, so the first and the last lines are
	// not under them while they show. Bars that are always shown stay
	// in the layout as they were: a tap that hides them gives the
	// document their room.
	const floating =
		!isDesktop && canScroll && (barMode !== "always" || immersed);
	const topBar = useRef<HTMLElement>(null);
	const footBar = useRef<HTMLElement>(null);
	const footed = !!(bottom || (pager && !isDesktop));
	// biome-ignore lint/correctness/useExhaustiveDependencies: watched again when the bottom bar comes or goes
	useLayoutEffect(() => {
		const root = shell.current;
		if (!root || !floating) return;
		const room = () => {
			// offsetHeight is the bar's size wherever its transform has it.
			root.style.setProperty(
				"--bars-top",
				`${topBar.current?.offsetHeight ?? 0}px`,
			);
			// A phone held sideways has the bottom bar as a rail beside the
			// document, in a column of its own: nothing to keep clear of at
			// the foot (Shell.module.css, --rail).
			const rail =
				getComputedStyle(root).getPropertyValue("--rail").trim() === "1";
			root.style.setProperty(
				"--bars-bottom",
				`${rail ? 0 : (footBar.current?.offsetHeight ?? 0)}px`,
			);
		};
		room();
		// The find bar opens inside the top one and makes it taller.
		const watch =
			typeof ResizeObserver === "function" ? new ResizeObserver(room) : null;
		for (const bar of [topBar.current, footBar.current])
			if (bar) watch?.observe(bar);
		return () => {
			watch?.disconnect();
			root.style.removeProperty("--bars-top");
			root.style.removeProperty("--bars-bottom");
		};
	}, [floating, footed]);

	const fileMenu = (close: () => void) => (
		<>
			{menu && (
				<>
					{menu(close)}
					<SheetDivider />
				</>
			)}
			{canScroll && (
				<SheetItem
					icon={<ScrollText size={20} />}
					checked={scrolling}
					onClick={() => {
						close();
						setScrolling((on) => !on);
					}}
					testId="auto-scroll-start"
				>
					{t("Scroll by itself")}
				</SheetItem>
			)}
			<SheetItem
				icon={<SunDim size={20} />}
				hint={
					settings.dim > 0
						? t("{n}% darker", {
								n: Math.round((settings.dim / MAX_DIM) * 100),
							})
						: undefined
				}
				onClick={() => {
					close();
					setDimOpen(true);
				}}
				testId="dim"
			>
				{t("Dim the screen")}
			</SheetItem>
			{canRead && (
				<SheetItem
					icon={<Volume2 size={20} />}
					shortcut={hintFor("readAloud")}
					checked={reading}
					onClick={() => {
						close();
						setReading((r) => !r);
					}}
					testId="read-aloud-start"
				>
					{t("Read aloud")}
				</SheetItem>
			)}
			{fileId && (
				<SheetItem
					icon={<Bookmark size={20} />}
					hint={marks.list.length ? String(marks.list.length) : undefined}
					onClick={() => {
						close();
						setMarksOpen(true);
					}}
					testId="bookmarks"
					extra={
						<IconButton
							label={t("Add bookmark")}
							shortcut={hintFor("bookmark")}
							onClick={() => {
								close();
								addMark();
							}}
							data-testid="bookmark-add"
						>
							<BookmarkPlus size={18} />
						</IconButton>
					}
				>
					{t("Bookmarks")}
				</SheetItem>
			)}
			{paper && (
				<SheetItem
					icon={<SwatchBook size={20} />}
					hint={t(PAGE_COLOR_NAMES[settings.pageColor])}
					onClick={() => {
						close();
						setColorOpen(true);
					}}
					testId="page-color"
				>
					{t("Page colour")}
				</SheetItem>
			)}
		</>
	);

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

	// G goes to a page: the page number in the bar takes the keyboard,
	// to type one and press Enter.
	useEffect(() => {
		if (!active || !isDesktop) return;
		const onKey = (e: KeyboardEvent) => {
			if (modalOpen() || e.defaultPrevented || !matches(e, "goToPage")) return;
			const field =
				shell.current?.querySelector<HTMLInputElement>("[data-page-field]");
			if (!field) return;
			e.preventDefault();
			field.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active]);

	// The keyboard scrolls the document from the moment it opens, without
	// a click into it first: Space, Page Up / Down, Home, End, the arrows.
	const stepRef = useRef(onStep);
	stepRef.current = onStep;
	const turnRef = useRef(turnPages);
	turnRef.current = turnPages;
	const edgeRef = useRef(onEdge);
	edgeRef.current = onEdge;
	const stopsRef = useRef(pageTops);
	stopsRef.current = pageTops;
	useEffect(() => {
		if (!active) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || modalOpen()) return;
			// The next or the previous page, by whatever keys the reader gave
			// them (an arrow, or a Mac's ⌘] that a trackpad swipe sends).
			const step = matches(e, "nextPage") ? 1 : matches(e, "prevPage") ? -1 : 0;
			if (e.altKey && !step) return;
			// Only when nothing else wants the keys: a field does. A button in
			// the bars that was just clicked does not.
			const at = document.activeElement;
			const onBar =
				at instanceof HTMLElement &&
				!!at.closest("header, footer") &&
				!at.matches("input, textarea, select");
			const el = progressOf?.current ?? null;
			// A click on the page leaves the keyboard on it (pdf.js's text
			// layer takes the focus): the keys still turn and scroll, unless
			// a field, a button or a link in the page has them.
			const inPage =
				at instanceof HTMLElement &&
				!!el?.contains(at) &&
				!at.closest(
					'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])',
				);
			if (at && at !== document.body && !onBar && !inPage) return;

			if (step && !e.key.startsWith("Arrow") && stepRef.current) {
				stepRef.current(step);
				e.preventDefault();
				return;
			}
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
				if (edgeRef.current) edgeRef.current(end);
				else toEnd(el, end);
				e.preventDefault();
				return;
			}
			const turn =
				step !== 0
					? step
					: turnRef.current && e.key === "PageDown"
						? 1
						: turnRef.current && e.key === "PageUp"
							? -1
							: turnRef.current && e.key === " " && !onBar
								? e.shiftKey
									? -1
									: 1
								: 0;
			if (turn && stepRef.current) {
				const arrow = e.key.startsWith("Arrow");
				// Sideways keys pan a page wider than the screen instead
				// (pages in a row turn whatever their size).
				const pans = el && !across(el) && el.scrollWidth > el.clientWidth + 1;
				if (pans && arrow) return;
				// A page shown on its own but taller than the screen (zoomed
				// in) is read to its foot before the next is turned to, and
				// the previous one is shown from its foot.
				if (!arrow && el && el.scrollHeight > el.clientHeight + 8) {
					const room =
						turn > 0
							? el.scrollHeight - el.clientHeight - el.scrollTop
							: el.scrollTop;
					if (room > 1) {
						el.scrollTop += turn * Math.min(room, el.clientHeight * 0.9);
						e.preventDefault();
						return;
					}
					stepRef.current(turn, turn < 0);
				} else stepRef.current(turn);
				e.preventDefault();
				return;
			}
			if (!el) return;
			// Space, Page Up and Page Down: a screen on, stopping at the top
			// of the next page where the viewer says where pages begin.
			const screen =
				e.key === "PageDown"
					? 1
					: e.key === "PageUp"
						? -1
						: e.key === " "
							? e.shiftKey
								? -1
								: 1
							: 0;
			const keyed = screen !== 0 && (e.key === " " ? !onBar : pageKeys);
			if (keyed) {
				const tops = stopsRef.current?.() ?? [];
				el.scrollTop = screenStop(
					el.scrollTop,
					el.clientHeight,
					screen as 1 | -1,
					tops,
				);
			} else if (e.key === "ArrowDown") el.scrollTop += 48;
			else if (e.key === "ArrowUp") el.scrollTop -= 48;
			else if (e.key === "Home" || e.key === "End") {
				const end = e.key === "End";
				if (edgeRef.current) edgeRef.current(end);
				else toEnd(el, end);
			} else return;
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
			if (matches(e, "find")) {
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

	const barsHidden =
		!finding &&
		(immersed
			? chromeHidden === fullFrom
			: chromeHidden !== tapShows || autoHidden);
	const tabs = isDesktop
		? [
				...(side ?? []),
				...(fileId
					? [
							{
								id: "bookmarks",
								label: t("Bookmarks"),
								icon: <Bookmark size={16} />,
								content: (
									<BookmarkList
										list={marks.list}
										onPick={goMark}
										onRemove={(mark) => marks.remove(mark.id)}
										compact
									/>
								),
							},
						]
					: []),
			]
		: [];
	const sideOpen = settings.sidePanel && tabs.length > 0;

	return (
		<div
			ref={shell}
			className={s.shell}
			data-testid="viewer"
			data-floating={floating ? "" : undefined}
			data-immersed={immersed ? "" : undefined}
			// A tab not on show keeps its size, its place and its drawn
			// pages: hidden, not taken out of the layout, so showing it
			// again redraws nothing and replays no entrance (#84). Side by
			// side, the half without the keyboard is still shown.
			data-away={onShow(active, pane) ? undefined : ""}
			{...inert(!onShow(active, pane))}
		>
			<header
				ref={topBar}
				className={`${s.top} ${barsHidden ? s.hiddenTop : ""} ${finding ? s.pinned : ""}`}
				{...inert(barsHidden)}
			>
				{/* The bar is the window's title bar where the app draws its own
				 * frame: a press on it (not on a button) moves the window. */}
				<div className={s.row} data-tauri-drag-region="deep">
					<IconButton
						label={t("Back")}
						shortcut={hintFor("close")}
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
					{isDesktop && !narrow && (
						<IconButton
							label={full ? t("Leave full screen") : t("Full screen")}
							shortcut={hintFor("fullscreen")}
							active={full}
							onClick={fullscreen}
							data-testid="viewer-fullscreen"
						>
							{full ? <Minimize size={18} /> : <Maximize size={18} />}
						</IconButton>
					)}
					<FileMenu
						extra={fileMenu}
						details={details}
						onPrint={onPrint}
						active={active}
						fullscreen={
							isDesktop
								? narrow
									? { on: full, toggle: fullscreen }
									: undefined
								: canFull
									? { on: immersed, toggle: togglePhoneFull }
									: undefined
						}
					/>
				</div>
				{find}
				{progressOf && <Progress of={progressOf} value={progress} />}
			</header>
			<div className={s.body}>
				{sideOpen && (
					<SidePanel
						tabs={tabs}
						focus={sideFocus}
						onClose={() => update("sidePanel", false)}
					/>
				)}
				<div
					ref={main}
					className={s.main}
					dir="ltr"
					data-page-color={pageColor}
				>
					{children}
					{settings.dim > 0 && (
						<div
							className={s.dim}
							style={{ opacity: settings.dim }}
							aria-hidden="true"
							data-testid="dim-layer"
						/>
					)}
					{scrolling && progressOf && (
						<AutoScroll of={progressOf} onClose={() => setScrolling(false)} />
					)}
					{reading && speech && (
						<ReadAloud
							source={speech}
							active={active}
							onClose={() => setReading(false)}
						/>
					)}
					{hud && (
						<div ref={hud} className={s.hud} dir={uiDir()} aria-hidden="true" />
					)}
				</div>
			</div>
			{paper && (
				<PageColorSheet open={colorOpen} onClose={() => setColorOpen(false)} />
			)}
			<Sheet
				open={keysOpen}
				title={t("Keyboard shortcuts")}
				onClose={() => setKeysOpen(false)}
				wide
				testId="keys-sheet"
			>
				<ShortcutList />
			</Sheet>
			<DimSheet open={dimOpen} onClose={() => setDimOpen(false)} />
			{fileId && (
				<Sheet
					open={marksOpen}
					title={t("Bookmarks")}
					onClose={() => setMarksOpen(false)}
					wide
					testId="bookmark-list"
				>
					<BookmarkList
						list={marks.list}
						onPick={goMark}
						onRemove={(mark) => marks.remove(mark.id)}
					/>
				</Sheet>
			)}
			{footed && (
				<footer
					ref={footBar}
					className={`${s.bottom} ${barsHidden ? s.hiddenBottom : ""}`}
					{...inert(barsHidden)}
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
	// The two longest labels: letters are not all as wide, so the longer
	// of two is very nearly always the widest.
	const sizes = [
		...new Set([label, "888%", ...(presets ?? []).map((p) => p.label)]),
	]
		.sort((a, b) => b.length - a.length)
		.concat("");
	return (
		<div className={s.zoom}>
			<IconButton
				label={t("Zoom out")}
				shortcut={hintFor("zoomOut")}
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
				// As wide as the longest things it can say (drawn unseen by the
				// stylesheet), so the bar does not shift when "Whole page"
				// becomes "137%" under a zoom.
				data-size={sizes[0]}
				data-size2={sizes[1]}
			>
				<span className={s.zoomNow}>{label}</span>
			</button>
			<IconButton
				label={t("Zoom in")}
				shortcut={hintFor("zoomIn")}
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
	onOptions,
	onList,
}: {
	state: FindState;
	onQuery: (q: string) => void;
	onStep: (dir: 1 | -1) => void;
	onClose: () => void;
	/** Match case, whole words: offered when they can be changed. */
	options?: FindOptions;
	onOptions?: (options: FindOptions) => void;
	/** Show every result together. */
	onList?: () => void;
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
			else if (matches(e, "find")) {
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
		<div
			className={s.find}
			// biome-ignore lint/a11y/useSemanticElements: <search> is not yet in the React DOM typings
			role="search"
			data-empty={state.query ? undefined : ""}
		>
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
			{onList && state.total > 0 && !state.busy ? (
				<button
					type="button"
					className={s.findCount}
					aria-live="polite"
					aria-label={`${label}. ${t("All results")}`}
					onClick={onList}
					data-testid="find-count"
				>
					{label}
				</button>
			) : (
				<span
					className={s.findCount}
					aria-live="polite"
					data-testid="find-count"
				>
					{label}
				</span>
			)}
			{options && onOptions && (
				<>
					<button
						type="button"
						className={s.findOption}
						aria-pressed={options.matchCase}
						title={t("Match case")}
						aria-label={t("Match case")}
						onClick={() =>
							onOptions({ ...options, matchCase: !options.matchCase })
						}
						data-testid="find-case"
					>
						Aa
					</button>
					<button
						type="button"
						className={s.findOption}
						aria-pressed={options.wholeWords}
						title={t("Whole words")}
						aria-label={t("Whole words")}
						onClick={() =>
							onOptions({ ...options, wholeWords: !options.wholeWords })
						}
						data-testid="find-words"
					>
						“ab”
					</button>
				</>
			)}
			{onList && (
				<IconButton
					label={t("All results")}
					className={`${s.findStep} ${s.findAll}`}
					disabled={!state.total}
					onClick={onList}
					data-testid="find-list"
				>
					<ListChecks size={18} />
				</IconButton>
			)}
			<IconButton
				label={t("Previous match")}
				className={s.findStep}
				shortcut="Shift+F3"
				disabled={!state.total}
				onClick={() => onStep(-1)}
			>
				<ChevronUp size={20} />
			</IconButton>
			<IconButton
				label={t("Next match")}
				className={s.findStep}
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
