import { backend, managedRelPath } from "@/lib/backend";
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
	remove: (id: string) => void;
	/** Clears the list and returns it for Undo. */
	clear: () => RecentEntry[];
	restore: (entries: RecentEntry[]) => void;
}

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

	/** Every mutation goes through here: state, persistence, and
	 * deletion of managed copies nothing references any more. */
	const commit = useCallback((fn: (prev: RecentEntry[]) => RecentEntry[]) => {
		setEntries((prev) => {
			const next = fn(prev);
			if (next !== prev) {
				backend.storeSet(STORAGE_KEYS.recents, next).catch(() => {});
				const kept = new Set(managedPaths(next));
				const dropped = managedPaths(prev).filter((p) => !kept.has(p));
				if (dropped.length) backend.importsRemove(dropped).catch(() => {});
			}
			return next;
		});
	}, []);

	useEffect(() => {
		let alive = true;
		load().then(async (list) => {
			if (!alive) return;
			setEntries(list);
			setReady(true);
			// Housekeeping: orphaned copies go, and the size cap evicts the
			// oldest referenced ones, which then show as unavailable.
			const evicted = await backend
				.importsPrune(managedPaths(list))
				.catch(() => []);
			if (alive && evicted.length) {
				const gone = new Set(evicted);
				setEntries((prev) =>
					prev.map((e) =>
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
	}, []);

	// Name healing: entries saved with a fallback name ("PDF
	// document.pdf", or an id from an older build) ask the Android
	// provider again, a few times while the bridge comes up.
	const entriesNow = useRef(entries);
	entriesNow.current = entries;
	useEffect(() => {
		if (!ready) return;
		let attempt = 0;
		let timer = 0;
		const heal = () => {
			const fixes: Array<[string, string]> = [];
			for (const e of entriesNow.current) {
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

	// Turning recents off clears them (and their managed copies).
	useEffect(() => {
		if (settingsReady && ready && !settings.keepRecents)
			commit((prev) => (prev.length ? [] : prev));
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
			commit((prev) =>
				updateEntry(prev, id, {
					pinned: !prev.find((e) => e.id === id)?.pinned,
				}),
			),
		[commit],
	);
	const markUnavailable = useCallback<RecentsApi["markUnavailable"]>(
		(id) => commit((prev) => updateEntry(prev, id, { unavailable: true })),
		[commit],
	);
	const remove = useCallback<RecentsApi["remove"]>(
		(id) => commit((prev) => prev.filter((e) => e.id !== id)),
		[commit],
	);

	const entriesRef = useRef(entries);
	entriesRef.current = entries;
	// Clearing keeps managed copies until the Undo window has passed:
	// the snackbar's Undo must be able to restore working entries.
	const clear = useCallback(() => {
		const previous = entriesRef.current;
		setEntries([]);
		backend.storeSet(STORAGE_KEYS.recents, []).catch(() => {});
		return previous;
	}, []);
	const restore = useCallback<RecentsApi["restore"]>((list) => {
		const sorted = sortRecents(list);
		setEntries(sorted);
		backend.storeSet(STORAGE_KEYS.recents, sorted).catch(() => {});
	}, []);

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
