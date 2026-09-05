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

describe("versioned positions (docs/14 audit section 8)", () => {
	it("keeps v2 pdf payloads intact through normalization", () => {
		const position = {
			version: 2,
			kind: "pdf",
			location: {
				pageIndex: 7,
				x: 0.25,
				y: 0.75,
				viewportX: 0.5,
				viewportY: 0.5,
			},
			mode: "manual",
			scale: 1.37,
			rotation: 90,
		};
		const result = normalizeRecents([
			{ source: "/a/doc.pdf", name: "doc.pdf", format: "pdf", position },
		]);
		expect(result[0].position).toEqual(position);
	});

	it("keeps v2 sheet payloads with the sheet name", () => {
		const position = {
			version: 2,
			kind: "sheet",
			sheetName: "Q3",
			row: 12,
			col: 3,
			offsetX: 44,
			offsetY: 90,
		};
		const result = normalizeRecents([
			{ source: "/a/book.xlsx", name: "book.xlsx", format: "xlsx", position },
		]);
		expect(result[0].position).toEqual(position);
	});

	it("rejects nonfinite, fractional-page, and out-of-range v2 fields", () => {
		const result = normalizeRecents([
			{
				source: "/a/bad.pdf",
				name: "bad.pdf",
				format: "pdf",
				position: {
					version: 2,
					kind: "pdf",
					location: {
						pageIndex: 1.5,
						x: Number.NaN,
						y: 0,
						viewportX: 0.5,
						viewportY: 0.5,
					},
					mode: "manual",
					rotation: 90,
				},
			},
			{
				source: "/a/bad2.pdf",
				name: "bad2.pdf",
				format: "pdf",
				position: {
					version: 2,
					kind: "pdf",
					location: {
						pageIndex: 0,
						x: 0,
						y: 0,
						viewportX: 0.5,
						viewportY: 0.5,
					},
					mode: "sideways",
					rotation: 45,
				},
			},
		]);
		expect(result[0].position).toBeUndefined();
		expect(result[1].position).toBeUndefined();
	});

	it("clamps v2 fractions into 0..1 and floors sheet offsets", () => {
		const result = normalizeRecents([
			{
				source: "/a/clamp.pdf",
				name: "clamp.pdf",
				format: "pdf",
				position: {
					version: 2,
					kind: "pdf",
					location: {
						pageIndex: 0,
						x: 2,
						y: -1,
						viewportX: 0.25,
						viewportY: 0.9,
					},
					mode: "width",
					rotation: 0,
				},
			},
		]);
		expect(result[0].position).toMatchObject({
			version: 2,
			kind: "pdf",
			location: { x: 1, y: 0, viewportX: 0.25, viewportY: 0.9 },
			mode: "width",
			rotation: 0,
		});
	});

	it("still decodes legacy positions after reopening the app", () => {
		const result = normalizeRecents([
			{
				source: "/a/old.pdf",
				name: "old.pdf",
				format: "pdf",
				position: { page: 3, zoom: 2.5, scrollRatio: 0.5 },
			},
		]);
		expect(result[0].position).toEqual({
			page: 3,
			zoom: 2.5,
			scrollRatio: 0.5,
		});
	});
});
