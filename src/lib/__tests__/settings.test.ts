import { describe, expect, it } from "vitest";
import {
	isDarkTheme,
	migrateLegacySettings,
	normalizeSettings,
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

	it("keeps how PDF pages follow one another", () => {
		expect(normalizeSettings({ pdfFlow: "across" }).pdfFlow).toBe("across");
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

	it("resolves the system theme", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
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
