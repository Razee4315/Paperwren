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
	/** Durable reopen descriptor when the ingestion layer produced
	 * one; legacy flows fall back to `source`. */
	reopen?: ReopenDescriptor;
}

/** How a recent can be reopened after a process restart. Identity,
 * display name, and reopen mechanism are deliberately separate:
 * a content grant may be revoked, a managed copy may be cleared,
 * a desktop file may move. Each kind gets its own typed failure. */
export type ReopenDescriptor =
	| { kind: "persisted-uri"; uri: string }
	| { kind: "managed-copy"; path: string }
	| { kind: "desktop-path"; path: string };

/** Result of the native ingestion path (picker or open-with):
 * the real provider display name, sniffed-format input, size, and
 * the durable reopen descriptor. */
export interface IngestedDocument {
	id: string;
	displayName: string;
	size: number;
	reopen: ReopenDescriptor;
	/** Immediate read handle for this session. */
	readRef: string;
	importedAt: number;
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
	/** Durable reopen descriptor. Legacy entries without one are
	 * migrated from `source` by normalizeRecents. */
	reopen?: ReopenDescriptor;
	addedAt: number;
	lastOpenedAt: number;
	pinned: boolean;
	position?: FilePosition;
	/** Set when a reopen attempt failed; the dashboard shows a
	 * repair/remove affordance instead of a healthy entry. */
	unavailable?: boolean;
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
