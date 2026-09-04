import { guessFormat, idForSource } from "./backend";
import { displayNameFor } from "./sniff";
import type { FilePosition, RecentsEntry } from "./types";

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

/** Validate old persisted entries before they reach the dashboard. */
export function normalizeRecents(value: unknown): RecentsEntry[] {
	if (!Array.isArray(value)) return [];
	const bySource = new Map<string, RecentsEntry>();
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const raw = item as Record<string, unknown>;
		if (typeof raw.source !== "string" || raw.source.trim().length === 0)
			continue;
		const source = raw.source;
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
			id: idForSource(source),
			name,
			format,
			size: finiteNonNegative(raw.size),
			source,
			addedAt,
			lastOpenedAt,
			pinned: raw.pinned === true,
			position: cleanPosition(raw.position),
		};
		const previous = bySource.get(source);
		if (!previous || entry.lastOpenedAt >= previous.lastOpenedAt) {
			bySource.set(source, entry);
		}
	}
	return [...bySource.values()];
}
