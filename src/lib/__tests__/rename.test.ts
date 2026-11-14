import { describe, expect, it } from "vitest";
import {
	capOrigins,
	idForReopen,
	moveKeyed,
	normalizeRecents,
	originsChanged,
	recordOpen,
	renameRecent,
} from "../recents";
import {
	documentRenamed,
	originRenamed,
	renameRefusal,
	renameRefused,
	renameWay,
} from "../rename";
import type { RecentEntry, Reopen } from "../types";

const path = (p: string): Reopen => ({ kind: "path", path: p });
const doc: Reopen = {
	kind: "uri",
	uri: "content://com.android.externalstorage.documents/tree/primary%3ADocs/document/primary%3ADocs%2Fa.pdf",
};
const copy: Reopen = {
	kind: "managed",
	path: "/data/user/0/app.paperwren.docs/files/imports/ab12/a.pdf",
};

const entry = (reopen: Reopen, extra: Partial<RecentEntry> = {}) =>
	({
		id: idForReopen(reopen),
		name: "a.pdf",
		format: "pdf",
		size: 10,
		reopen,
		openedAt: 1,
		pinned: false,
		...extra,
	}) satisfies RecentEntry;

describe("how a file can be renamed", () => {
	it("renames a desktop file where it is", () => {
		expect(renameWay(path("C:\\Docs\\a.pdf"), false)).toBe("file");
		expect(renameWay(path("/home/a/a.pdf"), true)).toBe("file");
	});

	it("asks an Android document's provider, where the shell can", () => {
		expect(renameWay(doc, true)).toBe("document");
		// An older shell, with no way to ask.
		expect(renameWay(doc, false)).toBe("app");
	});

	it("only renames the app's own name for a copy it holds", () => {
		expect(renameWay(copy, true)).toBe("app");
		expect(renameWay({ kind: "browser", key: "k" }, true)).toBe("app");
	});

	it("asks the provider of a picked copy's original, where it kept it", () => {
		const picked: Reopen = { ...copy, origin: "content://downloads/doc/7" };
		expect(renameWay(picked, true)).toBe("origin");
		// An older shell, with no way to ask.
		expect(renameWay(picked, false)).toBe("app");
		// A copy with no original kept (opened from another app).
		expect(renameWay(copy, true)).toBe("app");
	});

	it("cannot rename a file inside another one", () => {
		expect(renameWay({ kind: "memory", key: "1:a.pdf" }, true)).toBeNull();
	});
});

describe("the Android side's answer", () => {
	it("follows the document to its new address and name", () => {
		const moved = `${doc.kind === "uri" ? doc.uri : ""}-2`;
		expect(
			documentRenamed({ uri: moved, name: "Q3 (1).pdf" }, doc, "Q3.pdf"),
		).toEqual({
			reopen: { kind: "uri", uri: moved },
			name: "Q3 (1).pdf",
			original: true,
		});
		// No name read back: the one asked for.
		expect(documentRenamed({ uri: moved }, doc, "Q3.pdf").name).toBe("Q3.pdf");
	});

	it("renames only in the app when the provider will not", () => {
		for (const answer of ["unsupported", "permission"])
			expect(documentRenamed(answer, doc, "Q3.pdf")).toEqual({
				reopen: doc,
				name: "Q3.pdf",
				original: false,
			});
	});

	it("is refused, renaming nothing, when the provider fails", () => {
		expect(() => documentRenamed("not_found", doc, "Q3.pdf")).toThrow(
			expect.objectContaining({ kind: "not_found" }),
		);
		for (const answer of [null, "", { uri: "file:///x" }, 3])
			expect(() => documentRenamed(answer, doc, "Q3.pdf")).toThrow(
				expect.objectContaining({ kind: "io" }),
			);
	});
});

