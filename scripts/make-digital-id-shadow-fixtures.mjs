// The xref page is what readers show; pdf-lib keeps the later unindexed page.
import { writeFileSync } from "node:fs";

for (const signed of [false, true]) {
	let source = "%PDF-1.4\n";
	const offsets = [0];
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >>",
		...[
			"BT /F1 16 Tf 40 700 Td (PAY 100) Tj ET",
			"BT /F1 16 Tf 40 700 Td (PAY 99999) Tj ET",
		].map((text) => `<< /Length ${text.length} >>\nstream\n${text}\nendstream`),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		...(signed ? ["<< /Type /Sig /ByteRange [0 0 0 0] >>"] : []),
	];
	objects.forEach((body, i) => {
		offsets.push(source.length);
		source += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	source += `3 0 obj\n${objects[2].replace("4 0 R", "5 0 R")}\nendobj\n`;
	const xref = source.length;
	source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
	source += offsets
		.slice(1)
		.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
		.join("");
	source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	writeFileSync(
		`fixtures/digital-id/shadow-${signed ? "signed" : "unsigned"}.pdf`,
		Buffer.from(source),
	);
}
