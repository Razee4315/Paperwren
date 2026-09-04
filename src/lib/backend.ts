import { isTauriEnvironment } from "./env";
import { type OpenFailure, classifyOpenError } from "./errors";
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
	storeGet(key: string): Promise<unknown>;
	storeSet(key: string, value: unknown): Promise<void>;
	cacheStats(): Promise<{ bytes: number }>;
	clearCache(): Promise<void>;
	importsStats(): Promise<{ bytes: number }>;
	clearImports(): Promise<void>;
}

// ---------- Browser backend (development and web preview) ----------

const browserFiles = new Map<string, File>();

declare global {
	interface Window {
		/** Dev test hook: set a File here and the picker returns it
		 * instead of showing the file input. Lets automated browser
		 * tests exercise the whole open flow without a chooser. */
		__paperwrenTestFile?: File;
	}
}

const browserBackend: Backend = {
	async pickFile() {
		const injected = window.__paperwrenTestFile;
		if (injected) {
			window.__paperwrenTestFile = undefined;
			const source = `browser:${injected.name}`;
			browserFiles.set(source, injected);
			return {
				name: injected.name,
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
				browserFiles.set(source, file);
				resolve({
					name: file.name,
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
		const file = browserFiles.get(ref);
		if (!file) throw new Error("File not found. It may have been moved.");
		return file.arrayBuffer();
	},
	async openRecent(entry) {
		// Browser sources ("browser:name") only resolve while the
		// in-memory map still holds the picked File.
		const file = browserFiles.get(entry.source);
		if (!file) return { ok: false, failure: "not_found" };
		return { ok: true, buffer: await file.arrayBuffer() };
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
		return { bytes };
	},
	async clearCache() {
		browserFiles.clear();
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
		// an opaque numeric id with no extension. Keep the raw name as
		// a hint only; sniffing decides the format from the bytes, and
		// the size arrives with the single read (no extra SAF round
		// trip, which is what made picking feel stuck).
		const name = path.split(/[\\/]/).pop() ?? path;
		const reopen: ReopenDescriptor = path.startsWith("content://")
			? { kind: "persisted-uri", uri: path }
			: { kind: "desktop-path", path };
		return { name, size: 0, source: path, ref: path, reopen };
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
