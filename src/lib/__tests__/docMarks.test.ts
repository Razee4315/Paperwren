import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type DocMark,
	allMarks,
	clearAllMarks,
	contentKey,
	fileSample,
	loadMarkList,
	loadMarks,
	marksToMarkdown,
	restoreMarks,
	saveMarks,
	sortMarks,
	validDoc,
	validMark,
} from "../docMarks";

const store = new Map<string, unknown>();

vi.mock("../backend", () => ({
	backend: {
		storeGet: async (key: string) => store.get(key) ?? null,
		storeSet: async (key: string, value: unknown) => {
			if (value === null) store.delete(key);
			else store.set(key, value);
		},
	},
}));

const KEY = "0123456789abcdef0123456789abcdef";

const highlight = (id: string, page = 0, y = 0.1): DocMark => ({
	id,
	createdAt: 1,
	kind: "highlight",
	page,
	boxes: [{ x: 0.1, y, w: 0.5, h: 0.02 }],
	color: "#ffd93b",
	text: `words ${id}`,
});

const doc = (marks: DocMark[], note = "") => ({
	key: KEY,
	name: "Report.pdf",
	note,
	marks,
	updatedAt: 10,
});

beforeEach(() => store.clear());

describe("knowing a file again", () => {
	it("gives the same key to the same content, and a key a store takes", () => {
		const bytes = new Uint8Array(4000).fill(7);
		const key = contentKey(fileSample(bytes));
		expect(key).toBe(contentKey(fileSample(bytes.slice())));
		expect(key).toMatch(/^[0-9a-f]{32}$/);
		expect(`marks_${key}`.length).toBeLessThanOrEqual(64);
	});

	it("tells files apart by what they hold and by their size", () => {
		const a = new Uint8Array(4000).fill(7);
		const b = a.slice();
		b[10] = 8;
		expect(contentKey(fileSample(a))).not.toBe(contentKey(fileSample(b)));
		expect(contentKey(fileSample(a))).not.toBe(
			contentKey(fileSample(a.subarray(0, 3999))),
		);
	});

	it("reads only the two ends of a large file", () => {
		const big = new Uint8Array(5 << 20);
		expect(fileSample(big).length).toBeLessThan(2.1 * (1 << 20));
	});
});

describe("reading marks back", () => {
	it("keeps a sound mark of every kind", () => {
		const marks: DocMark[] = [
			highlight("a"),
			{
				id: "b",
				createdAt: 1,
				kind: "ink",
				page: 1,
				points: [[0.1, 0.2]],
				color: "#111111",
				width: 2,
			},
			{
				id: "c",
				createdAt: 1,
				kind: "note",
				page: 0,
				x: 0.1,
				y: 0.1,
				text: "x",
			},
			{
				id: "d",
				createdAt: 1,
				kind: "text",
				page: 0,
				x: 0.1,
				y: 0.1,
				w: 0.4,
				h: 0.1,
				size: 14,
				text: "x",
				color: "#111111",
			},
			{
				id: "e",
				createdAt: 1,
				kind: "measure",
				page: 0,
				points: [
					[0.1, 0.1],
					[0.2, 0.2],
				],
				color: "#111111",
			},
		];
		for (const mark of marks) expect(validMark(mark)?.kind).toBe(mark.kind);
	});

	it("drops what is not a mark, and keeps the rest of the document", () => {
		const read = validDoc(
			{ note: "hello", marks: [highlight("a"), { id: "b" }, null, 7] },
			KEY,
		);
		expect(read?.marks.map((m) => m.id)).toEqual(["a"]);
		expect(read?.note).toBe("hello");
	});

	it("refuses a mark with no place on the page", () => {
		expect(validMark({ ...highlight("a"), boxes: [] })).toBeNull();
		expect(validMark({ ...highlight("a"), page: -1 })).toBeNull();
		expect(validMark({ ...highlight("a"), kind: "other" })).toBeNull();
	});

	it("keeps only a sound scale", () => {
		const read = validDoc(
			{
				marks: [],
				scales: {
					0: { perPoint: 0.1, unit: "m" },
					1: { perPoint: -1, unit: "m" },
					x: { perPoint: 1, unit: "m" },
				},
			},
			KEY,
		);
		expect(read?.scales).toEqual({ 0: { perPoint: 0.1, unit: "m" } });
	});
});

describe("keeping marks", () => {
	it("keeps a document and lists it", async () => {
		await saveMarks(doc([highlight("a")]));
		expect((await loadMarks(KEY))?.marks).toHaveLength(1);
		expect(await loadMarkList()).toEqual([
			{ key: KEY, name: "Report.pdf", count: 1, updatedAt: 10 },
		]);
	});

	it("lets go of a document with nothing left in it", async () => {
		await saveMarks(doc([highlight("a")]));
		await saveMarks(doc([]));
		expect(await loadMarks(KEY)).toBeNull();
		expect(await loadMarkList()).toEqual([]);
	});

	it("keeps a note on its own", async () => {
		await saveMarks(doc([], "about all of it"));
		expect((await loadMarks(KEY))?.note).toBe("about all of it");
	});

	it("clears them all, and brings them back", async () => {
		await saveMarks(doc([highlight("a")]));
		const previous = await clearAllMarks();
		expect(await allMarks()).toEqual([]);
		expect(await restoreMarks(previous)).toBe(1);
		expect((await loadMarks(KEY))?.marks).toHaveLength(1);
	});

	it("keeps the newer copy when restoring", async () => {
		await saveMarks({ ...doc([highlight("new")]), updatedAt: 20 });
		await restoreMarks([{ ...doc([highlight("old")]), updatedAt: 5 }]);
		expect((await loadMarks(KEY))?.marks[0].id).toBe("new");
	});
});

describe("marks in order", () => {
	it("sorts by page, then down the page", () => {
		const sorted = sortMarks([
			highlight("c", 1, 0.1),
			highlight("b", 0, 0.5),
			highlight("a", 0, 0.1),
		]);
		expect(sorted.map((m) => m.id)).toEqual(["a", "b", "c"]);
	});

	it("writes them as Markdown, with notes and pages", () => {
		const text = marksToMarkdown(
			"Report.pdf",
			{
				note: "Read before Friday",
				marks: [
					{ ...highlight("a", 2), note: "Ask about this" } as DocMark,
					{
						id: "n",
						createdAt: 1,
						kind: "note",
						page: 0,
						x: 0.1,
						y: 0.1,
						text: "A thought",
					},
				],
			},
			(page) => `p. ${page + 1}`,
		);
		expect(text).toBe(
			"# Report\n\nRead before Friday\n\n- A thought (p. 1)\n\n> words a (p. 3)\n\nAsk about this\n",
		);
	});

	it("leaves out what is only drawn", () => {
		const text = marksToMarkdown(
			"Report.pdf",
			{
				note: "",
				marks: [
					{
						id: "i",
						createdAt: 1,
						kind: "ink",
						page: 0,
						points: [[0.1, 0.1]],
						color: "#000000",
						width: 1,
					},
				],
			},
			() => "p. 1",
		);
		expect(text).toBe("# Report\n");
	});
});
