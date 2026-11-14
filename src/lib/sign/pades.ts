import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFHexString,
	PDFInvalidObject,
	PDFName,
	PDFNull,
	PDFNumber,
	type PDFRef,
	PDFString,
	StandardFonts,
} from "@cantoo/pdf-lib";
import { version } from "../../../package.json";
import {
	type Placement,
	digitallySigned,
	pagePoint,
	shownBox,
	standardText,
} from "../pdfTools";
import { cmsReservation, createCms, verifyCms } from "./cms";
import { buffer, concat, equal } from "./der";
import { DigitalIdError } from "./errors";
import { cleanName } from "./names";
import { crossReferences } from "./pdfStructure";
import type { ImportedId } from "./pkcs12";

export type SignBlocker = "encrypted" | "certified" | "damaged" | "constrained";
export class PdfSignError extends Error {
	constructor(readonly reason: SignBlocker) {
		super(reason);
		this.name = "PdfSignError";
	}
}
export interface SignOptions {
	appearance: {
		placement: Placement;
		png: Uint8Array;
		caption?: string;
	} | null;
	field?: string;
	now?: Date;
}

function fieldLocks(doc: PDFDocument, name: string) {
	const signatures = new Set<PDFDict>();
	for (const [, object] of doc.context.enumerateIndirectObjects()) {
		if (
			object instanceof PDFDict &&
			object.get(PDFName.of("Type")) === PDFName.of("Sig")
		)
			signatures.add(object);
	}
	for (const [field] of doc.catalog.getAcroForm()?.getAllFields() ?? []) {
		const value = field.V();
		if (
			value instanceof PDFDict &&
			field.getInheritableAttribute(PDFName.of("FT")) === PDFName.of("Sig")
		)
			signatures.add(value);
	}
	const certified = doc.catalog
		.lookupMaybe(PDFName.of("Perms"), PDFDict)
		?.lookupMaybe(PDFName.of("DocMDP"), PDFDict);
	if (certified) signatures.add(certified);
	for (const signature of signatures) {
		const references = signature.lookupMaybe(PDFName.of("Reference"), PDFArray);
		for (const ref of references?.asArray() ?? []) {
			const reference = doc.context.lookup(ref, PDFDict);
			if (
				reference.get(PDFName.of("TransformMethod")) !== PDFName.of("FieldMDP")
			)
				continue;
			const params = reference.lookup(PDFName.of("TransformParams"), PDFDict);
			const action = params.get(PDFName.of("Action"));
			if (action === PDFName.of("All")) throw new PdfSignError("constrained");
			if (action !== PDFName.of("Include") && action !== PDFName.of("Exclude"))
				throw new PdfSignError("constrained");
			const fields = params.lookup(PDFName.of("Fields"), PDFArray);
			const listed = fields.asArray().some((value) => {
				const field = doc.context.lookup(value);
				if (!(field instanceof PDFString) && !(field instanceof PDFHexString))
					throw new PdfSignError("constrained");
				const locked = field.decodeText();
				return name === locked || name.startsWith(`${locked}.`);
			});
			if (action === PDFName.of("Include") ? listed : !listed)
				throw new PdfSignError("constrained");
		}
	}
}

function certified(doc: PDFDocument): boolean {
	const perms = doc.catalog.lookupMaybe(PDFName.of("Perms"), PDFDict);
	const signature = perms?.lookupMaybe(PDFName.of("DocMDP"), PDFDict);
	const references = signature?.lookupMaybe(PDFName.of("Reference"), PDFArray);
	if (!signature) return false;
	if (!references) throw new PdfSignError("damaged");
	for (const reference of references.asArray()) {
		const dict = doc.context.lookup(reference, PDFDict);
		if (dict.get(PDFName.of("TransformMethod")) !== PDFName.of("DocMDP"))
			continue;
		const params = dict.lookup(PDFName.of("TransformParams"), PDFDict);
		const permission =
			params.lookupMaybe(PDFName.of("P"), PDFNumber)?.asNumber() ?? 2;
		if (permission === 1) return true;
		if (permission !== 2 && permission !== 3) throw new PdfSignError("damaged");
	}
	return false;
}

