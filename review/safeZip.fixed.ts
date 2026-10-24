/**
 * A SUGGESTED fix for src/lib/safeZip.ts, written by the security-audit
 * review to show the two bypasses it found can be closed without
 * breaking the branch's own tests. Not wired into the app.
 *
 * Differences from the branch version (marked REVIEW below):
 * - Entries are counted in the filter, which sees exactly the entries
 *   fflate walks, so a ZIP64 record (which the pre-scan never reads)
 *   cannot smuggle in billions of entries.
 * - The budget is charged with what fflate will really allocate: a
 *   stored entry is sliced at its compressed size, not its claimed
 *   uncompressed size, so stored entries that share one payload can no
 *   longer each claim 0 bytes.
 * - A compressed size past the archive's own length is a lie and is
 *   skipped, which also makes the ratio check bound the real input.
 * - The pre-scan refuses an archive with a ZIP64 locator, and reads the
 *   same entry-count field fflate does.
 * - maxRatio sits just above deflate's own ceiling, so it refuses only
 *   claims no honest entry can make.
 */

import { type UnzipFileInfo, type Unzipped, unzipSync } from "fflate";

export class ZipTooLarge extends Error {}

export interface ZipLimits {
	maxEntries: number;
	maxBytes: number;
	maxEntryBytes: number;
	maxRatio: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const ZIP_LIMITS: ZipLimits = {
	maxEntries: 8192,
	maxBytes: 1 * GB,
	maxEntryBytes: 512 * MB,
	// REVIEW: deflate cannot expand past ~1032x, so only a claim above
	// that is a lie; 200 also drops honest blank images and stylesheets.
	maxRatio: 1100,
};

const STORED = 0;

export function guardedUnzip(
	bytes: Uint8Array,
	options: {
		filter?: (file: UnzipFileInfo) => boolean;
		limits?: Partial<ZipLimits>;
	} & Omit<Parameters<typeof unzipSync>[1], "filter"> = {},
): Unzipped {
	const limits = { ...ZIP_LIMITS, ...options.limits };
	scanCentralDirectory(bytes, limits);
	let budget = limits.maxBytes;
	let seen = 0; // REVIEW: counted where fflate walks, not only in the pre-scan
	const filter = (file: UnzipFileInfo): boolean => {
		if (++seen > limits.maxEntries)
			throw new ZipTooLarge("archive holds too many entries");
		if (options.filter && !options.filter(file)) return false;
		// REVIEW: a compressed size past the archive itself is a lie.
		if (file.size > bytes.length) return false;
		// REVIEW: a stored entry is its bytes; sizes that differ are a lie.
		if (file.compression === STORED && file.size !== file.originalSize)
			return false;
		// REVIEW: charge what fflate allocates (stored: a slice of `size`).
		const cost = file.compression === STORED ? file.size : file.originalSize;
		if (cost > limits.maxEntryBytes) return false;
		if (
			file.compression !== STORED &&
			file.size > 0 &&
			file.originalSize / file.size > limits.maxRatio
		)
			return false;
		if (cost > budget) return false;
		budget -= cost;
		return true;
	};
	const out = unzipSync(bytes, { ...options, filter });
	let actual = 0;
	for (const data of Object.values(out)) actual += data.length;
	if (actual > limits.maxBytes)
		throw new ZipTooLarge("archive unpacks to too much to hold");
	return out;
}

function scanCentralDirectory(bytes: Uint8Array, limits: ZipLimits): void {
	let at = -1;
	const from = Math.max(0, bytes.length - 22 - 65535);
	for (let i = bytes.length - 22; i >= from; i--) {
		if (
			bytes[i] === 0x50 &&
			bytes[i + 1] === 0x4b &&
			bytes[i + 2] === 0x05 &&
			bytes[i + 3] === 0x06
		) {
			at = i;
			break;
		}
	}
	if (at < 0) return;
	const u16 = (o: number) => bytes[o] | (bytes[o + 1] << 8);
	const u32 = (o: number) =>
		(bytes[o] |
			(bytes[o + 1] << 8) |
			(bytes[o + 2] << 16) |
			(bytes[o + 3] << 24)) >>>
		0;
	// REVIEW: fflate follows a ZIP64 locator found 20 bytes before the end
	// record; a document reader has no use for ZIP64, so refuse it here.
	if (at >= 20 && u32(at - 20) === 0x07064b50)
		throw new ZipTooLarge("archive is past the ZIP64 line");
	if (u16(at + 4) !== 0 || u16(at + 6) !== 0) return;
	// REVIEW: fflate counts entries from offset 8 (this disk), not 10.
	const entries = Math.max(u16(at + 8), u16(at + 10));
	if (entries > limits.maxEntries)
		throw new ZipTooLarge(`archive holds ${entries} entries`);
	let p = u32(at + 16);
	const end = p + u32(at + 12);
	if (p > bytes.length || end > bytes.length) return;
	for (let n = 0; n < entries; n++) {
		if (p + 46 > end || u32(p) !== 0x02014b50) return;
		const compressed = u32(p + 20);
		const original = u32(p + 24);
		if (compressed === 0xffffffff || original === 0xffffffff)
			throw new ZipTooLarge("archive is past the ZIP64 line");
		if (original > limits.maxEntryBytes)
			throw new ZipTooLarge("an entry claims to be too large to unpack");
		p += 46 + u16(p + 28) + u16(p + 30) + u16(p + 32);
	}
}
