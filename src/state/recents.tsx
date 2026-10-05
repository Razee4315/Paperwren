import { backend, managedRelPath } from "@/lib/backend";
import { isDesktop, isTauri } from "@/lib/env";
import { isOpaqueName } from "@/lib/formats";
import {
	migrateLegacyRecents,
	normalizeRecents,
	recordOpen as recordOpenPure,
	sortRecents,
	updateEntry,
} from "@/lib/recents";
import { type Position, type RecentEntry, STORAGE_KEYS } from "@/lib/types";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSettings } from "./settings";

interface RecentsApi {
	entries: RecentEntry[];
	ready: boolean;
	record: (entry: Omit<RecentEntry, "pinned" | "openedAt">) => void;
	setPosition: (id: string, position: Position) => void;
	togglePin: (id: string) => void;
	markUnavailable: (id: string) => void;
	/** Removes one entry and returns the list as it was, for Undo. */
	remove: (id: string) => RecentEntry[];
	/** Clears the list and returns it for Undo. */
	clear: () => RecentEntry[];
	/** Puts back whatever of `entries` is no longer in the list. */
	restore: (entries: RecentEntry[]) => void;
}

/** How long a removed entry's managed copy outlives it, so the
 * snackbar's Undo can bring back an entry that still opens. */
const UNDO_MS = 6000;

/** On a desktop every document opened from the file manager is its own
 * window of the app, and they all keep one list. A window that wrote
 * the list as it remembered it would erase what the others had added,
 * so there a change is made to the list as it is in the store now. (A
 * phone runs one copy of the app; its list is written as it stands.) */
const SHARED = isTauri && isDesktop;

const RecentsContext = createContext<RecentsApi | null>(null);

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
	const { settings, ready: settingsReady } = useSettings();
	const [entries, setEntries] = useState<RecentEntry[]>([]);
	const [ready, setReady] = useState(false);
	const limitRef = useRef(settings.recentsLimit);
	limitRef.current = settings.recentsLimit;
	const keepRef = useRef(settings.keepRecents);
	keepRef.current = settings.keepRecents;

	// The list as of the last change, readable at once: two changes in
	// one tick must each see the other.
	const current = useRef(entries);
	const apply = useCallback((next: RecentEntry[]) => {
		current.current = next;
		setEntries(next);
	}, []);

	const writing = useRef<Promise<unknown>>(Promise.resolve());

	// Coming back to this window, show what the other windows did since.
	useEffect(() => {
		if (!SHARED || !ready) return;
		const refresh = () => {
			writing.current = writing.current
				.then(() => backend.storeGet(STORAGE_KEYS.recents))
				.then((stored) => {
					const there = stored ? normalizeRecents(stored) : [];
					if (JSON.stringify(there) !== JSON.stringify(current.current))
						apply(there);
				})
				.catch(() => {});
		};
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [ready, apply]);

	/** Every mutation goes through here: state, persistence, and
	 * deletion of managed copies nothing references any more. An
	 * `undoable` change keeps those copies for a moment, so Undo restores
	 * entries that still open. Returns the list as it was. */
	const commit = useCallback(
		(fn: (prev: RecentEntry[]) => RecentEntry[], undoable = false) => {
			const prev = current.current;
			const next = fn(prev);
			if (next === prev) return prev;
			apply(next);
			if (SHARED) {
				// One after another, so two changes never read the same list.
				writing.current = writing.current
					.then(() => backend.storeGet(STORAGE_KEYS.recents))
					.then((stored) => {
						const there = stored ? normalizeRecents(stored) : [];
						const merged = fn(there);
						return merged === there
							? undefined
							: backend.storeSet(STORAGE_KEYS.recents, merged);
					})
					.catch(() => {});
			} else backend.storeSet(STORAGE_KEYS.recents, next).catch(() => {});
			const release = () => {
				const kept = new Set(managedPaths(current.current));
				const dropped = managedPaths(prev).filter((p) => !kept.has(p));
				if (dropped.length) backend.importsRemove(dropped).catch(() => {});
			};
			if (undoable) window.setTimeout(release, UNDO_MS);
			else release();
			return prev;
		},
		[apply],
	);

	useEffect(() => {
		let alive = true;
		load().then(async (list) => {
			if (!alive) return;
			apply(list);
			setReady(true);
			// Housekeeping: orphaned copies go, and the size cap evicts the
			// oldest referenced ones, which then show as unavailable.
			const evicted = await backend
				.importsPrune(managedPaths(list))
				.catch(() => []);
			if (alive && evicted.length) {
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
		});
		return () => {
			alive = false;
		};
	}, [apply]);

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
	// passed, their managed copies).
	useEffect(() => {
		if (settingsReady && ready && !settings.keepRecents)
			commit((prev) => (prev.length ? [] : prev), true);
	}, [settingsReady, ready, settings.keepRecents, commit]);

	const record = useCallback<RecentsApi["record"]>(
		(entry) => {
			if (!keepRef.current) return;
			commit(
				(prev) =>
					recordOpenPure(prev, entry, Date.now(), limitRef.current).list,
			);
		},
		[commit],
	);

	const setPosition = useCallback<RecentsApi["setPosition"]>(
		(id, position) => {
			if (!keepRef.current) return;
			// Positions change constantly while reading; no re-sort needed.
			commit((prev) =>
				prev.some((e) => e.id === id)
					? prev.map((e) => (e.id === id ? { ...e, position } : e))
					: prev,
			);
		},
		[commit],
	);

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
		(id) =>
			commit(
				(prev) =>
					prev.some((e) => e.id === id)
						? prev.filter((e) => e.id !== id)
						: prev,
				true,
			),
		[commit],
	);
	const clear = useCallback(
		() => commit((prev) => (prev.length ? [] : prev), true),
		[commit],
	);
	const restore = useCallback<RecentsApi["restore"]>(
		(list) => {
			commit((prev) => {
				const missing = list.filter((e) => !prev.some((p) => p.id === e.id));
				return missing.length ? sortRecents([...prev, ...missing]) : prev;
			});
		},
		[commit],
	);

	const api = useMemo(
		() => ({
			entries,
			ready,
			record,
			setPosition,
			togglePin,
			markUnavailable,
			remove,
			clear,
			restore,
		}),
		[
			entries,
			ready,
			record,
			setPosition,
			togglePin,
			markUnavailable,
			remove,
			clear,
			restore,
		],
	);
	return (
		<RecentsContext.Provider value={api}>{children}</RecentsContext.Provider>
	);
}

export function useRecents(): RecentsApi {
	const ctx = useContext(RecentsContext);
	if (!ctx) throw new Error("useRecents must be used inside RecentsProvider");
	return ctx;
}
