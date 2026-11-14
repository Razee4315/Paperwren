// Independent first signatures: OpenSSL signs a placeholder PDF, without the signing library.
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	rmdirSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
	PDFDocument,
	PDFHexString,
	PDFName,
	PDFString,
	degrees,
} from "@cantoo/pdf-lib";

const directory = resolve("fixtures/digital-id");
const temporary = mkdtempSync(join(directory, ".pdf-"));
const run = (...args) => {
	const result = spawnSync("openssl", args, { encoding: "utf8" });
	if (result.error || result.status !== 0)
		throw new Error(result.stderr || "openssl");
};
try {
	for (const certified of process.argv.includes("--mixed")
		? ["mixed"]
		: [false, true, "mixed"]) {
		const mixed = certified === "mixed";
		const doc = await PDFDocument.create({ updateMetadata: false });
		const page = doc.addPage([600, 800]);
		const context = doc.context;
		if (mixed) {
			page.setCropBox(40, 60, 500, 680);
			page.setRotation(degrees(90));
			page.drawText("Mixed structures keep this text", { x: 80, y: 600 });
			const shared = context.register(context.obj([]));
			for (let i = 0; i < 2; i++)
				doc.addPage([600, 800]).node.set(PDFName.of("Annots"), shared);
		}
		const signature = context.obj({
			Type: "Sig",
			Filter: "Adobe.PPKLite",
			SubFilter: "adbe.pkcs7.detached",
			ByteRange: [
				0,
				PDFName.of("**********"),
				PDFName.of("**********"),
				PDFName.of("**********"),
			],
			Contents: PDFHexString.of("0".repeat(8192)),
			M: PDFString.fromDate(new Date("2026-11-14T00:00:00Z")),
		});
		if (certified)
			signature.set(
				PDFName.of("Reference"),
				context.obj([
					{
						Type: "SigRef",
						TransformMethod: "DocMDP",
						TransformParams: {
							Type: "TransformParams",
							P: mixed ? 2 : 1,
							V: "1.2",
						},
					},
				]),
			);
		const ref = context.register(signature);
		const ap = context.register(
			context.flateStream("", {
				Type: "XObject",
				Subtype: "Form",
				BBox: [0, 0, 0, 0],
			}),
		);
		const widget = context.register(
			context.obj({
				Type: "Annot",
				Subtype: "Widget",
				FT: "Sig",
				T: PDFString.of("OriginalSignature"),
				V: ref,
				Rect: [0, 0, 0, 0],
				P: page.ref,
				F: 132,
				AP: { N: ap },
			}),
		);
		page.node.addAnnot(widget);
		const form = doc.catalog.getOrCreateAcroForm();
		form.addField(widget);
		if (mixed) {
			const prepared = context.register(
				context.obj({
					Type: "Annot",
					Subtype: "Widget",
					FT: "Sig",
					T: PDFString.of("Prepared"),
					Rect: [60, 100, 260, 180],
					P: page.ref,
					F: 4,
				}),
			);
			page.node.addAnnot(prepared);
			form.addField(prepared);
			form.dict.set(PDFName.of("Fields"), context.register(form.Fields()));
			page.node.set(PDFName.of("Annots"), context.register(page.node.Annots()));
		}
		form.dict.set(PDFName.of("SigFlags"), context.obj(3));
		if (certified)
			doc.catalog.set(PDFName.of("Perms"), context.obj({ DocMDP: ref }));
		const pdf = await doc.save({
			useObjectStreams: mixed,
			updateFieldAppearances: false,
		});
		const source = Buffer.from(pdf).toString("latin1");
		const range = source.match(/\/ByteRange\s*(\[[^\]]+\])/);
		const contents = source.match(/\/Contents\s*(<0+>)/);
		if (!range || !contents) throw new Error("placeholder");
		const a = contents.index + contents[0].indexOf("<");
		const b = a + contents[1].length;
		const values = `0 ${a} ${b} ${pdf.length - b}`;
		pdf.set(
			Buffer.from(`[${values.padEnd(range[1].length - 2)}]`),
			range.index + range[0].indexOf("["),
		);
		const ranges = join(temporary, "ranges");
		const cms = join(temporary, "signature.cms");
		writeFileSync(ranges, Buffer.concat([pdf.subarray(0, a), pdf.subarray(b)]));
		writeFileSync(
			join(temporary, "chain.pem"),
			Buffer.concat([
				readFileSync(join(directory, "issuer.pem")),
				readFileSync(join(directory, "ca.pem")),
			]),
		);
		run(
			"cms",
			"-sign",
			"-binary",
			"-nosmimecap",
			"-md",
			"sha256",
			"-in",
			ranges,
			"-signer",
			join(directory, "rsa.pem"),
			"-inkey",
			join(directory, "rsa.key"),
			"-certfile",
			join(temporary, "chain.pem"),
			"-outform",
			"DER",
			"-out",
			cms,
		);
		const signed = readFileSync(cms);
		if (signed.length > 4096) throw new Error("reserve");
		pdf.set(Buffer.from(signed.toString("hex")), a + 1);
		run(
			"cms",
			"-verify",
			"-binary",
			"-inform",
			"DER",
			"-in",
			cms,
			"-content",
			ranges,
			"-noverify",
			"-out",
			join(temporary, "verified"),
		);
		writeFileSync(
			join(
				directory,
				mixed
					? "mixed-certified.pdf"
					: certified
						? "certified-nochanges.pdf"
						: "signed-once.pdf",
			),
			pdf,
		);
	}
} finally {
	for (const name of ["ranges", "signature.cms", "chain.pem", "verified"])
		rmSync(join(temporary, name), { force: true });
	rmdirSync(temporary);
}
