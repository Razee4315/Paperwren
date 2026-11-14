/**
 * Making a PDF smaller without changing anything it shows: no picture
 * is stored again and no page looks any different. What nothing refers
 * to is taken out, streams that are the same are kept once, page
 * thumbnails, other apps' private data (/PieceInfo) and XMP metadata go,
 * and packed streams are packed again as tightly as deflate can. Like
 * the other tools this returns new bytes; nothing is changed in place.
 */

import type {
	PDFDocument as Doc,
	PDFObject,
	PDFRawStream as RawStream,
	PDFRef as Ref,
} from "@cantoo/pdf-lib";
import { unzlibSync, zlibSync } from "fflate";
import { open } from "./pdfTools";

const lib = () => import("@cantoo/pdf-lib");

/** Streams past this are left as they are: unpacking one could take
 * more memory than a phone has to spare. */
const LARGEST_STREAM = 24 * 1024 * 1024;

/** Work between two breaks for the screen, in bytes packed. */
const BREAK_EVERY = 2 * 1024 * 1024;

const pause = () => new Promise<void>((done) => setTimeout(done, 0));

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/** A quick fingerprint of some bytes (FNV-1a), to find streams that may
 * be the same; they are then compared in full. */
function fingerprint(bytes: Uint8Array): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i];
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** Whether XMP metadata says the file is PDF/A (an archival copy, which
 * some offices ask for): that label is the metadata, so it stays. */
function saysArchival(xmp: Uint8Array): boolean {
	const mark = "pdfaid:";
	outer: for (let i = 0; i + mark.length <= xmp.length; i++) {
		for (let j = 0; j < mark.length; j++)
			if (xmp[i + j] !== mark.charCodeAt(j)) continue outer;
		return true;
	}
	return false;
}

/**
 * Tidy an open PDF in place, as described above. Everything the trailer
 * leads to (the document, its information, its encryption) is kept, so
 * forms, links, bookmarks and signatures' data stay. Only streams packed
 * with plain deflate (no predictor) or not packed at all are packed
 * again, each only when that is smaller and unpacks to the very same
 * bytes; anything else is left exactly as it was.
 */