describe("the answer for a picked copy's original", () => {
	const picked: Reopen = {
		kind: "managed",
		path: "/data/imports/ab12/a.pdf",
		origin: "content://com.android.providers.downloads.documents/document/7",
	};

	it("keeps the copy, under the provider's name and the new address", () => {
		expect(
			originRenamed(
				{ uri: "content://x/document/8", name: " Q3 (1).pdf " },
				picked,
				"Q3.pdf",
			),
		).toEqual({
			reopen: {
				kind: "managed",
				path: "/data/imports/ab12/a.pdf",
				origin: "content://x/document/8",
			},
			name: "Q3 (1).pdf",
			original: true,
		});
	});

	it("renames only in the app, letting go of an original out of reach", () => {
		for (const answer of ["unsupported", "permission", "not_found"])
			expect(originRenamed(answer, picked, "Q3.pdf")).toEqual({
				reopen: { kind: "managed", path: "/data/imports/ab12/a.pdf" },
				name: "Q3.pdf",
				original: false,
			});
	});

	it("is refused, renaming nothing, when the provider fails", () => {
		for (const answer of [null, { uri: "file:///x" }, 3])
			expect(() => originRenamed(answer, picked, "Q3.pdf")).toThrow(
				expect.objectContaining({ kind: "io" }),
			);
		expect(() => originRenamed({ uri: "content://x" }, doc, "Q3.pdf")).toThrow(
			expect.objectContaining({ kind: "unsupported" }),
		);
	});
});

describe("access kept to picked originals", () => {
	const origin = (n: number) => `content://media/document/${n}`;
	const picked = (n: number, openedAt = n) =>
		entry(
			{ kind: "managed", path: `/imports/${n}/a.pdf`, origin: origin(n) },
			{ openedAt },
		);

	it("holds what the list starts naming, and lets go of what it stops", () => {
		const a = picked(1);
		const b = picked(2);
		expect(originsChanged([a], [a, b])).toEqual({
			kept: [origin(2)],
			released: [],
		});
		expect(originsChanged([a, b], [b])).toEqual({
			kept: [],
			released: [origin(1)],
		});
		expect(originsChanged([a, b], [])).toEqual({
			kept: [],
			released: [origin(1), origin(2)],
		});
		expect(originsChanged([a], [a])).toEqual({ kept: [], released: [] });
	});

	it("never lets go of a document still opened where it is", () => {
		const a = picked(1);
		const saved = entry({ kind: "uri", uri: origin(1) });
		expect(originsChanged([a, saved], [saved]).released).toEqual([]);
	});

	it("follows a renamed original to its new address", () => {
		const a = picked(1);
		const renamed = renameRecent([a], a.id, "Q3.pdf", {
			kind: "managed",
			path: "/imports/1/a.pdf",
			origin: origin(9),
		}).list;
		expect(originsChanged([a], renamed)).toEqual({
			kept: [origin(9)],
			released: [origin(1)],
		});
	});

	it("keeps only the newest originals, older copies opening as before", () => {
		const list = [picked(1), picked(2), picked(3), entry(path("/d/x.pdf"))];
		expect(capOrigins(list, 3)).toBe(list);
		const capped = capOrigins(list, 2);
		expect(capped.map((e) => e.reopen)).toEqual([
			{ kind: "managed", path: "/imports/1/a.pdf" },
			list[1].reopen,
			list[2].reopen,
			list[3].reopen,
		]);
		// Same ids: what the reader kept stays with each.
		expect(capped.map((e) => e.id)).toEqual(list.map((e) => e.id));
		expect(originsChanged(list, capped).released).toEqual([origin(1)]);
	});

	it("is kept in the stored list, and an older entry simply has none", () => {
		const stored = [
			{ ...picked(1), reopen: { ...picked(1).reopen } },
			{ ...entry(copy), name: "b.pdf" },
			{
				...entry(copy),
				reopen: { kind: "managed", path: "/imports/2/c.pdf", origin: 5 },
			},
		];
		const read = normalizeRecents(stored);
		expect(read.find((e) => e.id === picked(1).id)?.reopen).toEqual(
			picked(1).reopen,
		);
		expect(
			read.find(
				(e) => e.reopen.kind === "managed" && e.reopen.path.includes("/2/"),
			)?.reopen,
		).toEqual({
			kind: "managed",
			path: "/imports/2/c.pdf",
		});
	});

	it("survives the same copy opened again without it", () => {
		const a = picked(1);
		const again = recordOpen(
			[a],
			{
				id: a.id,
				name: "a.pdf",
				format: "pdf",
				size: 10,
				reopen: { kind: "managed", path: "/imports/1/a.pdf" },
			},
			5,
			50,
		).list;
		expect(again[0].reopen).toEqual(a.reopen);
	});
});

