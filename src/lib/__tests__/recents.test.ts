import { describe, expect, it } from "vitest";
import { androidSaved, requestForSaved } from "../backend";
import {
	PICK_GRACE,
	capOrigins,
	cleanPosition,
	folderOf,
	idForReopen,
	isTreeDocument,
	lastingDocument,
	managedRelPath,
	migrateLegacyRecents,
	normalizeGrants,
	normalizeRecents,
	originsChanged,
	recordOpen,
	sharedNames,
	strayGrants,
} from "../recents";
import type { RecentEntry, Reopen } from "../types";

const uri = (n: number): Reopen => ({
	kind: "uri",
	uri: `content://docs/${n}`,
});
const entry = (n: number, extra: Partial<RecentEntry> = {}): RecentEntry => ({
	id: idForReopen(uri(n)),
	name: `f${n}.pdf`,
	format: "pdf",
	size: 10,
	reopen: uri(n),
	openedAt: n,
	pinned: false,
	...extra,
});

describe("idForReopen", () => {
	it("is stable and distinguishes sources", () => {
		expect(idForReopen(uri(1))).toBe(idForReopen(uri(1)));
		expect(idForReopen(uri(1))).not.toBe(idForReopen(uri(2)));
		expect(idForReopen({ kind: "browser", key: "a" })).not.toBe(
			idForReopen({ kind: "path", path: "a" }),
		);
	});
});

describe("recordOpen", () => {
	it("adds new entries on top", () => {
		const { list } = recordOpen([entry(1)], { ...entry(2) }, 100, 50);
		expect(list.map((e) => e.name)).toEqual(["f2.pdf", "f1.pdf"]);
	});

	it("updates in place, clears unavailable, keeps pin and position", () => {
		const start = [
			entry(1, {
				pinned: true,
				unavailable: true,
				position: { kind: "slides", slide: 3 },
			}),
		];
		const { list } = recordOpen(
			start,
			{ ...entry(1), name: "renamed.pdf", position: undefined },
			500,
			50,
		);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			name: "renamed.pdf",
			pinned: true,
			openedAt: 500,
			unavailable: undefined,
		});
		expect(list[0].position).toEqual({ kind: "slides", slide: 3 });
	});

	it("evicts the oldest unpinned entries beyond the limit", () => {
		const start = [entry(1, { pinned: true }), entry(2), entry(3)];
		const { list, evicted } = recordOpen(start, entry(4), 1000, 2);
		expect(list.map((e) => e.name)).toEqual(["f1.pdf", "f4.pdf", "f3.pdf"]);
		expect(evicted.map((e) => e.name)).toEqual(["f2.pdf"]);
	});
});

describe("a copy a tool saved (#19)", () => {
	it("opens from where Android saved it, and goes into Recent files", () => {
		const saved = androidSaved(
			{ name: "Scan 1.pdf", uri: "content://docs/document/7" },
			"Scan.pdf",
		);
		expect(saved).toEqual({
			name: "Scan 1.pdf",
			reopen: { kind: "uri", uri: "content://docs/document/7" },
		});
		const request = requestForSaved(saved, 1234);
		if (!request) throw new Error("no way to open the saved copy");
		const { list } = recordOpen(
			[],
			{ ...request, format: "pdf", size: request.size },
			100,
			50,
		);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({
			id: idForReopen({ kind: "uri", uri: "content://docs/document/7" }),
			name: "Scan 1.pdf",
			reopen: { kind: "uri", uri: "content://docs/document/7" },
		});
	});

	it("can only be named when the platform gives no address", () => {
		expect(androidSaved("Scan 1.pdf", "Scan.pdf")).toEqual({
			name: "Scan 1.pdf",
		});
		expect(androidSaved({ name: "", uri: "file:///x" }, "Scan.pdf")).toEqual({
			name: "Scan.pdf",
			reopen: undefined,
		});
		expect(requestForSaved({ name: "Scan.pdf" }, 10)).toBeNull();
	});
});

describe("normalizeRecents", () => {
	it("drops garbage, dedupes by id, sorts pinned first", () => {
		const list = normalizeRecents([
			null,
			{ name: "no reopen" },
			{ ...entry(1), openedAt: 5 },
			{ ...entry(1), openedAt: 9, name: "newer.pdf" },
			{ ...entry(2), pinned: true, format: "bogus", name: "x.docx" },
		]);
		expect(list.map((e) => e.name)).toEqual(["x.docx", "newer.pdf"]);
		expect(list[0].format).toBe("docx");
	});
	it("returns [] for non-arrays", () => {
		expect(normalizeRecents({})).toEqual([]);
	});
});

