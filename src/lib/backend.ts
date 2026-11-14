/**
 * The single platform boundary. Everything the UI needs from the
 * host (pick a file, read bytes, persist JSON, manage imported
 * copies) goes through `backend`, which is the Tauri implementation
 * in the app and an in-browser implementation in dev/tests.
 */

import { isTauri } from "./env";
import { OpenError, classifyError } from "./errors";
import { storedFileClear, storedFileGet, storedFilePut } from "./fileStore";
import {
	type FileFormat,
	PICKER_EXTENSIONS,
	SCRIPT_EXTENSIONS,
	extensionOf,
	formatFromName,
	mimeOf,
} from "./formats";
import { compareNames, formatNumber, msg, t } from "./i18n";
import { openHeader, saveAsking, saveRefused } from "./openFiles";
import { idForReopen, managedRelPath } from "./recents";
import {
	type Renamed,
	documentRenamed,
	originRenamed,
	renameRefused,
	renameWay,
} from "./rename";
import { createSerializedWriter } from "./serializedWriter";
import type { OpenRequest, Reopen } from "./types";

export interface ImportsStats {
	bytes: number;
	files: number;
}

/** A file the user is looking at, as other apps need it described. */
export interface FileRef {
	name: string;
	format: FileFormat;
	reopen: Reopen;
}

/** What this platform can do with a given file. */
export interface FileAbilities {
	/** Send it to another app or person (system share sheet). */
	share: boolean;
	/** The share falls back to saving a copy (no share sheet here). */
	shareIsDownload: boolean;
	/** Save a copy of it as a new file, where the reader picks. */
	saveCopy: boolean;
	/** Open it in another installed app. */
	openWith: boolean;
	/** Show it in the system file manager. */
	reveal: boolean;
	/** Give it a new name. */
	rename: boolean;
	/** A rename reaches the file itself (or is tried there). False where
	 * only the name it goes by in Paperwren can change: a copy the app
	 * holds, whose original is out of reach. */
	renameOriginal: boolean;
}

/** A folder the user chose to browse from Home. */
export interface Folder {
	/** Stable identity: the path or tree URI. */
	id: string;
	name: string;
	source:
		| { kind: "path"; path: string } // desktop
		| { kind: "tree"; uri: string } // Android (Storage Access Framework)
		| { kind: "browser"; key: string }; // dev / web preview
}

/** A document found in a browsed folder. */
export interface FolderFile {
	name: string;
	size: number;
	/** Last modified, ms since the epoch; 0 when unknown. */
	modified: number;
	/** Sub-folder inside the browsed folder ("" for its top level). */
	folder: string;
	request: OpenRequest;
}

/** A file the reader saved: its name, and where to open it again
 * when the platform says. */
export interface SavedFile {
	name: string;
	reopen?: Reopen;
}

/** Bounds for a folder scan, matched on the native side. */
export const FOLDER_LIMITS = { files: 2000, folders: 400, depth: 4 } as const;

/** What the app does while files hover over, and land on, the window. */
export interface DropHandlers {
	hover(active: boolean): void;
	drop(requests: OpenRequest[]): void;
}

/** What a signature or a stamp can be picked from. */
const PICTURE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

/** One of several picked files, made ready when called. */
export type PickedFile = () => Promise<OpenRequest>;
/** What a digital ID (a certificate with its private key) comes in. */
const DIGITAL_ID_EXTENSIONS = ["pfx", "p12"];

/** A digital ID the reader picked, read into memory. */
export interface PickedDigitalId {
	name: string;
	bytes: Uint8Array;
}

interface Backend {
	/** Ask for a document to open; with `pictures`, for a picture only. */
	pickFile(options?: { pictures?: boolean }): Promise<OpenRequest | null>;
	/** Ask for several at once (a tool that puts many together), in the
	 * order the picker gives them. None when the reader cancels. Each is
	 * made ready only when asked for (on Android that copies it in), so
	 * the caller can show how far it is and leave the rest alone. */
	pickFiles(options?: { pictures?: boolean }): Promise<PickedFile[]>;
	/** Ask for a digital ID (.pfx, .p12) and read it into memory. It is
	 * never copied, kept among the recent files or stored: it holds a
	 * private key, and is wanted for one signing only. Null when the
	 * reader cancels. */
	pickDigitalId(): Promise<PickedDigitalId | null>;
	/** Files dragged onto the window (desktop). Returns an unsubscribe. */
	onFileDrop(handlers: DropHandlers): () => void;
	/** True where the user can pick a folder to browse. */
	canBrowseFolders(): boolean;
	/** Ask for a folder. Null when the user cancels. */
	pickFolder(): Promise<Folder | null>;
	/** The documents in a folder (a few levels deep, bounded). Rejects
	 * when the folder is gone or access to it was withdrawn. */
	listFolder(folder: Folder): Promise<FolderFile[]>;
	/** Stop holding access to a folder the user removed. */
	forgetFolder(folder: Folder): void;
	/** Files the system asks the app to open (desktop: a double-clicked
	 * document, "Open with Paperwren"): the ones it was started with,
	 * and on a Mac the ones that come while it runs. Returns an
	 * unsubscribe. */
	onOpenFiles(open: (requests: OpenRequest[]) => void): () => void;
	/** The pictures in the folder a picture was opened from, itself
	 * included, in name order. Empty where the folder cannot be read (a
	 * phone is handed one file, not the folder around it). */
	picturesBeside(file: FileRef): Promise<OpenRequest[]>;
	abilities(file: FileRef): FileAbilities;
	/** Hand the file to the system share sheet. Rejects when it fails;
	 * a share the user cancels resolves quietly. */
	share(file: FileRef): Promise<void>;
	openWith(file: FileRef): Promise<void>;
	reveal(file: FileRef): Promise<void>;
	/** Save bytes the app made (a filled-in form, pages put together)
	 * as a new file, where the reader says. Null when they cancel. Never
	 * over a file that is open (`open`, filled in from lib/openFiles): the
	 * reader is told and asked again. */
	saveFile(
		name: string,
		bytes: Uint8Array,
		mime: string,
		open?: string[],
	): Promise<SavedFile | null>;
	/** Give the file a new name. On a desktop the file itself is
	 * renamed in its folder; on Android a document whose provider lets
	 * the app is renamed there. A copy the app holds (and a document
	 * its provider will not rename) only changes the name it is known
	 * by here (and is shared or saved by), which the answer says.
	 * Rejects, renaming nothing, when the rename is refused. */
	rename(file: FileRef, name: string): Promise<Renamed>;
	/** Android: hold on to a picked original over restarts (Recent files
	 * names it), or give that access back once nothing names it. */
	keepDocument(uri: string): void;
	releaseDocument(uri: string): void;
	/** Ask the host to print the page as it is laid out for print.
	 * False when the host has no printing of its own (use window.print). */
	printPage(jobName: string): Promise<boolean>;
	/** Print the original file itself (exact, e.g. a PDF). False when
	 * the host cannot. */
	printOriginal(file: FileRef): Promise<boolean>;
	/** Name the window after what it shows (desktop title bar, task
	 * switcher). Phones have no title to set. */
	setTitle(title: string): void;
	/** Provider display name of a content:// URI, or null. */
	providerName(uri: string): string | null;
	read(reopen: Reopen): Promise<ArrayBuffer>;
	/** When the file was last changed (ms), to notice another app
	 * change it while it is open; null where that cannot be known. */
	stamp(reopen: Reopen): Promise<number | null>;
	storeGet(key: string): Promise<unknown>;
	storeSet(key: string, value: unknown): Promise<void>;
	importsStats(): Promise<ImportsStats>;
	importsClear(): Promise<void>;
	importsRemove(paths: string[]): Promise<void>;
	/** Delete unreferenced copies and enforce the size cap. Returns the
	 * referenced copies that had to be evicted. */
	importsPrune(keep: string[]): Promise<string[]>;
}

