import { backend } from "@/lib/backend";
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
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * Every file's bookmarks, read once and kept here. On a desktop each
 * document opened from the file manager is a window of its own sharing
 * the one store, so there a change is made to the store as it is now
 * (as recents do), not to what this window last read.
 */
const SHARED = isTauri && isDesktop;

let book: Bookmarks = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => {
	for (const listener of listeners) listener();
};

const read = async () =>
	normalizeBookmarks(await backend.storeGet(BOOKMARKS_KEY).catch(() => null));

function load(): Promise<void> {
	loading ??= read().then((stored) => {
		book = stored;
		emit();
	});
	return loading;
}

async function change(file: string, edit: (list: Bookmark[]) => Bookmark[]) {
	await load();
	const base = SHARED ? await read() : book;
	const list = edit(base[file] ?? []);
	const next = { ...base, [file]: list };
	if (!list.length) delete next[file];
	book = next;
	emit();
	await backend.storeSet(BOOKMARKS_KEY, next).catch(() => {});
}

/** A file was renamed and is known by a new id: its bookmarks go with
 * it. */
export async function moveBookmarks(from: string, to: string) {
	if (from === to) return;
	await load();
	const base = SHARED ? await read() : book;
	const next = moveKeyed(base, from, to);
	if (next === base) return;
	book = next;
	emit();
	await backend.storeSet(BOOKMARKS_KEY, next).catch(() => {});
}

/** Forget every bookmark of every file. Returns them, for Undo. */
export async function clearBookmarks(): Promise<Bookmarks> {
	await load();
	const previous = SHARED ? await read() : book;
	book = {};
	emit();
	await backend.storeSet(BOOKMARKS_KEY, {}).catch(() => {});
	return previous;
}

/** Put back bookmarks cleared a moment ago. */
export async function restoreBookmarks(previous: Bookmarks) {
	await load();
	book = { ...previous, ...book };
	emit();
	await backend.storeSet(BOOKMARKS_KEY, book).catch(() => {});
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
const snapshot = () => book;

/** How many bookmarks there are in all. */
export function useBookmarkCount(): number {
	const all = useSyncExternalStore(subscribe, snapshot);
	useEffect(() => {
		load();
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
		load();
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
