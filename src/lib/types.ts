import type { FileFormat } from "./formats";

/** How a file can be read again after the app restarts. */
export type Reopen =
	| { kind: "uri"; uri: string } // Android content:// grant
	| { kind: "managed"; path: string } // copy under app_data/imports
	| { kind: "path"; path: string } // desktop filesystem path
	| { kind: "browser"; key: string }; // dev/web preview (IndexedDB)

/** A file the user asked to open. */
export interface OpenRequest {
	/** Stable identity for recents. */
	id: string;
	name: string;
	/** True when the name came from the provider/OS, not a URI guess. */
	nameVerified: boolean;
	size: number;
	reopen: Reopen;
	/** Carried over when a recent is repaired by picking the file again. */
	position?: Position;
}

/** Where the reader stopped, per viewer. Small and versionless: a
 * shape a viewer does not recognise is simply ignored. */
export type Position =
	| {
			kind: "pdf";
			page: number; // 1-based
			scale: string; // pdf.js scale value: "page-width" | "page-fit" | "1.25"
			top: number; // PDF points from the page top
			left: number;
			rotation: number;
	  }
	| { kind: "scroll"; ratio: number; zoom?: number }
	| { kind: "sheet"; sheet: number; top: number; left: number }
	| { kind: "slides"; slide: number };

export interface RecentEntry {
	id: string;
	name: string;
	format: FileFormat;
	size: number;
	reopen: Reopen;
	openedAt: number;
	pinned: boolean;
	position?: Position;
	/** Last reopen attempt failed; Home offers to locate or remove. */
	unavailable?: boolean;
}

export type ThemeSetting = "system" | "light" | "dark" | "black";
export type ResolvedTheme = "light" | "dark" | "black";
export type PdfZoom = "page-width" | "page-fit" | "auto";
export type Accent = "sunset" | "ocean" | "forest" | "berry" | "mono";

export interface Settings {
	theme: ThemeSetting;
	accent: Accent;
	pdfZoom: PdfZoom;
	rememberPosition: boolean;
	darkPages: boolean;
	keepRecents: boolean;
	recentsLimit: number;
}

export const DEFAULT_SETTINGS: Settings = {
	theme: "system",
	accent: "sunset",
	pdfZoom: "page-width",
	rememberPosition: true,
	darkPages: false,
	keepRecents: true,
	recentsLimit: 50,
};

export const STORAGE_KEYS = {
	settings: "settings_v2",
	recents: "recents_v2",
	legacySettings: "settings",
	legacyRecents: "recents",
} as const;
