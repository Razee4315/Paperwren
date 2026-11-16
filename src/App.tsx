import {
	backend,
	requestForManagedCopy,
	retainMemoryFiles,
} from "@/lib/backend";
import { isDesktop, isMac, isTauri, sharesFrame } from "@/lib/env";
import { toggleFullscreen, watchFullscreen } from "@/lib/fullscreen";
import { language, subscribe, t } from "@/lib/i18n";
import { isFullscreenKey } from "@/lib/keys";
import { backToCaller } from "@/lib/navigation";
import { holdOpen, onSaveRefused } from "@/lib/openFiles";
import { matches } from "@/lib/shortcuts";
import { FIND_EVENT, SELECT_ALL_EVENT } from "@/lib/signals";
import type { OpenRequest, RecentEntry } from "@/lib/types";
import { type Tab, TabStrip, moveTab } from "@/screens/TabStrip";
import { UpdateHost } from "@/screens/Updates";
import { Home } from "@/screens/home/Home";
import { SettingsScreen } from "@/screens/settings/Settings";
import type { ToolId } from "@/screens/tools/ToolsScreen";
import { SplitDivider } from "@/screens/viewer/SplitDivider";
import {
	type Pane,
	SPLIT_ROOM,
	type SideBySide,
	SideBySideContext,
	clampRatio,
} from "@/screens/viewer/pane";
import { NavigationProvider, useNav } from "@/state/navigation";
import { RecentsProvider, useRecents } from "@/state/recents";
import { SettingsProvider, useSettings } from "@/state/settings";
import {
	DropHint,
	LinkGuard,
	OpeningView,
	ScreenLoading,
	Sheet,
	SheetItem,
	ToastHost,
	WindowControls,
	modalOpen,
	toast,
} from "@/ui";
import { Copy, Search, TextSelect } from "lucide-react";
import {
	type ComponentProps,
	Suspense,
	lazy,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

// The viewer engines (pdf.js, docx-preview, the grid) are the bulk of
// the code; Home must not pay for them at cold start.
const ViewerScreen = lazy(() => import("@/screens/viewer/ViewerScreen"));
const loadTools = () => import("@/screens/tools/ToolsScreen");
const loadNotes = () => import("@/screens/notes/NotesScreen");
const ToolsScreen = lazy(() =>
	loadTools().then((m) => ({ default: m.ToolsScreen })),
);
const NotesScreen = lazy(() =>
	loadNotes().then((m) => ({ default: m.NotesScreen })),
);
// Shown once; never part of a regular launch's bundle.
const Onboarding = lazy(() => import("@/screens/onboarding/Onboarding"));

/** The reader and pdf.js, fetched and compiled once Home has settled,
 * so the first document opens without waiting for them (most are PDFs).
 * Never at cold start: Home is drawn first, then the browser is idle. */
const WARM_AFTER = 1500;
function warmReader() {
	void import("@/screens/viewer/ViewerScreen").catch(() => {});
	// The PDF reader is a chunk of its own, behind the screen above.
	void import("@/screens/viewer/PdfView").catch(() => {});
	void import("@/lib/pdfEngine").then((m) => m.loadEngine()).catch(() => {});
	// Then Tools and Notes, at the next quiet moment: each is opened
	// from Home, and should come up as quickly as the reader does.
	idle(() => {
		void loadTools().catch(() => {});
		void loadNotes().catch(() => {});
	});
}
const idle = (run: () => void) =>
	window.requestIdleCallback
		? window.requestIdleCallback(run, { timeout: 4000 })
		: window.setTimeout(run, 1);

const ONBOARDED_KEY = "onboarded";
/** Tabs kept drawn besides the one on show, so a switch back is
 * instant; older ones are read again when shown. */
const KEPT_TABS = 4;
const MB = 1024 * 1024;
/** And no more than about this much memory between them. */
const KEPT_BYTES = 200 * MB;
/** What a tab kept drawn is reckoned to hold: a viewer and its engine
 * (about 24 MB measured for a small PDF), and its file about twice
 * over (the bytes, and what the engine reads from them). A PDF behind
 * another lets go of its drawn pages, so they are not counted. */
const tabBytes = (tab: Tab) => 24 * MB + 2 * (tab.request.size || 0);
/** The tabs kept drawn, the latest shown first, until there are
 * KEPT_TABS of them or they would hold more than KEPT_BYTES: a few
 * large documents are not all held at once. The latest is always
 * kept. One left out opens again where it was left when shown. */
function keptTabs(tabs: Tab[], used: number[]): Set<number> {
	const kept = new Set<number>();
	let bytes = 0;
	for (let i = used.length - 1; i >= 0 && kept.size < KEPT_TABS; i--) {
		const tab = tabs.find((one) => one.key === used[i]);
		if (!tab) continue;
		bytes += tabBytes(tab);
		if (kept.size && bytes > KEPT_BYTES) break;
		kept.add(tab.key);
	}
	return kept;
}

interface Split {
	left: number;
	right: number;
	ratio: number;
}

function onRoomChange(then: () => void) {
	const query = window.matchMedia?.(SPLIT_ROOM);
	query?.addEventListener("change", then);
	return () => query?.removeEventListener("change", then);
}
const roomForTwo = () => !!window.matchMedia?.(SPLIT_ROOM).matches;
function onResize(then: () => void) {
	window.addEventListener("resize", then);
	return () => window.removeEventListener("resize", then);
}
/** A half narrower than this has no room for every button in its bar. */
const NARROW_HALF = 720;
/** What two documents side by side take from the window's width: where
 * the halves meet, and whether each is narrow. Read as one string, so a
 * resize that changes neither does not draw the window again (the raw
 * width would, at every step of a drag). */
function splitShape(ratio: number | null) {
	return () => {
		if (ratio === null) return "";
		const width = window.innerWidth;
		const at = clampRatio(ratio, width);
		const narrow = (share: number) => (width * share < NARROW_HALF ? "1" : "0");
		return `${at} ${narrow(at)}${narrow(1 - at)}`;
	};
}

/** What a document's screen asks of the window. The same functions at
 * every render, so the document is not drawn again for them. */
interface DocCalls {
	close: (key: number) => void;
	replace: (key: number, request: OpenRequest) => void;
	open: (request: OpenRequest) => void;
	tools: (tool: string | undefined, file: OpenRequest) => void;
	locate: (key: number, id: string) => void;
	focus: (key: number) => void;
}

/**
 * One document, drawn again only when what it is given changes, not at
 * every render of Root (a menu opening in another tab, a step of a
 * resize). The language and the keys are given too: what the document
 * shows of them is read while it is drawn, so a change of either must
 * still reach it.
 */
const DocView = memo(function DocView({
	docKey,
	request,
	active,
	tabbed,
	visible,
	side,
	ratio,
	narrow,
	calls,
}: {
	docKey: number;
	request: OpenRequest;
	active: boolean;
	/** A desktop's tab, in a wrapper that can fill half the window. */
	tabbed: boolean;
	visible: boolean;
	side: Pane["side"];
	ratio: number;
	narrow: boolean;
	calls: DocCalls;
	lang: string;
	keys: unknown;
}) {
	const onClose = useCallback(() => calls.close(docKey), [calls, docKey]);
	const onReplace = useCallback(
		(next: OpenRequest) => calls.replace(docKey, next),
		[calls, docKey],
	);
	const onLocate = useCallback(
		() => calls.locate(docKey, request.id),
		[calls, docKey, request.id],
	);
	const pane = useMemo<Pane | undefined>(
		() =>
			tabbed
				? { visible, side, ratio, narrow, onFocus: () => calls.focus(docKey) }
				: undefined,
		[tabbed, visible, side, ratio, narrow, calls, docKey],
	);
	return (
		<ViewerScreen
			request={request}
			active={active}
			pane={pane}
			onClose={onClose}
			onReplace={onReplace}
			onOpen={calls.open}
			onTools={calls.tools}
			onLocate={onLocate}
		/>
	);
});

/** Home, drawn again only when what it is given changes (see DocView). */
const KeptHome = memo(function KeptHome({
	lang: _lang,
	keys: _keys,
	...props
}: ComponentProps<typeof Home> & { lang: string; keys: unknown }) {
	return <Home {...props} />;
});

declare global {
	interface Window {
		__paperwrenFiles?: Array<{
			path: string;
			name: string;
			size: number;
			/** Another app opened it with Paperwren, which that start
			 * "started" or "woken" (index.html). */
			caller?: string | null;
		}>;
	}
}

function Root() {
	// Every screen is drawn from here, so a change of language redraws
	// them all.
	const lang = useSyncExternalStore(subscribe, language);
	const { state, push, replace, back, close, reset, onLeave } = useNav();
	const { entries, remove, ready: recentsReady } = useRecents();
	const { settings, ready: settingsReady } = useSettings();
	const nextKey = useRef(1);
	const picking = useRef(false);
	// null until storage answers; the welcome only shows on a first run.
	const [welcome, setWelcome] = useState<boolean | null>(null);
	useEffect(() => {
		backend
			.storeGet(ONBOARDED_KEY)
			.then((v) => setWelcome((w) => (w === null ? v !== true : w)))
			.catch(() => setWelcome(false));
	}, []);
	const finishWelcome = useCallback(() => {
		setWelcome(false);
		backend.storeSet(ONBOARDED_KEY, true).catch(() => {});
	}, []);

	// --- a desktop's tabs: every document opened in the window, one on
	// show (or none, on Home). A phone stacks documents instead. ---
	const [tabs, setTabs] = useState<Tab[]>([]);
	const tabsRef = useRef(tabs);
	tabsRef.current = tabs;
	/** Tabs by when they were last on show, the latest last. */
	const used = useRef<number[]>([]);
	/** A change of tab is under way; anything else that takes the
	 * document away (Back) closes its tab. */
	const leaving = useRef(false);
	const top = state.screens[state.screens.length - 1];
	const current = top?.kind === "viewer" ? top.key : null;
	/** Two documents side by side (a desktop's wide window): the tabs in
	 * each half, and where the halves meet. The one on show (`current`)
	 * has the keyboard; the other is shown beside it. */
	const [split, setSplit] = useState<Split | null>(null);
	const splitRef = useRef(split);
	splitRef.current = split;
	/** A file being picked to open beside the document on show. */
	const besideOf = useRef<number | null>(null);
	const room = useSyncExternalStore(onRoomChange, roomForTwo);
	const shapeOf = useMemo(
		() => splitShape(split ? split.ratio : null),
		[split],
	);
	const [shownRatio, narrowHalves = ""] = useSyncExternalStore(
		onResize,
		shapeOf,
	).split(" ");
	/** Where the halves meet, kept so that each has room. */
	const ratio = split ? Number(shownRatio) : 0.5;

	const show = useCallback(
		(tab: Tab) => {
			used.current = [...used.current.filter((k) => k !== tab.key), tab.key];
			leaving.current = true;
			reset([{ kind: "viewer", request: tab.request, key: tab.key }]);
		},
		[reset],
	);
	const closeTab = useCallback(
		(key: number) => {
			const rest = tabsRef.current.filter((tab) => tab.key !== key);
			const pair = splitRef.current;
			if (pair && (pair.left === key || pair.right === key)) {
				// The other half takes the window, and is shown.
				setSplit(null);
				const other = rest.find(
					(tab) => tab.key === (pair.left === key ? pair.right : pair.left),
				);
				if (other)
					used.current = [
						...used.current.filter((k) => k !== other.key),
						other.key,
					];
			}
			setTabs(rest);
			tabsRef.current = rest;
			used.current = used.current.filter((k) => k !== key);
			const shown = stateRef.current.screens.some(
				(screen) => screen.kind === "viewer" && screen.key === key,
			);
			if (!shown) return;
			// The one shown last before it takes its place, as a browser does.
			const next = [...used.current]
				.reverse()
				.map((k) => rest.find((tab) => tab.key === k))
				.find(Boolean);
			if (next) show(next);
			else {
				leaving.current = true;
				reset([]);
			}
		},
		[show, reset],
	);
	const goHome = useCallback(() => {
		leaving.current = true;
		reset([]);
	}, [reset]);
	/** Put the tab of `key` at index `to` in the row. */
	const moveTabTo = useCallback((key: number, to: number) => {
		const next = moveTab(tabsRef.current, key, to);
		if (next === tabsRef.current) return;
		tabsRef.current = next;
		setTabs(next);
	}, []);
	/** Close every tab but `keep`'s (`which: "others"`), or every one
	 * after it in the row (`"after"`). The tab kept is shown. */
	const closeAround = useCallback(
		(keep: Tab, which: "others" | "after") => {
			const list = tabsRef.current;
			const at = list.findIndex((tab) => tab.key === keep.key);
			if (at < 0) return;
			const gone = list.filter((_, i) =>
				which === "others" ? i !== at : i > at,
			);
			if (gone.some((tab) => tab.key === current)) show(keep);
			for (const tab of gone) closeTab(tab.key);
		},
		[current, show, closeTab],
	);

	const open = useCallback(
		(request: OpenRequest) => {
			if (!isDesktop) {
				push({ kind: "viewer", request, key: nextKey.current++ });
				return;
			}
			// A document already open is shown again, not opened twice.
			const already = tabsRef.current.find(
				(tab) => tab.request.id === request.id,
			);
			const tab = already ?? { key: nextKey.current++, request };
			if (!already) {
				tabsRef.current = [...tabsRef.current, tab];
				setTabs(tabsRef.current);
			}
			// Picked to open beside the one on show: the two side by side.
			const left = besideOf.current;
			besideOf.current = null;
			if (left !== null && left !== tab.key)
				setSplit({ left, right: tab.key, ratio: 0.5 });
			show(tab);
		},
		[push, show],
	);
	const replaceTab = useCallback(
		(key: number, request: OpenRequest) => {
			const fresh = { key: nextKey.current++, request };
			tabsRef.current = tabsRef.current.map((tab) =>
				tab.key === key ? fresh : tab,
			);
			setTabs(tabsRef.current);
			used.current = used.current.filter((k) => k !== key);
			// In its half, if it had one.
			setSplit((pair) =>
				pair?.left === key
					? { ...pair, left: fresh.key }
					: pair?.right === key
						? { ...pair, right: fresh.key }
						: pair,
			);
			show(fresh);
		},
		[show],
	);
	/** A file renamed from Home while a tab has it: the tab reads it from
	 * where it is now, under its new name, and stays where it was. */
	const renamedOpen = useCallback(
		(from: string, now: Pick<OpenRequest, "id" | "name" | "reopen">) => {
			if (!tabsRef.current.some((tab) => tab.request.id === from)) return;
			tabsRef.current = tabsRef.current.map((tab) =>
				tab.request.id === from
					? { ...tab, request: { ...tab.request, ...now, nameVerified: true } }
					: tab,
			);
			setTabs(tabsRef.current);
		},
		[],
	);

	// Back (Alt+Left, a mouse's back button) took the document away:
	// that closes its tab, as the arrow in the bar does.
	const shownBefore = useRef<number | null>(null);
	useEffect(() => {
		const was = shownBefore.current;
		shownBefore.current = current;
		if (!isDesktop || leaving.current) {
			leaving.current = false;
			return;
		}
		const stillOpen = state.screens.some(
			(screen) => screen.kind === "viewer" && screen.key === was,
		);
		if (was !== null && !stillOpen) closeTab(was);
	}, [current, state.screens, closeTab]);

	const stateRef = useRef(state);
	stateRef.current = state;

	const pick = useCallback(
		async (replacing?: RecentEntry) => {
			if (picking.current) return;
			picking.current = true;
			try {
				const request = await backend.pickFile();
				if (!request) return;
				if (replacing && replacing.id !== request.id) remove(replacing.id);
				open(
					replacing?.position
						? { ...request, position: replacing.position }
						: request,
				);
			} catch {
				toast(t("Couldn't open the file picker"));
			} finally {
				picking.current = false;
				besideOf.current = null;
			}
		},
		[open, remove],
	);

	// --- side by side ---
	const twoShown =
		isDesktop &&
		room &&
		!!split &&
		top?.kind === "viewer" &&
		(current === split.left || current === split.right);
	const sideBySide = useMemo<SideBySide>(
		() => ({
			on: twoShown,
			room: isDesktop && room,
			others: tabs.filter((tab) => tab.key !== current),
			beside: (tab) => {
				if (current === null || tab.key === current) return;
				setSplit({ left: current, right: tab.key, ratio: 0.5 });
				show(tab);
			},
			pickBeside: () => {
				if (current === null) return;
				besideOf.current = current;
				void pick();
			},
			swap: () =>
				setSplit(
					(pair) =>
						pair && {
							left: pair.right,
							right: pair.left,
							ratio: 1 - pair.ratio,
						},
				),
			leave: () => setSplit(null),
		}),
		[twoShown, room, tabs, current, show, pick],
	);
	const halfOf = (tab: Tab): Pane["side"] =>
		twoShown && split
			? tab.key === split.left
				? "left"
				: tab.key === split.right
					? "right"
					: null
			: null;

	const openRecent = useCallback(
		(e: RecentEntry) =>
			open({
				id: e.id,
				name: e.name,
				nameVerified: e.nameVerified !== false,
				size: e.size,
				reopen: e.reopen,
			}),
		[open],
	);

	// Back to what was being read, if the reader asked for that and the
	// app wasn't opened on a file of its own.
	const resumed = useRef(false);
	const openRecentRef = useRef(openRecent);
	openRecentRef.current = openRecent;
	const recentsRef = useRef(entries);
	recentsRef.current = entries;
	useEffect(() => {
		if (resumed.current || !settingsReady || !recentsReady) return;
		if (welcome !== false) return;
		if (!settings.reopenLast) {
			resumed.current = true;
			return;
		}
		const timer = window.setTimeout(() => {
			resumed.current = true;
			const busy = stateRef.current.screens.some((x) => x.kind === "viewer");
			if (busy) return;
			const last = [...recentsRef.current]
				.filter((entry) => !entry.unavailable)
				.sort((a, b) => b.openedAt - a.openedAt)[0];
			if (last) openRecentRef.current(last);
		}, 400);
		return () => window.clearTimeout(timer);
	}, [settingsReady, recentsReady, welcome, settings.reopenLast]);

	// Android "Open with": MainActivity copies the file into private
	// storage and calls window.__paperwrenOpenFile (see index.html);
	// payloads queue until this effect drains them.
	/** The document another app opened with Paperwren, and whether that
	 * started Paperwren: Back on it goes back to that app (#83). */
	const caller = useRef<{ id: string; started: boolean } | null>(null);
	useEffect(() => {
		const drain = () => {
			const queue = window.__paperwrenFiles ?? [];
			const files = queue.splice(0, queue.length);
			// A file shared into the app IS the onboarding: go straight to it.
			if (files.length) finishWelcome();
			for (const f of files) {
				const request = requestForManagedCopy(f.path, f.name, f.size);
				if (f.caller && !isDesktop)
					caller.current = { id: request.id, started: f.caller === "started" };
				open(request);
			}
		};
		drain();
		window.addEventListener("paperwren-file", drain);
		return () => window.removeEventListener("paperwren-file", drain);
	}, [open, finishWelcome]);

	// Back on that document, with nothing over it, goes back to the app
	// that opened it, as a viewer does: WhatsApp, a file manager. Started
	// for it, Paperwren ends; already running, it steps behind that app
	// with the document put away, and what was open before stays.
	useEffect(
		() =>
			onLeave((now) => {
				const from = caller.current;
				if (!from || !backToCaller(now, from.id)) return false;
				const leave = window.__paperwrenAndroidExtras?.leaveToCaller;
				if (!leave?.(from.started)) return false;
				caller.current = null;
				if (!from.started) close();
				return true;
			}),
		[onLeave, close],
	);

	// Desktop: files handed to the window open straight away, a tab
	// each.
	const openGiven = useCallback(
		(requests: OpenRequest[]) => {
			if (!requests.length) return;
			finishWelcome();
			for (const request of requests) open(request);
		},
		[open, finishWelcome],
	);

	// The document the app was started with (double-click, "Open with
	// Paperwren"), and on a Mac one opened that way while it runs.
	useEffect(() => backend.onOpenFiles(openGiven), [openGiven]);

	// Drop a file anywhere on the window to open it.
	const [dropping, setDropping] = useState(false);
	useEffect(
		() => backend.onFileDrop({ hover: setDropping, drop: openGiven }),
		[openGiven],
	);

	useEffect(() => {
		const timer = window.setTimeout(() => idle(warmReader), WARM_AFTER);
		return () => window.clearTimeout(timer);
	}, []);

	const entriesRef = useRef(entries);
	entriesRef.current = entries;

	// The keyboard, as a desktop reader has it: Ctrl+O opens a file,
	// Ctrl+W closes what is open, Ctrl+F on Home goes to its search (⌘
	// for Ctrl on a Mac). In the app's own window the webview's reload
	// and find-in-page keys would act on the app instead of the document,
	// so they are not let through (a viewer's own Ctrl+F still opens its
	// find bar).
	const deep = state.screens.length > 1;
	const shownKey = useRef(current);
	shownKey.current = current;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
			const key = e.key.toLowerCase();
			if (isDesktop && isFullscreenKey(e)) {
				e.preventDefault();
				toggleFullscreen();
			} else if (matches(e, "open")) {
				e.preventDefault();
				pick();
			} else if (matches(e, "close") && deep) {
				e.preventDefault();
				if (shownKey.current !== null) closeTab(shownKey.current);
				else close();
			} else if (
				isDesktop &&
				e.ctrlKey &&
				!e.altKey &&
				(e.key === "Tab" || /^[1-9]$/.test(e.key)) &&
				tabsRef.current.length > 1 &&
				!modalOpen()
			) {
				// Ctrl+Tab and Ctrl+Shift+Tab step through the tabs; Ctrl+1 to
				// Ctrl+8 go to one, Ctrl+9 to the last.
				e.preventDefault();
				const list = tabsRef.current;
				const at = list.findIndex((tab) => tab.key === shownKey.current);
				const to =
					e.key === "Tab"
						? (at + (e.shiftKey ? -1 : 1) + list.length) % list.length
						: e.key === "9"
							? list.length - 1
							: Math.min(Number(e.key) - 1, list.length - 1);
				show(list[to]);
			} else if (
				isDesktop &&
				e.ctrlKey &&
				e.shiftKey &&
				!e.altKey &&
				(e.key === "PageUp" || e.key === "PageDown") &&
				shownKey.current !== null &&
				!modalOpen()
			) {
				// Ctrl+Shift+Page Up and Down move the tab on show one place
				// back or on in the row, as in a browser.
				e.preventDefault();
				const at = tabsRef.current.findIndex(
					(tab) => tab.key === shownKey.current,
				);
				moveTabTo(shownKey.current, at + (e.key === "PageUp" ? -1 : 1));
			} else if (
				e.altKey &&
				!e.ctrlKey &&
				e.key === "ArrowLeft" &&
				deep &&
				// On a Mac ⌥← in a field moves the caret a word back.
				!(isMac && (e.target as Element | null)?.closest?.("input, textarea"))
			) {
				// Alt+Left goes back, as in a browser.
				e.preventDefault();
				back();
			} else if (isTauri && mod && ["=", "+", "-", "_", "0"].includes(e.key)) {
				// The webview's own zoom would scale the whole app. Zoom
				// belongs to the document: a viewer hears these keys itself
				// (viewer/hooks.ts), and nothing else may act on them.
				e.preventDefault();
			} else if (matches(e, "find") && !(e.ctrlKey && e.metaKey)) {
				if (isTauri) e.preventDefault();
				if (!deep) {
					e.preventDefault();
					document
						.querySelector<HTMLInputElement>('[data-testid="home"] input')
						?.focus();
				}
			} else if (
				isTauri &&
				(e.key === "F5" ||
					e.key === "F3" ||
					e.key === "F7" ||
					(mod && (key === "r" || key === "g")))
			) {
				e.preventDefault();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [pick, back, close, closeTab, show, deep, moveTabTo]);

	// Ctrl+wheel, which is also how a trackpad pinch arrives: the same
	// rule as the zoom keys above. A viewer takes it for its document
	// first; here it is only kept from the webview.
	useEffect(() => {
		if (!isTauri) return;
		const onWheel = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) e.preventDefault();
		};
		window.addEventListener("wheel", onWheel, { passive: false });
		return () => window.removeEventListener("wheel", onWheel);
	}, []);

	useEffect(() => (isDesktop ? watchFullscreen() : undefined), []);

	// The row of tabs: while two documents or more are open, or one is
	// open behind Home or Settings.
	const stripShown =
		isDesktop &&
		!welcome &&
		(tabs.length > 1 || (tabs.length > 0 && current === null));
	useEffect(() => {
		document.documentElement.classList.toggle("tabbed", stripShown);
	}, [stripShown]);

	// A Mac's menu bar, in the app's language. Its commands press the
	// keys above; Settings has no key of its own to press. Only a Mac
	// loads the code for it.
	const screensRef = useRef(state.screens);
	screensRef.current = state.screens;
	// biome-ignore lint/correctness/useExhaustiveDependencies: built again when the language changes
	useEffect(() => {
		if (!isTauri || !sharesFrame) return;
		import("@/lib/macMenu")
			.then(({ installMenu }) =>
				installMenu({
					settings: () => {
						if (!screensRef.current.some((s) => s.kind === "settings"))
							push({ kind: "settings" });
					},
				}),
			)
			.catch(() => {});
	}, [lang, push]);
	const viewing = state.screens[state.screens.length - 1]?.kind === "viewer";
	useEffect(() => {
		if (!isTauri || !sharesFrame) return;
		import("@/lib/macMenu")
			.then(({ setMenuViewing }) => setMenuViewing(viewing))
			.catch(() => {});
	}, [viewing]);

	// Android: the shell cannot translate, so a hand-off that fails there
	// is said here.
	useEffect(() => {
		const say = (code: string) => {
			toast(
				code === "share"
					? t("Couldn't share this file")
					: code === "open-with"
						? t("No other app can open this file")
						: code === "print"
							? t("Couldn't start printing")
							: code === "restarted"
								? t("Paperwren had to restart")
								: t("Couldn't open that file"),
			);
			return true;
		};
		window.__paperwrenNativeError = say;
		return () => {
			if (window.__paperwrenNativeError === say)
				window.__paperwrenNativeError = undefined;
		};
	}, []);

	// The documents open here (every tab, both halves side by side) are
	// never saved over: a copy goes somewhere else, and a save the reader
	// points at one of them is refused, saying why.
	useEffect(() => {
		retainMemoryFiles([
			...tabs.map((tab) => tab.request.reopen),
			...state.screens.map((screen) =>
				screen.kind === "viewer"
					? screen.request.reopen
					: screen.kind === "tools"
						? screen.file?.reopen
						: undefined,
			),
		]);
		holdOpen("documents", [
			...tabs.map((tab) => tab.request.reopen),
			...state.screens.map((screen) =>
				screen.kind === "viewer" ? screen.request.reopen : undefined,
			),
		]);
	}, [tabs, state.screens]);
	useEffect(() => onSaveRefused((note) => toast(t(note))), []);

	// A desktop app has no "Reload" or "Back" menu on a right-click, and
	// the webview's own menu acts on the app, not the document (its
	// "Print" prints the app). Fields keep their menu; selected text gets
	// a small one of ours.
	const [picked, setPicked] = useState<string | null>(null);
	useEffect(() => {
		if (!isDesktop) return;
		const onMenu = (e: MouseEvent) => {
			// A list row has already opened its own menu.
			if (e.defaultPrevented) return;
			if ((e.target as Element | null)?.closest?.("input, textarea")) return;
			e.preventDefault();
			const text = window.getSelection()?.toString().trim();
			if (text) setPicked(text);
		};
		window.addEventListener("contextmenu", onMenu);
		return () => window.removeEventListener("contextmenu", onMenu);
	}, []);
	const copyPicked = () => {
		const text = picked ?? "";
		setPicked(null);
		navigator.clipboard
			?.writeText(text)
			.then(() => toast(t("Copied")))
			.catch(() => toast(t("Couldn't copy")));
	};
	const kept = keptTabs(tabs, used.current);

	// What Home and the documents are handed, the same at every render:
	// they are drawn again for what they show, not each time Root is.
	const onOpenFile = useCallback(() => pick(), [pick]);
	const onSettings = useCallback(() => push({ kind: "settings" }), [push]);
	const onTools = useCallback(
		(tool?: ToolId) => push({ kind: "tools", tool }),
		[push],
	);
	const onNotes = useCallback(() => push({ kind: "notes" }), [push]);
	const openTools = useCallback(
		(tool: string | undefined, file: OpenRequest) =>
			push({ kind: "tools", tool, file }),
		[push],
	);
	/** A desktop's tabs. */
	const tabCalls = useMemo<DocCalls>(
		() => ({
			close: closeTab,
			replace: replaceTab,
			open,
			tools: openTools,
			locate: (key, id) => {
				const entry = entriesRef.current.find((e) => e.id === id);
				closeTab(key);
				pick(entry);
			},
			focus: (key) => {
				if (key === shownKey.current) return;
				const tab = tabsRef.current.find((one) => one.key === key);
				if (tab) show(tab);
			},
		}),
		[closeTab, replaceTab, open, openTools, pick, show],
	);
	/** A phone's one document on top. */
	const stackCalls = useMemo<DocCalls>(
		() => ({
			close,
			replace: (_key, request) =>
				replace({ kind: "viewer", request, key: nextKey.current++ }),
			open,
			tools: openTools,
			locate: (_key, id) => {
				const entry = entriesRef.current.find((e) => e.id === id);
				back();
				pick(entry);
			},
			focus: () => {},
		}),
		[close, replace, open, openTools, back, pick],
	);
	const narrowLeft = narrowHalves[0] === "1";
	const narrowRight = narrowHalves[1] === "1";

	return (
		<>
			<KeptHome
				onOpenFile={onOpenFile}
				onOpenRecent={openRecent}
				onOpenRequest={open}
				onSettings={onSettings}
				onTools={onTools}
				onNotes={onNotes}
				onRenamed={renamedOpen}
				lang={lang}
				keys={settings.shortcuts}
			/>
			{state.screens.map((screen, i) => {
				const atTop = i === state.screens.length - 1;
				if (screen.kind === "settings")
					return <SettingsScreen key="settings" />;
				if (screen.kind === "notes")
					return (
						<Suspense key="notes" fallback={<ScreenLoading />}>
							<NotesScreen />
						</Suspense>
					);
				if (screen.kind === "tools")
					return (
						<Suspense key={`tools-${i}`} fallback={<ScreenLoading />}>
							<ToolsScreen
								start={screen.tool as ToolId | undefined}
								file={screen.file}
								onOpen={open}
							/>
						</Suspense>
					);
				// A document under another one (several shared at once, a file
				// dropped while reading) is not kept in memory: Back opens it
				// again, where the reader left it. A desktop draws its tabs
				// below instead.
				if (isDesktop || screen.kind !== "viewer" || !atTop) return null;
				return (
					<Suspense
						key={screen.key}
						fallback={<OpeningView name={screen.request.name} />}
					>
						<DocView
							docKey={screen.key}
							request={screen.request}
							active={atTop}
							tabbed={false}
							visible
							side={null}
							ratio={0.5}
							narrow={false}
							calls={stackCalls}
							lang={lang}
							keys={settings.shortcuts}
						/>
					</Suspense>
				);
			})}
			<SideBySideContext.Provider value={sideBySide}>
				{isDesktop &&
					tabs
						.filter(
							(tab) =>
								tab.key === current ||
								tab.key === split?.left ||
								tab.key === split?.right ||
								kept.has(tab.key),
						)
						.map((tab) => {
							const half = halfOf(tab);
							const shown = tab.key === current && top?.kind === "viewer";
							return (
								<Suspense
									key={tab.key}
									fallback={
										tab.key === current ? (
											<OpeningView name={tab.request.name} />
										) : null
									}
								>
									<DocView
										docKey={tab.key}
										request={tab.request}
										// Under Settings, or behind another tab: kept, not shown.
										// Side by side, the half on show has the keyboard.
										active={shown}
										tabbed
										visible={half !== null || shown}
										side={half}
										ratio={ratio}
										narrow={
											half === "left"
												? narrowLeft
												: half === "right" && narrowRight
										}
										calls={tabCalls}
										lang={lang}
										keys={settings.shortcuts}
									/>
								</Suspense>
							);
						})}
			</SideBySideContext.Provider>
			{twoShown && split && (
				<SplitDivider
					ratio={ratio}
					onRatio={(next) =>
						setSplit(
							(pair) =>
								pair && {
									...pair,
									ratio: clampRatio(next, window.innerWidth),
								},
						)
					}
				/>
			)}
			{stripShown && (
				<TabStrip
					tabs={tabs}
					current={current}
					beside={
						twoShown && split
							? current === split.left
								? split.right
								: split.left
							: null
					}
					onShow={show}
					onClose={(tab) => closeTab(tab.key)}
					onHome={goHome}
					onMove={(tab, to) => moveTabTo(tab.key, to)}
					onCloseOthers={(tab) => closeAround(tab, "others")}
					onCloseAfter={(tab) => closeAround(tab, "after")}
					onBeside={sideBySide.room ? sideBySide.beside : undefined}
				/>
			)}
			{welcome && (
				<Suspense fallback={null}>
					<Onboarding onDone={finishWelcome} />
				</Suspense>
			)}
			{dropping && <DropHint />}
			<Sheet
				open={picked !== null}
				title={t("Selected text")}
				onClose={() => setPicked(null)}
				testId="selection-menu"
			>
				<SheetItem
					icon={<Copy size={20} />}
					shortcut="Ctrl+C"
					onClick={copyPicked}
					testId="selection-copy"
				>
					{t("Copy")}
				</SheetItem>
				{deep && (
					<>
						<SheetItem
							icon={<TextSelect size={20} />}
							shortcut="Ctrl+A"
							onClick={() => {
								setPicked(null);
								window.dispatchEvent(new Event(SELECT_ALL_EVENT));
							}}
						>
							{t("Select all")}
						</SheetItem>
						<SheetItem
							icon={<Search size={20} />}
							onClick={() => {
								// One line of it, and not a whole page of it.
								const text = (picked ?? "").split(/\r?\n/)[0].slice(0, 120);
								setPicked(null);
								window.dispatchEvent(
									new CustomEvent(FIND_EVENT, { detail: text }),
								);
							}}
							testId="selection-find"
						>
							{t("Find this text")}
						</SheetItem>
					</>
				)}
			</Sheet>
			<LinkGuard />
			<ToastHost />
			<UpdateHost paused={welcome !== false} />
			<WindowControls />
		</>
	);
}

export default function App() {
	return (
		<SettingsProvider>
			<RecentsProvider>
				<NavigationProvider>
					<Root />
				</NavigationProvider>
			</RecentsProvider>
		</SettingsProvider>
	);
}
