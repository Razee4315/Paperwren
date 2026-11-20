import type { Screen } from "@/lib/navigation";
import { createContext, useContext, useEffect, useRef } from "react";

/**
 * "Can I leave?": one check that every way out of a screen asks first.
 *
 * A screen or a tool with work that leaving would lose (a form being
 * filled, pages put in a new order, marks on a file with a password)
 * holds a guard while it has that work. Whatever takes it away (Back,
 * the close arrow, Ctrl+W, a tab's X, the window closing) asks the
 * guards where it is going; each shows its "Leave without saving?", and
 * the leaving goes on only once every one has been answered Discard.
 */

/** A guard's question: show it, and call `go` on Discard. Keep editing
 * just closes the question, and nothing leaves. */
export type Ask = (go: () => void) => void;

/** Where a guard is: one screen of the stack, or one desktop tab. */
export const LeaveScope = createContext("app");

/** The scope of a screen in the stack: a document's is its key, so a
 * desktop tab and its screen are one. */
export function screenScope(screen: Screen | undefined, index: number) {
	if (!screen) return "none";
	return screen.kind === "viewer"
		? docScope(screen.key)
		: `${screen.kind}:${index}`;
}
export const docScope = (key: number) => `doc:${key}`;

interface Guard {
	scope: string;
	ask: Ask;
}
/** In the order they were taken: the last is the innermost (a tool
 * over the document it was opened from). */
const guards: Guard[] = [];
const listeners = new Set<() => void>();
let scopes = "";
const emit = () => {
	scopes = [...new Set(guards.map((guard) => guard.scope))].sort().join(" ");
	for (const listener of [...listeners]) listener();
};

/** The question shown for a guard that has none of its own (the host
 * draws it; see ui/LeaveHost). */
let defaultAsk: Ask | null = null;
export function setDefaultAsk(ask: Ask | null) {
	defaultAsk = ask;
}

/** While `dirty`, leaving this screen asks first: `ask` shows the
 * question, or the app's own "Leave without saving?" when left out. */
export function useLeaveGuard(dirty: boolean, ask?: Ask) {
	const scope = useContext(LeaveScope);
	const askRef = useRef(ask);
	askRef.current = ask;
	useEffect(() => {
		if (!dirty) return;
		const guard: Guard = {
			scope,
			ask: (go) => {
				const own = askRef.current ?? defaultAsk;
				// Nothing can ask (no host yet): leaving goes on, as before.
				if (own) own(go);
				else go();
			},
		};
		guards.push(guard);
		emit();
		return () => {
			const at = guards.indexOf(guard);
			if (at >= 0) guards.splice(at, 1);
			emit();
		};
	}, [dirty, scope]);
}

/** Guards answered Discard, while the leaving they allowed runs: a
 * close that leaving makes on its way (Back that goes on to close the
 * document) does not ask the same thing again. */
const released = new Set<Guard>();

const within = (guard: Guard, where: string[] | null) =>
	!released.has(guard) && (!where || where.includes(guard.scope));

/** Whether leaving `where` (null: the whole window) would lose work. */
export function holdsWork(where: string[] | null = null): boolean {
	return guards.some((guard) => within(guard, where));
}

/**
 * Leave `where` (null: the whole window). With work there, each guard
 * asks in turn, the innermost first, and `go` runs once every one has
 * been answered Discard; `show` is told whose question is next, so it
 * can bring that document into view. With none, `go` runs at once.
 */
export function askLeave(
	where: string[] | null,
	go: () => void,
	show?: (scope: string) => void,
) {
	const asked = new Set<Guard>();
	const next = () => {
		const guard = [...guards]
			.reverse()
			.find((one) => !asked.has(one) && within(one, where));
		if (!guard) {
			for (const one of asked) released.add(one);
			try {
				go();
			} finally {
				window.setTimeout(() => {
					for (const one of asked) released.delete(one);
				});
			}
			return;
		}
		asked.add(guard);
		show?.(guard.scope);
		// On after the Discard has been drawn: a guard it cleared (Mark up
		// and the reader share one document's marks) has let go by then,
		// and is not asked the same thing twice.
		guard.ask(() => window.setTimeout(next));
	};
	next();
}

/** The scopes holding work now, as one string ("doc:3 tools:1"), for a
 * reader that keeps them drawn. */
export const guardedScopes = () => scopes;
export function onGuardsChange(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
