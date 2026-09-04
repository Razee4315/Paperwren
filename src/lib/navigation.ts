/**
 * Central navigation model (audit section 5): one ordered screen
 * stack plus one overlay stack, and a single Back priority order.
 * Pure so the Back behavior is unit-testable.
 *
 * Back priority (exactly one owner, exactly this order):
 *   1. dismiss the top overlay (sheet/dialog/search),
 *   2. leave a settings subpage back to Settings root,
 *   3. pop the active screen (viewer/settings) revealing the prior,
 *   4. at Home with nothing above, Back is not consumed (Android
 *      closes/minimizes the activity).
 */

import type { FileMeta } from "./types";

export type SettingsSubpage =
	| "appearance"
	| "viewer"
	| "files"
	| "privacy"
	| "about"
	| "licenses"
	| "policy";

export type Screen =
	| { kind: "home" }
	| { kind: "settings"; subpage: SettingsSubpage | null }
	| { kind: "viewer"; file: FileMeta };

export interface OverlayEntry {
	id: string;
}

export interface NavigationState {
	screens: Screen[]; // Home at the bottom, always present
	overlays: OverlayEntry[];
}

export const initialNavigation: NavigationState = {
	screens: [{ kind: "home" }],
	overlays: [],
};

export type NavigationAction =
	| { type: "push"; screen: Screen }
	| { type: "pop" }
	| { type: "replace"; screen: Screen } // home resets the stack
	| { type: "open-settings"; subpage?: SettingsSubpage }
	| { type: "set-settings-subpage"; subpage: SettingsSubpage | null }
	| { type: "open-overlay"; id: string }
	| { type: "close-overlay"; id: string }
	| { type: "handle-back" };

export function navigationReducer(
	state: NavigationState,
	action: NavigationAction,
): NavigationState {
	switch (action.type) {
		case "push": {
			if (action.screen.kind === "home") {
				return { screens: [action.screen], overlays: [] };
			}
			// Opening file B above file A stacks instead of replacing.
			return { ...state, screens: [...state.screens, action.screen] };
		}
		case "pop": {
			if (state.screens.length <= 1) return state;
			return { ...state, screens: state.screens.slice(0, -1) };
		}
		case "replace":
			return { screens: [action.screen], overlays: [] };
		case "open-settings":
			return {
				...state,
				screens: [
					...state.screens,
					{ kind: "settings", subpage: action.subpage ?? null },
				],
			};
		case "set-settings-subpage": {
			const screens = state.screens.map((s) =>
				s.kind === "settings" ? { ...s, subpage: action.subpage } : s,
			);
			return { ...state, screens };
		}
		case "open-overlay":
			if (state.overlays.some((o) => o.id === action.id)) return state;
			return {
				...state,
				overlays: [...state.overlays, { id: action.id }],
			};
		case "close-overlay":
			return {
				...state,
				overlays: state.overlays.filter((o) => o.id !== action.id),
			};
		case "handle-back": {
			// 1. top overlay
			if (state.overlays.length > 0) {
				return {
					...state,
					overlays: state.overlays.slice(0, -1),
				};
			}
			const top = state.screens[state.screens.length - 1];
			// 2. settings subpage
			if (top.kind === "settings" && top.subpage !== null) {
				const screens = state.screens.map((s) =>
					s.kind === "settings" ? { ...s, subpage: null } : s,
				);
				return { ...state, screens };
			}
			// 3./4. pop screen or not consumed at Home
			if (state.screens.length <= 1) return state;
			return { ...state, screens: state.screens.slice(0, -1) };
		}
	}
}

/** True when handle-back would change state (i.e. system Back is
 * consumed by the web layer). Pure; the bridge tests this. */
export function backWouldConsume(state: NavigationState): boolean {
	if (state.overlays.length > 0) return true;
	const top = state.screens[state.screens.length - 1];
	if (top.kind === "settings" && top.subpage !== null) return true;
	return state.screens.length > 1;
}
