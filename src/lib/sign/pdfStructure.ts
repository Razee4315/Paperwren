import {
	PDFArray,
	PDFDict,
	type PDFDocument,
	PDFName,
	PDFNumber,
	PDFObjectParser,
	PDFRawStream,
	PDFRef,
	decodePDFRawStream,
} from "@cantoo/pdf-lib";

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
	const objectStreams = new Map<number, number[]>();
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
	function section(offset: number, supplement = false): void {
		if (
			!Number.isSafeInteger(offset) ||
			visited.has(offset) ||
			visited.size >= 128 ||
			offset < 0 ||
			offset >= pdf.length
		)
			throw new Error("damaged");
		visited.add(offset);
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
				}
				whitespace();
			}
			const object = PDFObjectParser.forBytes(
				pdf.subarray(at + 7),
				doc.context,
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
				doc.context,
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
			const bytes = decodePDFRawStream(object).decode();
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
					else if (values[0] === 2) {
						const container = doc.context.lookup(PDFRef.of(values[1]));
						if (
							!(container instanceof PDFRawStream) ||
							container.dict.get(PDFName.of("Type")) !== PDFName.of("ObjStm")
						)
							throw new Error("damaged");
						let objects = objectStreams.get(values[1]);
						if (!objects) {
							const first = container.dict
								.lookup(PDFName.of("First"), PDFNumber)
								.asNumber();
							const count = container.dict
								.lookup(PDFName.of("N"), PDFNumber)
								.asNumber();
							const decoded = decodePDFRawStream(container).decode();
							if (
								first < 0 ||
								first > decoded.length ||
								count < 0 ||
								count > first
							)
								throw new Error("damaged");
							objects = new TextDecoder()
								.decode(decoded.subarray(0, first))
								.trim()
								.split(/\s+/)
								.map(Number);
							if (objects.length !== count * 2) throw new Error("damaged");
							objectStreams.set(values[1], objects);
						}
						if (objects[values[2] * 2] !== first + i)
							throw new Error("damaged");
					} else if (values[0] !== 0) throw new Error("damaged");
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
		if (supplement) return;
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
		if (hybrid) section(hybrid.asNumber(), true);
		const previous = dict.lookupMaybe(PDFName.of("Prev"), PDFNumber);
		if (previous) {
			section(previous.asNumber());
		}
	}
	section(last);
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
