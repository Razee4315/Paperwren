import { describe, expect, it } from "vitest";
import { buildSnippet, findMatches, middleTruncate } from "../text";

describe("buildSnippet", () => {
	it("wraps a match with context and marks cuts", () => {
		const text = `${"a".repeat(100)} needle ${"b".repeat(100)}`;
		const snippet = buildSnippet(text, 100, 6);
		expect(snippet.startsWith("...")).toBe(true);
		expect(snippet.endsWith("...")).toBe(true);
		expect(snippet).toContain("needle");
	});

	it("has no leading ellipsis when the match is at the start", () => {
		const snippet = buildSnippet("needle in a haystack", 0, 6);
		expect(snippet.startsWith("...")).toBe(false);
	});

	it("collapses whitespace runs", () => {
		const snippet = buildSnippet("word1\n\nword2   needle", 12, 6);
		expect(snippet).not.toMatch(/\s{2,}/);
	});
});

describe("findMatches", () => {
	it("is case-insensitive", () => {
		const hits = findMatches("The Viewer Works", "viewer works", 1, 5);
		expect(hits).toHaveLength(1);
		expect(hits[0].page).toBe(1);
	});

	it("respects the per-page hit cap", () => {
		const hits = findMatches("x x x x x x", "x", 3, 5);
		expect(hits).toHaveLength(5);
	});

	it("returns nothing when there is no match", () => {
		expect(findMatches("nothing to see", "zebra", 2, 5)).toHaveLength(0);
	});

	it("finds adjacent matches without overlap", () => {
		const hits = findMatches("ababab", "ab", 1, 10);
		expect(hits).toHaveLength(3);
	});
});

describe("middleTruncate", () => {
	// Monospace-ish measure: one unit per character, so budgets read
	// as character counts.
	const measure = (s: string) => s.length * 10;

	it("returns the text untouched when it fits", () => {
		expect(middleTruncate("report.pdf", 100, measure)).toBe("report.pdf");
		expect(middleTruncate("report.pdf", measure("report.pdf"), measure)).toBe(
			"report.pdf",
		);
	});

	it("keeps BOTH ends and the extension when cutting", () => {
		const out = middleTruncate("Quarterly financial report.pdf", 150, measure);
		expect(out.startsWith("Qua")).toBe(true);
		expect(out.endsWith("report.pdf")).toBe(true);
		expect(out).toContain("…");
		expect(measure(out)).toBeLessThanOrEqual(150);
	});

	it("fits an arbitrarily tight budget with extension intact", () => {
		const out = middleTruncate(
			"an extremely long document name that will never fit.xlsx",
			80,
			measure,
		);
		expect(measure(out)).toBeLessThanOrEqual(80);
		expect(out.endsWith(".xlsx")).toBe(true);
	});

	it("degrades to the extension, then a bare ellipsis, when tiny", () => {
		expect(middleTruncate("document.pdf", 50, measure)).toBe("….pdf");
		expect(middleTruncate("document.pdf", 5, measure)).toBe("…");
	});

	it("handles extensionless names", () => {
		const out = middleTruncate("README", 30, measure);
		expect(measure(out)).toBeLessThanOrEqual(30);
	});
});