describe("why a rename was refused", () => {
	it("says what the desktop side's kind means", () => {
		expect(renameRefusal({ kind: "exists", message: "" })).toBe(
			"Another file in that folder already has this name",
		);
		expect(renameRefusal(renameRefused("not_found"))).toBe(
			"The file is no longer where it was",
		);
		expect(renameRefusal({ kind: "invalid_name" })).toBe(
			"That name can't be used",
		);
	});

	it("reads the system's own words for the rest", () => {
		expect(
			renameRefusal({
				kind: "io",
				message:
					"The process cannot access the file because it is being used by another process. (os error 32)",
			}),
		).toMatch(/Another app is using this file/);
		expect(
			renameRefusal({ kind: "io", message: "Access is denied. (os error 5)" }),
		).toBe("Paperwren isn't allowed to rename this file");
		expect(
			renameRefusal({
				kind: "io",
				message: "Read-only file system (os error 30)",
			}),
		).toBe("Couldn't rename this file");
		expect(renameRefusal(renameRefused("io"))).toBe(
			"Couldn't rename this file",
		);
	});
});

describe("a renamed recent", () => {
	it("takes its new name and place, keeping what it had", () => {
		const from = path("C:\\Docs\\a.pdf");
		const to = path("C:\\Docs\\Q3.pdf");
		const list = [
			entry(from, {
				pinned: true,
				unavailable: true,
				position: { kind: "slides", slide: 4 },
			}),
			entry(path("C:\\Docs\\b.pdf"), { name: "b.pdf" }),
		];
		const done = renameRecent(list, list[0].id, "Q3.pdf", to);
		expect(done.id).toBe(idForReopen(to));
		expect(done.list).toHaveLength(2);
		expect(done.list[0]).toMatchObject({
			id: idForReopen(to),
			name: "Q3.pdf",
			reopen: to,
			pinned: true,
			position: { kind: "slides", slide: 4 },
			unavailable: undefined,
		});
		expect(done.list[1].name).toBe("b.pdf");
	});

	it("replaces a stale entry already at the new place", () => {
		const from = path("/d/a.pdf");
		const to = path("/d/Q3.pdf");
		const list = [entry(from), entry(to, { name: "Q3.pdf", openedAt: 0 })];
		const done = renameRecent(list, list[0].id, "Q3.pdf", to);
		expect(done.list).toHaveLength(1);
		expect(done.list[0].openedAt).toBe(1);
	});

	it("keeps its id when only the app's name changes", () => {
		const list = [entry(copy)];
		const done = renameRecent(list, list[0].id, "Q3.pdf", copy);
		expect(done.id).toBe(list[0].id);
		expect(done.list).toEqual([{ ...list[0], name: "Q3.pdf" }]);
	});

	it("moves what is kept by the old id", () => {
		const book = { old: [1, 2], other: [3] };
		expect(moveKeyed(book, "old", "new")).toEqual({
			new: [1, 2],
			other: [3],
		});
		expect(moveKeyed(book, "old", "old")).toBe(book);
		expect(moveKeyed(book, "missing", "new")).toBe(book);
	});
});
