import { type Folder, backend } from "@/lib/backend";
import { useCallback, useEffect, useState } from "react";

const KEY = "folders_v1";
const MAX_FOLDERS = 12;

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

/** The folders the user chose to browse from Home, kept across
 * launches. Only the folder's address is stored, never its contents. */
export function useFolders() {
	const [folders, setFolders] = useState<Folder[]>([]);

	useEffect(() => {
		let alive = true;
		backend
			.storeGet(KEY)
			.then((stored) => alive && setFolders(normalizeFolders(stored)))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);

	const save = useCallback((next: Folder[]) => {
		setFolders(next);
		backend
			.storeSet(
				KEY,
				next.filter((f) => f.source.kind !== "browser"),
			)
			.catch(() => {});
	}, []);

	/** Ask for a folder; returns it (new or already known), or null. */
	const add = useCallback(async (): Promise<Folder | null> => {
		const picked = await backend.pickFolder();
		if (!picked) return null;
		const known = folders.find((f) => f.id === picked.id);
		if (known) return known;
		save([...folders, picked].slice(-MAX_FOLDERS));
		return picked;
	}, [folders, save]);

	const remove = useCallback(
		(id: string) => {
			const folder = folders.find((f) => f.id === id);
			if (folder) backend.forgetFolder(folder);
			save(folders.filter((f) => f.id !== id));
		},
		[folders, save],
	);

	return { folders, add, remove };
}