describe("cleanPosition", () => {
	it("validates each kind", () => {
		expect(
			cleanPosition({
				kind: "pdf",
				page: 3.7,
				scale: "page-width",
				top: 10,
				left: 0,
				rotation: 45,
			}),
		).toEqual({
			kind: "pdf",
			page: 3,
			scale: "page-width",
			top: 10,
			left: 0,
			rotation: 0,
		});
		expect(cleanPosition({ kind: "scroll", ratio: 7 })).toEqual({
			kind: "scroll",
			ratio: 1,
			zoom: undefined,
		});
		expect(
			cleanPosition({ kind: "sheet", sheet: 1, top: 40, left: 8, zoom: 1.5 }),
		).toEqual({ kind: "sheet", sheet: 1, top: 40, left: 8, zoom: 1.5 });
		expect(cleanPosition({ kind: "pages", page: 4.6 })).toEqual({
			kind: "pages",
			page: 4,
		});
		expect(cleanPosition({ kind: "pdf" })).toBeUndefined();
		expect(cleanPosition({ kind: "nope" })).toBeUndefined();
	});

	it("keeps two pages side by side across a restart", () => {
		const pdf = { kind: "pdf", page: 2, scale: "auto", top: 0, left: 0 };
		expect(cleanPosition({ ...pdf, rotation: 0, spread: true })).toEqual({
			...pdf,
			rotation: 0,
			spread: true,
		});
		expect(cleanPosition({ ...pdf, spread: "yes" })).not.toHaveProperty(
			"spread",
		);
		expect(cleanPosition({ ...pdf, spread: true, cover: true })).toMatchObject({
			spread: true,
			cover: true,
		});
		// Crop margins as kept before boxes by hand: the app's crop.
		expect(cleanPosition({ ...pdf, crop: true })).toMatchObject({
			crop: { auto: true },
		});
		// A cover only means something beside a second page.
		expect(cleanPosition({ ...pdf, cover: true })).not.toHaveProperty("cover");
		expect(cleanPosition({ kind: "nope" })).toBeUndefined();
	});
});

describe("migrateLegacyRecents", () => {
	it("converts every old reopen kind and keeps the PDF page", () => {
		const list = migrateLegacyRecents([
			{
				name: "a.pdf",
				format: "pdf",
				source: "content://x/1",
				reopen: { kind: "persisted-uri", uri: "content://x/1" },
				lastOpenedAt: 3,
				pinned: true,
				position: {
					version: 2,
					kind: "pdf",
					location: { pageIndex: 4 },
					mode: "page",
					rotation: 90,
				},
			},
			{ name: "b.docx", source: "/data/files/imports/b.docx", lastOpenedAt: 2 },
			{ name: "c.xlsx", source: "browser:c.xlsx", lastOpenedAt: 1 },
			{
				name: "d.txt",
				source: "C:\\docs\\d.txt",
				reopen: { kind: "desktop-path", path: "C:\\docs\\d.txt" },
			},
		]);
		expect(list.map((e) => e.reopen.kind)).toEqual([
			"uri",
			"managed",
			"browser",
			"path",
		]);
		expect(list[0].position).toMatchObject({
			kind: "pdf",
			page: 5,
			scale: "page-fit",
			rotation: 90,
		});
		expect(list[0].pinned).toBe(true);
	});
});

describe("managedRelPath", () => {
	it("extracts the path under imports/", () => {
		expect(
			managedRelPath("/data/user/0/app/files/imports/ab12/Report.pdf"),
		).toBe("ab12/Report.pdf");
		expect(managedRelPath("C:\\x\\imports\\a.pdf")).toBe("a.pdf");
		expect(managedRelPath("/tmp/other.pdf")).toBeNull();
	});
});

describe("two recent files of one name", () => {
	it("are told apart by the folder each came from", () => {
		expect(
			folderOf({
				kind: "path",
				path: "C:\\Users\\me\\Desktop\\Marketing\\Deck.pptx",
			}),
		).toBe("Marketing");
		expect(
			folderOf({ kind: "path", path: "/home/me/Downloads/Deck.pptx" }),
		).toBe("Downloads");
		expect(
			folderOf({
				kind: "uri",
				uri: "content://com.android.externalstorage.documents/document/primary%3ADownload%2FDeck.pptx",
			}),
		).toBe("Download");
	});

	it("say nothing where the way back names no folder", () => {
		expect(
			folderOf({
				kind: "uri",
				uri: "content://com.android.providers.downloads.documents/document/msf%3A1234",
			}),
		).toBeNull();
		expect(
			folderOf({ kind: "managed", path: "imports/ab12/Deck.pptx" }),
		).toBeNull();
		expect(folderOf({ kind: "path", path: "Deck.pptx" })).toBeNull();
	});

	it("are found by name, whatever its case", () => {
		const entry = (id: string, name: string) =>
			({
				id,
				name,
				format: "pdf",
				size: 1,
				openedAt: 1,
				pinned: false,
				reopen: { kind: "browser", key: id },
			}) as const;
		const twins = sharedNames([
			entry("a", "Notes.pdf"),
			entry("b", "notes.PDF"),
			entry("c", "Other.pdf"),
		]);
		expect([...twins]).toEqual(["notes.pdf"]);
	});
});

