import { describe, expect, it } from "vitest";
import {
	cleanPosition,
	idForReopen,
	managedRelPath,
	migrateLegacyRecents,
	normalizeRecents,
	recordOpen,
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
		expect(cleanPosition({ kind: "pdf" })).toBeUndefined();
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
