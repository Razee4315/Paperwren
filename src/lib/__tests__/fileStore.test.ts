import { describe, expect, it } from "vitest";
import {
	storedFileBytes,
	storedFileClear,
	storedFileGet,
	storedFilePut,
} from "../fileStore";

/** The store must degrade to a clean no-op where IndexedDB is
 * unavailable (jsdom, locked-down webviews): no throw, no bytes, no
 * file — the caller's in-memory path keeps working. */

describe("fileStore without IndexedDB", () => {
	it("put resolves without a store", async () => {
		await expect(
			storedFilePut("browser:a.pdf", new Blob(["%PDF-1.4"])),
		).resolves.toBeUndefined();
	});

	it("get resolves to null after a put", async () => {
		await storedFilePut("browser:a.pdf", new Blob(["%PDF-1.4"]));
		await expect(storedFileGet("browser:a.pdf")).resolves.toBeNull();
	});

	it("bytes reports zero", async () => {
		await expect(storedFileBytes()).resolves.toBe(0);
	});

	it("clear resolves", async () => {
		await expect(storedFileClear()).resolves.toBeUndefined();
	});
});
