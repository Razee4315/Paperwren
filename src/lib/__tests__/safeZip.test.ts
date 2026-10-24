import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ZipTooLarge, guardedUnzip } from "../safeZip";

/** Byte-wise equality: fflate returns views into a shared buffer, and
 * a deep equal on those trips over the backing ArrayBuffer. */
const same = (a: Uint8Array, b: Uint8Array) =>
	a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Pseudo-random, so the fixture cannot be compressed away: what the
 * budget guard is asked about must be real bytes. */
const incompressible = (n: number) => {
	const out = new Uint8Array(n);
	let seed = 0x2545f491;
	for (let i = 0; i < n; i++) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		out[i] = seed >>> 24;
	}
	return out;
};

const u32 = (bytes: Uint8Array, at: number, value: number) => {
	bytes[at] = value & 255;
	bytes[at + 1] = (value >>> 8) & 255;
	bytes[at + 2] = (value >>> 16) & 255;
	bytes[at + 3] = (value >>> 24) & 255;
};

/** The central-directory entry's uncompressed-size field, rewritten to
 * a lie (the same signature and layout guardedUnzip reads). */
function claimInflatesTo(bytes: Uint8Array, original: number): Uint8Array {
	const out = bytes.slice();
	let eocd = -1;
	for (let i = out.length - 22; i >= 0; i--) {
		if (out[i] === 0x50 && out[i + 1] === 0x4b && out[i + 2] === 0x05) {
			eocd = i;
			break;
		}
	}
	const u32at = (o: number) =>
		(out[o] | (out[o + 1] << 8) | (out[o + 2] << 16) | (out[o + 3] << 24)) >>>
		0;
	u32(out, u32at(eocd + 16) + 24, original);
	return out;
}

describe("guardedUnzip", () => {
	it("reads what a caller's own filter asks for", () => {
		const zip = zipSync({
			"content.xml": strToU8("<doc/>"),
			"styles.xml": strToU8("<styles/>"),
			"media/pic.png": incompressible(1000),
		});
		const files = guardedUnzip(zip, {
			filter: (f) => f.name === "content.xml",
		});
		expect(Object.keys(files)).toEqual(["content.xml"]);
		expect(same(files["content.xml"], strToU8("<doc/>"))).toBe(true);
	});

	it("unpacks a big, honest archive whole", () => {
		const lines = [
			"The wren sat on the pine and sang to the yard.",
			"A page turned in the wind, and nobody caught it.",
			"By the fourth house the road gave up on paving.",
			"Supper was late, which the cat took personally.",
		];
		let prose = "";
		for (let i = 0; i < 12_000; i++) prose += `${lines[i % 4]} (${i})\n`;
		const chapter = strToU8(prose);
		const zip = zipSync({
			"OEBPS/ch1.xhtml": chapter,
			"OEBPS/ch2.xhtml": chapter,
			"OEBPS/ch3.xhtml": chapter,
		});
		const files = guardedUnzip(zip);
		expect(Object.keys(files).length).toBe(3);
		expect(same(files["OEBPS/ch2.xhtml"], chapter)).toBe(true);
	});

	it("refuses an archive with more entries than allowed", () => {
		const many: Record<string, Uint8Array> = {};
		for (let i = 0; i < 12; i++) many[`p/${i}.txt`] = strToU8("x");
		expect(() =>
			guardedUnzip(zipSync(many), { limits: { maxEntries: 10 } }),
		).toThrow(ZipTooLarge);
	});

	it("refuses an entry that claims to be enormous, before inflating", () => {
		const zip = zipSync({ "a.txt": strToU8("hello") });
		const lying = claimInflatesTo(zip, 513 * 1024 * 1024);
		expect(() => guardedUnzip(lying)).toThrow(ZipTooLarge);
	});

	it("skips an entry whose claimed expansion defies belief", () => {
		const zip = zipSync({
			"bomb.txt": strToU8("0".repeat(50_000)),
			"page.txt": strToU8("safe"),
		});
		// The bomb really inflates hundreds of times over. A claim that
		// stays under the ratio is believed (and fflate decodes into
		// exactly what was claimed); one that defies it is not.
		const believed = claimInflatesTo(zip, 100_000);
		const kept = guardedUnzip(believed, { limits: { maxRatio: 2000 } });
		expect(kept["bomb.txt"].length).toBeLessThanOrEqual(100_000);
		const refused = claimInflatesTo(zip, 100_000_000);
		const guarded = guardedUnzip(refused);
		expect(guarded["bomb.txt"]).toBeUndefined();
		expect(same(guarded["page.txt"], strToU8("safe"))).toBe(true);
	});

	it("stops when the entries it wanted already fill the budget", () => {
		const big = incompressible(2 * 1024 * 1024);
		const zip = zipSync({
			"one.bin": big,
			"two.bin": big,
			"three.bin": big,
			"last.txt": strToU8("never reached"),
		});
		// A budget of two: the third and fourth are skipped before they
		// are inflated.
		const files = guardedUnzip(zip, { limits: { maxBytes: big.length * 2 } });
		expect(same(files["one.bin"], big)).toBe(true);
		expect(same(files["two.bin"], big)).toBe(true);
		expect(files["three.bin"]).toBeUndefined();
		expect(files["last.txt"]).toBeUndefined();
	});

	it("never decodes past what an entry claims to be", () => {
		// A header that lies small: fflate decodes into the claimed
		// size and stops there, so a bomb cannot hide behind a modest
		// claim either.
		const zip = zipSync({ "a.txt": strToU8("0".repeat(300_000)) });
		const lying = claimInflatesTo(zip, 4_000);
		const files = guardedUnzip(lying, { limits: { maxRatio: 1000 } });
		expect(files["a.txt"].length).toBeLessThanOrEqual(4_000);
	});
});
