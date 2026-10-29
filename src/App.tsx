import { backend, requestForManagedCopy } from "@/lib/backend";
import { isDesktop, isMac, isTauri, sharesFrame } from "@/lib/env";
import { toggleFullscreen, watchFullscreen } from "@/lib/fullscreen";
import { language, subscribe, t } from "@/lib/i18n";
import { isFullscreenKey } from "@/lib/keys";
import { FIND_EVENT, SELECT_ALL_EVENT } from "@/lib/signals";
import type { OpenRequest, RecentEntry } from "@/lib/types";
import { type Tab, TabStrip } from "@/screens/TabStrip";
import { UpdateHost } from "@/screens/Updates";
import { Home } from "@/screens/home/Home";
import { SettingsScreen } from "@/screens/settings/Settings";
import type { ToolId } from "@/screens/tools/ToolsScreen";
import { NavigationProvider, useNav } from "@/state/navigation";
import { RecentsProvider, useRecents } from "@/state/recents";
import { SettingsProvider } from "@/state/settings";
import {
	DropHint,
	LinkGuard,
	OpeningView,
	Sheet,
	SheetItem,
	ToastHost,
	WindowControls,
	modalOpen,
	toast,
} from "@/ui";
import { Copy, Search, TextSelect } from "lucide-react";
import {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

// The viewer engines (pdf.js, docx-preview, the grid) are the bulk of
// the code; Home must not pay for them at cold start.
const ViewerScreen = lazy(() => import("@/screens/viewer/ViewerScreen"));
const ToolsScreen = lazy(() =>
	import("@/screens/tools/ToolsScreen").then((m) => ({
		default: m.ToolsScreen,
	})),
);
// Shown once; never part of a regular launch's bundle.
const Onboarding = lazy(() => import("@/screens/onboarding/Onboarding"));

const ONBOARDED_KEY = "onboarded";
/** Tabs kept drawn besides the one on show, so a switch back is
 * instant; older ones are read again when shown. */
const KEPT_TABS = 4;

declare global {
	interface Window {
		__paperwrenFiles?: Array<{ path: string; name: string; size: number }>;
	}
}

function Root() {
	// Every screen is drawn from here, so a change of language redraws
	// them all.
	const lang = useSyncExternalStore(subscribe, language);
	const { state, push, replace, back, close, reset } = useNav();
	const { entries, remove } = useRecents();
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
			if (already) return show(already);
			const tab = { key: nextKey.current++, request };
			tabsRef.current = [...tabsRef.current, tab];
			setTabs(tabsRef.current);
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
			show(fresh);
		},
		[show],
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
			}
		},
		[open, remove],
	);

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

	// Android "Open with": MainActivity copies the file into private
	// storage and calls window.__paperwrenOpenFile (see index.html);
	// payloads queue until this effect drains them.
	useEffect(() => {
		const drain = () => {
			const queue = window.__paperwrenFiles ?? [];
			const files = queue.splice(0, queue.length);
			// A file shared into the app IS the onboarding: go straight to it.
			if (files.length) finishWelcome();
			for (const f of files) {
				open(requestForManagedCopy(f.path, f.name, f.size));
			}
		};
		drain();
		window.addEventListener("paperwren-file", drain);
		return () => window.removeEventListener("paperwren-file", drain);
	}, [open, finishWelcome]);

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
			} else if (mod && !e.shiftKey && key === "o") {
				e.preventDefault();
				pick();
			} else if (mod && !e.shiftKey && key === "w" && deep) {
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
			} else if (mod && key === "f") {
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
	}, [pick, back, close, closeTab, show, deep]);

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

	return (
		<>
			<Home
				onOpenFile={() => pick()}
				onOpenRecent={openRecent}
				onOpenRequest={open}
				onSettings={() => push({ kind: "settings" })}
				onTools={(tool) => push({ kind: "tools", tool })}
			/>
			{state.screens.map((screen, i) => {
				const atTop = i === state.screens.length - 1;
				if (screen.kind === "settings")
					return <SettingsScreen key="settings" />;
				if (screen.kind === "tools")
					return (
						<Suspense key={`tools-${i}`} fallback={null}>
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
						<ViewerScreen
							request={screen.request}
							active={atTop}
							onClose={close}
							onReplace={(request) =>
								replace({ kind: "viewer", request, key: nextKey.current++ })
							}
							onOpen={open}
							onTools={(tool, file) => push({ kind: "tools", tool, file })}
							onLocate={() => {
								const entry = entriesRef.current.find(
									(e) => e.id === screen.request.id,
								);
								back();
								pick(entry);
							}}
						/>
					</Suspense>
				);
			})}
			{isDesktop &&
				tabs
					.filter(
						(tab) =>
							tab.key === current ||
							used.current.slice(-KEPT_TABS).includes(tab.key),
					)
					.map((tab) => (
						<Suspense
							key={tab.key}
							fallback={
								tab.key === current ? (
									<OpeningView name={tab.request.name} />
								) : null
							}
						>
							<ViewerScreen
								request={tab.request}
								// Under Settings, or behind another tab: kept, not shown.
								active={tab.key === current && top?.kind === "viewer"}
								onClose={() => closeTab(tab.key)}
								onReplace={(request) => replaceTab(tab.key, request)}
								onOpen={open}
								onTools={(tool, file) => push({ kind: "tools", tool, file })}
								onLocate={() => {
									const entry = entriesRef.current.find(
										(e) => e.id === tab.request.id,
									);
									closeTab(tab.key);
									pick(entry);
								}}
							/>
						</Suspense>
					))}
			{stripShown && (
				<TabStrip
					tabs={tabs}
					current={current}
					onShow={show}
					onClose={(tab) => closeTab(tab.key)}
					onHome={goHome}
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
