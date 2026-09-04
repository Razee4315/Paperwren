import { isTauriEnvironment } from "./env";
import type { FileMeta } from "./types";

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
}

interface Backend {
	pickFile(): Promise<PickedFileMeta | null>;
	readBytes(ref: string): Promise<ArrayBuffer>;
	storeGet(key: string): Promise<unknown>;
	storeSet(key: string, value: unknown): Promise<void>;
	cacheStats(): Promise<{ bytes: number }>;
	clearCache(): Promise<void>;
}

// ---------- Browser backend (development and web preview) ----------

const browserFiles = new Map<string, File>();
let browserCounter = 0;

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
			browserCounter += 1;
			const ref = `browser-${browserCounter}`;
			browserFiles.set(ref, injected);
			return {
				name: injected.name,
				size: injected.size,
				source: `browser:${injected.name}`,
				ref,
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
				browserCounter += 1;
				const ref = `browser-${browserCounter}`;
				browserFiles.set(ref, file);
				resolve({
					name: file.name,
					size: file.size,
					source: `browser:${file.name}`,
					ref,
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
		return { name, size: 0, source: path, ref: path };
	},
	async readBytes(ref) {
		const { readFile } = await import("@tauri-apps/plugin-fs");
		const bytes = await readFile(ref);
		return bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
	},
	async storeGet(key) {
		return tauriInvoke<unknown>("store_get", { key });
	},
	async storeSet(key, value) {
		return tauriInvoke<void>("store_set", { key, value });
	},
	async cacheStats() {
		return tauriInvoke<{ bytes: number }>("cache_stats");
	},
	async clearCache() {
		return tauriInvoke<void>("clear_cache");
	},
};

export const backend: Backend = isTauriEnvironment
	? tauriBackend
	: browserBackend;

export async function readFileMeta(picked: PickedFileMeta): Promise<FileMeta> {
	return {
		name: picked.name,
		format: guessFormat(picked.name),
		size: picked.size,
		ref: picked.ref,
		source: picked.source,
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
