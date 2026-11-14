// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { certificate } from "../sign/certificate";
import { der, octet, oid, read, seq, sequence, set } from "../sign/der";
import { readPkcs12 } from "../sign/pkcs12";
import { certificateSummary, validityAt } from "../sign/x509";

const fixture = (name: string) =>
	Uint8Array.from(readFileSync(`fixtures/digital-id/${name}`));
const pem = () =>
	Uint8Array.from(
		Buffer.from(
			readFileSync("fixtures/digital-id/rsa.pem", "utf8").replace(
				/-----[^-]+-----|\s/g,
				"",
			),
			"base64",
		),
	);
const summary = (cert: Uint8Array) =>
	certificateSummary({ chain: [cert], kind: "RSA", bits: 2048 });

function changed(
	subject?: Uint8Array,
	extensions?: Uint8Array,
	validity?: Uint8Array,
) {
	const outer = sequence(read(pem()));
	const tbs = sequence(outer[0]).map((node) => node.raw);
	if (subject) tbs[5] = subject;
	if (validity) tbs[4] = validity;
	if (extensions) tbs[tbs.length - 1] = der(163, extensions);
	return seq(seq(...tbs), outer[1].raw, outer[2].raw);
}

describe("digital ID certificate summaries", () => {
	it("uses the first common name and removes controls and bidi formatting", () => {
		const unsafe =
			"\u0000\u000a\u001f\u007f\u0085\u009f\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069";
		const attr = (id: string, value: string) =>
			set(seq(oid(id), der(12, new TextEncoder().encode(value))));
		const name = seq(
			attr("2.5.4.3", `First${unsafe} Signer`),
			attr("2.5.4.3", "Second Signer"),
			attr("2.5.4.10", `Org${unsafe}`),
		);
		const outer = sequence(read(changed(name)));
		const tbs = sequence(outer[0]).map((part) => part.raw);
		tbs[3] = name;
		const result = summary(seq(seq(...tbs), outer[1].raw, outer[2].raw));
		expect(result.name).toBe("First Signer");
		expect(result.issuer).toBe("First Signer");
		expect(result.organisation).toBe("Org");
		const san = seq(
			seq(
				oid("2.5.29.17"),
				octet(
					seq(
						der(
							129,
							new TextEncoder().encode(`signer${unsafe}@example.invalid`),
						),
					),
				),
			),
		);
		expect(summary(changed(name, san)).email).toBe("signer@example.invalid");
	});
	it("reads the signer, SAN email, issuer and fixed validity interval", async () => {
		const id = await readPkcs12(fixture("rsa-aes256.p12"), "wren");
		const value = certificateSummary(id);
		expect(value).toMatchObject({
			name: "Test Signer rsa",
			organisation: "Paperwren Tests",
			email: "signer@example.invalid",
			issuer: "Paperwren Test Issuer",
			issuerOrganisation: "Paperwren Tests",
			selfSigned: false,
			notForSigning: false,
			key: "RSA",
			bits: 2048,
		});
		expect(value.validFrom.toISOString()).toBe("2025-01-01T00:00:00.000Z");
		expect(value.validUntil.toISOString()).toBe("2045-01-01T00:00:00.000Z");
		expect(validityAt(value, new Date("2024-12-31"))).toBe("not-yet-valid");
		expect(validityAt(value, new Date("2026-11-14"))).toBeUndefined();
		expect(validityAt(value, new Date("2046-01-01"))).toBe("expired");
	});
	it.each([
		["p256.p12", "P-256", 256],
		["p384.p12", "P-384", 384],
		["p521.p12", "P-521", 521],
		["rsa4096.p12", "RSA", 4096],
	] as const)("describes %s", async (file, key, bits) => {
		expect(
			certificateSummary(await readPkcs12(fixture(file), "wren")),
		).toMatchObject({ key, bits });
	});
	it("recognises self-issued and actually expired fixtures", async () => {
		expect(
			certificateSummary(await readPkcs12(fixture("self-signed.p12"), "wren")),
		).toMatchObject({ name: "Self Signed Tester", selfSigned: true });
		expect(
			validityAt(
				certificateSummary(await readPkcs12(fixture("expired.p12"), "wren")),
				new Date("2026-11-14"),
			),
		).toBe("expired");
	});
	it("reads UTF-8 and BMP names, and falls back to the email attribute", () => {
		for (const [tag, value] of [
			[12, new TextEncoder().encode("Émilie 鳥")],
			[30, Uint8Array.of(0, 201, 0, 109, 0, 105, 0, 108, 0, 105, 0, 101)],
		] as const) {
			const name = seq(
				set(seq(oid("2.5.4.3"), der(tag, value))),
				set(
					seq(
						oid("1.2.840.113549.1.9.1"),
						der(22, new TextEncoder().encode("old@example.invalid")),
					),
				),
			);
			const result = summary(changed(name, seq()));
			expect(result.name).toBe(tag === 12 ? "Émilie 鳥" : "Émilie");
			expect(result.email).toBe("old@example.invalid");
		}
	});
	it("warns about restrictive key usages and accepts the documented signing purposes", () => {
		const usage = (bits: number) =>
			seq(oid("2.5.29.15"), octet(der(3, Uint8Array.of(0, bits))));
		const eku = (purpose: string) =>
			seq(oid("2.5.29.37"), octet(seq(oid(purpose))));
		expect(summary(changed(undefined, seq(usage(32)))).notForSigning).toBe(
			true,
		);
		expect(
			summary(changed(undefined, seq(eku("1.3.6.1.5.5.7.3.1")))).notForSigning,
		).toBe(true);
		for (const purpose of [
			"2.5.29.37.0",
			"1.3.6.1.5.5.7.3.4",
			"1.3.6.1.5.5.7.3.36",
			"1.2.840.113583.1.1.5",
			"1.3.6.1.4.1.311.10.3.12",
			"1.3.6.1.5.5.7.3.2",
		])
			expect(
				summary(changed(undefined, seq(usage(64), eku(purpose)))).notForSigning,
			).toBe(false);
		expect(summary(changed(undefined, seq())).notForSigning).toBe(false);
	});
	it("reads GeneralizedTime and rejects invalid calendar dates", () => {
		const utc = (value: string) => der(24, new TextEncoder().encode(value));
		expect(
			summary(
				changed(
					undefined,
					undefined,
					seq(utc("20500101000000Z"), utc("20600101000000Z")),
				),
			).validFrom.getUTCFullYear(),
		).toBe(2050);
		expect(() =>
			summary(
				changed(
					undefined,
					undefined,
					seq(utc("20500231000000Z"), utc("20600101000000Z")),
				),
			),
		).toThrow("certificate");
		expect(certificate(pem()).ca).toBe(false);
	});
});
