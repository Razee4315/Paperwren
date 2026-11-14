// @vitest-environment node
import { X509Certificate } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	PDFArray,
	PDFBool,
	PDFDict,
	PDFDocument,
	PDFHeader,
	PDFName,
	type PDFNumber,
	PDFRawStream,
	PDFString,
	StandardFonts,
	decodePDFRawStream,
	degrees,
} from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { protect } from "../pdfTools";
import { ecdsaRaw } from "../sign/cms";
import { buffer, concat, der, objectId, read, sequence } from "../sign/der";
import { PdfSignError, canSign, readDigitalId, signPdf } from "../sign/index";
import { OID } from "../sign/oids";
import { signWithId } from "../sign/pades";
import { crossReferences } from "../sign/pdfStructure";
import { readPkcs12 } from "../sign/pkcs12";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
	import.meta.url,
).toString();
const now = new Date("2026-11-14T00:00:00Z");
const fixture = (name: string) =>
	Uint8Array.from(readFileSync(`fixtures/digital-id/${name}`));
const id = (name = "rsa-aes256.p12") => readDigitalId(fixture(name), "wren");
const png = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=",
		"base64",
	),
);

async function pages(stream = false, turn = 0) {
	const doc = await PDFDocument.create();
	const page = doc.addPage([600, 800]);
	page.setRotation(degrees(turn));
	page.drawText("The original page", {
		x: 40,
		y: 700,
		font: await doc.embedFont(StandardFonts.Helvetica),
	});
	return doc.save({ useObjectStreams: stream });
}

function signatures(pdf: Uint8Array) {
	const source = Buffer.from(pdf).toString("latin1");
	return [
		...source.matchAll(
			/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g,
		),
	].map((match) => {
		const [zero, a, b, rest] = match.slice(1).map(Number);
		expect(zero).toBe(0);
		expect(source[a]).toBe("<");
		expect(source[b - 1]).toBe(">");
		const padded = Uint8Array.from(
			Buffer.from(source.slice(a + 1, b - 1), "hex"),
		);
		let size = padded[1];
		let header = 2;
		if (size & 128) {
			const count = size & 127;
			size = 0;
			for (let i = 0; i < count; i++) size = size * 256 + padded[header++];
		}
		const cms = padded.subarray(0, header + size);
		const ranges = concat(pdf.subarray(0, a), pdf.subarray(b, b + rest));
		return { a, b, rest, cms, ranges };
	});
}

async function verifySignatures(pdf: Uint8Array) {
	const found = signatures(pdf);
	for (const sig of found) {
		const signed = sequence(sequence(read(sig.cms))[1].children[0]);
		const signer = sequence(signed[4].children[0]);
		const hashId = objectId(sequence(signer[2])[0]);
		const hash =
			hashId === OID.sha384
				? "SHA-384"
				: hashId === OID.sha512
					? "SHA-512"
					: "SHA-256";
		const digest = new Uint8Array(
			await crypto.subtle.digest(hash, buffer(sig.ranges)),
		);
		const digestAttribute = signer[3].children.find(
			(attr) => objectId(sequence(attr)[0]) === OID.messageDigest,
		);
		expect(sequence(digestAttribute)[1].children[0].value).toEqual(digest);
		const sid = sequence(signer[1]);
		const cert = signed[3].children.find((cert) => {
			const x509 = new X509Certificate(cert.raw);
			return (
				x509.serialNumber.toLowerCase() ===
				Buffer.from(sid[1].value).toString("hex").replace(/^00/, "")
			);
		});
		expect(cert).toBeDefined();
		const publicKey = new X509Certificate(cert?.raw ?? new Uint8Array())
			.publicKey;
		const rsa = publicKey.asymmetricKeyType === "rsa";
		const curve = publicKey.asymmetricKeyDetails?.namedCurve;
		const namedCurve =
			curve === "secp384r1"
				? "P-384"
				: curve === "secp521r1"
					? "P-521"
					: "P-256";
		const key = await crypto.subtle.importKey(
			"spki",
			publicKey.export({ type: "spki", format: "der" }),
			rsa ? { name: "RSASSA-PKCS1-v1_5", hash } : { name: "ECDSA", namedCurve },
			false,
			["verify"],
		);
		const signature = rsa
			? signer[5].value
			: ecdsaRaw(
					signer[5].value,
					namedCurve === "P-521" ? 66 : namedCurve === "P-384" ? 48 : 32,
				);
		expect(
			await crypto.subtle.verify(
				rsa ? "RSASSA-PKCS1-v1_5" : { name: "ECDSA", hash },
				key,
				buffer(signature),
				buffer(der(49, signer[3].value)),
			),
		).toBe(true);
	}
	const last = found[found.length - 1];
	expect(last.b + last.rest).toBe(pdf.length);
	return found;
}

