import { backend, idForSource } from "@/lib/backend";
import { normalizeRecents } from "@/lib/recents";
import { isFallbackDisplayName, realNameFromPath } from "@/lib/sniff";
import { type RecentsEntry, STORAGE_KEYS } from "@/lib/types";
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
import { useSettings } from "./SettingsContext";

interface RecentsContextValue {
	entries: RecentsEntry[];
	ready: boolean;
	recordOpen: (
		entry: Omit<RecentsEntry, "id" | "addedAt" | "lastOpenedAt" | "pinned">,
	) => void;
	updatePosition: (id: string, position: RecentsEntry["position"]) => void;
	togglePin: (id: string) => void;
	remove: (id: string) => void;
	clearAll: () => RecentsEntry[];
	restore: (previous: RecentsEntry[]) => void;
	/** Mark a recent as failing to reopen; the dashboard offers
	 * repair/remove instead of a healthy-looking entry. */
	markUnavailable: (id: string) => void;
	/** Repair: re-point an existing recent at a newly picked source,
	 * keeping its history and position instead of duplicating. */
	replaceSource: (
		id: string,
		update: Pick<RecentsEntry, "name" | "format" | "size" | "source"> & {
			reopen?: RecentsEntry["reopen"];
		},
	) => void;
	/** Replace a stored generic display name with a learned real one
	 * (docs/15 #1). No-op when the entry no longer holds a fallback
	 * name, so a healed name is never overwritten. */
	applyNameHeal: (id: string, name: string) => void;
}

const RecentsContext = createContext<RecentsContextValue | null>(null);

