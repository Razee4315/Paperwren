import { describe, expect, it } from "vitest";
import {
	isDarkTheme,
	migrateLegacySettings,
	normalizeSettings,
	readingBarsOf,
	resolvePageColor,
	resolveTheme,
} from "../settings";
import { DEFAULT_SETTINGS } from "../types";

describe("settings", () => {
	it("falls back to defaults field by field", () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(
			normalizeSettings({ theme: "neon", darkPages: true, recentsLimit: 7 }),
		).toEqual({
			...DEFAULT_SETTINGS,
			pageColor: "theme",
		});
	});

	it("keeps a chosen page colour and drops an unknown one", () => {
		expect(normalizeSettings({ pageColor: "sepia" }).pageColor).toBe("sepia");
		expect(normalizeSettings({ pageColor: "neon" }).pageColor).toBe("original");
		// A choice made since wins over the old switch.
		expect(
			normalizeSettings({ pageColor: "dark", darkPages: false }).pageColor,
		).toBe("dark");
		expect(normalizeSettings({ darkPages: false }).pageColor).toBe("original");
	});

	it("turns the old bars switch into the choice that replaced it", () => {
		// On hid the bars as the reader scrolled; off kept them.
		expect(readingBarsOf({ autoHideBars: true })).toBe("scroll");
		expect(readingBarsOf({ autoHideBars: false })).toBe("always");
		expect(readingBarsOf({})).toBe("always");
		expect(readingBarsOf({ autoHideBars: "yes" })).toBe("always");
		// A choice made since wins over the old switch, and an unknown
		// one is read as the switch would be.
		expect(readingBarsOf({ readingBars: "tap", autoHideBars: false })).toBe(
			"tap",
		);
		expect(readingBarsOf({ readingBars: "never", autoHideBars: true })).toBe(
			"scroll",
		);
		const old = normalizeSettings({ autoHideBars: true });
		expect(old.readingBars).toBe("scroll");
		expect(old).not.toHaveProperty("autoHideBars");
		expect(normalizeSettings({ autoHideBars: false }).readingBars).toBe(
			"always",
		);
		expect(normalizeSettings(undefined).readingBars).toBe("always");
		// What is saved reads back the same.
		for (const readingBars of ["always", "scroll", "tap"] as const) {
			const saved = JSON.parse(
				JSON.stringify(normalizeSettings({ readingBars })),
			);
			expect(normalizeSettings(saved).readingBars).toBe(readingBars);
		}
	});

	it("keeps how PDF pages follow one another", () => {
		expect(normalizeSettings({ pdfFlow: "across" }).pdfFlow).toBe("across");
		expect(normalizeSettings({ pdfFlow: "one" }).pdfFlow).toBe("one");
		expect(normalizeSettings({ pdfFlow: "sideways" }).pdfFlow).toBe("down");
	});

	it("keeps the reading controls within their range", () => {
		const read = normalizeSettings({
			dim: 3,
			scrollSpeed: -5,
			volumeKeys: true,
			tapToTurn: "yes",
		});
		expect(read.dim).toBe(0.7);
		expect(read.scrollSpeed).toBe(10);
		expect(read.volumeKeys).toBe(true);
		expect(read.tapToTurn).toBe(false);
		expect(normalizeSettings({ dim: "dark" }).dim).toBe(0);
	});

	it("draws the page the theme suggests", () => {
		expect(resolvePageColor("theme", "light")).toBe("original");
		expect(resolvePageColor("theme", "sepia")).toBe("sepia");
		expect(resolvePageColor("theme", "dark")).toBe("dark");
		expect(resolvePageColor("sepia", "dark")).toBe("sepia");
	});

	it("migrates the old five-theme settings", () => {
		expect(
			migrateLegacySettings({
				"appearance.theme": "moss",
				"appearance.pure_black": true,
				"viewer.zoom_mode_pdf": "fit_page",
				"files.recents_limit": -1,
				"files.save_recents": false,
			}),
		).toMatchObject({
			theme: "dark",
			pdfZoom: "page-fit",
			recentsLimit: 500,
			keepRecents: false,
		});
		expect(migrateLegacySettings({ "appearance.theme": "sepia" }).theme).toBe(
			"sepia",
		);
	});

	it("folds retired v0.10 themes into the remaining three", () => {
		expect(normalizeSettings({ theme: "black" }).theme).toBe("dark");
		expect(normalizeSettings({ theme: "aurora" }).theme).toBe("dark");
		expect(normalizeSettings({ theme: "paper" }).theme).toBe("light");
		expect(normalizeSettings({ theme: "glass" }).theme).toBe("light");
		expect(normalizeSettings({ theme: "sepia" }).theme).toBe("sepia");
		expect(normalizeSettings({ accent: "ocean" })).toEqual(DEFAULT_SETTINGS);
	});

	it("resolves Auto to the plain white or dark the device asks for", () => {
		expect(resolveTheme("system", true)).toBe("plain-dark");
		expect(resolveTheme("system", false)).toBe("plain-light");
		expect(resolveTheme("sepia", true)).toBe("sepia");
	});

	it("keeps the plain themes, and treats plain Dark as dark", () => {
		expect(normalizeSettings({ theme: "plain-light" }).theme).toBe(
			"plain-light",
		);
		expect(normalizeSettings({ theme: "plain-dark" }).theme).toBe("plain-dark");
		expect(isDarkTheme("plain-dark")).toBe(true);
		expect(isDarkTheme("plain-light")).toBe(false);
		// The paper that follows the theme: white for Light, dark for Dark.
		expect(resolvePageColor("theme", "plain-light")).toBe("original");
		expect(resolvePageColor("theme", "plain-dark")).toBe("dark");
	});
});