function emit(name: string, pdf: Uint8Array) {
	const out = process.env.PAPERWREN_SIGN_OUT;
	if (!out) return;
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, `${name}.pdf`), pdf);
	signatures(pdf).forEach((sig, i) => {
		writeFileSync(join(out, `${name}-${i + 1}.cms`), sig.cms);
		writeFileSync(join(out, `${name}-${i + 1}.ranges`), sig.ranges);
	});
}

// Model Annex F's first-page -> main xref ordering without requiring qpdf.
// The main trailer deliberately omits Root and has older metadata and Size.
function linearizedStyle(kind: "table" | "stream" | "hybrid") {
	const offsets = new Map<number, number>();
	let source = "%PDF-1.7\n";
	const first = source.length;
	const newest = "/Size 100 /Root 1 0 R /Info 4 0 R /ID [<aaaa> <aaaa>]";
	const entries = (numbers: number[]) =>
		numbers
			.map(
				(n) =>
					`${String(offsets.get(n) ?? 0).padStart(10, "0")} ${n === 3 ? "00007" : n === 0 ? "65535" : "00000"} ${n === 0 ? "f" : "n"} \n`,
			)
			.join("");
	const stream = (number: number, numbers: number[], trailer: string) => {
		const bytes = Buffer.alloc(numbers.length * 7);
		numbers.forEach((n, i) => {
			bytes[i * 7] = n === 0 ? 0 : 1;
			bytes.writeUInt32BE(offsets.get(n) ?? 0, i * 7 + 1);
			bytes.writeUInt16BE(n === 3 ? 7 : n === 0 ? 65535 : 0, i * 7 + 5);
		});
		return `${number} 0 obj\n<< /Type /XRef /W [1 4 2] /Index [${numbers[0]} ${numbers.length}] ${trailer} /Length ${bytes.length} >>\nstream\n${bytes.toString("latin1")}\nendstream\nendobj\n`;
	};
	source = source.padEnd(1024, " ");
	for (const [n, body] of [
		[1, "<< /Type /Catalog /Pages 2 0 R >>"],
		[2, "<< /Type /Pages /Kids [3 7 R] /Count 1 >>"],
		[3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] >>"],
		[4, "<< /Title (Newest) >>"],
		[5, "<< /Title (Oldest) >>"],
	] as const) {
		offsets.set(n, source.length);
		source += `${n} ${n === 3 ? 7 : 0} obj\n${body}\nendobj\n`;
	}
	let hybrid = "";
	if (kind === "hybrid") {
		offsets.set(6, source.length);
		hybrid = ` /XRefStm ${source.length}`;
		// A supplement's Prev is ignored, even when it points at its own table.
		source += stream(6, [6], `/Size 100 /Prev ${first}`);
	}
	const main = source.length;
	const older = "/Size 8 /Info 5 0 R /ID [<bbbb> <bbbb>]";
	if (kind === "stream") {
		offsets.set(6, first);
		offsets.set(7, main);
		source += stream(7, [0, 1, 2, 3, 4, 5, 6, 7], older);
	} else {
		source += `xref\n0 6\n${entries([0, 1, 2, 3, 4, 5])}trailer\n<< ${older} >>\n`;
	}
	const initial =
		kind === "stream"
			? stream(6, [6], `${newest} /Prev ${main}`)
			: `xref\n1 1\n${entries([1])}trailer\n<< ${newest} /Prev ${main}${hybrid} >>\n`;
	source =
		source.slice(0, first) + initial + source.slice(first + initial.length);
	source += `startxref\n${first}\n%%EOF\n`;
	return Uint8Array.from(Buffer.from(source, "latin1"));
}