export async function tidyPdf(doc: Doc): Promise<void> {
	const {
		PDFArray,
		PDFDict,
		PDFName,
		PDFNumber,
		PDFRawStream,
		PDFRef,
		PDFStream,
	} = await lib();
	const { context } = doc;
	const key = (name: string) => PDFName.of(name);
	const dictOf = (object: PDFObject | undefined) =>
		object instanceof PDFDict
			? object
			: object instanceof PDFStream
				? object.dict
				: null;
	/** Streams the writer makes again itself, or leaves out. */
	const structural = (stream: RawStream) => {
		const type = stream.dict.get(key("Type"));
		return type === key("ObjStm") || type === key("XRef");
	};

	// What other apps keep for themselves, and what a reader draws again.
	for (const [, object] of context.enumerateIndirectObjects()) {
		const dict = dictOf(object);
		if (!dict) continue;
		dict.delete(key("PieceInfo"));
		if (dict.get(key("Type")) === key("Page")) dict.delete(key("Thumb"));
		const metadata = dict.lookup(key("Metadata"));
		if (
			metadata instanceof PDFRawStream &&
			metadata.dict.get(key("Subtype")) === key("XML") &&
			!saysArchival(metadata.contents)
		)
			dict.delete(key("Metadata"));
	}

	// A stream's length written in a separate object is written into the
	// stream itself on saving, so that object is no longer needed, and
	// streams that differ only in it are the same.
	const streams = context
		.enumerateIndirectObjects()
		.filter(
			(entry): entry is [Ref, RawStream] =>
				entry[1] instanceof PDFRawStream && !structural(entry[1]),
		);
	for (const [, stream] of streams)
		if (stream.dict.get(key("Length")) instanceof PDFRef)
			stream.dict.set(key("Length"), PDFNumber.of(stream.contents.length));

	// Streams that are the same, byte for byte and in every entry of
	// their dictionaries, are kept once.
	const kept = new Map<string, Array<[Ref, RawStream]>>();
	const same = new Map<Ref, Ref>();
	for (const [ref, stream] of streams) {
		const sign = `${stream.contents.length}/${fingerprint(stream.contents)}/${stream.dict.toString()}`;
		const alike = kept.get(sign) ?? [];
		const twin = alike.find(([, other]) =>
			sameBytes(other.contents, stream.contents),
		);
		if (twin) same.set(ref, twin[0]);
		else kept.set(sign, [...alike, [ref, stream]]);
	}
	if (same.size) {
		const point = (value: PDFObject): PDFObject => {
			if (value instanceof PDFRef) return same.get(value) ?? value;
			if (value instanceof PDFDict)
				for (const [name, inner] of value.entries()) {
					const next = point(inner);
					if (next !== inner) value.set(name, next);
				}
			else if (value instanceof PDFArray)
				for (let i = 0; i < value.size(); i++) {
					const inner = value.get(i);
					const next = point(inner);
					if (next !== inner) value.set(i, next);
				}
			return value;
		};
		for (const [, object] of context.enumerateIndirectObjects()) {
			const dict = dictOf(object);
			if (dict) point(dict);
			else if (object instanceof PDFArray) point(object);
		}
	}

	// Packed again, as tightly as deflate goes.
	let worked = 0;
	for (const [ref, stream] of streams) {
		if (same.has(ref) || stream.contents.length > LARGEST_STREAM) continue;
		const { dict } = stream;
		if (dict.has(key("DecodeParms")) || dict.has(key("F"))) continue;
		const filter = dict.lookup(key("Filter"));
		const flate =
			filter === key("FlateDecode") ||
			(filter instanceof PDFArray &&
				filter.size() === 1 &&
				filter.lookup(0) === key("FlateDecode"));
		// Unpacked, a stream is packed for the first time.
		const plain = filter === undefined;
		if (!flate && !plain) continue;
		let data: Uint8Array;
		try {
			data = plain ? stream.contents : unzlibSync(stream.contents);
		} catch {
			continue;
		}
		const packed = zlibSync(data, { level: 9 });
		worked += data.length;
		if (worked > BREAK_EVERY) {
			worked = 0;
			await pause();
		}
		if (packed.length >= stream.contents.length) continue;
		// Never trusted, always checked.
		if (!sameBytes(unzlibSync(packed), data)) continue;
		const next = dict.clone(context);
		next.set(key("Filter"), key("FlateDecode"));
		next.set(key("Length"), PDFNumber.of(packed.length));
		context.assign(ref, PDFRawStream.of(next, packed));
	}

	// Whatever the trailer does not lead to is left out.
	const { Root, Info, Encrypt } = context.trailerInfo;
	const reached = new Set<Ref>();
	const waiting: PDFObject[] = [Root, Info, Encrypt].filter(
		(x): x is PDFObject => x !== undefined,
	);
	while (waiting.length) {
		const value = waiting.pop() as PDFObject;
		if (value instanceof PDFRef) {
			if (reached.has(value)) continue;
			reached.add(value);
			const object = context.lookup(value);
			if (object) waiting.push(object);
		} else if (value instanceof PDFDict) {
			for (const [, inner] of value.entries()) waiting.push(inner);
		} else if (value instanceof PDFArray) {
			waiting.push(...value.asArray());
		} else if (value instanceof PDFStream) {
			waiting.push(value.dict);
		}
	}
	// Nothing is taken out unless the document itself was found.
	if (!(Root instanceof PDFRef) || !reached.has(Root)) return;
	for (const [ref] of context.enumerateIndirectObjects())
		if (!reached.has(ref)) context.delete(ref);
}

/** A copy made smaller without changing a picture or a page. */
export async function losslessPdf(
	bytes: Uint8Array,
	{ password }: { password?: string } = {},
): Promise<Uint8Array> {
	const doc = await open(bytes, password);
	await tidyPdf(doc);
	return doc.save({ useObjectStreams: true, updateFieldAppearances: false });
}