describe("documents opened where they are (Open file, #95)", () => {
	const PICKED =
		"content://com.android.providers.downloads.documents/document/msf%3A31";
	const TREE =
		"content://com.android.externalstorage.documents/tree/primary%3ADownload";
	const IN_FOLDER = `${TREE}/document/primary%3ADownload%2Fa.pdf`;
	const doc = (u: string, extra: Partial<RecentEntry> = {}): RecentEntry => ({
		...entry(0),
		id: idForReopen({ kind: "uri", uri: u }),
		reopen: { kind: "uri", uri: u },
		...extra,
	});
	const copyOf = (origin: string, openedAt = 0): RecentEntry => ({
		...entry(0),
		id: idForReopen({ kind: "managed", path: `/imports/${openedAt}/a.pdf` }),
		reopen: { kind: "managed", path: `/imports/${openedAt}/a.pdf`, origin },
		openedAt,
	});

	it("tells a folder's document from one picked on its own", () => {
		expect(isTreeDocument(IN_FOLDER)).toBe(true);
		expect(isTreeDocument(PICKED)).toBe(false);
		expect(lastingDocument(doc(PICKED))).toBe(PICKED);
		expect(lastingDocument(doc(IN_FOLDER))).toBeNull();
		expect(lastingDocument(copyOf(PICKED))).toBe(PICKED);
		expect(
			lastingDocument(entry(1, { reopen: { kind: "path", path: "/a" } })),
		).toBeNull();
	});

	it("holds a picked document the list names, and lets it go when it leaves", () => {
		const a = doc(PICKED);
		expect(originsChanged([], [a])).toEqual({ kept: [PICKED], released: [] });
		expect(originsChanged([a], [])).toEqual({ kept: [], released: [PICKED] });
	});

	it("never holds or lets go of a file in a folder the reader chose", () => {
		const f = doc(IN_FOLDER);
		expect(originsChanged([], [f])).toEqual({ kept: [], released: [] });
		expect(originsChanged([f], [])).toEqual({ kept: [], released: [] });
	});

	it("keeps access while another entry still names the document", () => {
		const a = doc(PICKED);
		const copy = copyOf(PICKED);
		expect(originsChanged([a, copy], [copy]).released).toEqual([]);
		expect(originsChanged([a, copy], [a]).released).toEqual([]);
		expect(originsChanged([a, copy], []).released).toEqual([PICKED]);
	});

	it("drops the oldest picked documents past the cap, but not a pinned one", () => {
		const d = (n: number, extra: Partial<RecentEntry> = {}) =>
			doc(`content://media/document/${n}`, { openedAt: n, ...extra });
		const folder = doc(IN_FOLDER, { openedAt: 0 });
		const list = [
			d(4),
			d(3),
			d(2, { pinned: true }),
			d(1),
			copyOf(PICKED, 5),
			folder,
		];
		expect(capOrigins(list, 5)).toBe(list);
		const capped = capOrigins(list, 2);
		// Newest two (the copy, d4) keep access; d3 and d1 leave; d2 is
		// pinned and stays; the folder's file is not counted.
		expect(capped.map((e) => e.id)).toEqual(
			[d(4), d(2), copyOf(PICKED, 5), folder].map((e) => e.id),
		);
		expect(originsChanged(list, capped).released).toEqual([
			"content://media/document/3",
			"content://media/document/1",
		]);
	});
});

describe("access taken at a pick that no entry took up", () => {
	const A = "content://media/document/1";
	const B = "content://media/document/2";
	const C = "content://media/document/3";
	const named: RecentEntry = {
		...entry(0),
		id: idForReopen({ kind: "uri", uri: A }),
		reopen: { kind: "uri", uri: A },
	};
	const started = 1_000_000;

	it("leaves the ledger once the list names it", () => {
		expect(
			strayGrants({ [A]: started + 1 }, [named], [], started + 2, started),
		).toEqual({ release: [], settled: [A] });
	});

	it("is given back once closed and past its first moments", () => {
		const now = started + PICK_GRACE + 10;
		const pending = { [B]: started + 5, [C]: now - 1 };
		expect(strayGrants(pending, [named], [], now, started)).toEqual({
			release: [B],
			settled: [B],
		});
		// Open in a tab or a tool: kept, however old.
		expect(strayGrants(pending, [named], [B], now, started)).toEqual({
			release: [],
			settled: [],
		});
	});

	it("from a run before this one is given back at once", () => {
		expect(
			strayGrants({ [B]: started - 1 }, [], [], started + 1, started),
		).toEqual({ release: [B], settled: [B] });
	});

	it("is read back only where well formed", () => {
		expect(
			normalizeGrants({ [A]: 5, "file:///x": 1, [B]: "no", [C]: -1 }),
		).toEqual({ [A]: 5 });
		expect(normalizeGrants(null)).toEqual({});
		expect(normalizeGrants([A])).toEqual({});
	});
});
