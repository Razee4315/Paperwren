/**
 * What was read from a scan, kept with its content key: a page takes
 * long enough on a phone that it should only ever be read once.
 */

import { backend } from "./backend";
import { LANGUAGES, type Language } from "./i18n";
import type { ReadLine } from "./ocr";

export interface KeptRead {
	language: Language;
	/** The lines of each page read, by its index. */
	pages: Record<string, ReadLine[]>;
}

const storeKey = (key: string) => `read_${key}`;

const isLine = (line: unknown) => {
	const l = line as Partial<ReadLine> | null;
	return (
		!!l &&
		typeof l.text === "string" &&
		Array.isArray(l.words) &&
		Number.isFinite(l.x) &&
		Number.isFinite(l.y) &&
		Number.isFinite(l.w) &&
		Number.isFinite(l.h)
	);
};

export function validRead(raw: unknown): KeptRead | null {
	const read = raw as Partial<KeptRead> | null;
	if (!read || !read.pages || typeof read.pages !== "object") return null;
	if (!LANGUAGES.some(([code]) => code === read.language)) return null;
	const pages: Record<string, ReadLine[]> = {};
	for (const [page, lines] of Object.entries(read.pages)) {
		if (/^\d+$/.test(page) && Array.isArray(lines) && lines.every(isLine))
			pages[page] = lines;
	}
	return { language: read.language as Language, pages };
}

const LIST_KEY = "reads_v1";

/** The list as last read or written: each page read saves, and the
 * list is not read from the store again for every one. */
let known: string[] | null = null;

const readList = async (): Promise<string[]> => {
	if (known) return known;
	let list: unknown;
	try {
		list = await backend.storeGet(LIST_KEY);
	} catch {
		// Not kept: the next ask reads it again.
		return [];
	}
	const valid = Array.isArray(list)
		? list.filter((key) => /^[0-9a-f]{32}$/.test(key))
		: [];
	// A write made while this was reading is the newer list.
	known ??= valid;
	return known;
};

export const loadRead = async (key: string) =>
	validRead(await backend.storeGet(storeKey(key)).catch(() => null));

export async function saveRead(key: string, read: KeptRead | null) {
	await backend.storeSet(storeKey(key), read).catch(() => {});
	const rest = (await readList()).filter((other) => other !== key);
	known = read ? [key, ...rest] : rest;
	await backend.storeSet(LIST_KEY, known).catch(() => {});
}

/** How many documents have text kept. */
export const readCount = async () => (await readList()).length;

/** Forget everything read from scans. */
export async function clearReads() {
	for (const key of await readList())
		await backend.storeSet(storeKey(key), null).catch(() => {});
	known = [];
	await backend.storeSet(LIST_KEY, []).catch(() => {});
}