async function checkLinearized(original: Uint8Array) {
	const first = await signWithId(
		original,
		await readPkcs12(fixture("rsa-aes256.p12"), "wren"),
		"Test",
		{ appearance: null, now },
	);
	expect(first.subarray(0, original.length)).toEqual(original);
	expect(await canSign(first)).toEqual({ signed: true });
	const second = await signPdf(first, await id(), { appearance: null, now });
	expect(second.subarray(0, first.length)).toEqual(first);
	expect(await verifySignatures(second)).toHaveLength(2);
	for (const [before, after] of [
		[original, first],
		[first, second],
	]) {
		const previous = Buffer.from(before)
			.toString("latin1")
			.match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1];
		expect(
			Buffer.from(after.subarray(before.length)).toString("latin1"),
		).toContain(`/Prev ${previous}`);
	}
	const reopened = await PDFDocument.load(second);
	expect(reopened.getPageCount()).toBe(1);
	expect(reopened.getPage(0).ref.generationNumber).toBe(
		(await PDFDocument.load(original)).getPage(0).ref.generationNumber,
	);
	const reader = await pdfjs.getDocument({
		data: second.slice(),
		isEvalSupported: false,
		verbosity: 0,
	}).promise;
	expect(reader.numPages).toBe(1);
	await reader.destroy();
	return second;
}

