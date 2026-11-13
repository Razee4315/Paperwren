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

declare global {
	interface Window {
		/** Android Back bridge: returns true when the app consumed Back. */
		__paperwrenHandleBack?: () => boolean;
	}
}

interface NavApi {
	state: NavState;
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
}

const NavContext = createContext<NavApi | null>(null);

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
		if (!canGoBack(current)) return false;
		dispatch({ type: "pop" });
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
	const close = useCallback(() => dispatch({ type: "pop" }), []);
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

	const api = useMemo(
		() => ({
			state,
			push,
			replace,
			back,
			close,
			reset,
			registerOverlay,
			noteClosed,
		}),
		[state, push, replace, back, close, reset, registerOverlay, noteClosed],
	);
	return <NavContext.Provider value={api}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
	const ctx = useContext(NavContext);
	if (!ctx) throw new Error("useNav must be used inside NavigationProvider");
	return ctx;
}

/** While `open`, Back closes this overlay before anything else. */
export function useBackClose(
	id: string,
	open: boolean,
	close: () => void,
): () => void {
	const { registerOverlay, noteClosed } = useNav();
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
