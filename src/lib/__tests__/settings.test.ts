import { describe, expect, it } from "vitest";
import {
	migrateLegacySettings,
	normalizeSettings,
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
			darkPages: true,
		});
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
			theme: "black",
			pdfZoom: "page-fit",
			recentsLimit: 500,
			keepRecents: false,
		});
		expect(migrateLegacySettings({ "appearance.theme": "sepia" }).theme).toBe(
			"light",
		);
	});

	it("resolves the system theme", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
		expect(resolveTheme("black", false)).toBe("black");
	});
});