describe("incremental PAdES signatures", () => {
	it("accepts 128 sections and still refuses bad generations and hybrid targets", async () => {
		let source = Buffer.from(linearizedStyle("table")).toString("latin1");
		let previous = Number(source.match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1]);
		for (let i = 0; i < 126; i++) {
			const offset = source.length;
			source += `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 100 /Root 1 0 R /Prev ${previous} >>\nstartxref\n${offset}\n%%EOF\n`;
			previous = offset;
		}
		expect(
			await canSign(Uint8Array.from(Buffer.from(source, "latin1"))),
		).toEqual({ signed: false });
		for (const damaged of [
			Buffer.from(linearizedStyle("table"))
				.toString("latin1")
				.replace("3 7 obj", "3 8 obj"),
			Buffer.from(linearizedStyle("hybrid"))
				.toString("latin1")
				.replace(
					/\/XRefStm (\d+)/,
					(_, n: string) => `/XRefStm ${"9".repeat(n.length)}`,
				),
		]) {
			expect(
				await canSign(Uint8Array.from(Buffer.from(damaged, "latin1"))),
			).toMatchObject({ blocker: "damaged" });
		}
	});
	it.each(["table", "stream", "hybrid"] as const)(
		"signs twice across a forward Prev in a %s layout",
		async (kind) => {
			const original = linearizedStyle(kind);
			const doc = await PDFDocument.load(original, {
				forIncrementalUpdate: true,
				updateMetadata: false,
			});
			crossReferences(original, doc);
			expect(doc.context.trailerInfo.Info?.toString()).toBe("4 0 R");
			expect(doc.context.trailerInfo.ID?.toString()).toBe("[ <aaaa> <aaaa> ]");
			expect(doc.context.trailerInfo.Size?.asNumber()).toBe(100);
			const signed = await checkLinearized(original);
			const after = await PDFDocument.load(signed);
			expect(after.context.trailerInfo.Info?.toString()).toBe("4 0 R");
			expect(after.context.trailerInfo.Size?.asNumber()).toBeGreaterThan(100);
			expect(after.getPage(0).ref.generationNumber).toBe(7);
		},
	);
	it.skipIf(!process.env.PAPERWREN_LINEARIZED_INPUT)(
		"signs a qpdf-linearized sample twice for independent verification",
		async () => {
			const original = Uint8Array.from(
				readFileSync(process.env.PAPERWREN_LINEARIZED_INPUT ?? ""),
			);
			emit("twice-linearized", await checkLinearized(original));
		},
	);
	it.each(["cycle", "outside", "long"])(
		"refuses a %s Prev chain",
		async (kind) => {
			let source = Buffer.from(linearizedStyle("table")).toString("latin1");
			const first = Number(source.match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1]);
			if (kind === "long") {
				let previous = first;
				for (let i = 0; i < 127; i++) {
					const offset = source.length;
					source += `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 100 /Root 1 0 R /Prev ${previous} >>\nstartxref\n${offset}\n%%EOF\n`;
					previous = offset;
				}
			} else {
				source = source.replace(
					/\/Prev (\d+)/,
					(_, value: string) =>
						`/Prev ${String(kind === "cycle" ? first : 9999).padStart(value.length, "0")}`,
				);
			}
			const pdf = Uint8Array.from(Buffer.from(source, "latin1"));
			expect(await canSign(pdf)).toMatchObject({ blocker: "damaged" });
			await expect(
				signPdf(pdf, await id(), { appearance: null, now }),
			).rejects.toMatchObject({ reason: "damaged" });
		},
	);
	it("signs a PDF 1.4 table and refuses captions that need a browser font renderer", async () => {
		const doc = await PDFDocument.load(await pages());
		doc.context.header = PDFHeader.forVersion(1, 4);
		const original = await doc.save({ useObjectStreams: false });
		const loaded = await id();
		const signed = await signPdf(original, loaded, { appearance: null, now });
		expect(new TextDecoder().decode(signed.subarray(0, 8))).toBe("%PDF-1.4");
		await verifySignatures(signed);
		await expect(
			signPdf(original, loaded, {
				appearance: {
					png,
					placement: { page: 0, x: 0, y: 0, w: 0.3, h: 0.1 },
					caption: "鳥",
				},
				now,
			}),
		).rejects.toMatchObject({ reason: "unsupported" });
		emit("rsa-table14", signed);
	});
	it.each([false, true])(
		"signs a PDF with xref streams = %s, preserving all original bytes",
		async (stream) => {
			const original = await pages(stream);
			const signed = await signPdf(original, await id(), {
				appearance: null,
				now,
			});
			expect(signed.subarray(0, original.length)).toEqual(original);
			expect(await canSign(signed)).toEqual({ signed: true });
			expect(await verifySignatures(signed)).toHaveLength(1);
			const reopened = await PDFDocument.load(signed);
			expect(reopened.getPageCount()).toBe(1);
			const signature = reopened.getForm().getSignature("Signature1");
			expect(
				signature.acroField.dict
					.lookup(PDFName.of("Rect"), PDFArray)
					.asArray()
					.map((n) => (n as PDFNumber).asNumber()),
			).toEqual([0, 0, 0, 0]);
			const value = signature.acroField.V() as PDFDict;
			expect(value.get(PDFName.of("SubFilter"))).toBe(
				PDFName.of("ETSI.CAdES.detached"),
			);
			const source = Buffer.from(signed).toString("latin1");
			const xref = Number(source.match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1]);
			expect(source.slice(xref, xref + 4) === "xref").toBe(!stream);
			const reader = await pdfjs.getDocument({
				data: signed.slice(),
				isEvalSupported: false,
				verbosity: 0,
			}).promise;
			expect(reader.numPages).toBe(1);
			expect(
				(await (await reader.getPage(1)).getAnnotations()).some(
					(a) => a.fieldType === "Sig",
				),
			).toBe(true);
			await reader.destroy();
			emit(stream ? "rsa-stream" : "rsa-table", signed);
		},
	);
	it.each([
		"p256.p12",
		"p384.p12",
		"p521.p12",
		"rsa4096.p12",
		"self-signed.p12",
	])("signs using %s", async (file) => {
		const original = await pages();
		const signed = await signPdf(original, await id(file), {
			appearance: null,
			now,
		});
		expect(signed.subarray(0, original.length)).toEqual(original);
		await verifySignatures(signed);
		emit(file.replace(".p12", ""), signed);
	});
	it("keeps an independently signed revision and its CMS bytes unchanged", async () => {
		const original = fixture("signed-once.pdf");
		await verifySignatures(original);
		const first = signatures(original)[0];
		const signed = await signPdf(original, await id("p256.p12"), {
			appearance: null,
			now,
		});
		expect(signed.subarray(0, original.length)).toEqual(original);
		const found = await verifySignatures(signed);
		expect(found).toHaveLength(2);
		expect(found[0].cms).toEqual(first.cms);
		emit("twice-signed", signed);
	});
	it("adds a visible widget to an already signed PDF without changing page content", async () => {
		const original = fixture("signed-once.pdf");
		const signed = await signPdf(original, await id(), {
			appearance: {
				png,
				placement: { page: 0, x: 0.1, y: 0.7, w: 0.3, h: 0.1 },
			},
			now,
		});
		expect(signed.subarray(0, original.length)).toEqual(original);
		const before = await PDFDocument.load(original);
		const after = await PDFDocument.load(signed);
		expect(after.getPage(0).node.Contents()?.toString()).toBe(
			before.getPage(0).node.Contents()?.toString(),
		);
		expect(await verifySignatures(signed)).toHaveLength(2);
		emit("twice-visible", signed);
	});
	it.each([2, 3])("allows DocMDP permission %i", async (permission) => {
		const doc = await PDFDocument.load(await pages());
		const signature = doc.context.register(
			doc.context.obj({
				Type: "Sig",
				Reference: [
					{ TransformMethod: "DocMDP", TransformParams: { P: permission } },
				],
			}),
		);
		doc.catalog.set(
			PDFName.of("Perms"),
			doc.context.obj({ DocMDP: signature }),
		);
		const original = await doc.save({ useObjectStreams: false });
		expect((await canSign(original)).blocker).toBeUndefined();
		await verifySignatures(
			await signPdf(original, await id(), { appearance: null, now }),
		);
	});
	it.each([0, 90, 180, 270])(
		"draws only a widget appearance on a page turned %i degrees",
		async (turn) => {
			const original = await pages(false, turn);
			const signed = await signPdf(original, await id(), {
				appearance: {
					png,
					placement: { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
					caption: "Signed for testing",
				},
				now,
			});
			const before = await PDFDocument.load(original);
			const after = await PDFDocument.load(signed);
			expect(after.getPage(0).node.Contents()?.toString()).toBe(
				before.getPage(0).node.Contents()?.toString(),
			);
			const widget = after.getForm().getSignature("Signature1").acroField.dict;
			const ap = widget
				.lookup(PDFName.of("AP"), PDFDict)
				.lookup(PDFName.of("N"));
			if (!(ap instanceof PDFRawStream)) throw new Error("appearance");
			const width = 0.3 * (turn % 180 ? 800 : 600);
			const height = 0.1 * (turn % 180 ? 600 : 800);
			const matrix =
				turn === 90
					? [0, 1, -1, 0, height, 0]
					: turn === 180
						? [-1, 0, 0, -1, width, height]
						: turn === 270
							? [0, -1, 1, 0, 0, width]
							: [1, 0, 0, 1, 0, 0];
			expect(
				ap.dict
					.lookup(PDFName.of("Matrix"), PDFArray)
					.asArray()
					.map((n) => (n as PDFNumber).asNumber()),
			).toEqual(matrix);
			expect(
				new TextDecoder().decode(decodePDFRawStream(ap).decode()),
			).toContain("/Image Do");
			const old = new Map(
				before.context
					.enumerateIndirectObjects()
					.map(([ref, obj]) => [ref.toString(), obj.toString()]),
			);
			const allowed = new Set([
				before.context.trailerInfo.Root?.toString(),
				before.getPage(0).ref.toString(),
			]);
			for (const [ref, obj] of after.context.enumerateIndirectObjects())
				if (
					old.has(ref.toString()) &&
					old.get(ref.toString()) !== obj.toString()
				)
					expect(allowed.has(ref.toString()), `rewritten ${ref}`).toBe(true);
			const reader = await pdfjs.getDocument({
				data: signed.slice(),
				isEvalSupported: false,
				verbosity: 0,
			}).promise;
			await (await reader.getPage(1)).getOperatorList();
			await reader.destroy();
			await verifySignatures(signed);
			if (!turn) emit("visible", signed);
		},
	);
	it("fills an existing empty signature widget, retaining its name and rectangle", async () => {
		const doc = await PDFDocument.load(await pages());
		const page = doc.getPage(0);
		const widget = doc.context.register(
			doc.context.obj({
				FT: "Sig",
				T: PDFString.of("Prepared"),
				Type: "Annot",
				Subtype: "Widget",
				Rect: [10, 20, 110, 70],
				P: page.ref,
			}),
		);
		page.node.addAnnot(widget);
		const form = doc.catalog.getOrCreateAcroForm();
		form.addField(widget);
		form.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
		const original = await doc.save({
			useObjectStreams: false,
			updateFieldAppearances: false,
		});
		const signed = await signPdf(original, await id(), {
			field: "Prepared",
			appearance: null,
			now,
		});
		const after = await PDFDocument.load(signed);
		const field = after.getForm().getSignature("Prepared").acroField;
		expect(field.V()).toBeInstanceOf(PDFDict);
		expect(
			field.dict
				.lookup(PDFName.of("Rect"), PDFArray)
				.asArray()
				.map((n) => (n as PDFNumber).asNumber()),
		).toEqual([10, 20, 110, 70]);
		expect(
			after.getForm().acroForm.dict.get(PDFName.of("NeedAppearances")),
		).toBe(PDFBool.True);
		await expect(
			signPdf(signed, await id(), { field: "Prepared", appearance: null }),
		).rejects.toBeInstanceOf(PdfSignError);
	});
	it("refuses encrypted, no-changes certified and damaged inputs with reason codes", async () => {
		const plain = await pages();
		const damaged = plain.slice();
		const source = Buffer.from(damaged).toString("latin1");
		const match = source.match(/startxref\s+(\d+)/);
		if (!match) throw new Error("xref");
		damaged.set(
			Buffer.from("0".repeat(match[1].length)),
			(match.index ?? 0) + match[0].indexOf(match[1]),
		);
		for (const [pdf, reason] of [
			[await protect(plain, "wren"), "encrypted"],
			[fixture("certified-nochanges.pdf"), "certified"],
			[damaged, "damaged"],
			[Uint8Array.of(1, 2), "damaged"],
		] as const) {
			expect((await canSign(pdf)).blocker).toBe(reason);
			await expect(
				signPdf(pdf, await id(), { appearance: null }),
			).rejects.toMatchObject({ reason });
		}
	});
	it("forgets the private session and refuses forged or forgotten IDs", async () => {
		const loaded = await id();
		expect(Object.keys(loaded).sort()).toEqual(["forget", "summary"]);
		loaded.forget();
		loaded.forget();
		await expect(
			signPdf(await pages(), loaded, { appearance: null }),
		).rejects.toMatchObject({ reason: "no-key" });
		await expect(
			signPdf(
				await pages(),
				{ summary: loaded.summary, forget() {} },
				{ appearance: null },
			),
		).rejects.toMatchObject({ reason: "no-key" });
	});
});
