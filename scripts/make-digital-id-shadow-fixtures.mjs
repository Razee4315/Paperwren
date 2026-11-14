// The xref page is what readers show; pdf-lib keeps the later unindexed page.
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	rmdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function sign(source) {
	const pdf = Buffer.from(source);
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
	const temporary = mkdtempSync(join(tmpdir(), "paperwren-shadow-"));
	try {
		writeFileSync(
			join(temporary, "ranges"),
			Buffer.concat([pdf.subarray(0, a), pdf.subarray(b)]),
		);
		writeFileSync(
			join(temporary, "chain.pem"),
			Buffer.concat([
				readFileSync("fixtures/digital-id/issuer.pem"),
				readFileSync("fixtures/digital-id/ca.pem"),
			]),
		);
		const result = spawnSync(
			"openssl",
			[
				"cms",
				"-sign",
				"-binary",
				"-nosmimecap",
				"-md",
				"sha256",
				"-in",
				join(temporary, "ranges"),
				"-signer",
				resolve("fixtures/digital-id/rsa.pem"),
				"-inkey",
				resolve("fixtures/digital-id/rsa.key"),
				"-certfile",
				join(temporary, "chain.pem"),
				"-outform",
				"DER",
				"-out",
				join(temporary, "signature.cms"),
			],
			{ encoding: "utf8" },
		);
		if (result.error || result.status)
			throw new Error(result.stderr || "openssl");
		const cms = readFileSync(join(temporary, "signature.cms"));
		if (cms.length * 2 > contents[1].length - 2) throw new Error("reserve");
		pdf.set(Buffer.from(cms.toString("hex")), a + 1);
		return pdf.toString();
	} finally {
		for (const name of ["ranges", "chain.pem", "signature.cms"])
			rmSync(join(temporary, name), { force: true });
		rmdirSync(temporary);
	}
}

for (const signed of [false, true]) {
	let source = "%PDF-1.4\n";
	const offsets = [0];
	const objects = [
		`<< /Type /Catalog /Pages 2 0 R ${signed ? "/AcroForm << /Fields [8 0 R] /SigFlags 3 >>" : ""} >>`,
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R ${signed ? "/Annots [8 0 R]" : ""} >>`,
		...[
			"BT /F1 16 Tf 40 700 Td (PAY 100) Tj ET",
			"BT /F1 16 Tf 40 700 Td (PAY 99999) Tj ET",
		].map((text) => `<< /Length ${text.length} >>\nstream\n${text}\nendstream`),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		...(signed
			? [
					`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 /********** /********** /**********] /Contents <${"0".repeat(8192)}> >>`,
					"<< /Type /Annot /Subtype /Widget /FT /Sig /T (OriginalSignature) /V 7 0 R /Rect [0 0 0 0] /P 3 0 R /F 132 >>",
				]
			: []),
	];
	objects.forEach((body, i) => {
		offsets.push(source.length);
		source += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const shadow = `3 0 obj\n${objects[2].replace("4 0 R", "5 0 R")}\nendobj\n`;
	if (!signed) source += shadow;
	const xref = source.length;
	source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
	source += offsets
		.slice(1)
		.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
		.join("");
	source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	if (signed) source = `${sign(source)}${shadow}startxref\n${xref}\n%%EOF\n`;
	writeFileSync(
		`fixtures/digital-id/shadow-${signed ? "signed" : "unsigned"}.pdf`,
		Buffer.from(source),
	);
}
