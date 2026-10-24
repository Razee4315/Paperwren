/**
 * The control for the review: the same API as src/lib/safeZip.ts, with
 * no guard at all (plain fflate unzipSync, as main calls it). The
 * branch's own safeZip tests are run against this to show which of
 * them would fail without the fix.
 */

import { type UnzipFileInfo, type Unzipped, unzipSync } from "fflate";

export class ZipTooLarge extends Error {}

export function guardedUnzip(
	bytes: Uint8Array,
	options: { filter?: (file: UnzipFileInfo) => boolean; limits?: unknown } = {},
): Unzipped {
	return unzipSync(bytes, { filter: options.filter });
}