declare global {
	interface Window {
		/** Android bridge installed by MainActivity. */
		__paperwrenAndroid?: {
			displayName(uri: string): string;
			contentSize(uri: string): number;
			importPicked(uri: string, token: string): boolean;
		};
		/** Hand-offs added after 1.0 (share, print, folders, ...). A web
		 * layer running in an older shell simply finds this missing. */
		__paperwrenAndroidExtras?: {
			shareFile(target: string, name: string, mime: string): boolean;
			openFile(target: string, name: string, mime: string): boolean;
			printPage(jobName: string): boolean;
			printFile(target: string, jobName: string): boolean;
			keepAwake(on: boolean): void;
			/** Hide the status and navigation bars (a slide show), turning
			 * the screen sideways for it when asked. Added after 1.0.4. */
			immersive?(on: boolean, landscape: boolean): void;
			/** Tell the system which way the app's bars are coloured, so
			 * the clock and battery are drawn to be read on them. */
			systemBars?(dark: boolean): void;
			/** The room the system bars take, as JSON {top, right, bottom,
			 * left} in CSS pixels, or "null"; changes come through
			 * window.__paperwrenInsets. Added after 1.4.1. */
			insets?(): string;
			pickFolder(token: string): boolean;
			/** Read `text` aloud with the system's text-to-speech, in an
			 * on-device voice for `lang`; the outcome comes back through
			 * window.__paperwrenSpoken(token, ...). False when there is no
			 * such voice. Added after 1.1.4. */
			speak?(text: string, lang: string, rate: number, token: string): boolean;
			stopSpeaking?(): void;
			/** Draw a picture the webview cannot (HEIC) and hand it back as
			 * a JPEG through window.__paperwrenDecoded(token, base64 | null).
			 * Added after 1.1.4. */
			decodePicture?(base64: string, token: string): boolean;
			/** Hear the volume keys (they turn pages), or let them change
			 * the volume again. Added after 1.1.4. */
			volumeKeys?(on: boolean): void;
			listFolder(treeUri: string, extensions: string, token: string): boolean;
			releaseFolder(treeUri: string): void;
			/** Saving a copy: begin, the bytes in base64 pieces, then the
			 * system's save screen; the answer comes back through
			 * window.__paperwrenSaved(token, name | "cancel" | null). */
			saveBegin?(token: string): boolean;
			saveChunk?(token: string, base64: string): boolean;
			saveFinish?(token: string, name: string, mime: string): boolean;
			/** Back on a file another app opened with Paperwren: back to
			 * that app, ending Paperwren if that start began it (`started`).
			 * Added after 1.7.0. */
			leaveToCaller?(started: boolean): boolean;
			/** Ask a document's provider to rename it; the answer comes
			 * back through window.__paperwrenRenamed(token, {uri, name} |
			 * "unsupported" | "permission" | "not_found" | null). Added
			 * after 1.7.1. */
			renameDocument?(uri: string, name: string, token: string): boolean;
			/** The system's own document picker ("Open file"), which lets the
			 * app keep the address of what was picked; the answer comes back
			 * through window.__paperwrenPicked(token, [uri, ...] | null),
			 * empty when the reader cancels. Added after 1.8.0. */
			pickDocuments?(
				token: string,
				pictures: boolean,
				multiple: boolean,
			): boolean;
			/** Keep access to a picked document over restarts (reading, and
			 * writing where the provider allows it). Added after 1.8.0. */
			keepDocument?(uri: string): boolean;
			/** The provider says the document can be renamed and the app may
			 * write to it. Added after 1.8.0. */
			canRenameDocument?(uri: string): boolean;
		};
		/** MainActivity's answers to pickFolder / listFolder. */
		__paperwrenSaved?: (token: string, result: string | null) => void;
		__paperwrenRenamed?: (token: string, result: unknown) => void;
		__paperwrenPicked?: (token: string, result: unknown) => void;
		__paperwrenFolder?: (
			token: string,
			folder: { uri: string; name: string } | null,
		) => void;
		__paperwrenFolderList?: (
			token: string,
			files: Array<{
				uri: string;
				name: string;
				size: number;
				modified: number;
				folder: string;
			}> | null,
		) => void;
		/** MainActivity reports a hand-off that failed ("share", "print",
		 * "open-with", "open"); the page says so in the reader's language
		 * and answers true. */
		__paperwrenNativeError?: (code: string) => boolean;
		/** MainActivity: a volume key was pressed (1 down, -1 up) while
		 * they turn pages. */
		__paperwrenVolumeKey?: (dir: number) => void;
		/** The system bars' room changed (see extras.insets). */
		__paperwrenInsets?: (insets: unknown) => void;
		/** MainActivity's answer to importPicked. */
		__paperwrenImported?: (token: string, copy: ManagedCopy | null) => void;
		/** Test hook: the next pick returns this file. */
		__paperwrenTestFile?: File;
		/** Test hook: the next pick of several returns these files. */
		__paperwrenTestFiles?: File[];
		/** Test hook: the next digital ID picked is this file. */
		__paperwrenTestDigitalId?: File;
		/** Test hook: when the open file was last changed. */
		__paperwrenTestStamp?: number;
		/** Test hook: the bytes of copies Android "delivered" (by path),
		 * for the browser, which has no such store. */
		__paperwrenTestCopies?: Record<string, Blob>;
		/** Test hook: stands in for the system renaming the file itself.
		 * Resolves to where it is now (renamed there), null (only the
		 * app's name changes), or rejects ({kind}) as the system would. */
		__paperwrenTestRename?: (
			reopen: Reopen,
			name: string,
		) => Promise<Reopen | null> | Reopen | null;
		/** Test hook: every rename the backend was asked for. */
		__paperwrenTestRenames?: Array<{ reopen: Reopen; name: string }>;
	}
}

