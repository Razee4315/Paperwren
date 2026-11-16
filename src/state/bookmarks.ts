import {
	BOOKMARKS_KEY,
	type Bookmark,
	type Bookmarks,
	addBookmark,
	normalizeBookmarks,
	removeBookmark,
} from "@/lib/bookmarks";
import { isDesktop, isTauri } from "@/lib/env";
import { moveKeyed } from "@/lib/recents";
import { createStoredValue } from "@/lib/storedValue";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * Every file's bookmarks, read once and kept here. On a desktop each
 * document opened from the file manager is a window of its own sharing
 * the one store, so there a change is made to the store as it is now
 * (as recents do), not to what this window last read. Changes are
 * written one at a time, so two quick ones never start from the same
 * list.
 */
const book = createStoredValue<Bookmarks>({
	key: BOOKMARKS_KEY,
	initial: {},
	normalize: normalizeBookmarks,
	shared: isTauri && isDesktop,
});

function change(file: string, edit: (list: Bookmark[]) => Bookmark[]) {
	void book.load();
	book.edit((all) => {
		const list = edit(all[file] ?? []);
		const next = { ...all, [file]: list };
		if (!list.length) delete next[file];
		return next;
	});
}

/** A file was renamed and is known by a new id: its bookmarks go with
 * it. */
export function moveBookmarks(from: string, to: string) {
	if (from === to) return;
	void book.load();
	book.edit((all) => moveKeyed(all, from, to));
}

/** Forget every bookmark of every file. Returns them, for Undo; rejects
 * when that could not be kept (nothing is forgotten then). */
export async function clearBookmarks(): Promise<Bookmarks> {
	let previous: Bookmarks = {};
	// The last run of the change is on the store as it is (a desktop's
	// other windows included): those are the ones to give back.
	await book.commit((all) => {
		previous = all;
		return {};
	});
	return previous;
}

/** Put back bookmarks cleared a moment ago. */
export async function restoreBookmarks(previous: Bookmarks) {
	await book.commit((all) => ({ ...previous, ...all }));
}

const subscribe = book.value.subscribe;
const snapshot = book.value.get;

/** How many bookmarks there are in all. */
export function useBookmarkCount(): number {
	const all = useSyncExternalStore(subscribe, snapshot);
	useEffect(() => {
		void book.load();
	}, []);
	return useMemo(
		() => Object.values(all).reduce((sum, list) => sum + list.length, 0),
		[all],
	);
}

/** One file's bookmarks, and adding to them and taking away. `file` is
 * null for a file that cannot keep any (one inside another document). */
export function useBookmarks(file: string | null) {
	const all = useSyncExternalStore(subscribe, snapshot);
	useEffect(() => {
		void book.load();
	}, []);
	const add = useCallback(
		(mark: Bookmark) =>
			file ? change(file, (list) => addBookmark(list, mark)) : undefined,
		[file],
	);
	const remove = useCallback(
		(id: string) =>
			file ? change(file, (list) => removeBookmark(list, id)) : undefined,
		[file],
	);
	return {
		list: file ? (all[file] ?? []) : [],
		add,
		remove,
	};
}
