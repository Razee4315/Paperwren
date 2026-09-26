import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatFromName, kindOf, sniffFormat } from "../formats";

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
