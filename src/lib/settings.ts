import {
	type Accent,
	DEFAULT_SETTINGS,
	type PdfZoom,
	type ResolvedTheme,
	type Settings,
	type ThemeSetting,
} from "./types";

const THEMES: ThemeSetting[] = ["system", "light", "dark", "black"];
export const ACCENTS: Accent[] = ["sunset", "ocean", "forest", "berry", "mono"];
const ZOOMS: PdfZoom[] = ["page-width", "page-fit", "auto"];
const LIMITS = [20, 50, 100, 500];

/** Validate stored settings field by field; unknown values fall back
 * to defaults instead of reaching the UI. */
export function normalizeSettings(value: unknown): Settings {
	if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
	const raw = value as Record<string, unknown>;
	const pick = <T>(v: unknown, allowed: T[], fallback: T): T =>
		allowed.includes(v as T) ? (v as T) : fallback;
	const bool = (v: unknown, fallback: boolean) =>
		typeof v === "boolean" ? v : fallback;
	return {
		theme: pick(raw.theme, THEMES, DEFAULT_SETTINGS.theme),
		accent: pick(raw.accent, ACCENTS, DEFAULT_SETTINGS.accent),
		pdfZoom: pick(raw.pdfZoom, ZOOMS, DEFAULT_SETTINGS.pdfZoom),
		rememberPosition: bool(
			raw.rememberPosition,
			DEFAULT_SETTINGS.rememberPosition,
		),
		darkPages: bool(raw.darkPages, DEFAULT_SETTINGS.darkPages),
		keepRecents: bool(raw.keepRecents, DEFAULT_SETTINGS.keepRecents),
		recentsLimit: pick(raw.recentsLimit, LIMITS, DEFAULT_SETTINGS.recentsLimit),
	};
}

/** Map the pre-redesign key/value shape ("appearance.theme", five
 * named palettes, ...) onto the new settings. */
export function migrateLegacySettings(value: unknown): Settings {
	if (!value || typeof value !== "object") return { ...DEFAULT_SETTINGS };
	const raw = value as Record<string, unknown>;
	const legacyTheme = raw["appearance.theme"];
	const pureBlack = raw["appearance.pure_black"] === true;
	let theme: ThemeSetting = "system";
	if (legacyTheme === "light" || legacyTheme === "sepia") theme = "light";
	else if (
		legacyTheme === "dark" ||
		legacyTheme === "moss" ||
		legacyTheme === "slate"
	)
		theme = pureBlack ? "black" : "dark";
	const zoom = raw["viewer.zoom_mode_pdf"];
	const limit = raw["files.recents_limit"];
	return normalizeSettings({
		theme,
		pdfZoom:
			zoom === "fit_page" ? "page-fit" : zoom === "100" ? "auto" : "page-width",
		rememberPosition: raw["viewer.remember_position"],
		darkPages: raw["viewer.darken_pages"],
		keepRecents: raw["files.save_recents"],
		recentsLimit: limit === -1 ? 500 : limit,
	});
}

export function resolveTheme(
	theme: ThemeSetting,
	systemDark: boolean,
): ResolvedTheme {
	if (theme === "system") return systemDark ? "dark" : "light";
	return theme;
}
