// @vitest-environment node
import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";
import { compressToSize } from "../pdfCompress";
import { losslessPdf } from "../pdfLossless";
import { addMarkup } from "../pdfMarkup";
import {
	addPageNumbers,
	addTextLayer,
	addWatermark,
	buildPdf,
	compressPdf,
	cropCopy,
	fillAndSign,
	pdfInfo,
	pdfProtection,
	protect,
	unlock,
} from "../pdfTools";
import { copyNote } from "../protection";

/**
 * Every tool opens a protected PDF with its password and saves a new
 * file. None of them carries the protection over, and the screens say so
 * (see protection.ts). These tests record which tools those are, so a
 * tool that starts to keep protection, or a new one that drops it, is
 * noticed.
 */

const locked = () =>
	new Uint8Array(readFileSync("fixtures/viewer-regressions/locked.pdf"));
const limited = () =>
	new Uint8Array(readFileSync("fixtures/features/nocopy.pdf"));
const plain = () => new Uint8Array(readFileSync("fixtures/sample.pdf"));

/** The file has an encryption dictionary: readers ask for a password or
 * keep to its limits. */
const encrypted = (bytes: Uint8Array) =>
	Buffer.from(bytes).includes("/Encrypt");

/** Opens in a reader with no password at all. */
async function opensWithoutPassword(bytes: Uint8Array) {
	try {
		await PDFDocument.load(bytes);
		return true;
	} catch {
		return false;
	}
}

const noPicture = async () => {
	throw new Error("none");
};

/** Each tool, run on a file with the password it needs. */
const TOOLS: Array<
	[string, (bytes: Uint8Array, password?: string) => Promise<Uint8Array>]
> = [
	[
		"merge, split, extract and organize",
		(bytes, password) =>
			buildPdf([{ bytes, password }], [{ file: 0, page: 0 }]),
	],
	["crop a copy", (bytes, password) => cropCopy(bytes, [null], { password })],
	["page numbers", (bytes, password) => addPageNumbers(bytes, { password })],
	[
		"watermark",
		(bytes, password) => addWatermark(bytes, { text: "DRAFT", password }),
	],
	[
		"fill and sign",
		(bytes, password) => fillAndSign(bytes, { password, flatten: false }),
	],
	[
		"mark up",
		(bytes, password) =>
			addMarkup(bytes, {
				password,
				marks: [{ kind: "note", page: 0, x: 0.2, y: 0.2, text: "Hello" }],
			}),
	],
	[
		"compress",
		(bytes, password) => compressPdf(bytes, noPicture, { password }),
	],
	[
		"compress without changing a picture",
		(bytes, password) => losslessPdf(bytes, { password }),
	],
	[
		"compress to a size",
		async (bytes, password) => {
			// A size just under the file's, so the tool has work to do.
			const fitted = await compressToSize(
				bytes,
				{ aim: bytes.length - 1, most: bytes.length - 1 },
				() => noPicture,
				{ password },
			);
			if (fitted.kind !== "made") throw new Error(fitted.kind);
			return fitted.bytes;
		},
	],
	[
		"read text, as a searchable PDF",
		(bytes, password) =>
			addTextLayer(
				bytes,
				[
					{
						page: 0,
						words: [
							{ text: "word", x: 0.1, y: 0.1, w: 0.2, h: 0.04, rtl: false },
						],
					},
				],
				{ password },
			),
	],
	["remove a password", (bytes, password) => unlock(bytes, password ?? "")],
];

describe("what protection a saved copy keeps", () => {
	it("starts from files that are protected", () => {
		expect(encrypted(locked())).toBe(true);
		expect(encrypted(limited())).toBe(true);
		expect(encrypted(plain())).toBe(false);
	});

	it("knows a file's protection when it is opened", async () => {
		expect(await pdfInfo(locked(), "wren")).toEqual({
			pages: 2,
			protected: true,
		});
		expect((await pdfInfo(limited())).protected).toBe(true);
		expect((await pdfInfo(plain())).protected).toBe(false);
		expect(pdfProtection({ password: "wren", protected: true })).toBe(
			"password",
		);
		expect(pdfProtection({ protected: true })).toBe("limits");
		expect(pdfProtection({ protected: false })).toBeNull();
	});

	it.each(TOOLS)(
		"%s: the copy of a locked PDF opens without a password",
		async (_, make) => {
			const out = await make(locked(), "wren");
			expect(encrypted(out)).toBe(false);
			expect(await opensWithoutPassword(out)).toBe(true);
		},
	);

	it.each(TOOLS)(
		"%s: the copy of a PDF with limits has none",
		async (_, make) => {
			const out = await make(limited());
			expect(encrypted(out)).toBe(false);
		},
	);

	it("add a password is the one that locks a copy", async () => {
		const out = await protect(plain(), "pw");
		expect(encrypted(out)).toBe(true);
		expect(await opensWithoutPassword(out)).toBe(false);
		// Opened with its password, and locked again with a new one.
		const again = await protect(locked(), "new", { password: "wren" });
		expect(await opensWithoutPassword(again)).toBe(false);
	});
});

describe("what the reader is told", () => {
	it("says it once, the same way, and only for a protected file", () => {
		expect(copyNote(null)).toBeNull();
		expect(copyNote(undefined)).toBeNull();
		expect(copyNote("password")).toBe(
			"The copy will open without a password. To lock it again, use Add a password.",
		);
		expect(copyNote("limits")).toBe(
			"This PDF limits what a reader may do, such as copying. The copy will have no limits.",
		);
	});
});
