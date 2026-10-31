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

export const saveThumb = (id: string, url: string) =>
	backend.storeSet(key(id), url).catch(() => {});

export const forgetThumb = (id: string) =>
	backend.storeSet(key(id), null).catch(() => {});