function request(
	name: string,
	nameVerified: boolean,
	size: number,
	reopen: Reopen,
): OpenRequest {
	return { id: idForReopen(reopen), name, nameVerified, size, reopen };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	// plugin-fs returns a fresh whole-buffer view; avoid a second copy.
	return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
		? (bytes.buffer as ArrayBuffer)
		: (bytes.slice().buffer as ArrayBuffer);
}

// ---------- Browser (dev server, tests) ----------

const liveFiles = new Map<string, File>();
const browserFolders = new Map<string, File[]>();

/** Several files from the browser's own picker. */
function browserPickMany(extensions = PICKER_EXTENSIONS): Promise<File[]> {
	const injected = window.__paperwrenTestFiles;
	if (injected) {
		window.__paperwrenTestFiles = undefined;
		return Promise.resolve(injected);
	}
	const one = window.__paperwrenTestFile;
	if (one) {
		window.__paperwrenTestFile = undefined;
		return Promise.resolve([one]);
	}
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = extensions.map((e) => `.${e}`).join(",");
		input.onchange = () => resolve(Array.from(input.files ?? []));
		input.oncancel = () => resolve([]);
		input.click();
	});
}

function browserPick(extensions = PICKER_EXTENSIONS): Promise<File | null> {
	const injected = window.__paperwrenTestFile;
	if (injected) {
		window.__paperwrenTestFile = undefined;
		return Promise.resolve(injected);
	}
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = extensions.map((e) => `.${e}`).join(",");
		input.onchange = () => resolve(input.files?.[0] ?? null);
		input.oncancel = () => resolve(null);
		input.click();
	});
}

function bridgeName(uri: string): string | null {
	try {
		const name = window.__paperwrenAndroid?.displayName(uri)?.trim();
		return name || null;
	} catch {
		return null;
	}
}

/** The bytes of a file as a File object, for the Web Share API. */
async function asFile(file: FileRef, read: Backend["read"]): Promise<File> {
	return new File([await read(file.reopen)], file.name, {
		type: mimeOf(file.format, file.name),
	});
}

/** Share through the Web Share API. A cancelled sheet is not an error. */
async function webShare(shared: File): Promise<void> {
	try {
		await navigator.share({ files: [shared], title: shared.name });
	} catch (err) {
		if ((err as Error)?.name !== "AbortError") throw err;
	}
}

function canWebShare(): boolean {
	try {
		return (
			typeof navigator.canShare === "function" &&
			navigator.canShare({
				files: [new File([""], "probe.pdf", { type: "application/pdf" })],
			})
		);
	} catch {
		return false;
	}
}

/** Bytes per piece handed to the Android bridge when saving. */
const SAVE_PIECE = 384 * 1024;

function base64Of(bytes: Uint8Array): string {
	let text = "";
	for (let at = 0; at < bytes.length; at += 0x8000)
		text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
	return btoa(text);
}

