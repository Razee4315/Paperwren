import type { DigitalIdSummary } from "@/lib/sign";
import { describe, expect, it } from "vitest";
import {
	blockerMessage,
	certificateDate,
	certificateWarnings,
	issuerLine,
	problemMessage,
	signatureCaption,
	signerLines,
	validLine,
	validity,
} from "./certificate";

const summary = (more: Partial<DigitalIdSummary> = {}): DigitalIdSummary => ({
	unprotected: false,
	name: "Test Signer rsa",
	organisation: "Paperwren Tests",
	email: "signer@example.invalid",
	issuer: "Paperwren Test CA",
	selfSigned: false,
	validFrom: new Date("2025-01-01T00:00:00Z"),
	validUntil: new Date("2045-01-01T00:00:00Z"),
	notForSigning: false,
	key: "RSA",
	bits: 2048,
	...more,
});

const day = (text: string) => new Date(`${text}T12:00:00Z`);

describe("a certificate's dates", () => {
	it("is valid from its first day to its last", () => {
		expect(validity(summary(), day("2026-11-14"))).toBe("valid");
		expect(validity(summary(), day("2024-12-31"))).toBe("not-yet");
		expect(validity(summary(), day("2045-01-02"))).toBe("expired");
	});

	it("says both days the reader's way", () => {
		expect(validLine(summary())).toBe(
			`Valid from ${certificateDate(summary().validFrom)} to ${certificateDate(summary().validUntil)}`,
		);
		expect(certificateDate(day("2026-11-14"))).toMatch(/2026/);
	});
});

describe("what is said before signing", () => {
	it("warns plainly when the digital ID had no integrity check", () => {
		expect(
			certificateWarnings(summary({ unprotected: true }), day("2026-11-14")),
		).toEqual([
			"This file has no integrity check, so it can't be told whether it was changed.",
		]);
	});
	it("names who signs, leaving out what the certificate doesn't give", () => {
		expect(signerLines(summary())).toEqual([
			"Test Signer rsa",
			"Paperwren Tests",
			"signer@example.invalid",
		]);
		expect(
			signerLines(summary({ organisation: undefined, email: " " })),
		).toEqual(["Test Signer rsa"]);
	});

	it("names the issuer, or says its owner made it", () => {
		expect(issuerLine(summary())).toBe("Paperwren Test CA");
		expect(issuerLine(summary({ issuerOrganisation: "Paperwren Tests" }))).toBe(
			"Paperwren Test CA, Paperwren Tests",
		);
		expect(
			issuerLine(summary({ issuer: "Acme", issuerOrganisation: "Acme" })),
		).toBe("Acme");
		expect(issuerLine(summary({ selfSigned: true }))).toBe(
			"Made by its owner (self-signed)",
		);
	});

	it("warns of an expired or early certificate, and one not meant for signing", () => {
		expect(certificateWarnings(summary(), day("2026-11-14"))).toEqual([]);
		const [late] = certificateWarnings(summary(), day("2046-01-01"));
		expect(late).toMatch(/^This certificate expired on .*2045/);
		const [early] = certificateWarnings(summary(), day("2024-06-01"));
		expect(early).toMatch(/^This certificate isn't valid until .*2025/);
		expect(
			certificateWarnings(summary({ notForSigning: true }), day("2046-01-01")),
		).toHaveLength(2);
		expect(
			certificateWarnings(summary({ notForSigning: true }), day("2026-11-14")),
		).toEqual([
			"This certificate isn't meant for signing documents. Readers may not accept the signature.",
		]);
	});
});

describe("why it can't sign", () => {
	it("says each of the reader's problems plainly", () => {
		expect(problemMessage("password")).toBe(
			"That password didn't work. Try again.",
		);
		expect(problemMessage("not-digital-id")).toBe(
			"This file isn't a digital ID.",
		);
		expect(problemMessage("unsupported")).toMatch(/AES-256 or TripleDES/);
		expect(problemMessage("no-key")).toMatch(/no private key/);
		expect(problemMessage("key-type")).toMatch(/RSA and ECDSA/);
		expect(problemMessage("mismatch")).toBe(
			"The key and the certificate in this file don't belong together.",
		);
	});

	it("takes anything else for a file that isn't a digital ID", () => {
		expect(problemMessage(undefined)).toBe("This file isn't a digital ID.");
		expect(problemMessage("toString")).toBe("This file isn't a digital ID.");
	});

	it("says why the PDF itself can't be signed", () => {
		expect(blockerMessage("encrypted")).toMatch(/\(Remove a password\)/);
		expect(blockerMessage("certified")).toMatch(/certified by its author/);
		expect(blockerMessage("damaged")).toMatch(/structure is damaged/);
	});
});

describe("the caption", () => {
	it("says who signed, then when", () => {
		const [who, when] = signatureCaption("Ayesha Khan", day("2026-11-14"));
		expect(who).toBe("Digitally signed by Ayesha Khan");
		expect(when).toMatch(/2026/);
	});
});
