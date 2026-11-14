import {
	PDFArray,
	PDFContext,
	PDFDict,
	type PDFDocument,
	PDFName,
	PDFNumber,
	type PDFObject,
	PDFObjectParser,
	PDFRawStream,
	PDFRef,
	decodePDFRawStream,
} from "@cantoo/pdf-lib";
import { equal } from "./der";

function xrefBytes(object: PDFRawStream, columns: number): Uint8Array {
	const bytes = decodePDFRawStream(object).decode();
	const params = object.dict.lookupMaybe(PDFName.of("DecodeParms"), PDFDict);
	const number = (key: string, fallback: number) =>
		params?.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber() ?? fallback;
	const predictor = number("Predictor", 1);
	if (predictor === 1) return bytes;
	// pdf-lib inflates streams without undoing PNG prediction. qpdf uses
	// one Up-filtered row per xref entry, including a leading filter byte.
	if (
		object.dict.get(PDFName.of("Filter")) !== PDFName.of("FlateDecode") ||
		predictor !== 12 ||
		number("Columns", 1) !== columns ||
		number("Colors", 1) !== 1 ||
		number("BitsPerComponent", 8) !== 8 ||
		bytes.length % (columns + 1) !== 0
	)
		throw new Error("damaged");
	const decoded = new Uint8Array((bytes.length / (columns + 1)) * columns);
	for (let row = 0; row < decoded.length / columns; row++) {
		const at = row * (columns + 1);
		if (bytes[at] !== 2) throw new Error("damaged");
		for (let column = 0; column < columns; column++) {
			const to = row * columns + column;
			decoded[to] = bytes[at + 1 + column] + (row ? decoded[to - columns] : 0);
		}
	}
	return decoded;
}

