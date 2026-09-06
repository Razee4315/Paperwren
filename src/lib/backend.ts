import { isTauriEnvironment } from "./env";
import { type OpenFailure, classifyOpenError } from "./errors";
import {
	storedFileBytes,
	storedFileClear,
	storedFileGet,
	storedFilePut,
} from "./fileStore";
import { createSerializedWriter } from "./serializedWriter";
import type { FileMeta, RecentsEntry, ReopenDescriptor } from "./types";

/**
 * The one platform boundary of the app: pick a file, read its
 * bytes, persist JSON. Every feature works through this interface
 * in both Tauri and a plain browser, so the whole UI is testable
 * in a desktop browser during development.
 *
 * Storage rule (never two stores for one kind of data): the shell
 * swaps the backend, features never know which one is active.
 */

export interface PickedFileMeta {
	name: string;
	/** True when `name` was verified against the provider or the OS
	 * (bridge DISPLAY_NAME, file object, desktop path); false when it
	 * is a best-effort URI segment fallback (docs/15 #1). */
	nameVerified?: boolean;
	size: number;
	source: string;
	ref: string;
	reopen?: ReopenDescriptor;
}

export type OpenRecentResult =
	| { ok: true; buffer: ArrayBuffer }
	| { ok: false; failure: OpenFailure };

interface Backend {
	pickFile(): Promise<PickedFileMeta | null>;
	readBytes(ref: string): Promise<ArrayBuffer>;
	/** Resolve a recent's durable descriptor into readable bytes or
	 * a typed failure (audit section 4.5). */
	openRecent(entry: RecentsEntry): Promise<OpenRecentResult>;
	/** Re-query the provider display name for a persisted content
	 * URI (Android bridge). Null when unavailable: off Android, the
	 * bridge not (yet) registered, or the provider query failed.
	 * Used to heal generic recents names on successful reopen
	 * (docs/15 #1 step 5). */
	resolveContentName(source: string): Promise<string | null>;
	storeGet(key: string): Promise<unknown>;
	storeSet(key: string, value: unknown): Promise<void>;
	cacheStats(): Promise<{ bytes: number }>;
	clearCache(): Promise<void>;
	importsStats(): Promise<{ bytes: number }>;
	clearImports(): Promise<void>;
}

// ---------- Browser backend (development and web preview) ----------

const browserFiles = new Map<string, File>();

/** A picked browser file serves the immediate open from memory and is
 * mirrored into IndexedDB so its recent survives a reload (the map
 * dies with the page; the store is the browser's disk). */
function registerBrowserFile(source: string, file: File): void {
	browserFiles.set(source, file);
	storedFilePut(source, file).catch(() => {});
}

async function resolveBrowserFile(source: string): Promise<Blob | null> {
	const live = browserFiles.get(source);
	if (live) return live;
	try {
		return await storedFileGet(source);
	} catch {
		return null;
	}
}

/** Query the provider display name through the Android bridge.
 * Shared by the picker and the reopen healing path; the
 * @JavascriptInterface call runs on a WebView worker thread, never
 * the UI thread. Returns null on any failure so callers keep their
 * fallback. */
function queryBridgeName(uri: string): string | null {
	if (!uri.startsWith("content://")) return null;
	const bridge = window.__paperwrenAndroid;
	if (!bridge) return null;
	try {
		const name = bridge.displayName(uri);
		return name && name.trim().length > 0 ? name : null;
	} catch {
		return null;
	}
}

declare global {
	interface Window {
		/** Dev test hook: set a File here and the picker returns it
		 * instead of showing the file input. Lets automated browser
		 * tests exercise the whole open flow without a chooser. */
		__paperwrenTestFile?: File;
		/** Dev test hook: milliseconds to delay browser-backend byte
		 * reads, so automated tests can observe the loading state and
		 * interactions DURING an in-flight read (docs/15 #2). */
		__paperwrenTestReadDelay?: number;
		/** Android picker bridge (MainActivity patch): asks the
		 * content resolver for the real DISPLAY_NAME and SIZE of a
		 * picked content:// URI, whose own last segment is an opaque
		 * numeric id. Undefined off Android or before the bridge
		 * installs. */
		__paperwrenAndroid?: {
			displayName(uri: string): string;
			contentSize(uri: string): number;
		};
	}
}

