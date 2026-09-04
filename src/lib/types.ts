import type { FileFormat } from "@/components/FormatBadge";

/** Data contracts shared by screens, state, and the Rust core
 * (docs/08 settings key registry, docs/10 section 5 storage map). */

export interface FileMeta {
	name: string;
	format: FileFormat;
	size: number;
	/** Handle the backend gave us for reading bytes (cache path in
	 * Tauri, an object URL key in the browser). */
	ref: string;
	/** Original path or URI the file came from, for recents. */
	source: string;
}

export interface FilePosition {
	page?: number;
	zoom?: number;
	scrollRatio?: number;
}

export interface RecentsEntry {
	id: string;
	name: string;
	format: FileFormat;
	size: number;
	source: string;
	addedAt: number;
	lastOpenedAt: number;
	pinned: boolean;
	position?: FilePosition;
}

export type ThemeSetting =
	| "system"
	| "light"
	| "dark"
	| "sepia"
	| "moss"
	| "slate";
export type ResolvedTheme = "paper" | "midnight" | "sepia" | "moss" | "slate";
export type ZoomMode = "fit_width" | "fit_page" | "100";
export type RecentsLimit = 20 | 50 | 100 | -1;

export interface Settings {
	"appearance.theme": ThemeSetting;
	"appearance.pure_black": boolean;
	"viewer.zoom_mode_pdf": ZoomMode;
	"viewer.remember_position": boolean;
	"viewer.darken_pages": boolean;
	"viewer.chrome_autohide": boolean;
	"viewer.haptics": boolean;
	"files.save_recents": boolean;
	"files.recents_limit": RecentsLimit;
}

export const DEFAULT_SETTINGS: Settings = {
	"appearance.theme": "system",
	"appearance.pure_black": false,
	"viewer.zoom_mode_pdf": "fit_width",
	"viewer.remember_position": true,
	"viewer.darken_pages": false,
	"viewer.chrome_autohide": true,
	"viewer.haptics": true,
	"files.save_recents": true,
	"files.recents_limit": 50,
};

export const STORAGE_KEYS = {
	settings: "settings",
	recents: "recents",
	onboarded: "onboarded",
	coachMarks: "coach_marks",
} as const;
