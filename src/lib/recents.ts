/**
 * Recents as pure functions over an array, so every rule (dedupe,
 * pin ordering, limit eviction, legacy migration) is unit-tested
 * without React.
 */

import { ALL_FORMATS, type FileFormat, formatFromName } from "./formats";
import type { Position, RecentEntry, Reopen } from "./types";

/** Stable id from the reopen identity (djb2, base36). */
export function idForReopen(reopen: Reopen): string {
	const key =
		reopen.kind === "uri"
			? reopen.uri
			: reopen.kind === "browser"
				? `browser:${reopen.key}`
				: reopen.path;
	let hash = 5381;
	for (let i = 0; i < key.length; i++) {
		hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
	}
	return `f${(hash >>> 0).toString(36)}`;
}

const finite = (v: unknown, fallback = 0) =>
	typeof v === "number" && Number.isFinite(v) ? v : fallback;

function cleanReopen(value: unknown): Reopen | null {
	if (!value || typeof value !== "object") return null;
	const r = value as Record<string, unknown>;
	if (r.kind === "uri" && typeof r.uri === "string")
		return { kind: "uri", uri: r.uri };
	if ((r.kind === "managed" || r.kind === "path") && typeof r.path === "string")
		return { kind: r.kind, path: r.path };
	if (r.kind === "browser" && typeof r.key === "string")
		return { kind: "browser", key: r.key };
	return null;
}

export function cleanPosition(value: unknown): Position | undefined {
	if (!value || typeof value !== "object") return undefined;
	const p = value as Record<string, unknown>;
	switch (p.kind) {
		case "pdf":
			if (typeof p.scale !== "string") return undefined;
			return {
				kind: "pdf",
				page: Math.max(1, Math.floor(finite(p.page, 1))),
				scale: p.scale,
				top: finite(p.top),
				left: finite(p.left),
				rotation: [0, 90, 180, 270].includes(p.rotation as number)
					? (p.rotation as number)
					: 0,
			};
		case "scroll":
			return {
				kind: "scroll",
				ratio: Math.min(1, Math.max(0, finite(p.ratio))),
				zoom: typeof p.zoom === "number" && p.zoom > 0 ? p.zoom : undefined,
			};
		case "sheet":
			return {
				kind: "sheet",
				sheet: Math.max(0, Math.floor(finite(p.sheet))),
				top: Math.max(0, finite(p.top)),
				left: Math.max(0, finite(p.left)),
			};
		case "slides":
			return {
				kind: "slides",
				slide: Math.max(0, Math.floor(finite(p.slide))),
			};
		default:
			return undefined;
	}
}

function cleanFormat(value: unknown, name: string): FileFormat {
	return ALL_FORMATS.includes(value as FileFormat)
		? (value as FileFormat)
		: formatFromName(name);
}

/** Validate stored entries; drop unusable ones, dedupe by id. */
export function normalizeRecents(value: unknown): RecentEntry[] {
	if (!Array.isArray(value)) return [];
	const byId = new Map<string, RecentEntry>();
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const raw = item as Record<string, unknown>;
		const reopen = cleanReopen(raw.reopen);
		if (!reopen) continue;
		const name =
			typeof raw.name === "string" && raw.name.trim()
				? raw.name.trim()
				: "Untitled";
		const entry: RecentEntry = {
			id: idForReopen(reopen),
			name,
			format: cleanFormat(raw.format, name),
			size: Math.max(0, finite(raw.size)),
			reopen,
			openedAt: finite(raw.openedAt),
			pinned: raw.pinned === true,
			position: cleanPosition(raw.position),
			unavailable: raw.unavailable === true || undefined,
		};
		const prev = byId.get(entry.id);
		if (!prev || entry.openedAt >= prev.openedAt) byId.set(entry.id, entry);
	}
	return sortRecents([...byId.values()]);
}

/** Convert the pre-redesign recents shape. Only the PDF page of the
 * old position survives; other viewers restart at the top. */
