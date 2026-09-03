/**
 * Generates the starter test fixtures (docs/12 section 3 corpus):
 * a 3-page PDF, a small XLSX workbook, a CSV, and a text file.
 * Run: node scripts/make-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "fixtures");
mkdirSync(dir, { recursive: true });

// ---------- Minimal multi-page PDF with computed xref ----------
function makePdf() {
	const _lines = [];
	const objects = [];
	const pageText = (n) =>
		`BT /F1 24 Tf 72 720 Td (Paperwren test page ${n} of 3) Tj ET\nBT /F1 14 Tf 72 680 Td (If you can read this, the PDF viewer works.) Tj ET\n`;

	const content1 = pageText(1);
	const content2 = pageText(2);
	const content3 = pageText(3);

	objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
	objects[2] = "<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>";
	objects[3] =
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 9 0 R >> >> >>";
	objects[4] = { stream: content1 };
	objects[5] =
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 9 0 R >> >> >>";
	objects[6] = { stream: content2 };
	objects[7] =
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R /Resources << /Font << /F1 9 0 R >> >> >>";
	objects[8] = { stream: content3 };
	objects[9] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

	let pdf = "%PDF-1.4\n";
	const offsets = [];
	for (let i = 1; i < objects.length; i++) {
		offsets[i] = pdf.length;
		const obj = objects[i];
		if (typeof obj === "string") {
			pdf += `${i} 0 obj\n${obj}\nendobj\n`;
		} else {
			const bytes = Buffer.byteLength(obj.stream, "latin1");
			pdf += `${i} 0 obj\n<< /Length ${bytes} >>\nstream\n${obj.stream}endstream\nendobj\n`;
		}
	}
	const xrefPos = pdf.length;
	const count = objects.length;
	pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
	for (let i = 1; i < count; i++) {
		pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

	writeFileSync(join(dir, "sample.pdf"), pdf, "latin1");
	console.log("fixtures/sample.pdf written");
}

// ---------- XLSX workbook ----------
function makeXlsx() {
	const wb = XLSX.utils.book_new();
	const data = [
		["Item", "Qty", "Price", "Total"],
		["Notebook", 4, 2.5, 10],
		["Pen", 10, 1.2, 12],
		["Binder", 2, 4.75, 9.5],
		["Stapler", 1, 6.3, 6.3],
	];
	const ws = XLSX.utils.aoa_to_sheet(data);
	ws["!cols"] = [{ wpx: 120 }, { wpx: 60 }, { wpx: 80 }, { wpx: 80 }];
	XLSX.utils.book_append_sheet(wb, ws, "Inventory");
	const ws2 = XLSX.utils.aoa_to_sheet([
		["Region", "Sales"],
		["North", 412],
		["South", 335],
		["East", 278],
		["West", 501],
	]);
	XLSX.utils.book_append_sheet(wb, ws2, "Summary");
	XLSX.writeFile(wb, join(dir, "sample.xlsx"));
	console.log("fixtures/sample.xlsx written");
}

makePdf();
makeXlsx();
writeFileSync(
	join(dir, "sample.txt"),
	"Paperwren plain text fixture\n\nThe quick brown fox jumps over the lazy dog.\n",
);
writeFileSync(
	join(dir, "sample.csv"),
	"name,role,city\nAisha,student,Dhaka\nRavi,engineer,Pune\nMaya,owner,Lima\n",
);

// ---------- Hostile fixtures (docs/12 section 3) ----------

// Legacy Office files are OLE compound documents; the magic bytes
// are enough to exercise the honest-dialog path.
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
for (const ext of ["doc", "xls", "ppt"]) {
	writeFileSync(join(dir, `legacy.${ext}`), OLE_MAGIC);
}

// A corrupt PDF: valid header, broken structure.
writeFileSync(
	join(dir, "corrupt.pdf"),
	"%PDF-1.4\nthis file claims to be a pdf but the structure is garbage\n",
);

// An unsupported extension with real bytes.
writeFileSync(
	join(dir, "archive.xyz"),
	"just some bytes in a format Paperwren does not read\n",
);

console.log("legacy and hostile fixtures written");
