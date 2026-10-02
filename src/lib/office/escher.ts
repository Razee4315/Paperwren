/**
 * OfficeArt ("Escher") records, the drawing layer shared by legacy
 * Word and PowerPoint files ([MS-ODRAW]). Only what a viewer needs:
 * walking the record tree, reading a shape's property table, and
 * pulling displayable pictures out of the picture store.
 */

import { sniffImage } from "./model";

export const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
export const i16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;
export const u32 = (b: Uint8Array, o: number) =>
	(b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
export const i32 = (b: Uint8Array, o: number) =>
	b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

export interface Rec {
	/** Low 4 bits of the header: 0xF marks a container. */
	ver: number;
	inst: number;
	type: number;
	body: number;
	end: number;
}

export const RT = {
	dggContainer: 0xf000,
	bstoreContainer: 0xf001,
	dgContainer: 0xf002,
	spgrContainer: 0xf003,
	spContainer: 0xf004,
	bse: 0xf007,
	spgr: 0xf009,
	sp: 0xf00a,
	opt: 0xf00b,
	clientTextbox: 0xf00d,
	childAnchor: 0xf00f,
	clientAnchor: 0xf010,
	clientData: 0xf011,
	tertiaryOpt: 0xf122,
} as const;

/** The records directly inside [start, end). Stops at the first
 * record that would run past the end (damaged files). */
export function children(b: Uint8Array, start: number, end: number): Rec[] {
	const out: Rec[] = [];
	let pos = start;
	while (pos + 8 <= end) {
		const head = u16(b, pos);
		const len = u32(b, pos + 4);
		const body = pos + 8;
		if (body + len > end) break;
		out.push({
			ver: head & 0x0f,
			inst: head >> 4,
			type: u16(b, pos + 2),
			body,
			end: body + len,
		});
		pos = body + len;
	}
	return out;
}

/** Every record of `type` under [start, end), at any depth. */
export function descendants(
	b: Uint8Array,
	start: number,
	end: number,
	type: number,
	depth = 0,
): Rec[] {
	const out: Rec[] = [];
	if (depth > 24) return out;
	for (const rec of children(b, start, end)) {
		if (rec.type === type) out.push(rec);
		else if (rec.ver === 0x0f)
			out.push(...descendants(b, rec.body, rec.end, type, depth + 1));
	}
	return out;
}

export interface Props {
	/** Simple properties: id -> value. */
	values: Map<number, number>;
	/** Complex properties: id -> byte range of their data. */
	data: Map<number, [number, number]>;
}

/** A shape's property table (OfficeArtFOPT). */
export function readProps(b: Uint8Array, rec: Rec, into?: Props): Props {
	const props = into ?? { values: new Map(), data: new Map() };
	const count = rec.inst;
	let complex = rec.body + count * 6;
	for (let i = 0; i < count; i++) {
		const at = rec.body + i * 6;
		if (at + 6 > rec.end) break;
		const head = u16(b, at);
		const id = head & 0x3fff;
		const value = u32(b, at + 2);
		if (head & 0x8000) {
			if (complex + value <= rec.end)
				props.data.set(id, [complex, complex + value]);
			complex += value;
		} else props.values.set(id, value);
	}
	return props;
}

/** The image inside a BLIP record body, if a browser can show it. The
 * payload follows one or two 16-byte UIDs and a tag byte; locating the
 * signature is sturdier than trusting the instance bits. */
export function blipImage(
	b: Uint8Array,
	body: number,
	end: number,
): { bytes: Uint8Array; type: string } | null {
	for (let i = body + 16; i < Math.min(end, body + 60); i++) {
		const bytes = b.subarray(i, end);
		const type = sniffImage(bytes);
		// BMPs are stored as headerless DIBs; those are not handled here.
		if (type && type !== "image/bmp") return { bytes: b.slice(i, end), type };
	}
	return null;
}

export interface StoredBlip {
	/** Offset of the BLIP record in the delay stream, or -1 if embedded. */
	offset: number;
	size: number;
	/** The BLIP when it is embedded in the store entry itself. */
	embedded?: Rec;
}

/** The picture store: one entry per image, in blip-index order. */
export function readBlipStore(
	b: Uint8Array,
	start: number,
	end: number,
): StoredBlip[] {
	const store = descendants(b, start, end, RT.bstoreContainer)[0];
	if (!store) return [];
	return children(b, store.body, store.end).map((rec) => {
		if (rec.type !== RT.bse) {
			// Some writers put the BLIP directly in the store.
			return { offset: -1, size: rec.end - rec.body, embedded: rec };
		}
		const nameLength = b[rec.body + 33];
		const inner = children(b, rec.body + 36 + nameLength, rec.end)[0];
		return {
			offset: u32(b, rec.body + 28),
			size: u32(b, rec.body + 20),
			embedded: inner,
		};
	});
}

/** Resolve a store entry to image bytes. `delay` is the stream BLIPs
 * live in when they are not embedded (WordDocument or Pictures). */
export function storedImage(
	entry: StoredBlip | undefined,
	container: Uint8Array,
	delay: Uint8Array | null,
): { bytes: Uint8Array; type: string } | null {
	if (!entry) return null;
	if (entry.embedded)
		return blipImage(container, entry.embedded.body, entry.embedded.end);
	if (!delay || entry.offset < 0 || entry.offset + 8 > delay.length)
		return null;
	const len = u32(delay, entry.offset + 4);
	const body = entry.offset + 8;
	return blipImage(delay, body, Math.min(delay.length, body + len));
}

/** 16.16 fixed point, as used for crops and gradient stops. */
export const fixed = (v: number) => (v | 0) / 65536;

/** An OfficeArt colour property as CSS, or undefined for scheme /
 * system colours the caller must resolve itself. */
export function colorOf(value: number | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (value & 0xff000000) return undefined;
	const hex = (n: number) => n.toString(16).padStart(2, "0");
	return `#${hex(value & 0xff)}${hex((value >> 8) & 0xff)}${hex((value >> 16) & 0xff)}`;
}
