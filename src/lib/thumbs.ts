/**
 * A small picture of a PDF's first page for the list of recent files,
 * kept apart from the list, which is written at every opening.
 */

import { backend } from "./backend";

const key = (id: string) => `thumb_${id}`;

/** The pictures read or saved lately, null for "has none": Home is
 * drawn again often, and each row would read its file again. The
 * oldest are let go past `KEPT`. */
const kept = new Map<string, string | null>();
const KEPT = 64;

function keep(id: string, url: string | null) {
	kept.delete(id);
	kept.set(id, url);
	if (kept.size > KEPT) {
		const oldest = kept.keys().next().value;
		if (oldest !== undefined) kept.delete(oldest);
	}
}

export async function loadThumb(id: string): Promise<string | null> {
	const known = kept.get(id);
	if (known !== undefined) {
		keep(id, known);
		return known;
	}
	let value: unknown;
	try {
		value = await backend.storeGet(key(id));
	} catch {
		// Not kept: the next ask reads it again.
		return null;
	}
	const url =
		typeof value === "string" && value.startsWith("data:image/jpeg;base64,")
			? value
			: null;
	// A save made while this was reading is the newer answer.
	if (!kept.has(id)) keep(id, url);
	return kept.get(id) ?? null;
}

const waiting = new Map<string, Set<() => void>>();

/** Hear when a file's picture is ready. Returns a stop. */
export function watchThumb(id: string, heard: () => void): () => void {
	const list = waiting.get(id) ?? new Set();
	waiting.set(id, list);
	list.add(heard);
	return () => {
		list.delete(heard);
		if (!list.size && waiting.get(id) === list) waiting.delete(id);
	};
}

export async function saveThumb(id: string, url: string) {
	keep(id, url);
	await backend.storeSet(key(id), url).catch(() => {});
	for (const heard of waiting.get(id) ?? []) heard();
}

/** Null removes the picture's key: the shell deletes its file
 * (store.rs), the browser its entry, so nothing is left per entry that
 * ever left Recent files. */
export const forgetThumb = (id: string) => {
	keep(id, null);
	return backend.storeSet(key(id), null).catch(() => {});
};

/** A file renamed where it is has a new id: its picture goes along. */
export async function moveThumb(from: string, to: string) {
	if (from === to) return;
	const url = await loadThumb(from);
	if (!url) return;
	await saveThumb(to, url);
	await forgetThumb(from);
}
