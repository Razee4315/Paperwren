import {
	type NavState,
	type Screen,
	canGoBack,
	initialNav,
	navReducer,
} from "@/lib/navigation";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
} from "react";
import { askLeave, holdsWork, screenScope } from "./leave";

declare global {
	interface Window {
		/** Android Back bridge: returns true when the app consumed Back. */
		__paperwrenHandleBack?: () => boolean;
	}
}

interface NavApi extends NavActions {
	state: NavState;
}

interface NavActions {
	push: (screen: Screen) => void;
	/** Put a screen in place of the one on top. */
	replace: (screen: Screen) => void;
	back: () => boolean;
	/** Leave the screen on top, whatever it has open: a document's
	 * close arrow and Ctrl+W close the document, where Back may first
	 * retrace a step inside it. */
	close: () => void;
	/** Show exactly these screens over Home (none: Home itself). */
	reset: (screens: Screen[]) => void;
	/** Register an open overlay; its `close` runs when Back targets it. */
	registerOverlay: (id: string, close: () => void) => () => void;
	/** An overlay closed another way (Esc, its Close button): Back skips
	 * it from now on, before the render that takes it off the list. */
	noteClosed: (id: string) => void;
	/** Give Back a way out of the app before it pops a screen: `leave`
	 * answers true when it has left (Android: back to the app that
	 * opened the document). */
	onLeave: (leave: (state: NavState) => boolean) => () => void;
}

