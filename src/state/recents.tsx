import { backend, managedRelPath, onDocumentKept } from "@/lib/backend";
import { isDesktop, isTauri } from "@/lib/env";
import { isOpaqueName } from "@/lib/formats";
import { openDocuments, openManagedPaths, watchOpen } from "@/lib/openFiles";
import {
	PICK_GRACE,
	capOrigins,
	cleanPosition,
	idForReopen,
	migrateLegacyRecents,
	normalizeGrants,
	normalizeRecents,
	originsChanged,
	recordOpen as recordOpenPure,
	renameRecent,
	sortRecents,
	strayGrants,
	updateEntry,
} from "@/lib/recents";
import { createStoredValue, storeFailed } from "@/lib/storedValue";
import { forgetThumb, moveThumb } from "@/lib/thumbs";
import {
	type Position,
	type RecentEntry,
	type Reopen,
	STORAGE_KEYS,
} from "@/lib/types";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { moveBookmarks } from "./bookmarks";
import { useSettingsOf, useSettingsReady } from "./settings";
import { type Store, createStore, useSelect } from "./store";

interface RecentsApi extends RecentsActions {
	entries: RecentEntry[];
	ready: boolean;
}

interface RecentsActions {
	record: (entry: Omit<RecentEntry, "pinned" | "openedAt">) => void;
	/** Where the reader is in `id`. Kept apart from the list until
	 * flushPositions (or a pause of a few seconds). */
	setPosition: (id: string, position: Position) => void;
	/** Where the reader was in `id`: the latest position, put in the
	 * list yet or not. */
	positionOf: (id: string) => Position | undefined;
	/** Put the positions kept apart in the list (and storage) now. */
	flushPositions: () => void;
	/** The list as it is now, for a handler. */
	list: () => RecentEntry[];
	togglePin: (id: string) => void;
	markUnavailable: (id: string) => void;
	/** Removes one entry and returns the list as it was, for Undo. The
	 * copies the entry held are kept until that list is restored or
	 * settled. */
	remove: (id: string) => RecentEntry[];
	/** Clears the list and returns it for Undo (kept the same way). */
	clear: () => RecentEntry[];
	/** Puts back whatever of `entries` is no longer in the list. */
	restore: (entries: RecentEntry[]) => void;
	/** The chance to undo the change that returned `entries` has passed
	 * (its Undo message went): let go of the copies it took out. */
	settle: (entries: RecentEntry[]) => void;
	/** A file was given a new name (and, on a desktop, a new path): its
	 * entry and bookmarks follow it. Returns the id it has now. */
	rename: (id: string, name: string, reopen: Reopen) => string;
}

/** How long the copies of a list cleared with no Undo on this screen
 * (recents turned off in another window) outlive it. A change made here
 * keeps them for as long as its Undo message is up instead (settle). */
const UNDO_MS = 6000;

/** On a desktop every document opened from the file manager is its own
 * window of the app, and they all keep one list. A window that wrote
 * the list as it remembered it would erase what the others had added,
 * so there a change is made to the list as it is in the store now. (A
 * phone runs one copy of the app; its list is written as it stands.) */
const SHARED = isTauri && isDesktop;

const RecentsContext = createContext<RecentsApi | null>(null);
/** What never changes: the actions, and the stores behind the narrow
 * readers. Nobody is drawn again through it. */
const RecentsFixedContext = createContext<{
	actions: RecentsActions;
	stores: { entries: Store<RecentEntry[]>; ready: Store<boolean> };
} | null>(null);

/** A pause in reading this long puts where the reader is in the list. */
const POSITION_IDLE = 5000;

/** Positions not yet in the stored list, also kept where a write is
 * immediate and small (the web view's own storage): a window closed,
 * or an app stopped, moments after the reader moved still opens there
 * the next time. Taken off once the list with them is written. */
const UNSAVED_KEY = "paperwren.positions-unsaved";

