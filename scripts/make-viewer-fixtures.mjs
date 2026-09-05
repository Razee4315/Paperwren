/**
 * Generates the viewer-regression fixture corpus
 * (docs/14 audit section 9) under fixtures/viewer-regressions/.
 * These fixtures are dedicated to automated regression tests and are
 * regenerated on demand; never put user documents here.
 * Run: node scripts/make-viewer-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "fixtures", "viewer-regressions");
mkdirSync(dir, { recursive: true });

// ---------- XLSX: unequal column widths, wide sparse range ----------
// Drives the header/cell alignment regression (XLS-01): header and
// body edges must agree at many horizontal offsets, including after
// a column resize, so widths must be unequal and content must reach
// far to the right.

// ---------- DOCX: narrow page whose fit scale is exactly 1 ----------
// DOC-01 acceptance: a document that fits at 100% must reach the
// ready state; loading must never be inferred from fitZoom === 1.
// 380 CSS px wide page -> (412 - 32) / 380 = 1.0 exactly.
// Word page width is measured in twips: 1 CSS px = 15 twips.
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
	const chunks = [];
	const central = [];
	let offset = 0;
	for (const [name, content] of entries) {
		const nameBuf = Buffer.from(name, "utf8");
		const data = Buffer.from(content, "utf8");
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		chunks.push(local, nameBuf, data);
		const cd = Buffer.alloc(46);
		cd.writeUInt32LE(0x02014b50, 0);
		cd.writeUInt16LE(20, 4);
		cd.writeUInt16LE(20, 6);
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

function makeNarrowDocx() {
	const documentXml =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
		"<w:p><w:r><w:t>Narrow page fits at exactly 100 percent.</w:t></w:r></w:p>" +
		"<w:p><w:r><w:t>If the loading note is gone, readiness no longer depends on fitZoom.</w:t></w:r></w:p>" +
		'<w:sectPr><w:pgSz w:w="5700" w:h="7200"/></w:sectPr>' +
		"</w:body></w:document>";
	const contentTypes =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
	const rels =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
	const zip = buildZip([
		["[Content_Types].xml", contentTypes],
		["_rels/.rels", rels],
		["word/document.xml", documentXml],
	]);
	writeFileSync(join(dir, "narrow-fit.docx"), zip);
	console.log("fixtures/viewer-regressions/narrow-fit.docx written");
}

function makeGridAlignXlsx() {
	const wb = XLSX.utils.book_new();
	const widths = [72, 140, 61, 220, 96, 48, 180, 96, 133, 250, 96, 96];
	const rows = 40;
	const data = [];
	for (let r = 0; r < rows; r++) {
		const row = [];
		for (let c = 0; c < widths.length; c++) {
			row.push(`R${r + 1}C${c + 1}`);
		}
		data.push(row);
	}
	const ws = XLSX.utils.aoa_to_sheet(data);
	ws["!cols"] = widths.map((wpx) => ({ wpx }));
	XLSX.utils.book_append_sheet(wb, ws, "Align");
	XLSX.writeFile(wb, join(dir, "grid-align.xlsx"));
	console.log("fixtures/viewer-regressions/grid-align.xlsx written");
}

// ---------- XLSX: merges (slice 5) ----------
function makeMergeXlsx() {
	const wb = XLSX.utils.book_new();
	const ws = XLSX.utils.aoa_to_sheet([
		["Quarterly report", "", "", ""],
		["", "", "", ""],
		["Region", "Q1", "Q2", "Total"],
		["North", 10, 20, 30],
		["South", 5, 15, 20],
	]);
	ws["!cols"] = [{ wpx: 120 }, { wpx: 90 }, { wpx: 90 }, { wpx: 90 }];
	ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
	XLSX.utils.book_append_sheet(wb, ws, "Merges");
	XLSX.writeFile(wb, join(dir, "merges.xlsx"));
	console.log("fixtures/viewer-regressions/merges.xlsx written");
}

// ---------- PDF: one 1200x800pt page (fit scale far below 0.5) ----------
// PDF-02 acceptance: converting fit -> manual must preserve the
// honest fit scale (~0.317 in a 380px reading area), not clamp it.
function makeWidePdf() {
	const objects = [];
	objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
	objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
	objects[3] =
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>";
	objects[4] = {
		stream:
			"BT /F1 24 Tf 60 700 Td (Wide page: fit scale stays honest below 0.5) Tj ET\n",
	};
	objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

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
	writeFileSync(join(dir, "wide-fit.pdf"), pdf, "latin1");
	console.log("fixtures/viewer-regressions/wide-fit.pdf written");
}

const manifest = {
	"grid-align.xlsx": {
		tests:
			"XLS-01/XLS-02 header/cell edge alignment at multiple scroll offsets, unequal widths, column resize",
	},
	"merges.xlsx": {
		tests:
			"XLS-03 merged rectangle rendering (single anchor cell spanning the range)",
	},
	"narrow-fit.docx": {
		tests: "DOC-01 readiness at exactly 100% fit; DOC-02 manual zoom controls",
	},
	"wide-fit.pdf": {
		tests:
			"PDF-02 fit -> manual conversion preserves a fit scale far below 0.5",
	},
};
writeFileSync(
	join(dir, "manifest.json"),
	`${JSON.stringify(manifest, null, 2)}\n`,
);
console.log("fixtures/viewer-regressions/manifest.json written");

makeGridAlignXlsx();
makeMergeXlsx();
makeNarrowDocx();
makeWidePdf();
