/**
 * Notes the reader writes in the app, kept on this device. Each note is
 * a file of its own in the app's store, with a list beside them holding
 * what the Notes screen shows and searches, so a long list opens without
 * reading every drawing. Nothing leaves the device, unless the reader
 * saves a note as a PDF or all of them as a backup file.
 */

import { backend } from "./backend";

export interface NoteStroke {
	/** Both as fractions of the sketch's width, so it can grow downward. */
	points: Array<[number, number]>;
	color: string;
	/** Units of a sheet SKETCH_WIDTH across. */
	width: number;
}

export type NoteBlock =
	| { kind: "text"; id: string; text: string }
	| { kind: "sketch"; id: string; height: number; strokes: NoteStroke[] };

export interface Note {
	id: string;
	title: string;
	blocks: NoteBlock[];
	createdAt: number;
	updatedAt: number;
}

/** A line of the Notes screen. */
export interface NoteSummary {
	id: string;
	title: string;
	/** The note's words, as far as search reaches. */
	text: string;
	drawn: boolean;
	updatedAt: number;
}

export const NOTES_KEY = "notes_v1";
export const SKETCH_WIDTH = 1000;
/** A new sketch's height, on a sheet SKETCH_WIDTH across. */
export const SKETCH_HEIGHT = 600;
const SEARCH_LENGTH = 4000;
/** What a backup file says it is. */
const BACKUP_KIND = "paperwren-notes";

const noteKey = (id: string) => `note_${id}`;
const fresh = () =>
	`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const blockId = fresh;

export function newNote(now = Date.now()): Note {
	return {
		id: fresh(),
		title: "",
		blocks: [{ kind: "text", id: fresh(), text: "" }],
		createdAt: now,
		updatedAt: now,
	};
}

/** Nothing written or drawn: not worth keeping. */
export function isEmptyNote(note: Note): boolean {
	return (
		!note.title.trim() &&
		note.blocks.every((block) =>
			block.kind === "text" ? !block.text.trim() : !block.strokes.length,
		)
	);
}

export function summarize(note: Note): NoteSummary {
	const text = note.blocks
		.flatMap((block) => (block.kind === "text" ? [block.text.trim()] : []))
		.filter(Boolean)
		.join("\n");
	return {
		id: note.id,
		title: note.title.trim(),
		text: text.slice(0, SEARCH_LENGTH),
		drawn: note.blocks.some(
			(block) => block.kind === "sketch" && block.strokes.length > 0,
		),
		updatedAt: note.updatedAt,
	};
}

export function matchesNote(summary: NoteSummary, query: string): boolean {
	const q = query.trim().toLocaleLowerCase();
	return (
		!q ||
		summary.title.toLocaleLowerCase().includes(q) ||
		summary.text.toLocaleLowerCase().includes(q)
	);
}

function validPoint(p: unknown): p is [number, number] {
	return (
		Array.isArray(p) &&
		p.length === 2 &&
		Number.isFinite(p[0]) &&
		Number.isFinite(p[1])
	);
}

function validBlock(raw: unknown): NoteBlock | null {
	const block = raw as Partial<Extract<NoteBlock, { kind: "sketch" }>> &
		Partial<Extract<NoteBlock, { kind: "text" }>>;
	if (!block || typeof block.id !== "string") return null;
	if (block.kind === "text" && typeof block.text === "string")
		return { kind: "text", id: block.id, text: block.text };
	if (
		block.kind === "sketch" &&
		Number.isFinite(block.height) &&
		Array.isArray(block.strokes)
	)
		return {
			kind: "sketch",
			id: block.id,
			height: Math.max(100, Number(block.height)),
			strokes: block.strokes.filter(
				(s) =>
					s &&
					typeof s.color === "string" &&
					Number.isFinite(s.width) &&
					Array.isArray(s.points) &&
					s.points.every(validPoint),
			),
		};
	return null;
}

/** A note read from the store or a backup; null if it is not one. */
export function validNote(raw: unknown): Note | null {
	const note = raw as Partial<Note> | null;
	if (
		!note ||
		typeof note.id !== "string" ||
		!/^[a-z0-9]{1,40}$/.test(note.id) ||
		!Array.isArray(note.blocks)
	)
		return null;
	const blocks = note.blocks.flatMap((b) => validBlock(b) ?? []);
	return {
		id: note.id,
		title: typeof note.title === "string" ? note.title : "",
		blocks: blocks.length ? blocks : [{ kind: "text", id: fresh(), text: "" }],
		createdAt: Number(note.createdAt) || 0,
		updatedAt: Number(note.updatedAt) || 0,
	};
}

function validSummaries(raw: unknown): NoteSummary[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(n): n is NoteSummary =>
			!!n &&
			typeof n.id === "string" &&
			typeof n.title === "string" &&
			typeof n.text === "string" &&
			Number.isFinite(n.updatedAt),
	);
}

export async function loadNotes(): Promise<NoteSummary[]> {
	return validSummaries(await backend.storeGet(NOTES_KEY).catch(() => null));
}

export async function loadNote(id: string): Promise<Note | null> {
	return validNote(await backend.storeGet(noteKey(id)).catch(() => null));
}

/** Keep a note and put it at the top of the list. A failed write
 * reaches the caller, who still holds the note. */
export async function saveNote(note: Note): Promise<NoteSummary[]> {
	await backend.storeSet(noteKey(note.id), note);
	const list = [
		summarize(note),
		...(await loadNotes()).filter((n) => n.id !== note.id),
	];
	await backend.storeSet(NOTES_KEY, list);
	return list;
}

export async function deleteNote(id: string): Promise<NoteSummary[]> {
	const list = (await loadNotes()).filter((n) => n.id !== id);
	await backend.storeSet(NOTES_KEY, list);
	await backend.storeSet(noteKey(id), null);
	return list;
}

/** Every note as one file's bytes, to keep somewhere safe: the app's
 * store goes when the app is uninstalled. */
export async function backupNotes(): Promise<Uint8Array> {
	const notes: Note[] = [];
	for (const { id } of await loadNotes()) {
		const note = await loadNote(id);
		if (note) notes.push(note);
	}
	return new TextEncoder().encode(
		JSON.stringify({ kind: BACKUP_KIND, version: 1, notes }),
	);
}

/** Bring the notes of a backup file back, beside those here. A note that
 * is here too keeps whichever copy was changed last. Null when the file
 * is not a backup; otherwise how many notes came in. */
export async function restoreNotes(bytes: ArrayBuffer): Promise<number | null> {
	let data: { kind?: unknown; notes?: unknown };
	try {
		data = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
	if (data?.kind !== BACKUP_KIND || !Array.isArray(data.notes)) return null;
	let added = 0;
	const here = new Map((await loadNotes()).map((n) => [n.id, n]));
	const incoming = data.notes
		.flatMap((raw) => validNote(raw) ?? [])
		.sort((a, b) => a.updatedAt - b.updatedAt);
	for (const note of incoming) {
		if ((here.get(note.id)?.updatedAt ?? -1) >= note.updatedAt) continue;
		await saveNote(note);
		added++;
	}
	// Saving puts a note on top; the list stays newest first.
	const list = (await loadNotes()).sort((a, b) => b.updatedAt - a.updatedAt);
	await backend.storeSet(NOTES_KEY, list);
	return added;
}