// Three contexts, so a reader is drawn again only for what it reads: an
// overlay opening (a menu, a dialog) changes the state but not the
// screens, and the actions never change.
const NavStateContext = createContext<NavState | null>(null);
const NavScreensContext = createContext<Screen[] | null>(null);
const NavActionsContext = createContext<NavActions | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
	const [state, dispatch] = useReducer(navReducer, initialNav);
	const stateRef = useRef(state);
	stateRef.current = state;
	const closers = useRef(new Map<string, () => void>());
	// Overlays whose close handler is running. A handler may itself go
	// Back (the viewer's error dialog closes by popping the viewer); that
	// nested call must skip the overlay being closed, or Back would call
	// the same handler forever and the dialog could never close.
	const closing = useRef(new Set<string>());
	// Overlays Back has closed that are still listed until the next
	// render. Two quick presses (Esc Esc, or Back twice while the app is
	// busy) would otherwise both reach the same overlay, and the second
	// would do nothing instead of going on to the screen under it.
	const closed = useRef(new Set<string>());
	// biome-ignore lint/correctness/useExhaustiveDependencies: cleared at each render of a new state
	useEffect(() => {
		closed.current.clear();
	}, [state]);

	// Until its own close lands; an overlay that turns Back down (busy
	// saving) is reached again a moment later.
	const noteClosed = useCallback((id: string) => {
		closed.current.add(id);
		window.setTimeout(() => closed.current.delete(id), 400);
	}, []);

	const leaveRef = useRef<((state: NavState) => boolean) | null>(null);
	const onLeave = useCallback((leave: (state: NavState) => boolean) => {
		leaveRef.current = leave;
		return () => {
			if (leaveRef.current === leave) leaveRef.current = null;
		};
	}, []);

	const back = useCallback(() => {
		const current = stateRef.current;
		const open = current.overlays.filter(
			(id) => !closing.current.has(id) && !closed.current.has(id),
		);
		const top = open[open.length - 1];
		if (top) {
			noteClosed(top);
			const close = closers.current.get(top);
			if (!close) {
				dispatch({ type: "overlay-close", id: top });
				return true;
			}
			closing.current.add(top);
			try {
				close();
			} finally {
				closing.current.delete(top);
			}
			return true;
		}
		// The screen on top goes (or the app, back to the one that opened
		// the document): what would be lost there is asked about first.
		const going = (now: NavState) => {
			if (leaveRef.current?.(now)) return true;
			if (!canGoBack(now)) return false;
			dispatch({ type: "pop" });
			return true;
		};
		const at = current.screens.length - 1;
		const screen = current.screens[at];
		const where = [screenScope(screen, at)];
		if (!holdsWork(where)) return going({ ...current, overlays: open });
		askLeave(where, () => {
			// Answered Discard: unless the screen has gone some other way
			// meanwhile. The question itself is the overlay closing now.
			const now = stateRef.current;
			if (now.screens[at] === screen) going({ ...now, overlays: [] });
		});
		return true;
	}, [noteClosed]);

	const registerOverlay = useCallback((id: string, close: () => void) => {
		closers.current.set(id, close);
		dispatch({ type: "overlay-open", id });
		return () => {
			closers.current.delete(id);
			dispatch({ type: "overlay-close", id });
		};
	}, []);

	const push = useCallback(
		(screen: Screen) => dispatch({ type: "push", screen }),
		[],
	);
	const close = useCallback(() => {
		const { screens } = stateRef.current;
		const at = screens.length - 1;
		const screen = screens[at];
		if (at < 1) return;
		askLeave([screenScope(screen, at)], () => {
			if (stateRef.current.screens[at] === screen) dispatch({ type: "pop" });
		});
	}, []);
	const reset = useCallback(
		(screens: Screen[]) => dispatch({ type: "reset", screens }),
		[],
	);
	const replace = useCallback(
		(screen: Screen) => dispatch({ type: "replace", screen }),
		[],
	);

	useEffect(() => {
		window.__paperwrenHandleBack = back;
		return () => {
			if (window.__paperwrenHandleBack === back)
				window.__paperwrenHandleBack = undefined;
		};
	}, [back]);

	// Browser/desktop: keep one history entry above the base while the
	// app has somewhere to go back to, so the browser Back button and
	// mouse back button behave like Android Back.
	const armed = useRef(false);
	useEffect(() => {
		const needs = canGoBack(state);
		if (needs && !armed.current) {
			window.history.pushState({ paperwren: true }, "");
			armed.current = true;
		}
	}, [state]);
	useEffect(() => {
		const onPop = () => {
			armed.current = false;
			back();
			if (canGoBack(stateRef.current)) {
				window.history.pushState({ paperwren: true }, "");
				armed.current = true;
			}
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, [back]);

	const actions = useMemo(
		() => ({
			push,
			replace,
			back,
			close,
			reset,
			registerOverlay,
			noteClosed,
			onLeave,
		}),
		[push, replace, back, close, reset, registerOverlay, noteClosed, onLeave],
	);
	return (
		<NavActionsContext.Provider value={actions}>
			<NavScreensContext.Provider value={state.screens}>
				<NavStateContext.Provider value={state}>
					{children}
				</NavStateContext.Provider>
			</NavScreensContext.Provider>
		</NavActionsContext.Provider>
	);
}

/** The state and every action: the reader is drawn again at every
 * change, an overlay opening or closing included. */
export function useNav(): NavApi {
	const state = useContext(NavStateContext);
	const actions = useNavActions();
	if (!state) throw new Error("useNav must be used inside NavigationProvider");
	return useMemo(() => ({ state, ...actions }), [state, actions]);
}

/** The screens over Home: the same array while only overlays change. */
export function useNavScreens(): Screen[] {
	const screens = useContext(NavScreensContext);
	if (!screens)
		throw new Error("useNavScreens must be used inside NavigationProvider");
	return screens;
}

/** What moves between screens and overlays. The same functions at
 * every render: the reader is never drawn again for them. */
export function useNavActions(): NavActions {
	const ctx = useContext(NavActionsContext);
	if (!ctx)
		throw new Error("useNavActions must be used inside NavigationProvider");
	return ctx;
}

/** While `open`, Back closes this overlay before anything else. */
export function useBackClose(
	id: string,
	open: boolean,
	close: () => void,
): () => void {
	const { registerOverlay, noteClosed } = useNavActions();
	const closeRef = useRef(close);
	closeRef.current = close;
	useEffect(() => {
		if (!open) return;
		return registerOverlay(id, () => closeRef.current());
	}, [id, open, registerOverlay]);
	// The close to hand to Esc and Close buttons: Back hears of it at once.
	return useCallback(() => {
		noteClosed(id);
		closeRef.current();
	}, [id, noteClosed]);
}
