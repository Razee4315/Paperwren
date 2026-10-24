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

	it("keeps honest entries that compress past two hundred times", () => {
		// A blank picture and a repetitive stylesheet: real documents
		// carry both, and both come close to deflate's own ceiling.
		const bmp = new Uint8Array(54 + 3000 * 1000).fill(255);
		const css = strToU8("p{margin:0}\n".repeat(20_000));
		const files = guardedUnzip(
			zipSync({ "word/media/blank.bmp": bmp, "OEBPS/style.css": css }),
		);
		expect(Object.keys(files).sort()).toEqual([
			"OEBPS/style.css",
			"word/media/blank.bmp",
		]);
	});
});

// Archives fflate's own zipSync would never write: entries that share
// one payload, sizes that lie, a ZIP64 record behind an ordinary one.
// Built byte by byte so they do not share the guard's assumptions.

const le = (n: number, width: number): Uint8Array => {
	const out = new Uint8Array(width);
	let v = BigInt(n);
	for (let i = 0; i < width; i++) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}
	return out;
};

const cat = (parts: Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};

/** A local header and its stored bytes, at offset 0 of the archive. */
const local = (name: string, data: Uint8Array) =>
	cat([
		le(0x04034b50, 4),
		le(20, 4),
		le(0, 2),
		le(0, 8),
		le(data.length, 4),
		le(data.length, 4),
		le(name.length, 2),
		le(0, 2),
		strToU8(name),
		data,
	]);

/** A central-directory entry pointing at the local header at 0. */
const central = (
	name: string,
	size: number,
	originalSize: number,
	method = 0,
) =>
	cat([
		le(0x02014b50, 4),
		le(20, 2),
		le(20, 2),
		le(0, 2),
		le(method, 2),
		le(0, 8),
		le(size, 4),
		le(originalSize, 4),
		le(name.length, 2),
		le(0, 8),
		le(0, 4),
		le(0, 4),
		strToU8(name),
	]);

const endRecord = (
	entries: number,
	cdSize: number,
	cdOffset: number,
	disk = 0,
) =>
	cat([
		le(0x06054b50, 4),
		le(disk, 2),
		le(0, 2),
		le(entries, 2),
		le(entries, 2),
		le(cdSize, 4),
		le(cdOffset, 4),
		le(0, 2),
	]);

/** One stored payload and `copies` directory entries all pointing at it. */
function sharedPayload(
	payload: number,
	copies: number,
	claim: number,
	disk = 0,
): Uint8Array {
	const head = local("a", new Uint8Array(payload).fill(0x41));
	const entries: Uint8Array[] = [];
	for (let i = 0; i < copies; i++)
		entries.push(central(`e${i}`, payload, claim));
	const cd = cat(entries);
	return cat([head, cd, endRecord(copies, cd.length, head.length, disk)]);
}

describe("guardedUnzip, against archives that lie", () => {
	const MiB = 1024 * 1024;
	const total = (files: Record<string, Uint8Array>) =>
		Object.values(files).reduce((a, d) => a + d.length, 0);

	it("skips stored entries whose two sizes disagree", () => {
		// 1 MiB on disk, 300 entries each claiming 0 bytes: unguarded,
		// every copy is sliced out and 300 MiB is spent.
		const files = guardedUnzip(sharedPayload(MiB, 300, 0));
		expect(total(files)).toBe(0);
	});

	it("charges a stored entry the bytes it copies", () => {
		// Honest sizes, one shared payload: the budget fills after 16
		// copies and the rest are never sliced.
		const files = guardedUnzip(sharedPayload(MiB, 64, MiB), {
			limits: { maxBytes: 16 * MiB },
		});
		expect(Object.keys(files).length).toBe(16);
		expect(total(files)).toBe(16 * MiB);
	});

	it("skips an entry whose compressed size runs past the archive", () => {
		const head = local("a", strToU8("not deflate data"));
		const cd = central("a", 50 * MiB, 100, 8);
		const zip = cat([head, cd, endRecord(1, cd.length, head.length)]);
		expect(guardedUnzip(zip)).toEqual({});
	});

	it("refuses a ZIP64 archive before walking it", () => {
		// The ordinary end record says one entry; the ZIP64 record fflate
		// follows says four billion. Unguarded, that walk takes minutes.
		const head = local("a.txt", strToU8("hi"));
		const cd = central("a.txt", 2, 2);
		const z64At = head.length + cd.length;
		const z64 = cat([
			le(0x06064b50, 4),
			le(44, 8),
			le(45, 4),
			le(0, 8),
			le(0xffffffff, 8),
			le(0xffffffff, 8),
			le(cd.length, 8),
			le(head.length, 8),
		]);
		const locator = cat([le(0x07064b50, 4), le(0, 4), le(z64At, 8), le(1, 4)]);
		const zip = cat([
			head,
			cd,
			z64,
			locator,
			endRecord(1, cd.length, head.length),
		]);
		const started = performance.now();
		expect(() => guardedUnzip(zip)).toThrow(ZipTooLarge);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("counts entries as they are walked when the scan cannot read the record", () => {
		// A non-zero disk number makes the scan stand aside; fflate
		// ignores it and walks every entry, so the filter must count.
		expect(() =>
			guardedUnzip(sharedPayload(4, 12, 4, 1), {
				limits: { maxEntries: 10 },
			}),
		).toThrow(ZipTooLarge);
	});

	it("holds each entry to the cap when the scan cannot read the record", () => {
		const files = guardedUnzip(sharedPayload(2048, 2, 2048, 1), {
			limits: { maxEntryBytes: 1024 },
		});
		expect(files).toEqual({});
	});
});
