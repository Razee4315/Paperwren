/**
 * A small picture of a PDF's first page for the list of recent files,
 * kept apart from the list, which is written at every opening.
 */

import { backend } from "./backend";

const key = (id: string) => `thumb_${id}`;

export async function loadThumb(id: string): Promise<string | null> {
	const value = await backend.storeGet(key(id)).catch(() => null);
	return typeof value === "string" &&
		value.startsWith("data:image/jpeg;base64,")
		? value
		: null;
}

const waiting = new Map<string, Set<() => void>>();

/** Hear when a file's picture is ready. Returns a stop. */
export function watchThumb(id: string, heard: () => void): () => void {
	const list = waiting.get(id) ?? new Set();
	waiting.set(id, list);
	list.add(heard);
	return () => list.delete(heard);
}

export async function saveThumb(id: string, url: string) {
	await backend.storeSet(key(id), url).catch(() => {});
	for (const heard of waiting.get(id) ?? []) heard();
}

export const forgetThumb = (id: string) =>
	backend.storeSet(key(id), null).catch(() => {});