function unsavedRaw(): Record<string, unknown> {
	try {
		const raw = JSON.parse(localStorage.getItem(UNSAVED_KEY) ?? "{}");
		return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	} catch {
		return {};
	}
}
function writeUnsaved(all: Record<string, unknown>) {
	try {
		if (Object.keys(all).length)
			localStorage.setItem(UNSAVED_KEY, JSON.stringify(all));
		else localStorage.removeItem(UNSAVED_KEY);
	} catch {
		// No storage (a private window): the list still has the last pause.
	}
}
function noteUnsaved(id: string, position: Position) {
	writeUnsaved({ ...unsavedRaw(), [id]: position });
}
function forgetUnsaved(moves: Map<string, Position>) {
	const all = unsavedRaw();
	for (const [id, position] of moves)
		if (JSON.stringify(all[id]) === JSON.stringify(position)) delete all[id];
	writeUnsaved(all);
}
function readUnsaved(): Array<[string, Position]> {
	const out: Array<[string, Position]> = [];
	for (const [id, value] of Object.entries(unsavedRaw())) {
		const position = cleanPosition(value);
		if (position) out.push([id, position]);
	}
	return out;
}

/** How long after a change housekeeping runs (copies over the cap,
 * picked documents' access no entry took up). */
const HOUSEKEEP_MS = 5000;

/** This run's start: access taken at a pick in an earlier run, and
 * still not named by the list, has nobody left to use it. */
const STARTED = Date.now();

/** Access to picked documents taken at the pick ("Open file" opens a
 * document where it is), until Recent files names them: lib/recents
 * strayGrants. Only written on a phone. */
const pickedGrants = createStoredValue<Record<string, number>>({
	key: "picked_grants_v1",
	initial: {},
	normalize: normalizeGrants,
});
onDocumentKept((uri) => {
	const at = Date.now();
	void pickedGrants.load();
	pickedGrants.edit((all) => ({ ...all, [uri]: at }));
});

/** Housekeeping beyond the first run after starting is for a phone: it
 * stays alive for days, and its copies and access build up meanwhile. */
const onPhone = () => !!window.__paperwrenAndroid;

function managedPaths(entries: RecentEntry[]): string[] {
	return entries
		.map((e) =>
			e.reopen.kind === "managed" ? managedRelPath(e.reopen.path) : null,
		)
		.filter((p): p is string => !!p);
}

async function load(): Promise<RecentEntry[]> {
	const stored = await backend.storeGet(STORAGE_KEYS.recents).catch(() => null);
	if (stored) return normalizeRecents(stored);
	const legacy = await backend
		.storeGet(STORAGE_KEYS.legacyRecents)
		.catch(() => null);
	if (!legacy) return [];
	const migrated = migrateLegacyRecents(legacy);
	backend.storeSet(STORAGE_KEYS.recents, migrated).catch(() => {});
	return migrated;
}

