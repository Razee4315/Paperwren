// @vitest-environment node
import { readFileSync } from "node:fs";
import {
	PDFCheckBox,
	PDFDocument,
	PDFDropdown,
	PDFName,
	PDFRadioGroup,
	PDFRawStream,
	type PDFRef,
	PDFTextField,
	StandardFonts,
	decodePDFRawStream,
} from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { losslessPdf } from "../pdfLossless";
import { protect } from "../pdfTools";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
	import.meta.url,
).toString();

const name = (n: string) => PDFName.of(n);

/** Each page's words, as pdf.js reads them, and how many pages. */
async function pageWords(bytes: Uint8Array, password?: string) {
	const doc = await pdfjs.getDocument({
		data: bytes.slice(),
		password,
		isEvalSupported: false,
		verbosity: 0,
	}).promise;
	const out: string[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		out.push(
			(await page.getTextContent()).items
				.map((i) => ("str" in i ? i.str : ""))
				.join(" "),
		);
	}
	const fields = Object.keys((await doc.getFieldObjects()) ?? {}).sort();
	await doc.destroy();
	return { pages: out, fields };
}

/** What a stream holds once unpacked; a JPEG as it is. */
function unpacked(stream: PDFRawStream) {
	try {
		return decodePDFRawStream(stream).decode();
	} catch {
		return stream.contents;
	}
}

/** A PDF with everything the lossless choice takes out, and words that
 * must stay: an object nothing points to, the same picture stored
 * twice, a page thumbnail, XMP, /PieceInfo and a stream not packed. */
async function untidy(useObjectStreams: boolean) {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const [one, two] = [doc.addPage([600, 800]), doc.addPage([600, 800])];
	one.drawText("First page words", { x: 50, y: 700, size: 20, font });
	two.drawText("Second page words", { x: 50, y: 700, size: 20, font });
	const { context } = doc;
	const picture = () =>
		context.register(
			context.stream(
				new Uint8Array(4000).map((_, i) => (i * 7) % 251),
				{
					Type: "XObject",
					Subtype: "Image",
					Width: 40,
					Height: 33,
					BitsPerComponent: 8,
					ColorSpace: "DeviceRGB",
				},
			),
		);
	const twins = [picture(), picture()];
	one.node.newXObject("Im", twins[0]);
	one.node.newXObject("Im", twins[1]);
	const orphan = context.register(context.obj({ Nobody: "points here" }));
	const orphanStream = context.register(
		context.stream(new Uint8Array(3000).fill(9)),
	);
	const thumb = context.register(
		context.stream(new Uint8Array(900).fill(3), {
			Width: 10,
			Height: 30,
			ColorSpace: "DeviceRGB",
			BitsPerComponent: 8,
		}),
	);
	one.node.set(name("Thumb"), thumb);
	const xmp = context.register(
		context.stream(
			new TextEncoder().encode(
				`<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/">${" ".repeat(2000)}</x:xmpmeta><?xpacket end="w"?>`,
			),
			{ Type: "Metadata", Subtype: "XML" },
		),
	);
	doc.catalog.set(name("Metadata"), xmp);
	two.node.set(
		name("PieceInfo"),
		context.obj({ Illustrator: { Private: "x".repeat(500) } }),
	);
	// A drawing stored with no packing at all.
	const plain = context.register(
		context.stream(
			new TextEncoder().encode("0 0 1 rg 10 10 50 50 re f\n".repeat(80)),
		),
	);
	two.node.addContentStream(plain);
	const bytes = await doc.save({ useObjectStreams });
	return { bytes, twins, orphan, orphanStream, thumb, xmp, plain };
}