function saveCopy(file: File) {
	const url = URL.createObjectURL(file);
	const link = document.createElement("a");
	link.href = url;
	link.download = file.name;
	link.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function adoptBrowserFile(file: File): OpenRequest {
	const key = `${file.name}:${file.size}:${file.lastModified}`;
	liveFiles.set(key, file);
	storedFilePut(key, file).catch(() => {});
	return request(file.name, true, file.size, { kind: "browser", key });
}

const browserBackend: Backend = {
	providerName: bridgeName,
	setTitle(title) {
		document.title = title;
	},
	async pickFile(options) {
		// A test standing in for the Android shell, with its own picker.
		const chosen = await androidPick(!!options?.pictures, false);
		if (chosen) return chosen[0] ? requestForPicked(chosen[0], true) : null;
		const file = await browserPick(
			options?.pictures ? PICTURE_EXTENSIONS : undefined,
		);
		return file ? adoptBrowserFile(file) : null;
	},
	async pickFiles(options) {
		const chosen = await androidPick(!!options?.pictures, true);
		if (chosen) return chosen.map((uri) => () => requestForPicked(uri, true));
		const files = await browserPickMany(
			options?.pictures ? PICTURE_EXTENSIONS : undefined,
		);
		return files.map((file) => async () => adoptBrowserFile(file));
	},
	async pickDigitalId() {
		// Read once and let go: not adopted as a document, so it is in no
		// list of files and not in the browser's file store.
		const injected = window.__paperwrenTestDigitalId;
		window.__paperwrenTestDigitalId = undefined;
		const file =
			injected ??
			(await new Promise<File | null>((resolve) => {
				const input = document.createElement("input");
				input.type = "file";
				input.accept = DIGITAL_ID_EXTENSIONS.map((e) => `.${e}`).join(",");
				input.onchange = () => resolve(input.files?.[0] ?? null);
				input.oncancel = () => resolve(null);
				input.click();
			}));
		if (!file) return null;
		return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
	},
	onFileDrop({ hover, drop }) {
		// dragenter/dragleave fire per element crossed; count the depth.
		let depth = 0;
		const carriesFiles = (e: DragEvent) =>
			Array.from(e.dataTransfer?.types ?? []).includes("Files");
		const onEnter = (e: DragEvent) => {
			if (!carriesFiles(e)) return;
			e.preventDefault();
			if (++depth === 1) hover(true);
		};
		const onOver = (e: DragEvent) => {
			if (carriesFiles(e)) e.preventDefault();
		};
		const onLeave = (e: DragEvent) => {
			if (!carriesFiles(e)) return;
			depth = Math.max(0, depth - 1);
			if (depth === 0) hover(false);
		};
		const onDrop = (e: DragEvent) => {
			if (!carriesFiles(e)) return;
			e.preventDefault();
			depth = 0;
			hover(false);
			drop(Array.from(e.dataTransfer?.files ?? []).map(adoptBrowserFile));
		};
		window.addEventListener("dragenter", onEnter);
		window.addEventListener("dragover", onOver);
		window.addEventListener("dragleave", onLeave);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onEnter);
			window.removeEventListener("dragover", onOver);
			window.removeEventListener("dragleave", onLeave);
			window.removeEventListener("drop", onDrop);
		};
	},
	canBrowseFolders() {
		return true;
	},
	pickFolder() {
		// Dev / web preview: the browser's own directory input. The
		// listing lives for this session only.
		return new Promise((resolve) => {
			const input = document.createElement("input");
			input.type = "file";
			input.setAttribute("webkitdirectory", "");
			input.onchange = () => {
				const files = Array.from(input.files ?? []);
				if (!files.length) return resolve(null);
				const top = files[0].webkitRelativePath.split("/")[0] || "Folder";
				const key = `folder:${top}:${Date.now()}`;
				browserFolders.set(key, files);
				resolve({ id: key, name: top, source: { kind: "browser", key } });
			};
			input.oncancel = () => resolve(null);
			input.click();
		});
	},
	async listFolder(folder) {
		const files =
			folder.source.kind === "browser"
				? browserFolders.get(folder.source.key)
				: undefined;
		if (!files) throw new OpenError("not_found");
		return files
			.filter((f) => formatFromName(f.name) !== "unknown")
			.slice(0, FOLDER_LIMITS.files)
			.map((f) => ({
				name: f.name,
				size: f.size,
				modified: f.lastModified,
				folder: f.webkitRelativePath.split("/").slice(1, -1).join("/"),
				request: adoptBrowserFile(f),
			}));
	},
	forgetFolder(folder) {
		if (folder.source.kind === "browser")
			browserFolders.delete(folder.source.key);
	},
	onOpenFiles() {
		return () => {};
	},
	async picturesBeside() {
		return [];
	},
	abilities(file) {
		const sheet = canWebShare();
		return {
			share: true,
			shareIsDownload: !sheet,
			// Its share already saves a download where there is no sheet.
			saveCopy: false,
			openWith: false,
			reveal: false,
			rename: true,
			// A browser hands over a copy: the file on disk is out of reach.
			renameOriginal:
				!!window.__paperwrenTestRename || androidRenamesOriginal(file.reopen),
		};
	},
	async share(file) {
		const shared = await asFile(file, browserBackend.read);
		if (canWebShare()) await webShare(shared);
		else saveCopy(shared);
	},
	async openWith() {
		throw new OpenError("unsupported");
	},
	async reveal() {
		throw new OpenError("unsupported");
	},
	async saveFile(name, bytes, mime) {
		saveCopy(new File([bytes as BlobPart], name, { type: mime }));
		return { name };
	},
	async rename(file, name) {
		window.__paperwrenTestRenames?.push({ reopen: file.reopen, name });
		const extras = window.__paperwrenAndroidExtras;
		if (renameWay(file.reopen, !!extras?.renameDocument) === "origin")
			return renameOrigin(file.reopen, name);
		const system = window.__paperwrenTestRename;
		const now = system ? await system(file.reopen, name) : null;
		return now
			? { reopen: now, name, original: true }
			: { reopen: file.reopen, name, original: false };
	},
	keepDocument: keepAndroidDocument,
	releaseDocument: releaseAndroidDocument,
	async printPage() {
		return false;
	},
	async printOriginal() {
		return false;
	},
	// A browser hands over a copy: the file on disk is out of sight.
	async stamp() {
		return window.__paperwrenTestStamp ?? null;
	},
	async read(reopen) {
		const copy =
			reopen.kind === "managed" && window.__paperwrenTestCopies?.[reopen.path];
		if (copy) return copy.arrayBuffer();
		if (reopen.kind !== "browser") throw new OpenError("not_found");
		const blob =
			liveFiles.get(reopen.key) ??
			(await storedFileGet(reopen.key).catch(() => null));
		if (!blob) throw new OpenError("not_found");
		return blob.arrayBuffer();
	},
	async storeGet(key) {
		try {
			const raw = localStorage.getItem(`paperwren.${key}`);
			return raw === null ? null : JSON.parse(raw);
		} catch {
			return null;
		}
	},
	async storeSet(key, value) {
		localStorage.setItem(`paperwren.${key}`, JSON.stringify(value));
	},
	async importsStats() {
		return { bytes: 0, files: 0 };
	},
	async importsClear() {
		liveFiles.clear();
		await storedFileClear().catch(() => {});
	},
	async importsRemove() {},
	async importsPrune() {
		return [];
	},
};

// ---------- Tauri ----------

async function invoke<T>(
	cmd: string,
	args?: Record<string, unknown> | Uint8Array,
	options?: { headers: Record<string, string> },
): Promise<T> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<T>(cmd, args, options);
}

function androidName(uri: string): {
	name: string;
	verified: boolean;
	size: number;
} {
	const bridge = window.__paperwrenAndroid;
	try {
		const name = bridge?.displayName(uri)?.trim();
		if (name) {
			const size = Number(bridge?.contentSize(uri)) || 0;
			return { name, verified: true, size };
		}
	} catch {
		// Bridge not installed yet: fall back below.
	}
	let segment = uri.slice(uri.lastIndexOf("/") + 1);
	try {
		segment = decodeURIComponent(segment);
		segment = segment.slice(segment.lastIndexOf("/") + 1);
		segment = segment.slice(segment.lastIndexOf(":") + 1);
	} catch {
		// Keep the raw segment.
	}
	return { name: segment || "Document", verified: false, size: 0 };
}

interface ManagedCopy {
	path: string;
	name: string;
	size: number;
}

const importWaiters = new Map<string, (copy: ManagedCopy | null) => void>();
let importToken = 0;

