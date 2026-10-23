import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* Every theme's text colours read at WCAG AA (4.5:1) on every surface
 * text sits on, the faint one (--text-3) included. */

const css = readFileSync(path.resolve(__dirname, "global.css"), "utf8");

/** The colour tokens a theme's own block sets. */
function theme(name: string): Record<string, string> {
	const block = new RegExp(
		String.raw`\[data-theme="${name}"\]\s*\{([^}]*)\}`,
	).exec(css)?.[1];
	if (!block) throw new Error(`no ${name} theme`);
	return Object.fromEntries(
		[...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [
			m[1],
			m[2],
		]),
	);
}

const channel = (v: number) => {
	const c = v / 255;
	return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
	const [r, g, b] = [1, 3, 5].map((i) =>
		channel(Number.parseInt(hex.slice(i, i + 2), 16)),
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

describe.each(["light", "sepia", "dark"])("the %s theme", (name) => {
	const tokens = theme(name);

	it.each(["--text", "--text-2", "--text-3", "--accent", "--success"])(
		"%s reads on its surfaces",
		(ink) => {
			for (const surface of ["--bg", "--surface", "--surface-2"]) {
				expect(tokens[ink], ink).toBeDefined();
				expect(
					contrast(tokens[ink], tokens[surface]),
					`${ink} on ${surface}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		},
	);

	it("keeps the accent readable on its soft background", () => {
		expect(
			contrast(tokens["--accent"], tokens["--accent-soft"]),
		).toBeGreaterThanOrEqual(4.5);
	});

	it("keeps faint text fainter than secondary text", () => {
		expect(contrast(tokens["--text-2"], tokens["--surface"])).toBeGreaterThan(
			contrast(tokens["--text-3"], tokens["--surface"]),
		);
	});
});
