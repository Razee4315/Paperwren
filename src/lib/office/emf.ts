/**
 * The picture inside an EMF, where there is one to take out.
 *
 * Word keeps a picture pasted from some apps (a scanned logo, a
 * screenshot) as an EMF: a Windows drawing no browser can show. Most
 * such files are only a wrapper around one ordinary bitmap. That bitmap
 * is lifted out here as a BMP (or the JPEG or PNG it holds), so the
 * picture shows instead of a broken one. A real drawing (lines, shapes,
 * text) is left alone: showing only its bitmap would be wrong.
 */

const HEADER = 1;
const EOF = 14;
const SET_DIBITS_TO_DEVICE = 80;
const STRETCH_DIBITS = 81;
/** Records that draw something other than the bitmap. */
const DRAWS = new Set([
	2, 3, 4, 5, 6, 7, 8, 42, 43, 44, 45, 46, 47, 54, 55, 56, 57, 58, 59, 60, 61,
	62, 63, 64, 65, 66, 67, 68, 76, 77, 79, 83, 84, 85, 86, 87, 88, 89, 90, 91,
	92, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 114, 115,
	116, 117, 118,
]);
/** biCompression values that carry a whole JPEG or PNG. */
const BI_JPEG = 4;
const BI_PNG = 5;
/** iUsageSrc: colours are indexes into a palette the EMF selected. */
const DIB_PAL_COLORS = 1;

export interface EmfPicture {
	bytes: Uint8Array;
	type: "image/bmp" | "image/jpeg" | "image/png";
}

export function emfPicture(emf: Uint8Array): EmfPicture | null {
	if (emf.length < 88) return null;
	const view = new DataView(emf.buffer, emf.byteOffset, emf.byteLength);
	// " EMF" at byte 40 of the header record.
	if (
		view.getUint32(0, true) !== HEADER ||
		view.getUint32(40, true) !== 0x464d4520
	)
		return null;
	let found: { at: number; size: number } | null = null;
	for (let at = 0; at + 8 <= emf.length; ) {
		const type = view.getUint32(at, true);
		const size = view.getUint32(at + 4, true);
		if (size < 8 || at + size > emf.length) return null;
		if (DRAWS.has(type)) return null;
		if (type === STRETCH_DIBITS || type === SET_DIBITS_TO_DEVICE) {
			if (found) return null;
			found = { at, size };
		}
		if (type === EOF) break;
		at += size;
	}
	if (!found) return null;
	const { at, size } = found;
	if (size < 80) return null;
	const offBmi = view.getUint32(at + 48, true);
	const cbBmi = view.getUint32(at + 52, true);
	const offBits = view.getUint32(at + 56, true);
	const cbBits = view.getUint32(at + 60, true);
	const usage = view.getUint32(at + 64, true);
	if (
		cbBmi < 40 ||
		!cbBits ||
		usage === DIB_PAL_COLORS ||
		offBmi + cbBmi > size ||
		offBits + cbBits > size
	)
		return null;
	const info = emf.subarray(at + offBmi, at + offBmi + cbBmi);
	const bits = emf.subarray(at + offBits, at + offBits + cbBits);
	const compression = view.getUint32(at + offBmi + 16, true);
	if (compression === BI_JPEG)
		return { bytes: bits.slice(), type: "image/jpeg" };
	if (compression === BI_PNG) return { bytes: bits.slice(), type: "image/png" };
	// A BMP is the same bitmap with a 14-byte file header in front.
	const bmp = new Uint8Array(14 + cbBmi + cbBits);
	const out = new DataView(bmp.buffer);
	bmp[0] = 0x42;
	bmp[1] = 0x4d;
	out.setUint32(2, bmp.length, true);
	out.setUint32(10, 14 + cbBmi, true);
	bmp.set(info, 14);
	bmp.set(bits, 14 + cbBmi);
	return { bytes: bmp, type: "image/bmp" };
}
