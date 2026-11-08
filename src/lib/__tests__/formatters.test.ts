import { describe, expect, it } from "vitest";
import { compareNames, formatDate, tn } from "../i18n";

describe("the kept formatters", () => {
	it("orders names as a person counts them, whatever their case", () => {
		const names = [
			"page 10.pdf",
			"Page 2.pdf",
			"page 1.pdf",
			"Árbol.pdf",
			"apple.pdf",
		];
		expect([...names].sort(compareNames)).toEqual([
			"apple.pdf",
			"Árbol.pdf",
			"page 1.pdf",
			"Page 2.pdf",
			"page 10.pdf",
		]);
	});

	it("writes a date and a time, as toLocaleDateString does", () => {
		const d = new Date(2026, 10, 8, 15, 6);
		const options = { month: "short", day: "numeric" } as const;
		expect(formatDate(d, options)).toBe(
			d.toLocaleDateString(undefined, options),
		);
		// The same formatter twice: the same words.
		expect(formatDate(d.getTime(), options)).toBe(formatDate(d, options));
		expect(formatDate(d, { hour: "numeric", minute: "2-digit" })).toMatch(
			/3|15/,
		);
	});

	it("still picks the plural form", () => {
		expect(tn(1, "{n} page", "{n} pages")).toBe("1 page");
		expect(tn(3, "{n} page", "{n} pages")).toBe("3 pages");
	});
});