/** pdf-lib repairs cross-reference offsets while reading. Signing must refuse that repair. */
export function crossReferences(
	pdf: Uint8Array,
	doc: PDFDocument,
): { stream: boolean } {
	const source = new TextDecoder("latin1").decode(pdf);
	const end = source.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
	if (!end) throw new Error("damaged");
	const last = Number(end[1]);
	const visited = new Set<number>();
	// Parse in an untracked context: parsing arrays into the document's
	// incremental context would search every indirect object on each push.
	const parsing = PDFContext.create();
	type Entry = { type: number; offset: number; generation: number };
	const entries = new Map<number, Entry>();
	const trailer: typeof doc.context.trailerInfo = {};
	let stream = false;
	const header = (offset: number, object: number, generation: number) => {
		if (!Number.isSafeInteger(offset) || offset < 0 || offset >= pdf.length)
			throw new Error("damaged");
		const match = source
			.slice(offset, offset + 80)
			.match(/^(\d+)\s+(\d+)\s+obj\b/);
		if (
			!match ||
			Number(match[1]) !== object ||
			Number(match[2]) !== generation
		)
			throw new Error("damaged");
	};
	function section(offset: number, supplement = false): Map<number, Entry> {
		if (
			!Number.isSafeInteger(offset) ||
			visited.has(offset) ||
			visited.size >= 128 ||
			offset < 0 ||
			offset >= pdf.length
		)
			throw new Error("damaged");
		visited.add(offset);
		const current = new Map<number, Entry>();
		let dict: PDFDict;
		if (source.slice(offset, offset + 4) === "xref") {
			if (supplement) throw new Error("damaged");
			let at = offset + 4;
			const whitespace = () => {
				while (/\s/.test(source[at] ?? "x")) at++;
			};
			whitespace();
			while (source.slice(at, at + 7) !== "trailer") {
				const range = source.slice(at, at + 80).match(/^(\d+)\s+(\d+)\s+/);
				if (!range) throw new Error("damaged");
				at += range[0].length;
				const first = Number(range[1]);
				const count = Number(range[2]);
				if (count > pdf.length / 18) throw new Error("damaged");
				for (let i = 0; i < count; i++) {
					const entry = source
						.slice(at, at + 32)
						.match(/^(\d{10})\s+(\d{5})\s+([nf])\s+/);
					if (!entry) throw new Error("damaged");
					at += entry[0].length;
					if (entry[3] === "n")
						header(Number(entry[1]), first + i, Number(entry[2]));
					current.set(first + i, {
						type: entry[3] === "n" ? 1 : 0,
						offset: Number(entry[1]),
						generation: Number(entry[2]),
					});
				}
				whitespace();
			}
			const object = PDFObjectParser.forBytes(
				pdf.subarray(at + 7),
				parsing,
			).parseObject();
			if (!(object instanceof PDFDict)) throw new Error("damaged");
			dict = object;
		} else {
			const match = source
				.slice(offset, offset + 80)
				.match(/^(\d+)\s+(\d+)\s+obj\s*/);
			if (!match) throw new Error("damaged");
			const object = PDFObjectParser.forBytes(
				pdf.subarray(offset + match[0].length),
				parsing,
			).parseObject();
			if (
				!(object instanceof PDFRawStream) ||
				object.dict.get(PDFName.of("Type")) !== PDFName.of("XRef")
			)
				throw new Error("damaged");
			dict = object.dict;
			if (offset === last) stream = true;
			const widths = dict
				.lookup(PDFName.of("W"), PDFArray)
				.asArray()
				.map((n) => {
					if (!(n instanceof PDFNumber)) throw new Error("damaged");
					return n.asNumber();
				});
			if (
				widths.length !== 3 ||
				widths.some((n) => !Number.isInteger(n) || n < 0 || n > 6) ||
				!widths.some(Boolean)
			)
				throw new Error("damaged");
			const size = dict.lookup(PDFName.of("Size"), PDFNumber).asNumber();
			const index = dict
				.lookupMaybe(PDFName.of("Index"), PDFArray)
				?.asArray()
				.map((n) => {
					if (!(n instanceof PDFNumber)) throw new Error("damaged");
					return n.asNumber();
				}) ?? [0, size];
			if (index.length % 2) throw new Error("damaged");
			const bytes = xrefBytes(
				object,
				widths.reduce((sum, n) => sum + n, 0),
			);
			let at = 0;
			for (let pair = 0; pair < index.length; pair += 2) {
				const [first, count] = index.slice(pair, pair + 2);
				if (
					!Number.isInteger(first) ||
					!Number.isInteger(count) ||
					first < 0 ||
					count < 0 ||
					count > bytes.length
				)
					throw new Error("damaged");
				for (let i = 0; i < count; i++) {
					const values = widths.map((width, column) => {
						let n = width === 0 && column === 0 ? 1 : 0;
						for (let j = 0; j < width; j++) {
							if (at >= bytes.length) throw new Error("damaged");
							n = n * 256 + bytes[at++];
						}
						return n;
					});
					if (values[0] === 1) header(values[1], first + i, values[2]);
					else if (values[0] !== 0 && values[0] !== 2)
						throw new Error("damaged");
					current.set(first + i, {
						type: values[0],
						offset: values[1],
						generation: values[2],
					});
				}
			}
			if (at !== bytes.length) throw new Error("damaged");
		}
		const size = dict.lookup(PDFName.of("Size"), PDFNumber);
		if (!Number.isSafeInteger(size.asNumber()) || size.asNumber() < 1)
			throw new Error("damaged");
		doc.context.largestObjectNumber = Math.max(
			doc.context.largestObjectNumber,
			size.asNumber() - 1,
		);
		// A hybrid stream supplements its table. Its trailer and Prev do not
		// describe another revision (ISO 32000-1, 7.5.8.4).
		if (supplement) return current;
		for (const key of ["Root", "Info", "Encrypt", "ID", "Size"] as const) {
			const value = dict.get(PDFName.of(key));
			if (value && trailer[key] === undefined)
				Object.assign(trailer, { [key]: value });
		}
		const root = dict.get(PDFName.of("Root"));
		if (root) {
			if (!(root instanceof PDFRef)) throw new Error("damaged");
			const catalog = doc.context.lookup(root);
			if (
				!(catalog instanceof PDFDict) ||
				catalog.get(PDFName.of("Type")) !== PDFName.of("Catalog")
			)
				throw new Error("damaged");
		}
		const hybrid = dict.lookupMaybe(PDFName.of("XRefStm"), PDFNumber);
		if (hybrid)
			for (const [n, entry] of section(hybrid.asNumber(), true)) {
				// pdf.js keeps live table entries when reading a supplement.
				// Replacing one here would validate a different reader graph.
				const table = current.get(n);
				if (
					table?.type === 1 &&
					(table.type !== entry.type ||
						table.offset !== entry.offset ||
						table.generation !== entry.generation)
				)
					throw new Error("damaged");
				current.set(n, entry);
			}
		for (const [n, entry] of current)
			if (!entries.has(n)) entries.set(n, entry);
		const previous = dict.lookupMaybe(PDFName.of("Prev"), PDFNumber);
		if (previous) {
			section(previous.asNumber());
		}
		return current;
	}
	section(last);
	const objects = new Map<number, PDFObject>();
	for (const [n, entry] of entries) {
		if (entry.type !== 1) continue;
		const match = source
			.slice(entry.offset, entry.offset + 80)
			.match(/^(\d+)\s+(\d+)\s+obj\s*/);
		if (!match) throw new Error("damaged");
		const object = PDFObjectParser.forBytes(
			pdf.subarray(entry.offset + match[0].length),
			parsing,
		).parseObject();
		objects.set(n, object);
		parsing.assign(PDFRef.of(n, entry.generation), object);
	}
	const streams = new Map<
		number,
		{ bytes: Uint8Array; first: number; slots: number[] }
	>();
	for (const [n, entry] of entries) {
		if (entry.type !== 2) continue;
		let stream = streams.get(entry.offset);
		if (!stream) {
			const container = objects.get(entry.offset);
			if (
				!(container instanceof PDFRawStream) ||
				container.dict.get(PDFName.of("Type")) !== PDFName.of("ObjStm")
			)
				throw new Error("damaged");
			const first = container.dict
				.lookup(PDFName.of("First"), PDFNumber)
				.asNumber();
			const count = container.dict
				.lookup(PDFName.of("N"), PDFNumber)
				.asNumber();
			const bytes = decodePDFRawStream(container).decode();
			if (
				!Number.isSafeInteger(first) ||
				!Number.isSafeInteger(count) ||
				first < 0 ||
				first > bytes.length ||
				count < 0 ||
				count > first
			)
				throw new Error("damaged");
			const slots = new TextDecoder()
				.decode(bytes.subarray(0, first))
				.trim()
				.split(/\s+/)
				.map(Number);
			if (
				slots.length !== count * 2 ||
				slots.some((n) => !Number.isSafeInteger(n) || n < 0)
			)
				throw new Error("damaged");
			for (let i = 1; i < slots.length; i += 2)
				if (
					first + slots[i] >= bytes.length ||
					(i > 1 && slots[i] <= slots[i - 2])
				)
					throw new Error("damaged");
			stream = { bytes, first, slots };
			streams.set(entry.offset, stream);
		}
		const slot = entry.generation * 2;
		if (stream.slots[slot] !== n) throw new Error("damaged");
		const start = stream.first + stream.slots[slot + 1];
		const end =
			stream.slots[slot + 3] === undefined
				? stream.bytes.length
				: stream.first + stream.slots[slot + 3];
		objects.set(
			n,
			PDFObjectParser.forBytes(
				stream.bytes.subarray(start, end),
				parsing,
			).parseObject(),
		);
	}
	// pdf-lib reads definitions in byte order instead of following xrefs.
	// Compare every live definition with the exact offset or object-stream
	// slot selected by the newest revision, including the stream bytes.
	for (const [n, object] of objects) {
		const entry = entries.get(n) as Entry;
		const loaded = doc.context.lookup(
			PDFRef.of(n, entry.type === 2 ? 0 : entry.generation),
		);
		// PDFStream.toString updates Length and marks it for incremental
		// saving. Compare its dictionary and raw bytes without that mutation.
		const same =
			object instanceof PDFRawStream
				? loaded instanceof PDFRawStream &&
					object.dict.toString() === loaded.dict.toString() &&
					equal(object.getContents(), loaded.getContents())
				: loaded &&
					!(loaded instanceof PDFRawStream) &&
					object.toString() === loaded.toString();
		if (!same) throw new Error("damaged");
	}
	const seen = new Set<PDFObject>();
	const pending: PDFObject[] = [doc.catalog, ...Object.values(trailer)];
	while (pending.length) {
		const object = pending.pop() as PDFObject;
		if (seen.has(object)) continue;
		seen.add(object);
		if (object instanceof PDFRef) {
			const entry = entries.get(object.objectNumber);
			if (
				!entry ||
				entry.type === 0 ||
				object.generationNumber !== (entry.type === 2 ? 0 : entry.generation)
			)
				throw new Error("damaged");
			const value = doc.context.lookup(object);
			if (!value) throw new Error("damaged");
			pending.push(value);
		} else if (object instanceof PDFRawStream) pending.push(object.dict);
		else if (object instanceof PDFDict) pending.push(...object.values());
		else if (object instanceof PDFArray) pending.push(...object.asArray());
	}
	// Linearized first-page trailers point forward to the main section and
	// carry Root themselves (Annex F). Newest means chain order, not byte order.
	// Refuse a catalog that pdf-lib recovered differently: appending to a
	// different object graph could change what an earlier signature displays.
	if (!trailer.Root || doc.context.lookup(trailer.Root) !== doc.catalog)
		throw new Error("damaged");
	doc.context.trailerInfo = trailer;
	doc.context.pdfFileDetails.prevStartXRef = last;
	return { stream };
}
