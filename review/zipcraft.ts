/**
 * Hand-built hostile archives for the security-audit review. Built byte
 * by byte (not with fflate's zipSync) so the fixtures do not share the
 * guard's own assumptions about what a zip looks like.
 */

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

const text = (s: string) => new TextEncoder().encode(s);

function local(name: string, data: Uint8Array): Uint8Array {
	return cat([
		le(0x04034b50, 4),
		le(20, 2),
		le(0, 2),
		le(0, 2),
		le(0, 4),
		le(0, 4),
		le(data.length, 4),
		le(data.length, 4),
		le(name.length, 2),
		le(0, 2),
		text(name),
		data,
	]);
}

function central(
	name: string,
	size: number,
	originalSize: number,
	offset: number,
): Uint8Array {
	return cat([
		le(0x02014b50, 4),
		le(20, 2),
		le(20, 2),
		le(0, 2),
		le(0, 2),
		le(0, 4),
		le(0, 4),
		le(size, 4),
		le(originalSize, 4),
		le(name.length, 2),
		le(0, 2),
		le(0, 2),
		le(0, 2),
		le(0, 2),
		le(0, 4),
		le(offset, 4),
		text(name),
	]);
}

function eocd(entries: number, cdSize: number, cdOffset: number): Uint8Array {
	return cat([
		le(0x06054b50, 4),
		le(0, 2),
		le(0, 2),
		le(entries, 2),
		le(entries, 2),
		le(cdSize, 4),
		le(cdOffset, 4),
		le(0, 2),
	]);
}

/** One stored payload, `copies` central-directory entries all pointing
 * at it, each claiming an uncompressed size of 0. Every copy is sliced
 * out separately, so memory grows by `payload × copies`. */
export function storedOverlap(payload: number, copies: number): Uint8Array {
	const head = local("a", new Uint8Array(payload).fill(0x41));
	const cds: Uint8Array[] = [];
	for (let i = 0; i < copies; i++) cds.push(central(`e${i}`, payload, 0, 0));
	const cd = cat(cds);
	return cat([head, cd, eocd(copies, cd.length, head.length)]);
}

/** The classic end record says one entry (what safeZip's pre-scan
 * reads); a ZIP64 locator and record (what fflate reads) say `count`. */
export function zip64Count(count: number): Uint8Array {
	const head = local("a.txt", text("hi"));
	const cd = central("a.txt", 2, 2, 0);
	const cdOffset = head.length;
	const z64Offset = cdOffset + cd.length;
	const record = cat([
		le(0x06064b50, 4),
		le(44, 8),
		le(45, 2),
		le(45, 2),
		le(0, 4),
		le(0, 4),
		le(count, 8),
		le(count, 8),
		le(cd.length, 8),
		le(cdOffset, 8),
	]);
	const locator = cat([
		le(0x07064b50, 4),
		le(0, 4),
		le(z64Offset, 8),
		le(1, 4),
	]);
	return cat([head, cd, record, locator, eocd(1, cd.length, cdOffset)]);
}