/** A copy of large or cloud files can legitimately take a while; past
 * this the pick still opens, just without surviving a restart. */
const IMPORT_TIMEOUT_MS = 120_000;

/** Ask MainActivity to copy a picked content:// file into managed
 * storage. The dialog plugin picks with ACTION_GET_CONTENT, whose
 * grant ends with the process, so the bare URI of a recent is dead
 * after the app is closed ("Access expired"). Null when the copy is
 * not possible; the caller then falls back to the URI. */
function importPicked(uri: string): Promise<ManagedCopy | null> {
	const bridge = window.__paperwrenAndroid;
	if (!bridge?.importPicked) return Promise.resolve(null);
	window.__paperwrenImported ??= (token, copy) => {
		const done = importWaiters.get(token);
		importWaiters.delete(token);
		done?.(copy && typeof copy.path === "string" ? copy : null);
	};
	const token = `pick-${++importToken}`;
	return new Promise((resolve) => {
		const timer = window.setTimeout(() => {
			importWaiters.delete(token);
			resolve(null);
		}, IMPORT_TIMEOUT_MS);
		importWaiters.set(token, (copy) => {
			window.clearTimeout(timer);
			resolve(copy);
		});
		let started = false;
		try {
			started = bridge.importPicked(uri, token);
		} catch {
			// Bridge unavailable: fall through.
		}
		if (!started) {
			window.clearTimeout(timer);
			importWaiters.delete(token);
			resolve(null);
		}
	});
}

/** One call into the Android bridge whose answer arrives later
 * through a window callback keyed by a token. Null on refusal or
 * after the bridge's own failure answer. */
const androidWaiters = new Map<string, (value: unknown) => void>();
let androidToken = 0;
function androidCall<T>(
	callback:
		| "__paperwrenFolder"
		| "__paperwrenFolderList"
		| "__paperwrenSaved"
		| "__paperwrenRenamed"
		| "__paperwrenPicked",
	start: (token: string) => boolean,
): Promise<T | null> {
	window[callback] ??= (token: string, value: unknown) => {
		const done = androidWaiters.get(token);
		androidWaiters.delete(token);
		done?.(value);
	};
	const token = `${callback}-${++androidToken}`;
	return new Promise((resolve) => {
		androidWaiters.set(token, (value) => resolve((value as T) ?? null));
		let started = false;
		try {
			started = start(token);
		} catch {
			// Bridge unavailable.
		}
		if (!started) {
			androidWaiters.delete(token);
			resolve(null);
		}
	});
}

// ---------- Android documents picked with "Open file" ----------
// Used by the Tauri backend on a phone, and by the browser one when a
// test stands in for the Android shell.

/** Documents from the Android shell's own picker, which lets the app
 * keep each one's address (so its original can be renamed later). An
 * empty list when the reader cancels; null when there is no such picker
 * (an older shell) or it failed, and the caller asks the old way. */
async function androidPick(
	pictures: boolean,
	multiple: boolean,
): Promise<string[] | null> {
	const extras = window.__paperwrenAndroidExtras;
	if (!extras?.pickDocuments) return null;
	const { pickDocuments } = extras;
	const answer = await androidCall<unknown>("__paperwrenPicked", (token) =>
		pickDocuments.call(extras, token, pictures, multiple),
	);
	if (!Array.isArray(answer)) return null;
	return answer.filter(
		(uri): uri is string =>
			typeof uri === "string" && uri.startsWith("content://"),
	);
}

/** Whether a picked original can be renamed where it is, as its
 * provider says; asked once per document, as menus ask often. */
const renamable = new Map<string, boolean>();
function originRenamable(uri: string): boolean {
	const known = renamable.get(uri);
	if (known !== undefined) return known;
	const extras = window.__paperwrenAndroidExtras;
	let can = false;
	try {
		can = !!extras?.canRenameDocument?.(uri);
	} catch {
		// The shell could not tell: only the app's name will change.
	}
	renamable.set(uri, can);
	return can;
}

/** Rename the original a copy was picked from, through its provider;
 * the copy takes the name it gets there. */
async function renameOrigin(reopen: Reopen, name: string): Promise<Renamed> {
	const extras = window.__paperwrenAndroidExtras;
	if (reopen.kind !== "managed" || !reopen.origin || !extras?.renameDocument)
		return { reopen, name, original: false };
	const { origin } = reopen;
	const { renameDocument } = extras;
	const answer = await androidCall<unknown>("__paperwrenRenamed", (token) =>
		renameDocument.call(extras, origin, name, token),
	);
	renamable.delete(origin);
	return originRenamed(answer, reopen, name);
}

/** A rename on Android reaches the file itself (or is tried there): a
 * document opened where it is, or the original of a picked copy whose
 * provider lets the app rename it. */
function androidRenamesOriginal(reopen: Reopen): boolean {
	const way = renameWay(
		reopen,
		!!window.__paperwrenAndroidExtras?.renameDocument,
	);
	if (way === "document") return true;
	return way === "origin" && reopen.kind === "managed" && !!reopen.origin
		? originRenamable(reopen.origin)
		: false;
}

function keepAndroidDocument(uri: string) {
	try {
		window.__paperwrenAndroidExtras?.keepDocument?.(uri);
	} catch {
		// Readable until the app closes; renamed in the app only after.
	}
}

function releaseAndroidDocument(uri: string) {
	renamable.delete(uri);
	try {
		// Gives back any document's access, not only a folder's.
		window.__paperwrenAndroidExtras?.releaseFolder?.(uri);
	} catch {
		// Already released, or never held.
	}
}

/**
 * A desktop folder's documents, within FOLDER_LIMITS: one call to the
 * shell (folder.rs), which walks it and reads every size and date off
 * the main thread. Asking for them one file at a time froze the window
 * on Linux, where the fs plugin answers on the thread that draws it.
 */
async function listDesktopFolder(root: string): Promise<FolderFile[]> {
	let found: Array<{
		path: string;
		name: string;
		folder: string;
		size: number;
		modified: number;
	}>;
	try {
		found = await invoke("list_folder", {
			path: root,
			extensions: PICKER_EXTENSIONS,
			limits: FOLDER_LIMITS,
		});
	} catch (err) {
		throw new OpenError(
			classifyError(err),
			String((err as { message?: string })?.message ?? err),
		);
	}
	return found.map((file) => ({
		name: file.name,
		size: file.size,
		modified: file.modified,
		folder: file.folder,
		request: request(file.name, true, file.size, {
			kind: "path",
			path: file.path,
		}),
	}));
}

