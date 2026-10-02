import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	formatFromName,
	isLargeFile,
	kindOf,
	largeFileLimit,
	sniffFormat,
} from "../formats";

const fixture = (name: string) => {
	const b = readFileSync(`fixtures/${name}`);
	return b.buffer.slice(
		b.byteOffset,
		b.byteOffset + b.byteLength,
	) as ArrayBuffer;
};

describe("sniffFormat", () => {
	it.each([
		["sample.pdf", "pdf"],
		["sample.docx", "docx"],
		["sample.xlsx", "xlsx"],
		["sample.pptx", "pptx"],
		["sample.doc", "doc"],
		["sample.xls", "xls"],
		["sample.ppt", "ppt"],
		["sample.odt", "odt"],
		["sample.ods", "ods"],
		["sample.odp", "odp"],
		["sample.rtf", "rtf"],
		["sample.txt", "txt"],
		["sample.csv", "csv"],
	])("%s is %s even without a name", (file, expected) => {
		const hint = expected === "csv" ? file : "";
		expect(sniffFormat(fixture(file), hint)).toBe(expected);
	});

	it("ignores a lying extension", () => {
		expect(sniffFormat(fixture("sample.pdf"), "photo.docx")).toBe("pdf");
	});

	it("rejects binary junk and damaged containers", () => {
		expect(sniffFormat(new Uint8Array([0, 1, 2, 3, 250, 0]).buffer)).toBe(
			"unknown",
		);
		expect(sniffFormat(fixture("archive.xyz"))).not.toBe("pdf");
	});

	it("treats UTF-16 text as text", () => {
		const bytes = new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]);
		expect(sniffFormat(bytes.buffer)).toBe("txt");
	});

	it("uses the name only to refine text", () => {
		const text = new TextEncoder().encode("# Title\n").buffer as ArrayBuffer;
		expect(sniffFormat(text, "notes.md")).toBe("md");
		expect(sniffFormat(text, "")).toBe("txt");
	});
});

describe("formatFromName / kindOf", () => {
	it("maps extensions case-insensitively", () => {
		expect(formatFromName("Report.PDF")).toBe("pdf");
		expect(formatFromName("a.tar.gz")).toBe("unknown");
		expect(formatFromName("noext")).toBe("unknown");
	});
	it("groups formats into families", () => {
		expect(kindOf("doc")).toBe("doc");
		expect(kindOf("ods")).toBe("sheet");
		expect(kindOf("ppt")).toBe("slides");
		expect(kindOf("md")).toBe("text");
	});
});

import { friendlyName, isOpaqueName } from "../formats";

describe("friendlyName", () => {
	it("never shows a provider id", () => {
		expect(isOpaqueName("1234")).toBe(true);
		expect(isOpaqueName("msf:1234")).toBe(true);
		expect(isOpaqueName("document%3A5521")).toBe(true);
		expect(isOpaqueName("Tax return 2026.pdf")).toBe(false);
		expect(friendlyName("msf:1234", "pdf")).toBe("PDF document.pdf");
		expect(friendlyName("1234", "xlsx")).toBe("Spreadsheet.xlsx");
		expect(friendlyName("Budget", "xlsx")).toBe("Budget.xlsx");
		expect(friendlyName("Report.docx", "docx")).toBe("Report.docx");
	});
});

import { strToU8, zipSync } from "fflate";
import { ooxmlFamily } from "../formats";

describe("Office packages with embedded parts", () => {
	const OOXML = "application/vnd.openxmlformats-officedocument";
	const types = (...parts: string[]) =>
		`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${parts.join("")}</Types>`;
	const xlsxDefault = `<Default Extension="xlsx" ContentType="${OOXML}.spreadsheetml.sheet"/>`;
	const docxDefault = `<Default Extension="docx" ContentType="${OOXML}.wordprocessingml.document"/>`;

	it("a deck with a chart's embedded workbook is still a deck", () => {
		const xml = types(
			xlsxDefault,
			docxDefault,
			`<Override PartName="/ppt/presentation.xml" ContentType="${OOXML}.presentationml.presentation.main+xml"/>`,
		);
		expect(ooxmlFamily(xml)).toBe("pptx");
		const zip = zipSync({ "[Content_Types].xml": strToU8(xml) });
		expect(sniffFormat(zip.buffer as ArrayBuffer, "1234")).toBe("pptx");
	});

	it("a workbook or document embedding other files keeps its family", () => {
		expect(
			ooxmlFamily(
				types(
					docxDefault,
					`<Default Extension="pptx" ContentType="${OOXML}.presentationml.presentation"/>`,
					`<Override PartName="/xl/workbook.xml" ContentType="${OOXML}.spreadsheetml.sheet.main+xml"/>`,
				),
			),
		).toBe("xlsx");
		expect(
			ooxmlFamily(
				types(
					xlsxDefault,
					`<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>`,
				),
			),
		).toBe("docx");
	});

	it("recognises slide shows, templates and macro decks", () => {
		for (const t of [
			`${OOXML}.presentationml.slideshow.main+xml`,
			`${OOXML}.presentationml.template.main+xml`,
			"application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml",
		])
			expect(
				ooxmlFamily(
					types(
						xlsxDefault,
						`<Override PartName="/ppt/presentation.xml" ContentType="${t}"/>`,
					),
				),
			).toBe("pptx");
	});

	it("falls back to the main part's name, then to any mention", () => {
		expect(
			ooxmlFamily(
				types(
					xlsxDefault,
					`<Override PartName="/ppt/presentation.xml" ContentType="application/xml"/>`,
				),
			),
		).toBe("pptx");
		expect(ooxmlFamily(types(xlsxDefault))).toBe("xlsx");
		expect(ooxmlFamily(types())).toBe("unknown");
	});
});

describe("large files", () => {
	const MB = 1024 * 1024;
	it("allows a PDF far more room than an Office file", () => {
		expect(largeFileLimit("pdf")).toBeGreaterThan(largeFileLimit("xlsx"));
		expect(isLargeFile("scan.pdf", 150 * MB)).toBe(false);
		expect(isLargeFile("scan.pdf", 201 * MB)).toBe(true);
		expect(isLargeFile("ledger.xlsx", 39 * MB)).toBe(false);
		expect(isLargeFile("ledger.XLSX", 41 * MB)).toBe(true);
		expect(isLargeFile("photo.jpg", 61 * MB)).toBe(true);
	});
	it("never calls an unknown size large", () => {
		expect(isLargeFile("ledger.xlsx", 0)).toBe(false);
		expect(isLargeFile("no-extension", 99 * MB)).toBe(false);
		expect(isLargeFile("no-extension", 101 * MB)).toBe(true);
	});
});
