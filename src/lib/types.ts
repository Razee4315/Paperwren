import type { FileFormat } from "./formats";
import type { LanguageSetting } from "./i18n";

/** How a file can be read again after the app restarts. */
export type Reopen =
	| { kind: "uri"; uri: string } // Android content:// grant
	| { kind: "managed"; path: string } // copy under app_data/imports
	| { kind: "path"; path: string } // desktop filesystem path
	| { kind: "browser"; key: string } // dev/web preview (IndexedDB)
	| { kind: "memory"; key: string }; // inside another file, this run only

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
			/** Two pages side by side. */
			spread?: boolean;
			/** ...with the first page on its own, as a book's cover. */
			cover?: boolean;
			/** The white around what is printed is left out. */
			crop?: boolean;
			/** How many pages it has, to show how far through it this is. */
			pages?: number;
	  }
	| { kind: "scroll"; ratio: number; zoom?: number }
	| { kind: "sheet"; sheet: number; top: number; left: number; zoom?: number }
	| { kind: "slides"; slide: number }
	/** The picture on show of several (a comic book, a TIFF's pages). */
	| { kind: "pages"; page: number };

export interface RecentEntry {
	id: string;
	name: string;
	format: FileFormat;
	size: number;
	reopen: Reopen;
	openedAt: number;
	pinned: boolean;
	/** False when the name is a fallback we should try to replace. */
	nameVerified?: boolean;
	position?: Position;
	/** Last reopen attempt failed; Home offers to locate or remove. */
	unavailable?: boolean;
}

/** Paper (light), Sand (sepia) and Ink (dark). */
export type ResolvedTheme = "light" | "sepia" | "dark";
export type ThemeSetting = "system" | ResolvedTheme;
export type PdfZoom = "page-width" | "page-fit" | "auto";
/** The paper a document is read on: as the file has it, warm, dark,
 * or whichever of those the app's theme suggests. */
export type PageColor = "original" | "sepia" | "dark" | "theme";
/** How a PDF's pages follow one another: down a long scroll, or side
 * by side, a swipe (or a key) to the next. */
export type PdfFlow = "down" | "across";
/** The face books, Markdown and reading view are set in: the one
 * each document has, or one the reader picks. */
export type ReadingFont = "original" | "serif" | "sans";

export interface Settings {
	theme: ThemeSetting;
	/** The interface language; "system" follows the phone. */
	language: LanguageSetting;
	pdfZoom: PdfZoom;
	pdfFlow: PdfFlow;
	rememberPosition: boolean;
	pageColor: PageColor;
	readingFont: ReadingFont;
	/** Keep the screen from dimming while a document is open. */
	keepAwake: boolean;
	keepRecents: boolean;
	recentsLimit: number;
	/** Desktop: the panel of pages, contents or slides is open. */
	sidePanel: boolean;
	/** Word documents flow to the width of the screen instead of
	 * keeping their paper pages. */
	readingView: boolean;
	/** Text files wrap long lines to the width of the screen. */
	wrapText: boolean;
	/** How fast read aloud speaks, as a share of the voice's pace. */
	speechRate: number;
	/** Android: the volume keys turn the pages. */
	volumeKeys: boolean;
	/** A tap on the left or right side of the screen turns the page. */
	tapToTurn: boolean;
	/** The app opens with the document last read. */
	reopenLast: boolean;
	/** Phones: the bars go while the reader scrolls on, and come back
	 * when they scroll back. */
	autoHideBars: boolean;
	/** How dark the screen is made over the document (0 to 0.7). */
	dim: number;
	/** How fast a document scrolls by itself, in screen pixels a second. */
	scrollSpeed: number;
	/** A computer: check for a new version when the app starts ("auto"),
	 * never ("off"), or ask the reader first ("ask", until answered). */
	updates: UpdateChecks;
}

export type UpdateChecks = "ask" | "auto" | "off";

export const DEFAULT_SETTINGS: Settings = {
	theme: "system",
	language: "system",
	// Fit width, but never past 125%: a phone gets the full width, a
	// wide window a readable page instead of a quarter of one.
	pdfZoom: "auto",
	pdfFlow: "down",
	rememberPosition: true,
	pageColor: "original",
	readingFont: "original",
	keepAwake: false,
	keepRecents: true,
	recentsLimit: 50,
	sidePanel: false,
	readingView: false,
	wrapText: true,
	speechRate: 1,
	volumeKeys: false,
	tapToTurn: false,
	reopenLast: false,
	autoHideBars: false,
	dim: 0,
	scrollSpeed: 40,
	updates: "ask",
};

export const STORAGE_KEYS = {
	settings: "settings_v2",
	recents: "recents_v2",
	legacySettings: "settings",
	legacyRecents: "recents",
} as const;