/** The shell's word that files are waiting to be opened (lib.rs). */
const OPEN_EVENT = "paperwren-open";

/** The path or content:// URI native code can open. */
function nativeTarget(file: FileRef): string {
	const { reopen } = file;
	if (reopen.kind === "uri") return reopen.uri;
	if (reopen.kind === "browser" || reopen.kind === "memory")
		throw new OpenError("unsupported");
	return reopen.path;
}

/** A file the system picker gave: a path on a computer, or on Android
 * a content:// document, copied in where the bridge can (so Recent
 * files can open it again after a restart). */
async function requestForPicked(
	picked: string,
	original = false,
): Promise<OpenRequest> {
	if (picked.startsWith("content://")) {
		const copy = await importPicked(picked);
		if (copy) {
			// From the shell's own picker the original stays in reach: its
			// address goes with the copy, so a rename can reach it.
			return request(copy.name, true, copy.size, {
				kind: "managed",
				path: copy.path,
				...(original ? { origin: picked } : {}),
			});
		}
		const { name, verified, size } = androidName(picked);
		return request(name, verified, size, { kind: "uri", uri: picked });
	}
	return requestForPath(picked);
}

/** A desktop file as an open request. Its size is asked for so a very
 * large file can be warned about before it is read; a refused stat
 * leaves it unknown. */
async function requestForPath(path: string): Promise<OpenRequest> {
	const name = path.split(/[\\/]/).pop() || path;
	let size = 0;
	try {
		const { stat } = await import("@tauri-apps/plugin-fs");
		size = (await stat(path)).size;
	} catch {
		// Unknown size: the read reports the real length.
	}
	return request(name, true, size, { kind: "path", path });
}

