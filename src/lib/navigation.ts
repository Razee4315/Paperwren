/**
 * Navigation as a pure reducer: a screen stack (Home always at the
 * bottom) plus an overlay stack. System Back, the browser's history
 * and every on-screen back arrow share one priority order:
 *   1. close the top overlay (sheet, dialog, search bar)
 *   2. pop the top screen
 *   3. at Home with nothing open, Back is not consumed (Android
 *      minimises the app).
 */

import type { OpenRequest } from "./types";

export type Screen =
	| { kind: "home" }
	| { kind: "settings" }
	| { kind: "notes" }
	/** The tools, or one of them with a file already in it. */
	| { kind: "tools"; tool?: string; file?: OpenRequest }
	| { kind: "viewer"; request: OpenRequest; key: number };

export interface NavState {
	screens: Screen[];
	overlays: string[];
}

export const initialNav: NavState = {
	screens: [{ kind: "home" }],
	overlays: [],
};

export type NavAction =
	| { type: "push"; screen: Screen }
	| { type: "pop" }
	| { type: "replace"; screen: Screen }
	/** Show these screens over Home, and nothing else (a desktop's tab
	 * changing: the one document on show, or none). */
	| { type: "reset"; screens: Screen[] }
	| { type: "overlay-open"; id: string }
	| { type: "overlay-close"; id: string };

export function navReducer(state: NavState, action: NavAction): NavState {
	switch (action.type) {
		case "push":
			// A second tap before the first screen has slid in would stack a
			// copy of it, and Back would have to be pressed twice.
			return sameScreen(state.screens[state.screens.length - 1], action.screen)
				? state
				: { ...state, screens: [...state.screens, action.screen] };
		case "pop":
			return state.screens.length > 1
				? { ...state, screens: state.screens.slice(0, -1) }
				: state;
		case "replace":
			// Home is never replaced: with nothing above it, this opens.
			return {
				...state,
				screens: [
					...state.screens.slice(0, Math.max(1, state.screens.length - 1)),
					action.screen,
				],
			};
		case "reset":
			return {
				...state,
				screens: [
					initialNav.screens[0],
					...action.screens.filter((screen) => screen.kind !== "home"),
				],
			};
		case "overlay-open":
			return state.overlays.includes(action.id)
				? state
				: { ...state, overlays: [...state.overlays, action.id] };
		case "overlay-close":
			return {
				...state,
				overlays: state.overlays.filter((o) => o !== action.id),
			};
	}
}

/** The same screen, showing the same thing (a viewer's key is only
 * which time it was opened). */
function sameScreen(a: Screen, b: Screen): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === "viewer" && b.kind === "viewer")
		return a.request.id === b.request.id;
	if (a.kind === "tools" && b.kind === "tools")
		return a.tool === b.tool && a.file?.id === b.file?.id;
	return true;
}

/** Whether Back has something to do inside the app. */
export function canGoBack(state: NavState): boolean {
	return state.overlays.length > 0 || state.screens.length > 1;
}
