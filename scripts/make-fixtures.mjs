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

// ---------- Minimal DOCX (hand-built OOXML zip) ----------

function crc32(buf) {
	let table = crc32.table;
	if (!table) {
		table = crc32.table = new Int32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c;
		}
	}
	let crc = -1;
	for (let i = 0; i < buf.length; i++)
		crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
	return (crc ^ -1) >>> 0;
}

function buildZip(entries) {
	// entries: [name, content][], stored (no compression)
	const chunks = [];
	const central = [];
	let offset = 0;
	for (const [name, content] of entries) {
		const nameBuf = Buffer.from(name, "utf8");
		const data = Buffer.from(content, "utf8");
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0, 6); // flags
		local.writeUInt16LE(0, 8); // stored
		local.writeUInt16LE(0, 10); // time
		local.writeUInt16LE(0x5921, 12); // date
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		local.writeUInt16LE(0, 28);
		chunks.push(local, nameBuf, data);
		const cd = Buffer.alloc(46);
		cd.writeUInt32LE(0x02014b50, 0);
		cd.writeUInt16LE(20, 4);
		cd.writeUInt16LE(20, 6);
		cd.writeUInt16LE(0, 8);
		cd.writeUInt16LE(0, 10);
		cd.writeUInt16LE(0, 12);
		cd.writeUInt16LE(0x5921, 14);
		cd.writeUInt32LE(crc, 16);
		cd.writeUInt32LE(data.length, 20);
		cd.writeUInt32LE(data.length, 24);
		cd.writeUInt16LE(nameBuf.length, 28);
		cd.writeUInt32LE(offset, 42);
		central.push(Buffer.concat([cd, nameBuf]));
		offset += local.length + nameBuf.length + data.length;
	}
	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...chunks, centralBuf, end]);
}

function makeDocx() {
	const document =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
		'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Paperwren Word fixture</w:t></w:r></w:p>' +
		"<w:p><w:r><w:t>If you can read this, the DOCX reader works.</w:t></w:r></w:p>" +
		"<w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Bold and italic text renders too.</w:t></w:r></w:p>" +
		"</w:body></w:document>";
	const contentTypes =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
	const rels =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
	const zip = buildZip([
		["[Content_Types].xml", contentTypes],
		["_rels/.rels", rels],
		["word/document.xml", document],
	]);
	writeFileSync(join(dir, "sample.docx"), zip);
	console.log("fixtures/sample.docx written");
}

makePdf();
makeXlsx();
makeDocx();
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