async function inspect(pdf: Uint8Array) {
	const signed = digitallySigned(pdf);
	try {
		const doc = await PDFDocument.load(pdf, {
			ignoreEncryption: true,
			forIncrementalUpdate: true,
			updateMetadata: false,
			throwOnInvalidObject: false,
		});
		if (doc.isEncrypted) return { signed, blocker: "encrypted" as const };
		if (
			doc.context
				.enumerateIndirectObjects()
				.some(([, object]) => object instanceof PDFInvalidObject)
		)
			return { signed, blocker: "damaged" as const };
		const xref = crossReferences(pdf, doc);
		if (doc.context.trailerInfo.Encrypt)
			return { signed, blocker: "encrypted" as const };
		if (certified(doc)) return { signed, blocker: "certified" as const };
		if (!doc.getPageCount()) return { signed, blocker: "damaged" as const };
		const fields = doc.catalog.getAcroForm()?.getAllFields() ?? [];
		const hasSignature = fields.some(
			([field]) =>
				field.getInheritableAttribute(PDFName.of("FT")) === PDFName.of("Sig") &&
				field.V() &&
				field.V() !== PDFNull,
		);
		return { signed: signed || hasSignature, doc, xref };
	} catch {
		return { signed, blocker: "damaged" as const };
	}
}

export async function canSign(
	pdf: Uint8Array,
): Promise<{ signed: boolean; blocker?: SignBlocker }> {
	const result = await inspect(pdf);
	return {
		signed: result.signed,
		...(result.blocker ? { blocker: result.blocker } : {}),
	};
}

async function appearance(
	doc: PDFDocument,
	pageIndex: number,
	options: SignOptions,
	existing?: PDFArray,
) {
	const page = doc.getPage(pageIndex);
	const box = shownBox(page);
	let rect = existing?.asArray().map((value) => {
		if (!(value instanceof PDFNumber)) throw new PdfSignError("damaged");
		return value.asNumber();
	}) ?? [0, 0, 0, 0];
	let width = rect[2] - rect[0];
	let height = rect[3] - rect[1];
	if (box.turn % 180) [width, height] = [height, width];
	if (existing && (rect.length !== 4 || rect.some((n) => !Number.isFinite(n))))
		throw new PdfSignError("damaged");
	if (options.appearance && !existing) {
		const mark = options.appearance.placement;
		if (
			[mark.x, mark.y, mark.w, mark.h].some((n) => !Number.isFinite(n)) ||
			mark.w <= 0 ||
			mark.h <= 0
		)
			throw new PdfSignError("damaged");
		const a = pagePoint(box, mark.x, mark.y);
		const b = pagePoint(box, mark.x + mark.w, mark.y + mark.h);
		rect = [
			Math.min(a[0], b[0]),
			Math.min(a[1], b[1]),
			Math.max(a[0], b[0]),
			Math.max(a[1], b[1]),
		];
		width = mark.w * (box.turn % 180 ? box.height : box.width);
		height = mark.h * (box.turn % 180 ? box.width : box.height);
	} else if (!existing) rect = [0, 0, 0, 0];
	const matrix =
		box.turn === 90
			? [0, 1, -1, 0, height, 0]
			: box.turn === 180
				? [-1, 0, 0, -1, width, height]
				: box.turn === 270
					? [0, -1, 1, 0, 0, width]
					: [1, 0, 0, 1, 0, 0];
	const resources = doc.context.obj({});
	let content = "";
	if (options.appearance) {
		const image = await doc.embedPng(options.appearance.png);
		resources.set(PDFName.of("XObject"), doc.context.obj({ Image: image.ref }));
		const caption = options.appearance.caption
			? cleanName(options.appearance.caption)
			: undefined;
		const captionHeight = caption ? Math.min(height / 3, 14) : 0;
		content = `q ${width} 0 0 ${height - captionHeight} 0 ${captionHeight} cm /Image Do Q\n`;
		if (caption) {
			// Other scripts can be included in the caller's PNG, without a DOM renderer here.
			if (!standardText(caption)) throw new DigitalIdError("unsupported");
			const font = await doc.embedFont(StandardFonts.Helvetica);
			resources.set(PDFName.of("Font"), doc.context.obj({ Caption: font.ref }));
			const size = Math.min(
				captionHeight * 0.8,
				width / Math.max(1, font.widthOfTextAtSize(caption, 1)),
			);
			content += `BT /Caption ${size} Tf 0 2 Td ${font.encodeText(caption)} Tj ET\n`;
		}
	}
	const form = doc.context.flateStream(content, {
		Type: "XObject",
		Subtype: "Form",
		FormType: 1,
		BBox: [0, 0, width, height],
		Matrix: matrix,
		Resources: resources,
	});
	return { rect, ref: doc.context.register(form) };
}

