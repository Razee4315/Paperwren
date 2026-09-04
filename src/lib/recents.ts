import { guessFormat, idForSource } from "./backend";
import { displayNameFor } from "./sniff";
import type { FilePosition, RecentsEntry, ReopenDescriptor } from "./types";

const FORMATS = new Set([
	"pdf",
	"docx",
	"xlsx",
	"pptx",
	"csv",
	"txt",
	"unknown",
]);

const finiteNonNegative = (value: unknown, fallback = 0) =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: fallback;

function cleanPosition(value: unknown): FilePosition | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const position: FilePosition = {};
	if (typeof raw.page === "number" && raw.page >= 0) position.page = raw.page;
	if (typeof raw.zoom === "number" && raw.zoom > 0) position.zoom = raw.zoom;
	if (typeof raw.scrollRatio === "number" && raw.scrollRatio >= 0) {
		position.scrollRatio = Math.min(1, raw.scrollRatio);
	}
	return Object.keys(position).length > 0 ? position : undefined;
}

/** Derive a reopen descriptor from a legacy `source` string. The
 * source scheme decides the mechanism; a wrong guess surfaces as a
 * typed reopen failure instead of a silent generic name. */
export function reopenFromSource(source: string): ReopenDescriptor {
	if (source.startsWith("content://")) {
		return { kind: "persisted-uri", uri: source };
	}
	if (/[\\/]/.test(source)) {
		// Managed open-with copies live under the app's imports dir;
		// desktop picks are plain filesystem paths.
		const normalized = source.replace(/\\/g, "/");
		if (normalized.includes("/imports/")) {
			return { kind: "managed-copy", path: source };
		}
		return { kind: "desktop-path", path: source };
	}
	// Browser dev keys ("browser:name") and anything opaque.
	return { kind: "managed-copy", path: source };
}

function cleanReopen(value: unknown, source: string): ReopenDescriptor {
	if (!value || typeof value !== "object") return reopenFromSource(source);
	const raw = value as Record<string, unknown>;
	if (raw.kind === "persisted-uri" && typeof raw.uri === "string") {
		return { kind: "persisted-uri", uri: raw.uri };
	}
	if (
		(raw.kind === "managed-copy" || raw.kind === "desktop-path") &&
		typeof raw.path === "string"
	) {
		return { kind: raw.kind, path: raw.path };
	}
	return reopenFromSource(source);
}

/** Validate old persisted entries before they reach the dashboard.
 * Every legacy shape is accepted, deduplicated by reopen identity,
 * and never dropped silently (audit section 19). */
export function normalizeRecents(value: unknown): RecentsEntry[] {
	if (!Array.isArray(value)) return [];
	const byId = new Map<string, RecentsEntry>();
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const raw = item as Record<string, unknown>;
		if (typeof raw.source !== "string" || raw.source.trim().length === 0)
			continue;
		const source = raw.source;
		const reopen = cleanReopen(raw.reopen, source);
		// Identity is the durable descriptor, not the display name.
		const id =
			typeof raw.id === "string" && raw.id.length > 0
				? raw.id
				: idForSource(source);
		const rawName =
			typeof raw.name === "string" && raw.name.trim().length > 0
				? raw.name.trim()
				: "Untitled file";
		const storedFormat =
			typeof raw.format === "string" && FORMATS.has(raw.format)
				? (raw.format as RecentsEntry["format"])
				: "unknown";
		const nameFormat = guessFormat(rawName);
		const sourceFormat = guessFormat(source);
		const format =
			storedFormat !== "unknown"
				? storedFormat
				: nameFormat !== "unknown"
					? nameFormat
					: sourceFormat;
		const opaqueName = /^\d+$/.test(rawName);
		const name = opaqueName
			? format !== "unknown"
				? displayNameFor(rawName, format)
				: "Document"
			: rawName;
		const addedAt = finiteNonNegative(raw.addedAt);
		const lastOpenedAt = finiteNonNegative(raw.lastOpenedAt, addedAt);
		const entry: RecentsEntry = {
			id,
			name,
			format,
			size: finiteNonNegative(raw.size),
			source,
			reopen,
			addedAt,
			lastOpenedAt,
			pinned: raw.pinned === true,
			position: cleanPosition(raw.position),
			unavailable: raw.unavailable === true || undefined,
		};
		const previous = byId.get(id);
		if (!previous || entry.lastOpenedAt >= previous.lastOpenedAt) {
			byId.set(id, entry);
		}
	}
	return [...byId.values()];
}
