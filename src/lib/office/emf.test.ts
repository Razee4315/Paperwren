import { describe, expect, it } from "vitest";
import { emfPicture } from "./emf";

/** An EMF of records given as [type, body bytes after type and size]. */
function emf(records: Array<[number, Uint8Array]>): Uint8Array {
	const header = new Uint8Array(80);
	new DataView(header.buffer).setUint32(32, 0x464d4520, true); // " EMF" at 40
	const all: Array<[number, Uint8Array]> = [
		[1, header],
		...records,
		[14, new Uint8Array(12)],
	];
	const size = all.reduce((n, [, body]) => n + 8 + body.length, 0);
	const out = new Uint8Array(size);
	const view = new DataView(out.buffer);
	let at = 0;
	for (const [type, body] of all) {
		view.setUint32(at, type, true);
		view.setUint32(at + 4, 8 + body.length, true);
		out.set(body, at + 8);
		at += 8 + body.length;
	}
	return out;
}

/** EMR_STRETCHDIBITS around a 1×1 24-bit bitmap. */
function stretch(compression = 0, bits = new Uint8Array([0, 0, 255, 0])) {
	const fixed = 80 - 8;
	const bmi = new Uint8Array(40);
	const info = new DataView(bmi.buffer);
	info.setUint32(0, 40, true);
	info.setInt32(4, 1, true);
	info.setInt32(8, 1, true);
	info.setUint16(12, 1, true);
	info.setUint16(14, 24, true);
	info.setUint32(16, compression, true);
	const body = new Uint8Array(fixed + bmi.length + bits.length);
	const view = new DataView(body.buffer);
	// Offsets are from the start of the record, 8 bytes before the body.
	view.setUint32(48 - 8, 80, true);
	view.setUint32(52 - 8, bmi.length, true);
	view.setUint32(56 - 8, 80 + bmi.length, true);
	view.setUint32(60 - 8, bits.length, true);
	body.set(bmi, fixed);
	body.set(bits, fixed + bmi.length);
	return body;
}

describe("the picture inside an EMF", () => {
	it("lifts out a lone bitmap as a BMP", () => {
		const picture = emfPicture(emf([[81, stretch()]]));
		expect(picture?.type).toBe("image/bmp");
		const bytes = picture?.bytes ?? new Uint8Array();
		expect(String.fromCharCode(bytes[0], bytes[1])).toBe("BM");
		const view = new DataView(bytes.buffer);
		expect(view.getUint32(2, true)).toBe(bytes.length);
		expect(view.getUint32(10, true)).toBe(14 + 40);
		expect(Array.from(bytes.subarray(54))).toEqual([0, 0, 255, 0]);
	});

	it("hands back a JPEG kept inside as it is", () => {
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
		expect(emfPicture(emf([[81, stretch(4, jpeg)]]))).toEqual({
			bytes: jpeg,
			type: "image/jpeg",
		});
	});

	it("leaves a real drawing alone", () => {
		// EMR_EXTTEXTOUTW: there is text besides the bitmap.
		expect(
			emfPicture(
				emf([
					[81, stretch()],
					[84, new Uint8Array(68)],
				]),
			),
		).toBeNull();
		expect(emfPicture(emf([]))).toBeNull();
		expect(emfPicture(new Uint8Array(200))).toBeNull();
	});
});