/** Append an approval signature. The original bytes are never changed. */
export async function signWithId(
	pdf: Uint8Array,
	id: ImportedId,
	signerName: string,
	options: SignOptions,
): Promise<Uint8Array> {
	const inspection = await inspect(pdf);
	if (inspection.blocker || !inspection.doc || !inspection.xref)
		throw new PdfSignError(inspection.blocker ?? "damaged");
	const { doc, xref } = inspection;
	const now = options.now ?? new Date();
	if (!Number.isFinite(now.getTime())) throw new PdfSignError("damaged");
	const context = doc.context;
	const reserve = await cmsReservation(id);
	const snapshot = context.snapshot;
	if (!snapshot) throw new Error("Missing signing snapshot");
	const firstNew = context.largestObjectNumber;
	const changed = new Set<PDFDict | PDFArray>([doc.catalog]);
	let signatureRef: PDFRef;
	// New nested objects otherwise trigger a whole-document search on each
	// set or push. Build and flush them without tracking, then mark the small
	// set of edited containers and all new refs explicitly.
	context.snapshot = undefined;
	try {
		const form = doc.catalog.getOrCreateAcroForm();
		const fields = form.getAllFields();
		const names = new Set(
			fields.map(([field]) => field.getFullyQualifiedName()),
		);
		let number = 1;
		while (names.has(`Signature${number}`)) number++;
		const fieldName = options.field ?? `Signature${number}`;
		fieldLocks(doc, fieldName);
		const existing = options.field
			? fields.find(
					([field]) => field.getFullyQualifiedName() === options.field,
				)?.[0]
			: undefined;
		if (
			options.field &&
			(!existing ||
				existing.getInheritableAttribute(PDFName.of("FT")) !==
					PDFName.of("Sig") ||
				(existing.V() && existing.V() !== PDFNull))
		)
			throw new PdfSignError("damaged");
		let widget = existing?.dict;
		let widgetRef = existing?.ref;
		const kids = existing?.Kids();
		if (kids) {
			if (kids.size() !== 1) throw new PdfSignError("damaged");
			widgetRef = kids.get(0) as PDFRef;
			widget = context.lookup(widgetRef, PDFDict);
		}
		if (
			existing &&
			(existing.getInheritableAttribute(PDFName.of("Lock")) ||
				existing.getInheritableAttribute(PDFName.of("SV")) ||
				widget?.has(PDFName.of("Lock")) ||
				widget?.has(PDFName.of("SV")))
		)
			throw new PdfSignError("constrained");
		const existingPage = widgetRef
			? doc.findPageForAnnotationRef(widgetRef)
			: undefined;
		if (existing && !existingPage) throw new PdfSignError("damaged");
		const pageIndex = existingPage
			? doc.getPages().indexOf(existingPage)
			: (options.appearance?.placement.page ?? 0);
		if (
			!Number.isInteger(pageIndex) ||
			pageIndex < 0 ||
			pageIndex >= doc.getPageCount()
		)
			throw new PdfSignError("damaged");
		const page = doc.getPage(pageIndex);
		const rect = widget?.lookupMaybe(PDFName.of("Rect"), PDFArray);
		if (existing && !rect) throw new PdfSignError("damaged");
		const ap = await appearance(doc, pageIndex, options, rect);

		const signature = context.obj({
			Type: "Sig",
			Filter: "Adobe.PPKLite",
			SubFilter: "ETSI.CAdES.detached",
			ByteRange: [
				0,
				PDFName.of("**********"),
				PDFName.of("**********"),
				PDFName.of("**********"),
			],
			Contents: PDFHexString.of("0".repeat(reserve * 2)),
			M: PDFString.fromDate(now),
			Name: PDFHexString.fromText(cleanName(signerName)),
			Prop_Build: { App: { Name: "Paperwren", REx: PDFString.of(version) } },
		});
		signatureRef = context.register(signature);
		if (existing && widget && widgetRef) {
			existing.dict.set(PDFName.of("V"), signatureRef);
		} else {
			widget = context.obj({
				FT: "Sig",
				T: PDFHexString.fromText(fieldName),
				V: signatureRef,
				Type: "Annot",
				Subtype: "Widget",
			});
			widgetRef = context.register(widget);
			form.addField(widgetRef);
		}
		if (!existing) {
			widget.set(PDFName.of("Rect"), context.obj(ap.rect));
			widget.set(PDFName.of("P"), page.ref);
			widget.set(PDFName.of("F"), PDFNumber.of(132));
		}
		widget.set(PDFName.of("AP"), context.obj({ N: ap.ref }));
		// addAnnot normalises page content too. Append the annotation directly.
		let annots = page.node.Annots();
		if (
			annots &&
			annots.indexOf(widgetRef) === undefined &&
			doc
				.getPages()
				.some((other) => other !== page && other.node.Annots() === annots)
		) {
			annots = annots.clone(context);
			page.node.set(PDFName.of("Annots"), context.register(annots));
		}
		if (!annots) {
			annots = context.obj([]);
			page.node.set(PDFName.of("Annots"), annots);
		}
		if (annots.indexOf(widgetRef) === undefined) annots.push(widgetRef);
		form.dict.set(PDFName.of("SigFlags"), PDFNumber.of(3));
		changed.add(form.dict);
		const fieldArray = form.dict.lookupMaybe(PDFName.of("Fields"), PDFArray);
		if (fieldArray) changed.add(fieldArray);
		if (existing) changed.add(existing.dict);
		changed.add(widget);
		changed.add(page.node);
		changed.add(annots);
		await doc.flush();
	} finally {
		context.snapshot = snapshot;
	}
	for (const object of changed) context.registerObjectChange(object);
	for (const [ref] of context.enumerateIndirectObjects())
		if (ref.objectNumber > firstNew) snapshot?.markRefForSave(ref);

	// Appending invalidates a linearization dictionary's L, as Annex F expects.
	let output: Uint8Array;
	context.snapshot = undefined;
	try {
		output = concat(
			pdf,
			await doc.saveIncremental(snapshot, { useObjectStreams: xref.stream }),
		);
	} finally {
		context.snapshot = snapshot;
	}
	if (!equal(output.subarray(0, pdf.length), pdf))
		throw new PdfSignError("damaged");
	const increment = new TextDecoder("latin1").decode(
		output.subarray(pdf.length),
	);
	const ranges = [...increment.matchAll(/\/ByteRange\s*(\[[^\]]+\])/g)];
	if (ranges.length !== 1) throw new PdfSignError("damaged");
	const range = ranges[0];
	const contents = increment.slice(range.index).match(/\/Contents\s*(<0+>)/);
	if (!contents || contents[1].length !== reserve * 2 + 2)
		throw new PdfSignError("damaged");
	const a =
		pdf.length + range.index + (contents.index ?? 0) + contents[0].indexOf("<");
	const b = a + contents[1].length;
	const values = `0 ${a} ${b} ${output.length - b}`;
	if (values.length > range[1].length - 2) throw new PdfSignError("damaged");
	const rangeStart = pdf.length + range.index + range[0].indexOf("[");
	output.set(
		new TextEncoder().encode(`[${values.padEnd(range[1].length - 2)}]`),
		rangeStart,
	);
	const digest = new Uint8Array(
		await crypto.subtle.digest(
			id.hash,
			buffer(concat(output.subarray(0, a), output.subarray(b))),
		),
	);
	const cms = await createCms(digest, id);
	if (cms.length > reserve)
		throw new Error("CMS signature exceeded its reservation");
	const hex = Array.from(cms, (n) => n.toString(16).padStart(2, "0")).join("");
	output.set(new TextEncoder().encode(hex), a + 1);
	const reopened = await PDFDocument.load(output, {
		updateMetadata: false,
		throwOnInvalidObject: true,
	});
	const written = reopened.context.lookup(signatureRef, PDFDict);
	const writtenRanges = written
		.lookup(PDFName.of("ByteRange"), PDFArray)
		.asArray()
		.map((value) => {
			if (!(value instanceof PDFNumber)) throw new PdfSignError("damaged");
			return value.asNumber();
		});
	if (
		writtenRanges.length !== 4 ||
		writtenRanges.some((n, i) => n !== [0, a, b, output.length - b][i])
	)
		throw new PdfSignError("damaged");
	const checkedDigest = new Uint8Array(
		await crypto.subtle.digest(
			id.hash,
			buffer(concat(output.subarray(0, a), output.subarray(b))),
		),
	);
	const stored = written.lookup(PDFName.of("Contents"), PDFHexString).asBytes();
	if (!(await verifyCms(stored.subarray(0, cms.length), checkedDigest, id)))
		throw new PdfSignError("damaged");
	return output;
}
