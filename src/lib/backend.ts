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
	formatFromName,
	mimeOf,
} from "./formats";
import { idForReopen, managedRelPath } from "./recents";
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
	/** Open it in another installed app. */
	openWith: boolean;
	/** Show it in the system file manager. */
	reveal: boolean;
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

/** Bounds for a folder scan, matched on the native side. */
export const FOLDER_LIMITS = { files: 2000, folders: 400, depth: 4 } as const;

/** What the app does while files hover over, and land on, the window. */
export interface DropHandlers {
	hover(active: boolean): void;
	drop(requests: OpenRequest[]): void;
}

interface Backend {
	pickFile(): Promise<OpenRequest | null>;
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
	/** Files the app was started with (desktop: a double-clicked
	 * document, "Open with Paperwren"). */
	launchFiles(): Promise<OpenRequest[]>;
	abilities(file: FileRef): FileAbilities;
	/** Hand the file to the system share sheet. Rejects when it fails;
	 * a share the user cancels resolves quietly. */
	share(file: FileRef): Promise<void>;
	openWith(file: FileRef): Promise<void>;
	reveal(file: FileRef): Promise<void>;
	/** Ask the host to print the page as it is laid out for print.
	 * False when the host has no printing of its own (use window.print). */
	printPage(jobName: string): Promise<boolean>;
	/** Print the original file itself (exact, e.g. a PDF). False when
	 * the host cannot. */
	printOriginal(file: FileRef): Promise<boolean>;
	/** Provider display name of a content:// URI, or null. */
	providerName(uri: string): string | null;
	read(reopen: Reopen): Promise<ArrayBuffer>;
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
			pickFolder(token: string): boolean;
			listFolder(treeUri: string, extensions: string, token: string): boolean;
			releaseFolder(treeUri: string): void;
		};
		/** MainActivity's answers to pickFolder / listFolder. */
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
		/** MainActivity's answer to importPicked. */
		__paperwrenImported?: (token: string, copy: ManagedCopy | null) => void;
		/** Test hook: the next pick returns this file. */
		__paperwrenTestFile?: File;
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

function browserPick(): Promise<File | null> {
	const injected = window.__paperwrenTestFile;
	if (injected) {
		window.__paperwrenTestFile = undefined;
		return Promise.resolve(injected);
	}
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = PICKER_EXTENSIONS.map((e) => `.${e}`).join(",");
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
	async pickFile() {
		const file = await browserPick();
		return file ? adoptBrowserFile(file) : null;
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
	async launchFiles() {
		return [];
	},
	abilities() {
		const sheet = canWebShare();
		return {
			share: true,
			shareIsDownload: !sheet,
			openWith: false,
			reveal: false,
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
	async printPage() {
		return false;
	},
	async printOriginal() {
		return false;
	},
	async read(reopen) {
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
	args?: Record<string, unknown>,
): Promise<T> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<T>(cmd, args);
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
	callback: "__paperwrenFolder" | "__paperwrenFolderList",
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

/** Walk a desktop folder breadth-first, within FOLDER_LIMITS. */
async function listDesktopFolder(root: string): Promise<FolderFile[]> {
	const { readDir, stat } = await import("@tauri-apps/plugin-fs");
	const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
	const join = (dir: string, name: string) =>
		dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`;
	const found: Array<{ path: string; name: string; folder: string }> = [];
	const queue: Array<{ dir: string; label: string; depth: number }> = [
		{ dir: root, label: "", depth: 0 },
	];
	let visited = 0;
	let first = true;
	while (
		queue.length &&
		found.length < FOLDER_LIMITS.files &&
		visited < FOLDER_LIMITS.folders
	) {
		const { dir, label, depth } = queue.shift() as (typeof queue)[number];
		visited++;
		let entries: Awaited<ReturnType<typeof readDir>>;
		try {
			entries = await readDir(dir);
		} catch (err) {
			// The chosen folder itself must be readable; deeper ones may not be.
			if (first) throw new OpenError(classifyError(err), String(err));
			continue;
		} finally {
			first = false;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.isDirectory) {
				if (depth < FOLDER_LIMITS.depth)
					queue.push({
						dir: join(dir, entry.name),
						label: label ? `${label}/${entry.name}` : entry.name,
						depth: depth + 1,
					});
			} else if (
				entry.isFile &&
				formatFromName(entry.name) !== "unknown" &&
				found.length < FOLDER_LIMITS.files
			) {
				found.push({
					path: join(dir, entry.name),
					name: entry.name,
					folder: label,
				});
			}
		}
	}
	// Size and date are a nicety: a refused stat still lists the file.
	const out: FolderFile[] = new Array(found.length);
	let next = 0;
	const worker = async () => {
		while (next < found.length) {
			const i = next++;
			const file = found[i];
			let size = 0;
			let modified = 0;
			try {
				const info = await stat(file.path);
				size = info.size;
				modified = info.mtime ? info.mtime.getTime() : 0;
			} catch {
				// Leave them unknown.
			}
			out[i] = {
				name: file.name,
				size,
				modified,
				folder: file.folder,
				request: request(file.name, true, size, {
					kind: "path",
					path: file.path,
				}),
			};
		}
	};
	await Promise.all(Array.from({ length: 12 }, worker));
	return out;
}

/** The path or content:// URI native code can open. */
function nativeTarget(file: FileRef): string {
	const { reopen } = file;
	if (reopen.kind === "uri") return reopen.uri;
	if (reopen.kind === "browser") throw new OpenError("unsupported");
	return reopen.path;
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
	async pickFile() {
		const { open } = await import("@tauri-apps/plugin-dialog");
		const picked = await open({
			multiple: false,
			title: "Open a document",
			filters: [{ name: "Documents", extensions: PICKER_EXTENSIONS }],
		});
		if (!picked || typeof picked !== "string") return null;
		if (picked.startsWith("content://")) {
			const copy = await importPicked(picked);
			if (copy) {
				return request(copy.name, true, copy.size, {
					kind: "managed",
					path: copy.path,
				});
			}
			const { name, verified, size } = androidName(picked);
			return request(name, verified, size, { kind: "uri", uri: picked });
		}
		return requestForPath(picked);
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
			title: "Choose a folder to browse",
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
	async launchFiles() {
		// Android delivers files through intents (see index.html).
		if (window.__paperwrenAndroid) return [];
		try {
			const paths = await invoke<string[]>("launch_files");
			return await Promise.all(paths.map(requestForPath));
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
				openWith: extras,
				reveal: false,
			};
		}
		return {
			share: canWebShare(),
			shareIsDownload: false,
			// Desktop: the OS opens it with whatever app owns the type.
			openWith: file.reopen.kind === "path",
			reveal: file.reopen.kind === "path",
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
		if (reopen.kind === "browser") throw new OpenError("not_found");
		const target = reopen.kind === "uri" ? reopen.uri : reopen.path;
		try {
			const { readFile } = await import("@tauri-apps/plugin-fs");
			return toArrayBuffer(await readFile(target));
		} catch (err) {
			throw new OpenError(classifyError(err), String(err));
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
export const backend: Backend = {
	...raw,
	storeSet: createSerializedWriter((key, value) => raw.storeSet(key, value)),
};

/** Build an open request for a file delivered by Android "Open with". */
export function requestForManagedCopy(
	path: string,
	name: string,
	size: number,
): OpenRequest {
	return request(name, true, size, { kind: "managed", path });
}

export { managedRelPath };

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
