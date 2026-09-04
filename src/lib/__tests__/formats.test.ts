import { validateFileName, validateFileSize } from "@/state/openFlow";
import { describe, expect, it } from "vitest";
import { formatBytes, guessFormat, idForSource } from "../backend";

describe("guessFormat", () => {
	it("recognises the four flagship formats", () => {
		expect(guessFormat("report.pdf")).toBe("pdf");
		expect(guessFormat("notes.docx")).toBe("docx");
		expect(guessFormat("budget.xlsx")).toBe("xlsx");
		expect(guessFormat("deck.pptx")).toBe("pptx");
	});

	it("covers the adjacent spreadsheet and text types", () => {
		expect(guessFormat("data.csv")).toBe("csv");
		expect(guessFormat("readme.md")).toBe("txt");
		expect(guessFormat("notes.txt")).toBe("txt");
		expect(guessFormat("book.xlsm")).toBe("xlsx");
	});

	it("is case-insensitive", () => {
		expect(guessFormat("REPORT.PDF")).toBe("pdf");
		expect(guessFormat("CV.Pdf")).toBe("pdf");
	});

	it("returns unknown for anything else", () => {
		expect(guessFormat("archive.xyz")).toBe("unknown");
		expect(guessFormat("noext")).toBe("unknown");
	});
});

describe("formatBytes", () => {
	it("formats bytes, kilobytes and megabytes", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
		expect(formatBytes(7.5 * 1024 * 1024)).toBe("7.5 MB");
	});
});

describe("idForSource", () => {
	it("is stable across calls", () => {
		expect(idForSource("/a/b.pdf")).toBe(idForSource("/a/b.pdf"));
	});
	it("differs between different files", () => {
		expect(idForSource("/a/b.pdf")).not.toBe(idForSource("/a/c.pdf"));
	});
});

describe("validateFileName (open-flow gate)", () => {
	it("rejects legacy Office formats with a migration hint", () => {
		for (const [ext, newExt] of [
			["doc", "docx"],
			["xls", "xlsx"],
			["ppt", "pptx"],
		]) {
			const err = validateFileName(`old.${ext}`);
			expect(err?.kind).toBe("legacy");
			if (err?.kind === "legacy") expect(err.newExt).toBe(newExt);
		}
	});

	it("rejects unknown types as unsupported", () => {
		expect(validateFileName("archive.xyz")?.kind).toBe("unsupported");
	});

	it("accepts everything the viewers read", () => {
		for (const name of [
			"a.pdf",
			"b.docx",
			"c.xlsx",
			"d.pptx",
			"e.csv",
			"f.txt",
			"g.md",
		]) {
			expect(validateFileName(name)).toBeNull();
		}
	});
});

describe("validateFileSize (open-flow gate)", () => {
	it("flags spreadsheets past 500 MB", () => {
		const err = validateFileSize("huge.xlsx", 501 * 1024 * 1024);
		expect(err?.kind).toBe("too-large");
	});

	it("flags presentations past 200 MB", () => {
		const err = validateFileSize("huge.pptx", 201 * 1024 * 1024);
		expect(err?.kind).toBe("too-large");
	});

	it("has no limit for pdf and small files pass everywhere", () => {
		expect(validateFileSize("a.pdf", 900 * 1024 * 1024)).toBeNull();
		expect(validateFileSize("small.xlsx", 1024)).toBeNull();
	});
});