/** Test-only read delay (docs/15 #2): a controlled slow read so
 * browser tests can cover the loading state and in-flight
 * interactions. No-op unless the hook is set. */
async function testReadDelay(): Promise<void> {
	const ms = window.__paperwrenTestReadDelay;
	if (typeof ms === "number" && ms > 0) {
		await new Promise((resolve) => setTimeout(resolve, ms));
	}
}

const browserBackend: Backend = {
	async pickFile() {
		const injected = window.__paperwrenTestFile;
		if (injected) {
			window.__paperwrenTestFile = undefined;
			const source = `browser:${injected.name}`;
			registerBrowserFile(source, injected);
			return {
				name: injected.name,
				nameVerified: true,
				size: injected.size,
				source,
				ref: source,
			};
		}
		return new Promise((resolve) => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".pdf,.docx,.xlsx,.pptx,.csv,.txt,.md,application/pdf";
			input.onchange = () => {
				const file = input.files?.[0];
				if (!file) {
					resolve(null);
					return;
				}
				const source = `browser:${file.name}`;
				registerBrowserFile(source, file);
				resolve({
					name: file.name,
					nameVerified: true,
					size: file.size,
					source,
					ref: source,
				});
			};
			input.oncancel = () => resolve(null);
			input.click();
		});
	},
	async readBytes(ref) {
		const file = await resolveBrowserFile(ref);
		if (!file) throw new Error("File not found. It may have been moved.");
		const buffer = await file.arrayBuffer();
		await testReadDelay();
		return buffer;
	},
	async openRecent(entry) {
		// Browser sources ("browser:name") resolve from the in-memory
		// map first, then the IndexedDB mirror left by the pick.
		const file = await resolveBrowserFile(entry.source);
		if (!file) return { ok: false, failure: "not_found" };
		return { ok: true, buffer: await file.arrayBuffer() };
	},
	async resolveContentName() {
		// No content providers outside Android/Tauri.
		return null;
	},
	async storeGet(key) {
		const raw = localStorage.getItem(`paperwren.${key}`);
		return raw === null ? null : JSON.parse(raw);
	},
	async storeSet(key, value) {
		localStorage.setItem(`paperwren.${key}`, JSON.stringify(value));
	},
	async cacheStats() {
		let bytes = 0;
		browserFiles.forEach((f) => {
			bytes += f.size;
		});
		try {
			bytes += await storedFileBytes();
		} catch {
			// The mirror is best-effort; the live map still reports.
		}
		return { bytes };
	},
	async clearCache() {
		browserFiles.clear();
		try {
			await storedFileClear();
		} catch {
			// Ditto: clearing the mirror is best-effort.
		}
	},
	async importsStats() {
		return { bytes: 0 };
	},
	async clearImports() {},
};

// ---------- Tauri backend ----------
//
// File picking goes through the dialog plugin (the system picker on
// Android, a native dialog on desktop). Reading goes through the fs
// plugin because it understands both desktop paths and Android
// content:// URIs, which std::fs cannot touch.

async function tauriInvoke<T>(
	cmd: string,
	args?: Record<string, unknown>,
): Promise<T> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<T>(cmd, args);
}