export function RecentsProvider({ children }: { children: ReactNode }) {
	const settings = useSettingsOf("recentsLimit", "keepRecents");
	const settingsReady = useSettingsReady();
	// In stores, so a reader of one thing about the list (is it read,
	// is this file in it) is not drawn again at every change of it.
	const [stores] = useState(() => ({
		entries: createStore<RecentEntry[]>([]),
		ready: createStore(false),
	}));
	const entries = useSyncExternalStore(
		stores.entries.subscribe,
		stores.entries.get,
	);
	const ready = useSyncExternalStore(stores.ready.subscribe, stores.ready.get);
	const limitRef = useRef(settings.recentsLimit);
	limitRef.current = settings.recentsLimit;
	const keepRef = useRef(settings.keepRecents);
	keepRef.current = settings.keepRecents;

	// The list as of the last change, readable at once: two changes in
	// one tick must each see the other.
	const current = useRef(entries);
	const apply = useCallback(
		(next: RecentEntry[]) => {
			current.current = next;
			stores.entries.set(next);
		},
		[stores],
	);

	const writing = useRef<Promise<unknown>>(Promise.resolve());
	/** The last change written out (or failed to be). */
	const saved = useRef<Promise<boolean>>(Promise.resolve(true));
	/** Changes made here so far: a read of the store begun before one of
	 * them is older than what is shown. */
	const changes = useRef(0);

	// Coming back to this window, show what the other windows did since.
	useEffect(() => {
		if (!SHARED || !ready) return;
		const refresh = () => {
			const before = changes.current;
			writing.current = writing.current
				.then(() => backend.storeGet(STORAGE_KEYS.recents))
				.then((stored) => {
					// A change made here meanwhile is written after this read,
					// onto the list as it is then: this one would hide it, so a
					// read after that write is shown instead.
					if (changes.current !== before) return refresh();
					const there = stored ? normalizeRecents(stored) : [];
					if (JSON.stringify(there) !== JSON.stringify(current.current))
						apply(there);
				})
				.catch(() => {});
		};
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [ready, apply]);

	/** Copies an undoable change took out, kept until its Undo is gone:
	 * by the list it returned. */
	const held = useRef(new Map<RecentEntry[], () => void>());
	/** Ids being renamed: their picture moves, it is not forgotten. */
	const renaming = useRef(new Set<string>());
	/** Changes asked for before the list was read: made once it is, so
	 * nothing is written over a list that has not been seen. */
	const early = useRef<
		Array<[(prev: RecentEntry[]) => RecentEntry[], boolean]>
	>([]);

	/** Write the change `fn` made. One that fails is said, with Try
	 * again; the list shown keeps it. */
	const persist = useCallback(function persist(
		fn: (prev: RecentEntry[]) => RecentEntry[],
	) {
		let done: Promise<unknown>;
		if (SHARED) {
			// One after another, so two changes never read the same list.
			done = writing.current
				.then(() => backend.storeGet(STORAGE_KEYS.recents))
				.then((stored) => {
					const there = stored ? normalizeRecents(stored) : [];
					const merged = fn(there);
					return merged === there
						? undefined
						: backend.storeSet(STORAGE_KEYS.recents, merged);
				});
			writing.current = done.catch(() => {});
		} else done = backend.storeSet(STORAGE_KEYS.recents, current.current);
		saved.current = done.then(
			() => true,
			() => {
				storeFailed(() => persist(fn));
				return false;
			},
		);
	}, []);

	/** Every mutation goes through here: state, persistence, and
	 * deletion of managed copies nothing references any more. An
	 * `undoable` change keeps those copies until its list is restored or
	 * settled, so Undo restores entries that still open. Returns the list
	 * as it was. */
	const commit = useCallback(
		(fn: (prev: RecentEntry[]) => RecentEntry[], undoable = false) => {
			const prev = current.current;
			if (!stores.ready.get()) {
				early.current.push([fn, undoable]);
				return prev;
			}
			const next = fn(prev);
			if (next === prev) return prev;
			changes.current++;
			apply(next);
			persist(fn);
			// A picked document the list now names is held over restarts
			// (so it can still be opened and renamed); one it no longer names
			// is let go, with its copy and its picture.
			for (const uri of originsChanged(prev, next).kept)
				void backend.keepDocument(uri);
			const release = () => {
				const now = current.current;
				// A copy still open in a tab or a tool stays; housekeeping
				// deletes it once it is closed.
				const kept = new Set([...managedPaths(now), ...openManagedPaths()]);
				const dropped = managedPaths(prev).filter((p) => !kept.has(p));
				if (dropped.length) backend.importsRemove(dropped).catch(() => {});
				// An open document keeps being readable this run: giving back
				// access over restarts leaves the access of the pick.
				for (const uri of originsChanged(prev, now).released)
					backend.releaseDocument(uri);
				// Pictures of entries that left, the limit's too; a renamed
				// one's picture moves to its new id instead (rename).
				const ids = new Set(now.map((e) => e.id));
				for (const e of prev)
					if (!ids.has(e.id) && !renaming.current.has(e.id)) forgetThumb(e.id);
			};
			if (undoable) held.current.set(prev, release);
			else release();
			return prev;
		},
		[apply, persist, stores],
	);

	useEffect(() => {
		let alive = true;
		load().then((list) => {
			if (!alive) return;
			apply(list);
			stores.ready.set(true);
			// What was asked for meanwhile (a document read before the list
			// came), now onto the list as stored.
			const asked = early.current.splice(0);
			for (const [fn, undoable] of asked) commit(fn, undoable);
		});
		return () => {
			alive = false;
		};
	}, [apply, commit, stores]);

	// Housekeeping: copies nothing names or has open go, and the size cap
	// evicts the least wanted named ones (the list's oldest; open ones
	// last), which then show as unavailable. Access taken at a pick that
	// no entry took up is given back. Once after starting, when Home has
	// settled; on a phone also a few seconds after each opening or
	// closing, as the app stays alive for days.
	const alive = useRef(true);
	const housekeeper = useRef({ timer: 0, busy: false, again: false });
	const schedule = useRef<(delay?: number) => void>(() => {});
	const settleGrants = useCallback(async () => {
		if (!window.__paperwrenAndroidExtras) return;
		await pickedGrants.load();
		const pending = pickedGrants.value.get();
		if (!Object.keys(pending).length) return;
		const open = openDocuments();
		const { release, settled } = strayGrants(
			pending,
			current.current,
			open,
			Date.now(),
			STARTED,
		);
		for (const uri of release) backend.releaseDocument(uri);
		if (settled.length) {
			// Only as seen: the same document picked again since is new.
			const seen = settled.map((uri) => [uri, pending[uri]] as const);
			pickedGrants.edit((all) => {
				const next = { ...all };
				for (const [uri, at] of seen) if (next[uri] === at) delete next[uri];
				return next;
			});
		}
		// One still in its first moments is looked at again after them.
		const done = new Set([...settled, ...open]);
		if (Object.keys(pending).some((uri) => !done.has(uri)))
			schedule.current(PICK_GRACE);
	}, []);
	const housekeep = useCallback(async () => {
		const state = housekeeper.current;
		if (state.busy) {
			state.again = true;
			return;
		}
		state.busy = true;
		try {
			// What is open first: the cap evicts it last.
			const evicted = await backend
				.importsPrune([...openManagedPaths(), ...managedPaths(current.current)])
				.catch(() => []);
			if (alive.current && evicted.length) {
				const gone = new Set(evicted);
				apply(
					current.current.map((e) =>
						e.reopen.kind === "managed" &&
						gone.has(managedRelPath(e.reopen.path) ?? "")
							? { ...e, unavailable: true }
							: e,
					),
				);
			}
			await settleGrants().catch(() => {});
		} finally {
			state.busy = false;
			if (state.again && alive.current) {
				state.again = false;
				schedule.current();
			}
		}
	}, [apply, settleGrants]);
	schedule.current = (delay = HOUSEKEEP_MS) => {
		const state = housekeeper.current;
		if (!stores.ready.get() || !onPhone()) return;
		window.clearTimeout(state.timer);
		state.timer = window.setTimeout(() => void housekeep(), delay);
	};
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			window.clearTimeout(housekeeper.current.timer);
		};
	}, []);
	// A document or a tool closed: its copy and access may go now.
	useEffect(() => watchOpen(() => schedule.current()), []);

	// Wait until Home has settled; use the latest list if it changed meanwhile.
	useEffect(() => {
		if (!ready) return;
		const idle = typeof window.requestIdleCallback === "function";
		const id = idle
			? window.requestIdleCallback(() => void housekeep(), { timeout: 4000 })
			: window.setTimeout(() => void housekeep(), 4000);
		return () => {
			if (idle) window.cancelIdleCallback(id);
			else window.clearTimeout(id);
		};
	}, [ready, housekeep]);

	// Name healing: entries saved with a fallback name ("PDF
	// document.pdf", or an id from an older build) ask the Android
	// provider again, a few times while the bridge comes up.
	useEffect(() => {
		if (!ready) return;
		let attempt = 0;
		let timer = 0;
		const heal = () => {
			const fixes: Array<[string, string]> = [];
			for (const e of current.current) {
				if (e.reopen.kind !== "uri") continue;
				if (e.nameVerified !== false && !isOpaqueName(e.name)) continue;
				const name = backend.providerName(e.reopen.uri);
				if (name && !isOpaqueName(name)) fixes.push([e.id, name]);
			}
			if (fixes.length) {
				commit((prev) =>
					prev.map((e) => {
						const fix = fixes.find(([id]) => id === e.id);
						return fix ? { ...e, name: fix[1], nameVerified: undefined } : e;
					}),
				);
			}
			if (++attempt < 4) timer = window.setTimeout(heal, attempt * 1500);
		};
		heal();
		return () => window.clearTimeout(timer);
	}, [ready, commit]);

	// Turning recents off clears them (and, once the chance to undo has
	// passed, their managed copies). Settings clears them itself, with an
	// Undo; this is for a change heard from another window.
	useEffect(() => {
		if (!settingsReady || !ready || settings.keepRecents) return;
		const before = commit((prev) => (prev.length ? [] : prev), true);
		const timer = window.setTimeout(() => {
			const release = held.current.get(before);
			held.current.delete(before);
			release?.();
		}, UNDO_MS);
		return () => window.clearTimeout(timer);
	}, [settingsReady, ready, settings.keepRecents, commit]);

	const record = useCallback<RecentsApi["record"]>(
		(entry) => {
			// A phone's copy (or access to a picked document) came in: the
			// cap is kept while the app stays alive, not only at the next
			// start. With Recent files off, nothing names it, so it goes
			// once it is closed.
			schedule.current();
			if (!keepRef.current) return;
			commit((prev) =>
				capOrigins(
					recordOpenPure(prev, entry, Date.now(), limitRef.current).list,
				),
			);
		},
		[commit],
	);

	// Where the reader is changes at every pause while reading. Each change
	// put in the list drew Home and every reader of the list again and
	// wrote the whole list out, so they wait here, and go in together
	// when the document is left, the app is put away, or reading has
	// paused for a while.
	const pending = useRef(new Map<string, Position>());
	const idle = useRef(0);
	const flushPositions = useCallback(() => {
		window.clearTimeout(idle.current);
		// Until the list is read, there is nothing to put them in.
		if (!pending.current.size || !stores.ready.get()) return;
		const moves = new Map(pending.current);
		pending.current.clear();
		// No re-sort: where the reader is does not change the order.
		commit((prev) => {
			let moved = false;
			const next = prev.map((e) => {
				const position = moves.get(e.id);
				if (!position || position === e.position) return e;
				moved = true;
				return { ...e, position };
			});
			return moved ? next : prev;
		});
		// Kept apart until the list with them is written.
		void saved.current.then((ok) => ok && forgetUnsaved(moves));
	}, [commit, stores]);

	const setPosition = useCallback<RecentsApi["setPosition"]>(
		(id, position) => {
			if (!keepRef.current) return;
			pending.current.set(id, position);
			noteUnsaved(id, position);
			window.clearTimeout(idle.current);
			idle.current = window.setTimeout(flushPositions, POSITION_IDLE);
		},
		[flushPositions],
	);

	const positionOf = useCallback<RecentsApi["positionOf"]>(
		(id) =>
			pending.current.get(id) ??
			current.current.find((e) => e.id === id)?.position,
		[],
	);
	const list = useCallback(() => current.current, []);

	// Positions a run before this one had not put in the list (it was
	// closed or stopped moments after the reader moved) go in now.
	useEffect(() => {
		if (!ready) return;
		for (const [id, position] of readUnsaved())
			if (!pending.current.has(id)) pending.current.set(id, position);
		flushPositions();
	}, [ready, flushPositions]);

	// And the app put away (Android: another app, the home screen) or
	// the page going.
	useEffect(() => {
		const hide = () => {
			if (document.visibilityState === "hidden") flushPositions();
		};
		document.addEventListener("visibilitychange", hide);
		window.addEventListener("pagehide", flushPositions);
		return () => {
			document.removeEventListener("visibilitychange", hide);
			window.removeEventListener("pagehide", flushPositions);
			flushPositions();
		};
	}, [flushPositions]);

	const togglePin = useCallback<RecentsApi["togglePin"]>(
		(id) =>
			void commit((prev) =>
				updateEntry(prev, id, {
					pinned: !prev.find((e) => e.id === id)?.pinned,
				}),
			),
		[commit],
	);
	const markUnavailable = useCallback<RecentsApi["markUnavailable"]>(
		(id) => void commit((prev) => updateEntry(prev, id, { unavailable: true })),
		[commit],
	);
	const remove = useCallback<RecentsApi["remove"]>(
		(id) => {
			forgetThumb(id);
			return commit(
				(prev) =>
					prev.some((e) => e.id === id)
						? prev.filter((e) => e.id !== id)
						: prev,
				true,
			);
		},
		[commit],
	);
	const clear = useCallback(
		() =>
			commit((prev) => {
				for (const entry of prev) forgetThumb(entry.id);
				return prev.length ? [] : prev;
			}, true),
		[commit],
	);
	const restore = useCallback<RecentsApi["restore"]>(
		(list) => {
			// Its copies are named again: nothing to let go.
			held.current.delete(list);
			commit((prev) => {
				const missing = list.filter((e) => !prev.some((p) => p.id === e.id));
				return missing.length ? sortRecents([...prev, ...missing]) : prev;
			});
		},
		[commit],
	);
	const settle = useCallback<RecentsApi["settle"]>((list) => {
		const release = held.current.get(list);
		held.current.delete(list);
		release?.();
	}, []);

	const rename = useCallback<RecentsApi["rename"]>(
		(id, name, reopen) => {
			// An id comes from where the file is: a file renamed where it is
			// has a new one, and what is kept by it moves along; a copy the
			// app holds keeps its own.
			const now = idForReopen(reopen);
			renaming.current.add(id);
			try {
				commit((prev) => renameRecent(prev, id, name, reopen).list);
			} finally {
				renaming.current.delete(id);
			}
			moveBookmarks(id, now);
			moveThumb(id, now);
			const position = pending.current.get(id);
			if (position && now !== id) {
				pending.current.delete(id);
				pending.current.set(now, position);
				noteUnsaved(now, position);
			}
			return now;
		},
		[commit],
	);

	const actions = useMemo<RecentsActions>(
		() => ({
			record,
			setPosition,
			positionOf,
			flushPositions,
			list,
			togglePin,
			markUnavailable,
			remove,
			clear,
			restore,
			settle,
			rename,
		}),
		[
			record,
			setPosition,
			positionOf,
			flushPositions,
			list,
			togglePin,
			markUnavailable,
			remove,
			clear,
			restore,
			settle,
			rename,
		],
	);
	const api = useMemo(
		() => ({ entries, ready, ...actions }),
		[entries, ready, actions],
	);
	const fixed = useMemo(() => ({ actions, stores }), [actions, stores]);
	return (
		<RecentsFixedContext.Provider value={fixed}>
			<RecentsContext.Provider value={api}>{children}</RecentsContext.Provider>
		</RecentsFixedContext.Provider>
	);
}

/** The list and everything that changes it: the reader is drawn again
 * at every change of the list. */
export function useRecents(): RecentsApi {
	const ctx = useContext(RecentsContext);
	if (!ctx) throw new Error("useRecents must be used inside RecentsProvider");
	return ctx;
}

function useFixed() {
	const ctx = useContext(RecentsFixedContext);
	if (!ctx) throw new Error("recents read outside RecentsProvider");
	return ctx;
}

/** What changes the list, and `list()` to read it in a handler: the same
 * functions at every render, so the reader is never drawn again for
 * them. */
export function useRecentsActions(): RecentsActions {
	return useFixed().actions;
}

/** Whether the list has been read from storage. */
export function useRecentsReady(): boolean {
	return useSelect(useFixed().stores.ready, (ready) => ready);
}

/** Whether the file of `id` is in the list. */
export function useIsRecent(id: string): boolean {
	return useSelect(useFixed().stores.entries, (list) =>
		list.some((e) => e.id === id),
	);
}
