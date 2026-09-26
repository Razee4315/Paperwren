/**
 * The single platform boundary. Everything the UI needs from the
 * host (pick a file, read bytes, persist JSON, manage imported
 * copies) goes through `backend`, which is the Tauri implementation
 * in the app and an in-browser implementation in dev/tests.
 */

import { isTauri } from "./env";
import { OpenError, classifyError } from "./errors";
import { storedFileClear, storedFileGet, storedFilePut } from "./fileStore";
import { PICKER_EXTENSIONS } from "./formats";
import { idForReopen, managedRelPath } from "./recents";
import { createSerializedWriter } from "./serializedWriter";
import type { OpenRequest, Reopen } from "./types";

export interface ImportsStats {
	bytes: number;
	files: number;
}

interface Backend {
	pickFile(): Promise<OpenRequest | null>;
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
			persist(uri: string): boolean;
		};
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

const browserBackend: Backend = {
	providerName: bridgeName,
	async pickFile() {
		const file = await browserPick();
		if (!file) return null;
		const key = `${file.name}:${file.size}:${file.lastModified}`;
		liveFiles.set(key, file);
		storedFilePut(key, file).catch(() => {});
		return request(file.name, true, file.size, { kind: "browser", key });
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
			try {
				window.__paperwrenAndroid?.persist(picked);
			} catch {
				// Not every provider grants persistable access.
			}
			const { name, verified, size } = androidName(picked);
			return request(name, verified, size, { kind: "uri", uri: picked });
		}
		const name = picked.split(/[\\/]/).pop() || picked;
		return request(name, true, 0, { kind: "path", path: picked });
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
