import { type Folder, backend } from "@/lib/backend";
import { createStoredValue } from "@/lib/storedValue";
import { useCallback, useEffect, useSyncExternalStore } from "react";

const KEY = "folders_v1";
/** How many folders Home keeps. */
export const MAX_FOLDERS = 12;

/** Only well-formed folders survive a round trip through storage. */
export function normalizeFolders(stored: unknown): Folder[] {
	if (!Array.isArray(stored)) return [];
	const out: Folder[] = [];
	for (const item of stored) {
		const f = item as Partial<Folder> | null;
		const source = f?.source as Folder["source"] | undefined;
		if (!f || typeof f.id !== "string" || typeof f.name !== "string" || !source)
			continue;
		const ok =
			(source.kind === "path" && typeof source.path === "string") ||
			(source.kind === "tree" && typeof source.uri === "string");
		// Browser folders only live for one session: never restored.
		if (ok && !out.some((x) => x.id === f.id))
			out.push({ id: f.id, name: f.name, source });
	}
	return out.slice(0, MAX_FOLDERS);
}

/** Read once; a change made before that waits for it, and is made to
 * the list as read. */
const saved = createStoredValue<Folder[]>({
	key: KEY,
	initial: [],
	normalize: normalizeFolders,
	// Browser folders only live for one session: never written.
	stored: (list) => list.filter((f) => f.source.kind !== "browser"),
});

/** The folders the user chose to browse from Home, kept across
 * launches. Only the folder's address is stored, never its contents. */
export function useFolders() {
	const folders = useSyncExternalStore(saved.value.subscribe, saved.value.get);

	useEffect(() => {
		void saved.load();
	}, []);

	/** Ask for a folder; returns it (new or already known), or null. */
	const add = useCallback(async (): Promise<Folder | null> => {
		const picked = await backend.pickFolder();
		if (!picked) return null;
		// The list as it is now, not as it was when the picker opened.
		const known = saved.value.get().find((f) => f.id === picked.id);
		if (known) return known;
		// Home refuses to add past the limit; should one slip through, the
		// oldest goes and the access held for it is given back.
		const next = [...saved.value.get(), picked];
		for (const dropped of next.slice(0, -MAX_FOLDERS))
			backend.forgetFolder(dropped);
		saved.edit((list) =>
			list.some((f) => f.id === picked.id)
				? list
				: [...list, picked].slice(-MAX_FOLDERS),
		);
		return picked;
	}, []);

	const remove = useCallback((id: string) => {
		const folder = saved.value.get().find((f) => f.id === id);
		if (folder) backend.forgetFolder(folder);
		saved.edit((list) => list.filter((f) => f.id !== id));
	}, []);

	return { folders, add, remove };
}
