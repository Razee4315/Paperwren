/**
 * The single navigation owner (audit section 5): the reducer state
 * plus an overlay dismiss registry. System Back (Android bridge),
 * browser history, and every toolbar Back arrow funnel into one
 * handleBack(); overlays register their own dismiss so the stack
 * never desyncs from what is visually open.
 */

import {
	type NavigationState,
	type SettingsSubpage,
	backWouldConsume,
	initialNavigation,
	navigationReducer,
} from "@/lib/navigation";
import type { FileMeta } from "@/lib/types";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useReducer,
	useRef,
} from "react";

declare global {
	interface Window {
		/** Android Back bridge contract (audit section 5.3):
		 * synchronously consumes Back if a overlay/subpage/screen was
		 * dismissed or popped; returns false so the activity can
		 * finish/minimize. */
		__paperwrenHandleBack?: () => boolean;
	}
}

interface NavigationContextValue {
	state: NavigationState;
	/** Push a viewer above the current stack (file B stacks on A). */
	openViewer: (file: FileMeta) => void;
	openSettings: (subpage?: SettingsSubpage) => void;
	setSettingsSubpage: (subpage: SettingsSubpage | null) => void;
	/** Reset to Home (leaving the last viewer). */
	goHome: () => void;
	/** One Back step; returns true when consumed by the web layer. */
	handleBack: () => boolean;
	openOverlay: (id: string) => void;
	closeOverlay: (id: string) => void;
	/** Register the dismiss callback for an open overlay. Returns an
	 * unregister function; call it when the overlay unmounts. */
	registerOverlay: (id: string, dismiss: () => void) => () => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

function navDepth(state: NavigationState): number {
	const top = state.screens[state.screens.length - 1];
	return (
		state.screens.length +
		state.overlays.length +
		(top.kind === "settings" && top.subpage ? 1 : 0)
	);
}

export function NavigationProvider({ children }: { children: ReactNode }) {
	const [state, dispatch] = useReducer(navigationReducer, initialNavigation);
	const registry = useRef(new Map<string, () => void>());
	const stateRef = useRef(state);
	stateRef.current = state;

	const registerOverlay = useCallback((id: string, dismiss: () => void) => {
		registry.current.set(id, dismiss);
		return () => {
			registry.current.delete(id);
		};
	}, []);

	const openOverlay = useCallback((id: string) => {
		dispatch({ type: "open-overlay", id });
	}, []);
	const closeOverlay = useCallback((id: string) => {
		dispatch({ type: "close-overlay", id });
	}, []);

	const handleBack = useCallback((): boolean => {
		const current = stateRef.current;
		const top = current.overlays[current.overlays.length - 1];
		if (top) {
			// The owner's dismiss closes its own state and calls
			// closeOverlay; the registry is the source of truth for
			// what is actually on screen.
			const dismiss = registry.current.get(top.id);
			if (dismiss) {
				dismiss();
				return true;
			}
			dispatch({ type: "close-overlay", id: top.id });
			return true;
		}
		if (!backWouldConsume(current)) return false;
		dispatch({ type: "handle-back" });
		return true;
	}, []);

	const openViewer = useCallback((file: FileMeta) => {
		dispatch({ type: "push", screen: { kind: "viewer", file } });
	}, []);
	const openSettings = useCallback((subpage?: SettingsSubpage) => {
		dispatch({ type: "open-settings", subpage });
	}, []);
	const setSettingsSubpage = useCallback((subpage: SettingsSubpage | null) => {
		dispatch({ type: "set-settings-subpage", subpage });
	}, []);
	const goHome = useCallback(() => {
		dispatch({ type: "replace", screen: { kind: "home" } });
	}, []);

	// Android Back bridge: the native side asks before finishing.
	useEffect(() => {
		window.__paperwrenHandleBack = handleBack;
		return () => {
			if (window.__paperwrenHandleBack === handleBack) {
				window.__paperwrenHandleBack = undefined;
			}
		};
	}, [handleBack]);

	// Browser/desktop QA parity: each deeper screen/overlay pushes a
	// history entry; popstate is one Back step.
	const depthRef = useRef(1);
	useEffect(() => {
		const depth = navDepth(state);
		if (depth > depthRef.current) {
			window.history.pushState({ paperwrenDepth: depth }, "");
		}
		depthRef.current = depth;
	}, [state]);

	useEffect(() => {
		const onPopState = () => {
			const consumed = handleBack();
			depthRef.current = navDepth(stateRef.current);
			if (!consumed) {
				// Nothing to dismiss: restore parity so Back keeps
				// matching visible depth in the browser.
				window.history.pushState({}, "");
			}
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [handleBack]);

	const value = {
		state,
		openViewer,
		openSettings,
		setSettingsSubpage,
		goHome,
		handleBack,
		openOverlay,
		closeOverlay,
		registerOverlay,
	};

	return (
		<NavigationContext.Provider value={value}>
			{children}
		</NavigationContext.Provider>
	);
}

export function useNavigation(): NavigationContextValue {
	const ctx = useContext(NavigationContext);
	if (!ctx) throw new Error("useNavigation needs NavigationProvider");
	return ctx;
}

/** Register an overlay with the shared stack while `open` is true.
 * The dismiss callback must close the overlay. */
export function useOverlayRegistration(
	id: string,
	open: boolean,
	dismiss: () => void,
) {
	const { registerOverlay, openOverlay, closeOverlay } = useNavigation();
	const dismissRef = useRef(dismiss);
	dismissRef.current = dismiss;
	useEffect(() => {
		if (!open) return;
		openOverlay(id);
		const unregister = registerOverlay(id, () => dismissRef.current());
		return () => {
			unregister();
			closeOverlay(id);
		};
	}, [id, open, openOverlay, closeOverlay, registerOverlay]);
}