describe("losslessPdf", () => {
	for (const useObjectStreams of [true, false]) {
		it(`takes out only what nothing shows (${useObjectStreams ? "object streams" : "a plain table"})`, async () => {
			const made = await untidy(useObjectStreams);
			const out = await losslessPdf(made.bytes);
			expect(out.length).toBeLessThan(made.bytes.length);

			const before = await PDFDocument.load(made.bytes);
			const after = await PDFDocument.load(out);
			expect(after.getPageCount()).toBe(before.getPageCount());
			const gone = (ref: PDFRef) => after.context.lookup(ref) === undefined;
			expect(gone(made.orphan)).toBe(true);
			expect(gone(made.orphanStream)).toBe(true);
			expect(gone(made.thumb)).toBe(true);
			expect(gone(made.xmp)).toBe(true);
			// The same picture, kept once and drawn from both names.
			expect(made.twins.filter(gone)).toHaveLength(1);
			const xobjects = after
				.getPage(0)
				.node.Resources()
				?.lookup(name("XObject"));
			const refs = new Set(
				xobjects && "values" in xobjects
					? (xobjects as { values(): unknown[] }).values()
					: [],
			);
			expect(refs.size).toBe(1);
			expect(after.getPage(0).node.has(name("Thumb"))).toBe(false);
			expect(after.getPage(1).node.has(name("PieceInfo"))).toBe(false);
			expect(after.catalog.has(name("Metadata"))).toBe(false);
			// The stream that was not packed now is.
			const plain = after.context.lookup(made.plain) as PDFRawStream;
			expect(plain.dict.get(name("Filter"))).toBe(name("FlateDecode"));

			// Every stream left holds just what it held.
			for (const [ref, object] of after.context.enumerateIndirectObjects()) {
				if (!(object instanceof PDFRawStream)) continue;
				const type = object.dict.get(name("Type"));
				if (type === name("ObjStm") || type === name("XRef")) continue;
				const was = before.context.lookup(ref);
				expect(was, `object ${ref}`).toBeInstanceOf(PDFRawStream);
				expect(unpacked(object)).toEqual(unpacked(was as PDFRawStream));
			}

			// pdf.js reads the same words on the same pages.
			expect(await pageWords(out)).toEqual(await pageWords(made.bytes));
		});
	}

	it("keeps a form's fields and what they hold", async () => {
		const bytes = new Uint8Array(readFileSync("fixtures/features/form.pdf"));
		const fields = async (b: Uint8Array) =>
			(await PDFDocument.load(b))
				.getForm()
				.getFields()
				.map((f) => [
					f.getName(),
					f instanceof PDFTextField
						? f.getText()
						: f instanceof PDFCheckBox
							? f.isChecked()
							: f instanceof PDFDropdown
								? f.getSelected()
								: f instanceof PDFRadioGroup
									? f.getSelected()
									: f.constructor.name,
				]);
		const out = await losslessPdf(bytes);
		const was = await fields(bytes);
		expect(was.length).toBeGreaterThan(0);
		expect(await fields(out)).toEqual(was);
		expect(await pageWords(out)).toEqual(await pageWords(bytes));
	});

	it("opens a locked PDF with its password, as compressing does", async () => {
		const bytes = new Uint8Array(
			readFileSync("fixtures/viewer-regressions/locked.pdf"),
		);
		const out = await losslessPdf(bytes, { password: "wren" });
		expect(await pageWords(out)).toEqual(await pageWords(bytes, "wren"));
		expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
	});

	it("keeps a locked copy's pages and words", async () => {
		const { bytes } = await untidy(true);
		const locked = await protect(bytes, "pw");
		const out = await losslessPdf(locked, { password: "pw" });
		expect(await pageWords(out)).toEqual(await pageWords(bytes));
	});

	it("leaves a digital signature's dictionary as it was", async () => {
		// A signature field as a signing app leaves it (with made-up
		// numbers): rewriting breaks the signature, as every copy does,
		// but what it holds is kept.
		const doc = await PDFDocument.create();
		doc.addPage([300, 300]);
		const { context } = doc;
		const sig = context.register(
			context.obj({
				Type: "Sig",
				Filter: "Adobe.PPKLite",
				ByteRange: [0, 100, 200, 300],
			}),
		);
		const widget = context.register(
			context.obj({
				Type: "Annot",
				Subtype: "Widget",
				FT: "Sig",
				T: context.obj("Signature1" as never),
				V: sig,
				Rect: [0, 0, 0, 0],
			}),
		);
		doc.getPage(0).node.addAnnot(widget);
		doc.catalog.set(
			name("AcroForm"),
			context.obj({ Fields: [widget], SigFlags: 3 }),
		);
		const out = await losslessPdf(await doc.save());
		const after = await PDFDocument.load(out);
		const kept = after.context.lookup(sig);
		expect(String(kept)).toContain("/ByteRange [ 0 100 200 300 ]");
	});
});