export function migrateLegacyRecents(value: unknown): RecentEntry[] {
	if (!Array.isArray(value)) return [];
	const converted = value.map((item) => {
		if (!item || typeof item !== "object") return null;
		const raw = item as Record<string, unknown>;
		const source = typeof raw.source === "string" ? raw.source : "";
		const old = (raw.reopen ?? {}) as Record<string, unknown>;
		let reopen: Reopen | null = null;
		if (old.kind === "persisted-uri" && typeof old.uri === "string")
			reopen = { kind: "uri", uri: old.uri };
		else if (old.kind === "managed-copy" && typeof old.path === "string")
			reopen = old.path.startsWith("browser:")
				? { kind: "browser", key: old.path.slice(8) }
				: { kind: "managed", path: old.path };
		else if (old.kind === "desktop-path" && typeof old.path === "string")
			reopen = { kind: "path", path: old.path };
		else if (source.startsWith("content://"))
			reopen = { kind: "uri", uri: source };
		else if (source.startsWith("browser:"))
			reopen = { kind: "browser", key: source.slice(8) };
		else if (source.includes("/imports/"))
			reopen = { kind: "managed", path: source };
		else if (source) reopen = { kind: "path", path: source };
		if (!reopen) return null;
		const pos = raw.position as Record<string, unknown> | undefined;
		const loc = pos?.location as Record<string, unknown> | undefined;
		let position: Position | undefined;
		if (pos?.kind === "pdf" && loc && typeof loc.pageIndex === "number") {
			position = {
				kind: "pdf",
				page: loc.pageIndex + 1,
				scale: pos.mode === "page" ? "page-fit" : "page-width",
				top: 0,
				left: 0,
				rotation: typeof pos.rotation === "number" ? pos.rotation : 0,
			};
		}
		return {
			name: raw.name,
			format: raw.format,
			size: raw.size,
			reopen,
			openedAt: raw.lastOpenedAt ?? raw.addedAt,
			pinned: raw.pinned,
			position,
			unavailable: raw.unavailable,
		};
	});
	return normalizeRecents(converted.filter(Boolean));
}

/** Pinned first, then most recently opened. */
export function sortRecents(list: RecentEntry[]): RecentEntry[] {
	return [...list].sort((a, b) =>
		a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.openedAt - a.openedAt,
	);
}

/** Record an open: update in place (clearing `unavailable`) or add,
 * then trim unpinned entries beyond `limit`. Returns the evicted
 * entries so their managed copies can be deleted. */
export function recordOpen(
	list: RecentEntry[],
	entry: Omit<RecentEntry, "pinned" | "openedAt" | "id"> & { id: string },
	now: number,
	limit: number,
): { list: RecentEntry[]; evicted: RecentEntry[] } {
	const existing = list.find((e) => e.id === entry.id);
	const merged: RecentEntry = existing
		? {
				...existing,
				...entry,
				position: entry.position ?? existing.position,
				pinned: existing.pinned,
				openedAt: now,
				unavailable: undefined,
			}
		: { ...entry, pinned: false, openedAt: now };
	const next = sortRecents([merged, ...list.filter((e) => e.id !== entry.id)]);
	const pinned = next.filter((e) => e.pinned);
	const unpinned = next.filter((e) => !e.pinned);
	return {
		list: [...pinned, ...unpinned.slice(0, limit)],
		evicted: unpinned.slice(limit),
	};
}

export function updateEntry(
	list: RecentEntry[],
	id: string,
	patch: Partial<RecentEntry>,
): RecentEntry[] {
	return sortRecents(list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

/** Managed-copy path relative to the imports directory, as the Rust
 * housekeeping commands expect it. */
export function managedRelPath(path: string): string | null {
	const normalized = path.replace(/\\/g, "/");
	const at = normalized.lastIndexOf("/imports/");
	return at === -1 ? null : normalized.slice(at + "/imports/".length);
}
