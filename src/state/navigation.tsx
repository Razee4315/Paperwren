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
	back: () => boolean;
	home: () => void;
	/** Register an open overlay; its `close` runs when Back targets it. */
	registerOverlay: (id: string, close: () => void) => () => void;
}

const NavContext = createContext<NavApi | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
	const [state, dispatch] = useReducer(navReducer, initialNav);
	const stateRef = useRef(state);
	stateRef.current = state;
	const closers = useRef(new Map<string, () => void>());

	const back = useCallback(() => {
		const current = stateRef.current;
		const top = current.overlays[current.overlays.length - 1];
		if (top) {
			const close = closers.current.get(top);
			if (close) close();
			else dispatch({ type: "overlay-close", id: top });
			return true;
		}
		if (!canGoBack(current)) return false;
		dispatch({ type: "pop" });
		return true;
	}, []);

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
	const home = useCallback(() => dispatch({ type: "home" }), []);

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
		() => ({ state, push, back, home, registerOverlay }),
		[state, push, back, home, registerOverlay],
	);
	return <NavContext.Provider value={api}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
	const ctx = useContext(NavContext);
	if (!ctx) throw new Error("useNav must be used inside NavigationProvider");
	return ctx;
}

/** While `open`, Back closes this overlay before anything else. */
export function useBackClose(id: string, open: boolean, close: () => void) {
	const { registerOverlay } = useNav();
	const closeRef = useRef(close);
	closeRef.current = close;
	useEffect(() => {
		if (!open) return;
		return registerOverlay(id, () => closeRef.current());
	}, [id, open, registerOverlay]);
}
