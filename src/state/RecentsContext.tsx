import { backend, idForSource } from "@/lib/backend";
import { normalizeRecents } from "@/lib/recents";
import { type RecentsEntry, STORAGE_KEYS } from "@/lib/types";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
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

	const recordOpen = useCallback<RecentsContextValue["recordOpen"]>(
		(entry) => {
			if (!settings["files.save_recents"]) return;
			const id = idForSource(entry.source);
			const now = Date.now();
			setEntries((prev) => {
				const existing = prev.find((e) => e.id === id);
				let next: RecentsEntry[];
				if (existing) {
					next = prev.map((e) =>
						e.id === id ? { ...e, ...entry, lastOpenedAt: now } : e,
					);
				} else {
					next = [
						{ ...entry, id, addedAt: now, lastOpenedAt: now, pinned: false },
						...prev,
					];
				}
				const limit = settings["files.recents_limit"];
				if (limit > 0) {
					next = [
						...next.filter((e) => e.pinned),
						...next
							.filter((e) => !e.pinned)
							.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
							.slice(0, limit),
					];
				}
				persist(next);
				return next;
			});
		},
		[persist, settings],
	);

	const updatePosition = useCallback<RecentsContextValue["updatePosition"]>(
		(id, position) => {
			if (!settings["files.save_recents"]) return;
			setEntries((prev) => {
				const next = prev.map((e) =>
					e.id === id ? { ...e, position: { ...e.position, ...position } } : e,
				);
				persist(next);
				return next;
			});
		},
		[persist, settings],
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
				const next = prev.filter((e) => e.id !== id);
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

	// Turning recents off wipes the list immediately (docs/08).
	useEffect(() => {
		if (ready && !settings["files.save_recents"] && entries.length > 0) {
			setEntries([]);
			persist([]);
		}
	}, [ready, settings, entries.length, persist]);

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
