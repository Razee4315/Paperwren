import { describe, expect, it } from "vitest";
import { normalizeRecents } from "../recents";

describe("normalizeRecents", () => {
	it("drops invalid rows and repairs unsafe persisted fields", () => {
		const result = normalizeRecents([
			null,
			{ source: "", name: "bad" },
			{
				source: "/docs/report.pdf",
				name: "  report.pdf  ",
				format: "broken",
				size: Number.NaN,
				addedAt: -10,
				lastOpenedAt: "yesterday",
				pinned: "yes",
				position: { page: -4, scrollRatio: 4 },
			},
		]);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			name: "report.pdf",
			format: "pdf",
			size: 0,
			addedAt: 0,
			lastOpenedAt: 0,
			pinned: false,
			position: { scrollRatio: 1 },
		});
	});

	it("deduplicates the same source and keeps its newest record", () => {
		const result = normalizeRecents([
			{ source: "/a.pdf", name: "old", format: "pdf", lastOpenedAt: 1 },
			{ source: "/a.pdf", name: "new", format: "pdf", lastOpenedAt: 2 },
		]);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("new");
	});

	it("repairs old extension-based and opaque Android labels", () => {
		const [named, opaque] = normalizeRecents([
			{ source: "/a/report.pdf", name: "report.pdf", format: "unknown" },
			{ source: "content://provider/1284", name: "1284", format: "unknown" },
		]);
		expect(named).toMatchObject({ name: "report.pdf", format: "pdf" });
		expect(opaque).toMatchObject({ name: "Document", format: "unknown" });
	});
});