const tauriBackend: Backend = {
	async pickFile() {
		const { open } = await import("@tauri-apps/plugin-dialog");
		const result = await open({
			multiple: false,
			title: "Open a file",
			filters: [
				{
					name: "Documents",
					extensions: ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "md"],
				},
			],
		});
		if (!result || typeof result !== "string") return null;
		const path = result;
		// Android pickers return content:// URIs whose last segment is
		// an opaque numeric id with no extension. The Kotlin bridge
		// (MainActivity patch) asks the provider for the real
		// DISPLAY_NAME; without it every recent showed as
		// "Document.pdf". Fallbacks: percent-decode the segment
		// (SAF URIs carry the path as ...%2FDir%2FName.pdf), then the
		// raw segment. A bridge name is VERIFIED (nameVerified) so the
		// viewer stores it verbatim; a segment fallback is not, and
		// the sniffed format decides the viewer regardless.
		let name = path.split(/[\\/]/).pop() ?? path;
		let nameVerified = !path.startsWith("content://");
		let size = 0;
		if (path.startsWith("content://")) {
			const bridgedName = queryBridgeName(path);
			if (bridgedName) {
				name = bridgedName;
				nameVerified = true;
				const bridge = window.__paperwrenAndroid;
				const bridgedSize = bridge ? bridge.contentSize(path) : 0;
				if (Number.isFinite(bridgedSize) && bridgedSize > 0) {
					size = bridgedSize;
				}
			}
			if (size === 0 && name === (path.split(/[\\/]/).pop() ?? path)) {
				try {
					const decoded = decodeURIComponent(name);
					name = decoded.includes("/")
						? decoded.slice(decoded.lastIndexOf("/") + 1)
						: decoded;
				} catch {
					// Malformed escape: keep the raw segment.
				}
			}
		}
		const reopen: ReopenDescriptor = path.startsWith("content://")
			? { kind: "persisted-uri", uri: path }
			: { kind: "desktop-path", path };
		return { name, nameVerified, size, source: path, ref: path, reopen };
	},
	async readBytes(ref) {
		const { readFile } = await import("@tauri-apps/plugin-fs");
		const bytes = await readFile(ref);
		return bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
	},
	async openRecent(entry) {
		const target = entry.reopen?.kind !== undefined ? entry.reopen : null;
		const ref =
			target?.kind === "persisted-uri"
				? target.uri
				: target?.kind === "managed-copy" || target?.kind === "desktop-path"
					? target.path
					: entry.source;
		try {
			const buffer = await this.readBytes(ref);
			if (buffer.byteLength === 0) return { ok: false, failure: "corrupt" };
			return { ok: true, buffer };
		} catch (err) {
			const failure = classifyOpenError(err);
			// A revoked/unavailable provider or a vanished copy is a
			// fact about the recent, not a transient read error.
			return {
				ok: false,
				failure:
					failure === "provider_unavailable" && target?.kind === "managed-copy"
						? "not_found"
						: failure,
			};
		}
	},
	async resolveContentName(source) {
		return queryBridgeName(source);
	},
	async storeGet(key) {
		return tauriInvoke<unknown>("store_get", { key });
	},
	async storeSet(key, value) {
		await tauriInvoke<void>("store_set", { key, value });
	},
	async cacheStats() {
		return tauriInvoke<{ bytes: number }>("cache_stats");
	},
	async clearCache() {
		await tauriInvoke<void>("clear_cache");
	},
	async importsStats() {
		return tauriInvoke<{ bytes: number }>("imports_stats");
	},
	async clearImports() {
		await tauriInvoke<void>("clear_imports");
	},
};

const rawBackend: Backend = isTauriEnvironment ? tauriBackend : browserBackend;

// Serialized per-key persistence writes (audit section 15.1).
const serializedStoreSet = createSerializedWriter((key, value) =>
	rawBackend.storeSet(key, value),
);

export const backend: Backend = {
	...rawBackend,
	storeSet: serializedStoreSet,
};

export async function readFileMeta(picked: PickedFileMeta): Promise<FileMeta> {
	return {
		name: picked.name,
		nameVerified: picked.nameVerified,
		format: guessFormat(picked.name),
		size: picked.size,
		ref: picked.ref,
		source: picked.source,
		reopen: picked.reopen,
	};
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function guessFormat(name: string): FileMeta["format"] {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	switch (ext) {
		case "pdf":
			return "pdf";
		case "docx":
			return "docx";
		case "xlsx":
		case "xlsm":
		case "xlsb":
			return "xlsx";
		case "pptx":
			return "pptx";
		case "csv":
			return "csv";
		case "txt":
		case "md":
			return "txt";
		default:
			return "unknown";
	}
}

/** Stable id for a recents entry: hash of the source string. */
export function idForSource(source: string): string {
	let hash = 5381;
	for (let i = 0; i < source.length; i++) {
		hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
	}
	return `f${(hash >>> 0).toString(36)}`;
}
