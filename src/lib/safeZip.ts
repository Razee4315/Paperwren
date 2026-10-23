/**
 * What an archive may be allowed to inflate to.
 *
 * The app unzips documents a reader chose to open: EPUBs, comic books,
 * Office and OpenDocument files. A hostile archive can be tiny on disk
 * and expand to gigabytes (a "decompression bomb"), which would run the
 * webview out of memory before any viewer gets a say. So every inflate
 * goes through here, which checks three times:
 *
 * 1. **Before inflating anything**, the archive's central directory is
 *    read directly: an absurd number of entries, or an entry claiming
 *    to be enormous, is refused without spending a byte.
 * 2. **Per entry**, as fflate asks the filter whether to inflate it:
 *    an entry past the per-entry cap, a deflated one claiming to
 *    expand beyond `maxRatio` times its compressed bytes (no real
 *    document text expands past a handful of times), or entries that
 *    together would pass `maxBytes`, are skipped. A caller's own
 *    filter runs first, so a caller that only wanted `content.xml`
 *    still gets exactly that.
 * 3. **After inflating**, the actual decoded bytes are summed once
 *    more; headers that lied their way past (2) still fail here.
 *
 * What remains is a bounded risk: a central directory can lie about
 * both sizes, and fflate inflates an entry whole before anyone can
 * measure it. The worst a lying archive then does is crash the tab —
 * no reader data is touched, and nothing is executed.
 */

import { type UnzipFileInfo, type Unzipped, unzipSync } from "fflate";

/** Raised when an archive is refused, before or after inflating. */
export class ZipTooLarge extends Error {}

export interface ZipLimits {
	/** Most entries an archive may hold. */
	maxEntries: number;
	/** Most uncompressed bytes the entries a caller inflates may total. */
	maxBytes: number;
	/** Most uncompressed bytes a single entry may claim. */
	maxEntryBytes: number;
	/** How far past its compressed size one deflated entry may claim to
	 * expand. Stored entries never expand, so only those are checked. */
	maxRatio: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Room for any real book or workbook: an unpacked archive far past a
 * gigabyte is not a document, it is an attack. */
export const ZIP_LIMITS: ZipLimits = {
	maxEntries: 8192,
	maxBytes: 1 * GB,
	maxEntryBytes: 512 * MB,
	maxRatio: 200,
};

/** The stored method: its bytes are the file, so it cannot expand. */
const STORED = 0;

/**
 * `unzipSync`, guarded: the same entries the caller's own `filter`
 * would have chosen, and nothing an archive could stretch into a
 * memory problem. Reads `filter` and `limits`; everything else goes to
 * fflate as given.
 */
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
	const filter = (file: UnzipFileInfo): boolean => {
		if (options.filter && !options.filter(file)) return false;
		if (file.originalSize > limits.maxEntryBytes) return false;
		if (
			file.compression !== STORED &&
			file.size > 0 &&
			file.originalSize / file.size > limits.maxRatio
		)
			return false;
		if (file.originalSize > budget) return false;
		budget -= file.originalSize;
		return true;
	};
	const out = unzipSync(bytes, { ...options, filter });
	let actual = 0;
	for (const data of Object.values(out)) actual += data.length;
	if (actual > limits.maxBytes)
		throw new ZipTooLarge("archive unpacks to too much to hold");
	return out;
}

/** Read the archive's central directory and refuse, before anything is
 * inflated, what no document should be. Quiet about archives it cannot
 * read at all: unzipSync reports those its own way. */
function scanCentralDirectory(bytes: Uint8Array, limits: ZipLimits): void {
	// The end-of-central-directory record sits at the end, followed only
	// by a comment of at most 65535 bytes. The record is 22 bytes; find
	// its signature 0x06054b50 from the back.
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
	// An archive spread over disks is out of scope for a viewer.
	if (u16(at + 4) !== 0 || u16(at + 6) !== 0) return;
	const entries = u16(at + 10);
	// 65535 or more means ZIP64: too big for a document reader anyway.
	if (entries > limits.maxEntries)
		throw new ZipTooLarge(`archive holds ${entries} entries`);
	// Walk the entries: each is 46 bytes of fixed fields, then its name,
	// extra field and comment.
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
