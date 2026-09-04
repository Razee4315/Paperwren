import { describe, expect, it } from "vitest";
import { buildSnippet, findMatches } from "../text";

describe("buildSnippet", () => {
	it("wraps a match with context and marks cuts", () => {
		const text = "a".repeat(100) + " needle " + "b".repeat(100);
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
