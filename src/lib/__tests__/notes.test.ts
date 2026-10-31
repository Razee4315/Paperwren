import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	NOTES_KEY,
	type Note,
	backupNotes,
	deleteNote,
	isEmptyNote,
	loadNote,
	loadNotes,
	matchesNote,
	newNote,
	restoreNotes,
	saveNote,
	summarize,
	validNote,
} from "../notes";

const store = new Map<string, unknown>();

vi.mock("../backend", () => ({
	backend: {
		storeGet: async (key: string) => store.get(key) ?? null,
		storeSet: async (key: string, value: unknown) => {
			store.set(key, value);
		},
	},
}));

const written = (text: string, at = 100): Note => ({
	...newNote(at),
	title: "Lecture",
	blocks: [{ kind: "text", id: "b1", text }],
});

beforeEach(() => store.clear());

describe("a note", () => {
	it("is empty until something is written or drawn", () => {
		const note = newNote();
		expect(isEmptyNote(note)).toBe(true);
		expect(
			isEmptyNote({
				...note,
				blocks: [
					{
						kind: "sketch",
						id: "s",
						height: 300,
						strokes: [{ points: [[0, 0]], color: "#111111", width: 3 }],
					},
				],
			}),
		).toBe(false);
	});

	it("is found by its title or its words, in any case", () => {
		const summary = summarize(written("Mitochondria are the powerhouse"));
		expect(matchesNote(summary, "POWERHOUSE")).toBe(true);
		expect(matchesNote(summary, "lecture")).toBe(true);
		expect(matchesNote(summary, "ribosome")).toBe(false);
		expect(matchesNote(summary, "  ")).toBe(true);
	});

	it("refuses an id that could not be a store key", () => {
		expect(validNote({ ...newNote(), id: "../secrets" })).toBeNull();
		expect(validNote(null)).toBeNull();
	});

	it("drops strokes it cannot draw", () => {
		const note = validNote({
			...newNote(),
			blocks: [
				{
					kind: "sketch",
					id: "s",
					height: 300,
					strokes: [
						{ points: [["x", 1]], color: "#000000", width: 2 },
						{ points: [[0, 1]], color: "#000000", width: 2 },
					],
				},
			],
		});
		const block = note?.blocks[0];
		expect(block?.kind === "sketch" && block.strokes).toHaveLength(1);
	});
});

describe("the notes kept", () => {
	it("keeps the newest on top and each note in its own place", async () => {
		const first = written("one");
		const second = written("two");
		await saveNote(first);
		const list = await saveNote(second);
		expect(list.map((n) => n.id)).toEqual([second.id, first.id]);
		expect(await loadNote(first.id)).toEqual(first);
		expect((await saveNote(first)).map((n) => n.id)).toEqual([
			first.id,
			second.id,
		]);
	});

	it("forgets a deleted note", async () => {
		const note = written("gone");
		await saveNote(note);
		expect(await deleteNote(note.id)).toEqual([]);
		expect(await loadNote(note.id)).toBeNull();
	});

	it("survives a list that is not one", async () => {
		store.set(NOTES_KEY, "nonsense");
		expect(await loadNotes()).toEqual([]);
	});
});

describe("a backup", () => {
	it("brings every note back", async () => {
		const note = written("kept safe");
		await saveNote(note);
		const bytes = await backupNotes();
		store.clear();
		expect(await restoreNotes(bytes.slice().buffer)).toBe(1);
		expect(await loadNote(note.id)).toEqual(note);
	});

	it("keeps the copy changed last", async () => {
		const old = written("old", 100);
		await saveNote(old);
		const bytes = await backupNotes();
		const newer = {
			...old,
			blocks: [{ kind: "text" as const, id: "b1", text: "new" }],
			updatedAt: 200,
		};
		await saveNote(newer);
		expect(await restoreNotes(bytes.slice().buffer)).toBe(0);
		expect(await loadNote(old.id)).toEqual(newer);
	});

	it("says when a file is not a backup", async () => {
		const not = new TextEncoder().encode('{"kind":"other"}');
		expect(await restoreNotes(not.slice().buffer)).toBeNull();
		const junk = new TextEncoder().encode("not json");
		expect(await restoreNotes(junk.slice().buffer)).toBeNull();
	});
});