const tauriBackend: Backend = {
	providerName: bridgeName,
	setTitle(title) {
		document.title = title;
		if (window.__paperwrenAndroid) return;
		import("@tauri-apps/api/window")
			.then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
			.catch(() => {});
	},
	async pickFile(options) {
		const chosen = await androidPick(!!options?.pictures, false);
		if (chosen) return chosen[0] ? requestForPicked(chosen[0], true) : null;
		const { open } = await import("@tauri-apps/plugin-dialog");
		const picked = await open({
			multiple: false,
			title: options?.pictures ? t("Pick a picture") : t("Open a document"),
			filters: options?.pictures
				? [{ name: t("Pictures"), extensions: PICTURE_EXTENSIONS }]
				: [{ name: t("Documents"), extensions: PICKER_EXTENSIONS }],
		});
		if (!picked || typeof picked !== "string") return null;
		return requestForPicked(picked);
	},
	async pickFiles(options) {
		const chosen = await androidPick(!!options?.pictures, true);
		if (chosen) return chosen.map((uri) => () => requestForPicked(uri, true));
		const { open } = await import("@tauri-apps/plugin-dialog");
		const picked = await open({
			multiple: true,
			title: options?.pictures ? t("Choose pictures") : t("Choose documents"),
			filters: options?.pictures
				? [{ name: t("Pictures"), extensions: PICTURE_EXTENSIONS }]
				: [{ name: t("Documents"), extensions: PICKER_EXTENSIONS }],
		});
		const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
		return list.map((path) => () => requestForPicked(path));
	},
	async pickDigitalId() {
		const { open } = await import("@tauri-apps/plugin-dialog");
		const phone = !!window.__paperwrenAndroid;
		const picked = await open({
			multiple: false,
			title: t("Choose your digital ID (.pfx or .p12)"),
			// A phone's file managers often call a .pfx "application/
			// octet-stream", and a filter would grey it out: any file can be
			// picked there, and what it is is found from its contents.
			filters: phone
				? undefined
				: [
						{ name: t("Digital IDs"), extensions: DIGITAL_ID_EXTENSIONS },
						{ name: t("All files"), extensions: ["*"] },
					],
		});
		if (!picked || typeof picked !== "string") return null;
		// Read straight into memory, a phone's content:// URI too: never
		// through importPicked, which keeps a copy for the recent files.
		const { readFile } = await import("@tauri-apps/plugin-fs");
		let bytes: Uint8Array;
		try {
			bytes = await readFile(picked);
		} catch (err) {
			throw new OpenError(classifyError(err), String(err));
		}
		const name = picked.startsWith("content://")
			? androidName(picked).name
			: picked.split(/[\\/]/).pop() || picked;
		return { name, bytes };
	},
	onFileDrop({ hover, drop }) {
		// The webview reports drags natively (with real paths), which the
		// desktop read scope already covers. Nothing to hear on mobile.
		let stop = () => {};
		let cancelled = false;
		import("@tauri-apps/api/webview")
			.then(({ getCurrentWebview }) =>
				getCurrentWebview().onDragDropEvent(({ payload }) => {
					if (payload.type === "enter") hover(payload.paths.length > 0);
					else if (payload.type === "leave") hover(false);
					else if (payload.type === "drop") {
						hover(false);
						Promise.all(payload.paths.map(requestForPath)).then(drop);
					}
				}),
			)
			.then((unlisten) => {
				if (cancelled) unlisten();
				else stop = unlisten;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			stop();
		};
	},
	canBrowseFolders() {
		return window.__paperwrenAndroid ? !!window.__paperwrenAndroidExtras : true;
	},
	async pickFolder() {
		const extras = window.__paperwrenAndroidExtras;
		if (extras) {
			const picked = await androidCall<{ uri: string; name: string }>(
				"__paperwrenFolder",
				(token) => extras.pickFolder(token),
			);
			return picked
				? {
						id: picked.uri,
						name: picked.name || "Folder",
						source: { kind: "tree", uri: picked.uri },
					}
				: null;
		}
		const { open } = await import("@tauri-apps/plugin-dialog");
		const picked = await open({
			directory: true,
			multiple: false,
			title: t("Choose a folder to browse"),
		});
		if (!picked || typeof picked !== "string") return null;
		return {
			id: picked,
			name: picked.split(/[\\/]/).filter(Boolean).pop() || picked,
			source: { kind: "path", path: picked },
		};
	},
	async listFolder(folder) {
		if (folder.source.kind === "tree") {
			const extras = window.__paperwrenAndroidExtras;
			const { uri } = folder.source;
			if (!extras) throw new OpenError("unsupported");
			const files = await androidCall<
				Array<{
					uri: string;
					name: string;
					size: number;
					modified: number;
					folder: string;
				}>
			>("__paperwrenFolderList", (token) =>
				extras.listFolder(uri, PICKER_EXTENSIONS.join(","), token),
			);
			if (!files) throw new OpenError("permission");
			return files.map((f) => ({
				name: f.name,
				size: f.size,
				modified: f.modified,
				folder: f.folder,
				request: request(f.name, true, f.size, { kind: "uri", uri: f.uri }),
			}));
		}
		if (folder.source.kind !== "path") throw new OpenError("unsupported");
		return listDesktopFolder(folder.source.path);
	},
	forgetFolder(folder) {
		if (folder.source.kind === "tree")
			window.__paperwrenAndroidExtras?.releaseFolder(folder.source.uri);
	},
	onOpenFiles(open) {
		// Android delivers files through intents (see index.html).
		if (window.__paperwrenAndroid) return () => {};
		// The shell hands each waiting file over once, so a file is never
		// opened twice however often it is asked.
		const take = () => {
			invoke<string[]>("launch_files")
				.then((paths) => Promise.all(paths.map(requestForPath)))
				.then((requests) => {
					if (requests.length) open(requests);
				})
				.catch(() => {});
		};
		take();
		// Files opened while the app runs (a double-click in Explorer or a
		// file manager starts Paperwren again, and that start hands them
		// over; macOS sends them itself): the shell says when some are
		// waiting, and they open as tabs. One may have come before this
		// was listening, so they are asked for once more when it is.
		let stop = () => {};
		let cancelled = false;
		import("@tauri-apps/api/event")
			.then(({ listen }) => listen(OPEN_EVENT, take))
			.then((unlisten) => {
				if (cancelled) return unlisten();
				stop = unlisten;
				take();
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			stop();
		};
	},
	async picturesBeside(file) {
		if (window.__paperwrenAndroid || file.reopen.kind !== "path") return [];
		const { path } = file.reopen;
		const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
		if (cut < 0) return [];
		const folder = path.slice(0, cut + 1);
		try {
			const { readDir } = await import("@tauri-apps/plugin-fs");
			return (await readDir(folder))
				.filter((e) => e.isFile && formatFromName(e.name) === "image")
				.map((e) => e.name)
				.sort(compareNames)
				.slice(0, FOLDER_LIMITS.files)
				.map((name) =>
					request(name, true, 0, { kind: "path", path: folder + name }),
				);
		} catch {
			return [];
		}
	},
	abilities(file) {
		if (window.__paperwrenAndroid) {
			const extras = !!window.__paperwrenAndroidExtras;
			return {
				share: extras,
				shareIsDownload: false,
				saveCopy: !!window.__paperwrenAndroidExtras?.saveBegin,
				openWith: extras,
				reveal: false,
				rename: true,
				renameOriginal: androidRenamesOriginal(file.reopen),
			};
		}
		return {
			share: canWebShare(),
			shareIsDownload: false,
			saveCopy: true,
			// Desktop: the OS opens it with whatever app owns the type; a
			// script is not handed on, as that app might run it.
			openWith:
				file.reopen.kind === "path" &&
				!SCRIPT_EXTENSIONS.includes(extensionOf(file.name)),
			reveal: file.reopen.kind === "path",
			rename: true,
			renameOriginal: renameWay(file.reopen, false) === "file",
		};
	},
	async share(file) {
		const bridge = window.__paperwrenAndroidExtras;
		if (bridge) {
			if (
				!bridge.shareFile(
					nativeTarget(file),
					file.name,
					mimeOf(file.format, file.name),
				)
			)
				throw new OpenError("unreadable");
			return;
		}
		await webShare(await asFile(file, tauriBackend.read));
	},
	async openWith(file) {
		const bridge = window.__paperwrenAndroidExtras;
		if (bridge) {
			if (
				!bridge.openFile(
					nativeTarget(file),
					file.name,
					mimeOf(file.format, file.name),
				)
			)
				throw new OpenError("unsupported");
			return;
		}
		await invoke("open_external", { path: nativeTarget(file) });
	},
	async reveal(file) {
		await invoke("reveal_in_folder", { path: nativeTarget(file) });
	},
	async saveFile(name, bytes, mime, open = []) {
		const bridge = window.__paperwrenAndroidExtras;
		if (window.__paperwrenAndroid) {
			if (!bridge?.saveBegin || !bridge.saveChunk || !bridge.saveFinish)
				throw new OpenError("unsupported");
			const { saveBegin, saveChunk, saveFinish } = bridge;
			const answer = await androidCall<unknown>("__paperwrenSaved", (token) => {
				if (!saveBegin.call(bridge, token)) return false;
				for (let at = 0; at < bytes.length; at += SAVE_PIECE)
					if (
						!saveChunk.call(
							bridge,
							token,
							base64Of(bytes.subarray(at, at + SAVE_PIECE)),
						)
					)
						return false;
				return saveFinish.call(bridge, token, name, mime);
			});
			if (answer === "cancel") return null;
			if (answer === null) throw new OpenError("unreadable");
			return androidSaved(answer, name);
		}
		// The shell refuses a place that is one of the open files (it alone
		// sees where the reader picked before anything is written).
		const path = await invoke<string | null>("save_as", bytes, {
			headers: {
				"x-name": encodeURIComponent(name),
				"x-open": openHeader(open),
			},
		});
		if (!path) return null;
		const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
		return { name: path.slice(cut + 1), reopen: { kind: "path", path } };
	},
	async rename(file, name) {
		const { reopen } = file;
		const extras = window.__paperwrenAndroidExtras;
		const way = renameWay(reopen, !!extras?.renameDocument);
		if (way === "file" && reopen.kind === "path") {
			const path = await invoke<string>("rename_file", {
				path: reopen.path,
				name,
			});
			const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
			return {
				reopen: { kind: "path", path },
				name: path.slice(cut + 1) || name,
				original: true,
			};
		}
		if (way === "document" && reopen.kind === "uri" && extras?.renameDocument) {
			const { renameDocument } = extras;
			const answer = await androidCall<unknown>("__paperwrenRenamed", (token) =>
				renameDocument.call(extras, reopen.uri, name, token),
			);
			return documentRenamed(answer, reopen, name);
		}
		if (way === "origin") return renameOrigin(reopen, name);
		if (way === null) throw renameRefused("unsupported");
		// A copy the app holds with no way back to its original (opened
		// from another app, or picked with an older picker): the name is
		// the one it goes by here.
		return { reopen, name, original: false };
	},
	keepDocument: keepAndroidDocument,
	releaseDocument: releaseAndroidDocument,
	async printPage(jobName) {
		return window.__paperwrenAndroidExtras?.printPage(jobName) ?? false;
	},
	async printOriginal(file) {
		if (file.format !== "pdf") return false;
		return (
			window.__paperwrenAndroidExtras?.printFile(
				nativeTarget(file),
				file.name,
			) ?? false
		);
	},
	async read(reopen) {
		if (reopen.kind === "browser" || reopen.kind === "memory")
			throw new OpenError("not_found");
		const target = reopen.kind === "uri" ? reopen.uri : reopen.path;
		try {
			const { readFile } = await import("@tauri-apps/plugin-fs");
			return toArrayBuffer(await readFile(target));
		} catch (err) {
			throw new OpenError(classifyError(err), String(err));
		}
	},
	async stamp(reopen) {
		// Only a desktop opens files in place; a phone's are copies or
		// content the system hands over.
		if (reopen.kind !== "path" || window.__paperwrenAndroid) return null;
		try {
			const { stat } = await import("@tauri-apps/plugin-fs");
			return (await stat(reopen.path)).mtime?.getTime() ?? null;
		} catch {
			return null;
		}
	},
	storeGet: (key) => invoke("store_get", { key }),
	storeSet: (key, value) => invoke("store_set", { key, value }),
	importsStats: () => invoke("imports_stats"),
	importsClear: () => invoke("imports_clear"),
	async importsRemove(paths) {
		if (paths.length > 0) await invoke("imports_remove", { paths });
	},
	async importsPrune(keep) {
		const report = await invoke<{ evicted: string[] }>("imports_prune", {
			keep,
		});
		return report.evicted;
	},
};

const raw = isTauri ? tauriBackend : browserBackend;

/** Writes per key are serialized so a slow write can never land
 * after a newer one. */
/** Files that live inside another one (a PDF's attachments), held for
 * this run only. */
const held = new Map<string, File>();

/** Open a file found inside another document. It is read from memory
 * and never kept in recents: once the app closes, it is gone. */
export function requestForBytes(name: string, bytes: Uint8Array): OpenRequest {
	const key = `${held.size + 1}:${name}`;
	held.set(key, new File([bytes as BlobPart], name));
	return request(name, true, bytes.byteLength, { kind: "memory", key });
}

export const backend: Backend = {
	...raw,
	storeSet: createSerializedWriter((key, value) => raw.storeSet(key, value)),
	saveFile(name, bytes, mime) {
		return saveAsking(
			(open) => raw.saveFile(name, bytes, mime, open),
			saveRefused,
		);
	},
	stamp(reopen) {
		return reopen.kind === "memory" ? Promise.resolve(null) : raw.stamp(reopen);
	},
	read(reopen) {
		if (reopen.kind !== "memory") return raw.read(reopen);
		const file = held.get(reopen.key);
		return file
			? file.arrayBuffer()
			: Promise.reject(new OpenError("not_found"));
	},
	abilities(file) {
		if (file.reopen.kind !== "memory") return raw.abilities(file);
		// It has no place of its own: it can only be shared, or saved
		// where the browser keeps downloads.
		const sheet = canWebShare();
		return {
			share: sheet || !isTauri,
			shareIsDownload: !sheet,
			saveCopy: isTauri && raw.abilities(file).saveCopy,
			openWith: false,
			reveal: false,
			rename: false,
			renameOriginal: false,
		};
	},
	async rename(file, name) {
		if (file.reopen.kind === "memory") throw new OpenError("unsupported");
		return raw.rename(file, name);
	},
	async share(file) {
		if (file.reopen.kind !== "memory") return raw.share(file);
		const shared = await asFile(file, backend.read);
		if (canWebShare()) await webShare(shared);
		else saveCopy(shared);
	},
};

/** Where Android's "save as" put a copy: its name and the document's
 * address, so it can be opened from the message and again from Recent
 * files (the app keeps the right to read it). A bare name, or an
 * answer with no address, can only be named. */
export function androidSaved(answer: unknown, offered: string): SavedFile {
	if (answer && typeof answer === "object") {
		const { name, uri } = answer as { name?: unknown; uri?: unknown };
		return {
			name: typeof name === "string" && name ? name : offered,
			reopen:
				typeof uri === "string" && uri.startsWith("content://")
					? { kind: "uri", uri }
					: undefined,
		};
	}
	return { name: typeof answer === "string" && answer ? answer : offered };
}

/** Open a copy the reader just saved, where the platform said it is. */
export function requestForSaved(
	saved: SavedFile,
	size: number,
): OpenRequest | null {
	return saved.reopen ? request(saved.name, true, size, saved.reopen) : null;
}

/** Build an open request for a file delivered by Android "Open with". */
export function requestForManagedCopy(
	path: string,
	name: string,
	size: number,
): OpenRequest {
	return request(name, true, size, { kind: "managed", path });
}

export { managedRelPath };

/** A file's size in the reader's language: "1.5 MB", "1,5 МБ", "1,5 Mo". */
export function formatBytes(bytes: number): string {
	const size = (value: number, digits: number, unit: string) =>
		t(unit, {
			n: formatNumber(value, {
				minimumFractionDigits: digits,
				maximumFractionDigits: digits,
			}),
		});
	if (!Number.isFinite(bytes) || bytes <= 0) return size(0, 0, msg("{n} B"));
	if (bytes < 1024) return size(bytes, 0, msg("{n} B"));
	if (bytes < 1024 ** 2) return size(bytes / 1024, 0, msg("{n} KB"));
	if (bytes < 1024 ** 3) return size(bytes / 1024 ** 2, 1, msg("{n} MB"));
	return size(bytes / 1024 ** 3, 2, msg("{n} GB"));
}
