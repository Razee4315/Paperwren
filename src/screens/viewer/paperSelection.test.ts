import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Selected text on paper (#17): every viewer that draws a page of its own
 * colours gives selection its own colours, and they read at WCAG AA. */

const css = (name: string) =>
	readFileSync(path.resolve(__dirname, name), "utf8");

/** The bodies of every rule whose selector ends in ::selection. */
const selectionRules = (sheet: string) =>
	[...sheet.matchAll(/([^{}]*::selection[^{}]*)\{([^}]*)\}/g)].map((m) => ({
		selector: m[1].trim(),
		background: /background:\s*(#[0-9a-f]{6})/i.exec(m[2])?.[1],
		color: /(?:^|[\s;])color:\s*(#[0-9a-f]{3,6})/i.exec(m[2])?.[1],
	}));

const channel = (v: number) => {
	const c = v / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
function luminance(hex: string) {
	const full =
		hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
	const [r, g, b] = [1, 3, 5].map((i) =>
		channel(Number.parseInt(full.slice(i, i + 2), 16)),
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

describe("selection on paper", () => {
	const rules = [
		...selectionRules(css("Doc.module.css")),
		...selectionRules(css("Slides.module.css")),
	];

	it("covers Word pages, reflowed paper, text slides and slides", () => {
		const selectors = rules.map((r) => r.selector).join("\n");
		expect(selectors).toContain("section.docx");
		expect(selectors).toContain(".paper");
		expect(selectors).toContain(".slideText");
		expect(selectors).toContain(".slide ");
	});

	it("reads at WCAG AA", () => {
		for (const rule of rules) {
			expect(rule.background, rule.selector).toBeDefined();
			expect(rule.color, rule.selector).toBeDefined();
			expect(
				contrast(rule.background ?? "", rule.color ?? ""),
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("leaves the app's own selection colour alone", () => {
		const global = selectionRules(css("../../styles/global.css"));
		expect(global).toHaveLength(1);
		expect(global[0].selector).toBe("::selection");
	});
});
