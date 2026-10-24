/**
 * Review evidence for src/lib/safeZip.ts on security/audit-hardening.
 *
 * "branch guard" tests assert the VULNERABLE behaviour: a pass here
 * means the bypass is confirmed against the branch's guardedUnzip.
 * "suggested fix" tests assert the same archives are refused by
 * review/safeZip.fixed.ts.
 */

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as branch from "../src/lib/safeZip";
import * as fixed from "./safeZip.fixed";
import { storedOverlap, zip64Count } from "./zipcraft";

const MiB = 1024 * 1024;
const total = (files: Record<string, Uint8Array>) =>
	Object.values(files).reduce((a, d) => a + d.length, 0);

describe("branch guard (a pass confirms the bypass)", () => {
	it("BYPASS: stored entries sharing one payload multiply memory past the claimed budget", () => {
		// ~1 MiB on disk, 300 MiB in memory, every entry accepted: each
		// copy claims 0 bytes, so the budget is never charged.
		const zip = storedOverlap(MiB, 300);
		expect(zip.length).toBeLessThan(1.1 * MiB);
		const files = branch.guardedUnzip(zip);
		expect(Object.keys(files).length).toBe(300);
		expect(total(files)).toBe(300 * MiB);
	});

	it("BYPASS: the budget is only enforced after the memory is spent", () => {
		// With a 16 MiB budget the guard does throw, but only from the
		// post-inflate sum, after 64 MiB was already allocated. At the
		// default 1 GiB budget and 8192 entries this is ~8 GiB per MiB of file.
		const zip = storedOverlap(MiB, 64);
		expect(() =>
			branch.guardedUnzip(zip, { limits: { maxBytes: 16 * MiB } }),
		).toThrow("archive unpacks to too much to hold");
	});

	it("BYPASS: a ZIP64 record smuggles in more entries than maxEntries", () => {
		// The pre-scan reads the classic end record (1 entry); fflate
		// follows the ZIP64 record (9000). Nothing refuses it.
		expect(() => branch.guardedUnzip(zip64Count(9000))).not.toThrow();
	});

	it("BYPASS: a ZIP64 entry count keeps the tab busy (measured, extrapolated)", () => {
		// 4,294,967,295 entries is a ~200-byte file. Measure 1,000,000
		// and report the extrapolated hang for the full count.
		const t = performance.now();
		branch.guardedUnzip(zip64Count(1_000_000));
		const ms = performance.now() - t;
		const hangMinutes = ((ms / 1_000_000) * 0xffffffff) / 60_000;
		console.log(
			`zip64Count(1e6) took ${ms.toFixed(0)} ms; 2^32-1 entries ≈ ${hangMinutes.toFixed(0)} min of a frozen tab`,
		);
		expect(hangMinutes).toBeGreaterThan(5);
	});
});

describe("branch guard, honest documents (a pass confirms the regression)", () => {
	it("REGRESSION: honest parts that compress past 200x are silently dropped", () => {
		// A blank 1000x1000 24-bit BMP (Office documents embed these) and
		// a repetitive stylesheet. Deflate's ceiling is ~1032x, so both
		// are real, honest entries; the guard drops them without a word.
		const bmp = new Uint8Array(54 + 3000 * 1000).fill(255);
		const css = strToU8("p{margin:0}\n".repeat(20_000));
		const zip = zipSync({
			"word/media/blank.bmp": bmp,
			"OEBPS/style.css": css,
			"OEBPS/ch1.xhtml": strToU8("<p>kept</p>"),
		});
		const files = branch.guardedUnzip(zip);
		expect(Object.keys(files)).toEqual(["OEBPS/ch1.xhtml"]);
	});
});

describe("suggested fix (review/safeZip.fixed.ts)", () => {
	it("charges stored entries what they really cost", () => {
		const files = fixed.guardedUnzip(storedOverlap(MiB, 300));
		// Each copy's sizes disagree (stored, size 1 MiB, claims 0): skipped.
		expect(total(files)).toBe(0);
	});

	it("keeps honest parts that compress past 200x", () => {
		const bmp = new Uint8Array(54 + 3000 * 1000).fill(255);
		const css = strToU8("p{margin:0}\n".repeat(20_000));
		const files = fixed.guardedUnzip(
			zipSync({ "word/media/blank.bmp": bmp, "OEBPS/style.css": css }),
		);
		expect(Object.keys(files).sort()).toEqual([
			"OEBPS/style.css",
			"word/media/blank.bmp",
		]);
	});

	it("refuses a ZIP64 record before walking it", () => {
		expect(() => fixed.guardedUnzip(zip64Count(9000))).toThrow(
			fixed.ZipTooLarge,
		);
		const t = performance.now();
		expect(() => fixed.guardedUnzip(zip64Count(0xffffffff))).toThrow(
			fixed.ZipTooLarge,
		);
		expect(performance.now() - t).toBeLessThan(1000);
	});
});
