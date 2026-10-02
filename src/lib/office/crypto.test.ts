import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { isEncryptedPackage, sniffFormat } from "../sniff";
import { decryptPackage } from "./crypto";

const read = (name: string) => new Uint8Array(readFileSync(`fixtures/${name}`));
const buffer = (b: Uint8Array) =>
	b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function lookup(bytes: Uint8Array) {
	const cfb = XLSX.CFB.read(bytes, { type: "array" });
	return (name: string): Uint8Array | null => {
		const entry = XLSX.CFB.find(cfb, name);
		return entry?.content ? Uint8Array.from(entry.content as number[]) : null;
	};
}

describe("password-protected Office files", () => {
	beforeAll(() => {
		// jsdom has no WebCrypto of its own; browsers and workers do.
		if (!globalThis.crypto?.subtle)
			Object.defineProperty(globalThis, "crypto", { value: webcrypto });
	});

	const cases: Array<[string, string, string]> = [
		["agile (Office 2010+)", "locked-agile.xlsx", "sample.xlsx"],
		["standard (Office 2007)", "locked-standard.docx", "sample.docx"],
	];

	it.each(cases)("%s: is recognised as protected", (_, locked, plain) => {
		const bytes = read(`viewer-regressions/${locked}`);
		expect(isEncryptedPackage(buffer(bytes))).toBe(true);
		// Until it is unlocked, nothing says what it is.
		expect(sniffFormat(buffer(bytes))).toBe("unknown");
		expect(isEncryptedPackage(buffer(read(plain)))).toBe(false);
	});

	it.each(cases)(
		"%s: the right password gives back the original file, byte for byte",
		async (_, locked, plain) => {
			const out = await decryptPackage(
				lookup(read(`viewer-regressions/${locked}`)),
				"wren",
			);
			const original = read(plain);
			expect(out.length).toBe(original.length);
			expect(Buffer.from(out).equals(Buffer.from(original))).toBe(true);
			expect(sniffFormat(buffer(Uint8Array.from(out)))).toBe(
				plain.endsWith("xlsx") ? "xlsx" : "docx",
			);
		},
	);

	it.each(cases)("%s: a wrong password is refused", async (_, locked) => {
		const streams = lookup(read(`viewer-regressions/${locked}`));
		await expect(decryptPackage(streams, "Wren")).rejects.toThrow("password");
		await expect(decryptPackage(streams, "")).rejects.toThrow("password");
	});

	it("says so when the scheme is one it does not read", async () => {
		// Extensible encryption: version 4.3.
		const info = Uint8Array.of(4, 0, 3, 0, 0, 0, 0, 0, 0, 0);
		const streams = (name: string) =>
			name === "EncryptionInfo" ? info : new Uint8Array(32);
		await expect(decryptPackage(streams, "wren")).rejects.toThrow(
			"unsupported encryption",
		);
	});

	it("ordinary OLE files are not mistaken for protected ones", () => {
		for (const name of ["sample.doc", "sample.xls", "sample.ppt"])
			expect(isEncryptedPackage(buffer(read(name)))).toBe(false);
	});
});
