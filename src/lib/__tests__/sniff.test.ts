import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { displayNameFor, isLegacyOffice, sniffFormat } from "../sniff";

function bytesOf(s: string): ArrayBuffer {
	const arr = new TextEncoder().encode(s);
	const buf = new ArrayBuffer(arr.length);
	new Uint8Array(buf).set(arr);
	return buf;
}

// Realistic OOXML packages: deflate-compressed zips whose content
// types declare the family (the plaintext scan cannot see these).
function ooxml(family: string): ArrayBuffer {
	const zip = zipSync(
		{
			"[Content_Types].xml": strToU8(
				`<?xml xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Types><Override PartName="/word/document.xml" ContentType="application/${family}"/></Types>`,
			),
			"word/document.xml": strToU8("<doc/>"),
		},
		{ level: 6 },
	);
	return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}

const PDF = bytesOf("%PDF-1.7\n%");
const OLE = new ArrayBuffer(8);
new Uint8Array(OLE).set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

describe("sniffFormat", () => {
	it("sniffs PDF by magic bytes even with a lying name", () => {
		expect(sniffFormat(PDF, "1284")).toBe("pdf");
		expect(sniffFormat(PDF, "photo.xlsx")).toBe("pdf");
	});

	it("separates the three OOXML families through real deflate zips", () => {
		expect(sniffFormat(ooxml("wordprocessingml.document"), "1284")).toBe(
			"docx",
		);
		expect(sniffFormat(ooxml("spreadsheetml.sheet"), "1284")).toBe("xlsx");
		expect(sniffFormat(ooxml("presentationml.presentation"), "1284")).toBe(
			"pptx",
		);
	});

	it("treats a zip with no Office marker as unknown", () => {
		const zip = zipSync({ "a.txt": strToU8("hello") });
		expect(
			sniffFormat(
				zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
				"f.zip",
			),
		).toBe("unknown");
	});

	it("falls back to the extension for text formats without magic", () => {
		expect(sniffFormat(bytesOf("name,city\nAisha,Dhaka"), "1284")).toBe("txt");
		expect(sniffFormat(bytesOf("plain text"), "notes.txt")).toBe("txt");
		expect(sniffFormat(bytesOf("# Title"), "readme.md")).toBe("txt");
	});

	it("prefers bytes over a claiming extension (truncated files)", () => {
		expect(sniffFormat(bytesOf("garbage"), "truncated.pdf")).toBe("unknown");
	});

	it("calls pre-2007 OLE unknown (the legacy dialog handles it)", () => {
		expect(sniffFormat(OLE, "old.doc")).toBe("unknown");
	});

	it("detects pre-2007 OLE for the legacy dialog", () => {
		expect(isLegacyOffice(OLE)).toBe(true);
		expect(isLegacyOffice(PDF)).toBe(false);
	});
});

describe("displayNameFor", () => {
	it("keeps a real filename", () => {
		expect(displayNameFor("cv.pdf", "pdf")).toBe("cv.pdf");
	});

	it("gives extension-less content URIs a friendly label", () => {
		expect(displayNameFor("1284", "pdf")).toBe("Document.pdf");
		expect(displayNameFor("1284", "xlsx")).toBe("Spreadsheet.xlsx");
		expect(displayNameFor("", "unknown")).toBe("File");
	});
});
