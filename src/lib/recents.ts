import { guessFormat, idForSource } from "./backend";
import { displayNameFor } from "./sniff";
import type {
	DocxPositionMode,
	FilePosition,
	RecentsEntry,
	ReopenDescriptor,
} from "./types";

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

const unitFraction = (value: unknown, fallback = 0) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.min(1, Math.max(0, value))
		: fallback;

const nonNegativeFinite = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined;

/** Zero-based page index of a stored position, whatever shape it is
 * (legacy page field or a versioned pdf/docx location). */
export function positionPageIndex(
	position: FilePosition | undefined,
): number | undefined {
	if (!position) return undefined;
	if (isVersionedPosition(position)) {
		if (position.kind === "pdf" || position.kind === "docx") {
			return position.location.pageIndex;
		}
		return undefined;
	}
	return position.page;
}

/** Type guard for the versioned union members. */
export function isVersionedPosition(
	position: FilePosition,
): position is Extract<FilePosition, { version: 2 }> {
	return "version" in position;
}

/** Validate a versioned position payload (docs/14 audit section 8).
 * v2 payloads are checked field by field (finite numbers, integer
 * page indexes, sane bounds, known kinds/modes); legacy
 * {page,zoom,scrollRatio} values keep their documented decoding.
 * Anything untrustworthy is dropped rather than persisted. */
function cleanPosition(value: unknown): FilePosition | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;

	if (raw.version === 2) {
		if (raw.kind === "pdf" || raw.kind === "docx") {
			const loc = raw.location;
			if (!loc || typeof loc !== "object") return undefined;
			const l = loc as Record<string, unknown>;
			const pageIndex = nonNegativeFinite(l.pageIndex);
			if (pageIndex === undefined || !Number.isInteger(pageIndex)) {
				return undefined;
			}
			const modes = ["width", "page", "manual"] as const;
			const mode = modes.find((m) => m === raw.mode);
			if (!mode) return undefined;
			const location = {
				pageIndex,
				x: unitFraction(l.x),
				y: unitFraction(l.y),
				viewportX: unitFraction(l.viewportX, 0.5),
				viewportY: unitFraction(l.viewportY, 0.5),
			};
			const scale = nonNegativeFinite(raw.scale);
			if (raw.kind === "pdf") {
				const rotation =
					([0, 90, 180, 270] as const).find((r) => r === raw.rotation) ?? 0;
				return {
					version: 2,
					kind: "pdf",
					location,
					mode,
					rotation,
					scale: mode === "manual" && scale !== undefined ? scale : undefined,
				};
			}
			const docxMode: DocxPositionMode = mode === "page" ? "manual" : mode;
			return {
				version: 2,
				kind: "docx",
				location,
				mode: docxMode,
				scale: docxMode === "manual" && scale !== undefined ? scale : undefined,
			};
		}
		if (raw.kind === "sheet") {
			if (typeof raw.sheetName !== "string" || raw.sheetName.length === 0) {
				return undefined;
			}
			const row = nonNegativeFinite(raw.row);
			const col = nonNegativeFinite(raw.col);
			if (row === undefined || col === undefined) return undefined;
			return {
				version: 2,
				kind: "sheet",
				sheetName: raw.sheetName,
				row: Math.floor(row),
				col: Math.floor(col),
				offsetX: nonNegativeFinite(raw.offsetX) ?? 0,
				offsetY: nonNegativeFinite(raw.offsetY) ?? 0,
			};
		}
		return undefined;
	}

	// Legacy union: {page, zoom, scrollRatio}.
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