export function RecentsProvider({ children }: { children: ReactNode }) {
	const { settings } = useSettings();
	const [entries, setEntries] = useState<RecentsEntry[]>([]);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		backend
			.storeGet(STORAGE_KEYS.recents)
			.then((stored) => {
				if (cancelled) return;
				const normalized = normalizeRecents(stored);
				setEntries(normalized);
				if (
					Array.isArray(stored) &&
					JSON.stringify(normalized) !== JSON.stringify(stored)
				) {
					backend.storeSet(STORAGE_KEYS.recents, normalized).catch(() => {});
				}
				setReady(true);
			})
			.catch(() => setReady(true));
		return () => {
			cancelled = true;
		};
	}, []);

	const persist = useCallback((next: RecentsEntry[]) => {
		backend.storeSet(STORAGE_KEYS.recents, next).catch(() => {});
	}, []);

	// Only the recents-relevant settings may take part in these
	// identities (docs/15 #2): depending on the whole settings object
	// made every appearance change (theme, pure black) replace the
	// callbacks, and the viewer's read effect — which depends on
	// recordOpen — restarted the byte read whenever the theme changed.
	// The limit lives behind a ref for the same reason: changing
	// "keep N recents" in Settings must not re-read the document the
	// user is currently reading (the read effect depends on
	// recordOpen's identity).
	const saveRecents = settings["files.save_recents"];
	const recentsLimit = settings["files.recents_limit"];
	const recentsSettingsRef = useRef({ saveRecents, recentsLimit });
	recentsSettingsRef.current = { saveRecents, recentsLimit };

	/** Delete the managed copies of entries that left the list.
	 * Fire-and-forget hygiene: a failed eviction stays visible in
	 * Settings storage stats rather than blocking the UI. */
	const evictManagedCopies = useCallback((removed: RecentsEntry[]) => {
		const names = removed
			.map((e) =>
				e.reopen?.kind === "managed-copy"
					? e.reopen.path.split(/[\\/]/).pop()
					: null,
			)
			.filter((n): n is string => !!n);
		if (names.length > 0) {
			backend.removeManagedCopies(names).catch(() => {});
		}
	}, []);

	const recordOpen = useCallback<RecentsContextValue["recordOpen"]>(
		(entry) => {
			if (!recentsSettingsRef.current.saveRecents) return;
			const id = idForSource(entry.source);
			const now = Date.now();
			setEntries((prev) => {
				const { recentsLimit: limit } = recentsSettingsRef.current;
				const existing = prev.find((e) => e.id === id);
				let next: RecentsEntry[];
				let evicted: RecentsEntry[];
				if (existing) {
					next = prev.map((e) =>
						e.id === id
							? // A successful open clears any stale unavailable mark
								// (the entry healed — it must not stay dimmed).
								{ ...e, ...entry, lastOpenedAt: now, unavailable: undefined }
							: e,
					);
					evicted = [];
				} else {
					next = [
						{ ...entry, id, addedAt: now, lastOpenedAt: now, pinned: false },
						...prev,
					];
					evicted = [];
				}
				if (limit > 0) {
					const keepUnpinned = next
						.filter((e) => !e.pinned)
						.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
						.slice(0, limit);
					const keptIds = new Set(keepUnpinned.map((e) => e.id));
					evicted = next.filter((e) => !e.pinned && !keptIds.has(e.id));
					next = [...next.filter((e) => e.pinned), ...keepUnpinned];
				}
				persist(next);
				if (evicted.length > 0) evictManagedCopies(evicted);
				return next;
			});
		},
		[persist, evictManagedCopies],
	);

	const updatePosition = useCallback<RecentsContextValue["updatePosition"]>(
		(id, position) => {
			if (!saveRecents) return;
			setEntries((prev) => {
				const next = prev.map((e) =>
					e.id === id
						? // Versioned payloads REPLACE the stored position:
							// shallow-merging an old {page,zoom} shape with a new
							// versioned shape (or a different viewer's kind) would
							// leave obsolete fields behind (audit section 8).
							{ ...e, position }
						: e,
				);
				persist(next);
				return next;
			});
		},
		[persist, saveRecents],
	);

	const togglePin = useCallback<RecentsContextValue["togglePin"]>(
		(id) => {
			setEntries((prev) => {
				const next = prev.map((e) =>
					e.id === id ? { ...e, pinned: !e.pinned } : e,
				);
				persist(next);
				return next;
			});
		},
		[persist],
	);

	const remove = useCallback<RecentsContextValue["remove"]>(
		(id) => {
			setEntries((prev) => {
				const victim = prev.find((e) => e.id === id);
				if (victim) evictManagedCopies([victim]);
				const next = prev.filter((e) => e.id !== id);
				persist(next);
				return next;
			});
		},
		[persist, evictManagedCopies],
	);

	const markUnavailable = useCallback<RecentsContextValue["markUnavailable"]>(
		(id) => {
			setEntries((prev) => {
				const next = prev.map((e) =>
					e.id === id ? { ...e, unavailable: true } : e,
				);
				persist(next);
				return next;
			});
		},
		[persist],
	);

	const replaceSource = useCallback<RecentsContextValue["replaceSource"]>(
		(id, update) => {
			setEntries((prev) => {
				const next = prev.map((e) =>
					e.id === id
						? {
								...e,
								...update,
								unavailable: undefined,
								lastOpenedAt: Date.now(),
							}
						: e,
				);
				persist(next);
				return next;
			});
		},
		[persist],
	);

	const applyNameHeal = useCallback<RecentsContextValue["applyNameHeal"]>(
		(id, name) => {
			setEntries((prev) => {
				const next = prev.map((e) =>
					e.id === id && isFallbackDisplayName(e.name) ? { ...e, name } : e,
				);
				persist(next);
				return next;
			});
		},
		[persist],
	);

	const clearAll = useCallback<RecentsContextValue["clearAll"]>(() => {
		const previous = entries;
		setEntries(() => {
			persist([]);
			return [];
		});
		return previous;
	}, [entries, persist]);

	const restore = useCallback<RecentsContextValue["restore"]>(
		(previous) => {
			setEntries(() => {
				persist(previous);
				return previous;
			});
		},
		[persist],
	);

	// Turning recents off wipes the list immediately (docs/08) — and
	// evicts the managed copies with it: "stop keeping history" also
	// means stop keeping the reopen-critical files. "Clear all" in the
	// UI does NOT evict: its snackbar offers Undo, and a restored
	// recent pointing at a deleted file would be a broken promise.
	useEffect(() => {
		if (ready && !saveRecents && entries.length > 0) {
			evictManagedCopies(entries);
			setEntries([]);
			persist([]);
		}
	}, [ready, saveRecents, entries, persist, evictManagedCopies]);

	// Name healing at the dashboard (docs/15 #1): entries stored with a
	// generic label get their real name back WITHOUT requiring a
	// reopen. Managed copies and desktop paths carry the original name
	// in their basename (sync); content:// URIs re-query the provider
	// through the Android bridge (async, retried while the bridge
	// finishes installing). Each entry is attempted once per session;
	// applyNameHeal refuses to overwrite a name that is no longer a
	// fallback, so a learned real name is never clobbered.
	const entriesRef = useRef(entries);
	useEffect(() => {
		entriesRef.current = entries;
	}, [entries]);

	const applyNameHealRef = useRef(applyNameHeal);
	useEffect(() => {
		applyNameHealRef.current = applyNameHeal;
	}, [applyNameHeal]);

	const healTried = useRef<Set<string>>(new Set());
	const healRetryTimer = useRef<number | null>(null);

	useEffect(() => {
		if (!ready) return;
		const contentQueue: Array<{ id: string; uri: string }> = [];
		for (const e of entries) {
			if (healTried.current.has(e.id)) continue;
			if (!isFallbackDisplayName(e.name)) continue;
			healTried.current.add(e.id);
			const reopen = e.reopen;
			if (reopen?.kind === "managed-copy" || reopen?.kind === "desktop-path") {
				const healed = realNameFromPath(reopen.path);
				if (healed) applyNameHealRef.current(e.id, healed);
			} else if (reopen?.kind === "persisted-uri") {
				contentQueue.push({ id: e.id, uri: reopen.uri });
			}
		}
		if (contentQueue.length === 0) return;
		let attempt = 0;
		const tick = async () => {
			attempt += 1;
			let unresolved = 0;
			for (const { id, uri } of contentQueue) {
				const current = entriesRef.current.find((e) => e.id === id);
				if (!current || !isFallbackDisplayName(current.name)) continue;
				const name = await backend
					.resolveContentName(uri)
					.catch(() => null)
					.then((n) => (n && !isFallbackDisplayName(n) ? n : null));
				if (name) {
					applyNameHealRef.current(id, name);
				} else {
					unresolved += 1;
				}
			}
			if (unresolved > 0 && attempt < 3) {
				healRetryTimer.current = window.setTimeout(tick, 2500);
			}
		};
		tick();
	}, [ready, entries]);

	// The retry timer survives entries changes on purpose (each tick
	// re-checks live names before writing); it is cancelled only when
	// the provider unmounts.
	useEffect(() => {
		return () => {
			if (healRetryTimer.current !== null) {
				window.clearTimeout(healRetryTimer.current);
				healRetryTimer.current = null;
			}
		};
	}, []);

	const sorted = useMemo(
		() =>
			[...entries].sort((a, b) => {
				if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
				return b.lastOpenedAt - a.lastOpenedAt;
			}),
		[entries],
	);

	const value = useMemo(
		() => ({
			entries: sorted,
			ready,
			recordOpen,
			updatePosition,
			togglePin,
			remove,
			clearAll,
			restore,
			markUnavailable,
			replaceSource,
			applyNameHeal,
		}),
		[
			sorted,
			ready,
			recordOpen,
			updatePosition,
			togglePin,
			remove,
			clearAll,
			restore,
			markUnavailable,
			replaceSource,
			applyNameHeal,
		],
	);

	return (
		<RecentsContext.Provider value={value}>{children}</RecentsContext.Provider>
	);
}

export function useRecents(): RecentsContextValue {
	const ctx = useContext(RecentsContext);
	if (!ctx) throw new Error("useRecents must be used inside RecentsProvider");
	return ctx;
}
