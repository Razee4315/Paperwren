// @vitest-environment node
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { certificate } from "../sign/certificate";
import { createCms, ecdsaDer, ecdsaRaw, verifyCms } from "../sign/cms";
import { compare, der, objectId, read, sequence } from "../sign/der";
import { OID } from "../sign/oids";
import { readPkcs12 } from "../sign/pkcs12";

describe("PAdES baseline CMS", () => {
	it.each([
		"rsa-aes256.p12",
		"rsa4096.p12",
		"p256.p12",
		"p384.p12",
		"p521.p12",
	])("signs with %s and verifies independently", async (file) => {
		const id = await readPkcs12(
			Uint8Array.from(readFileSync(`fixtures/digital-id/${file}`)),
			"wren",
		);
		const digest = Uint8Array.from(
			createHash(id.hash.replace("-", "")).update("PDF byte ranges").digest(),
		);
		const cms = await createCms(digest, id);
		const content = sequence(read(cms));
		expect(objectId(content[0])).toBe(OID.signedData);
		const signed = sequence(content[1].children[0]);
		expect(sequence(signed[2])).toHaveLength(1);
		const signer = sequence(signed[4].children[0]);
		expect(signer[3].tag).toBe(160);
		const attrs = signer[3].children;
		expect(attrs.map((attr) => objectId(sequence(attr)[0])).sort()).toEqual(
			[OID.contentType, OID.messageDigest, OID.signingCertificateV2].sort(),
		);
		expect(attrs.map((attr) => attr.raw)).toEqual(
			attrs.map((attr) => attr.raw).sort(compare),
		);
		expect(signed[3].children.map((cert) => cert.raw)).toEqual(
			signed[3].children.map((cert) => cert.raw).sort(compare),
		);
		const value = (name: string) =>
			sequence(attrs.find((attr) => objectId(sequence(attr)[0]) === name))[1]
				.children[0];
		expect(objectId(value(OID.contentType))).toBe(OID.data);
		expect(value(OID.messageDigest).value).toEqual(digest);
		const ess = sequence(
			sequence(value(OID.signingCertificateV2))[0].children[0],
		);
		const hashAt = id.hash === "SHA-256" ? 0 : 1;
		expect(ess[hashAt].value).toEqual(
			Uint8Array.from(
				createHash(id.hash.replace("-", "")).update(id.chain[0]).digest(),
			),
		);
		if (hashAt) expect(ess[0].tag).toBe(48);
		const sid = sequence(signer[1]);
		expect(sid[0].raw).toEqual(certificate(id.chain[0]).issuer.raw);
		expect(sid[1].raw).toEqual(certificate(id.chain[0]).serial.raw);
		const pub = createPublicKey({
			key: Buffer.from(certificate(id.chain[0]).spki.raw),
			type: "spki",
			format: "der",
		});
		expect(
			verify(
				id.hash.replace("-", ""),
				der(49, signer[3].value),
				pub,
				signer[5].value,
			),
		).toBe(true);
		expect(
			verify(id.hash.replace("-", ""), signer[3].raw, pub, signer[5].value),
		).toBe(false);
		expect(await verifyCms(cms, digest, id)).toBe(true);
		digest[0] ^= 1;
		expect(await verifyCms(cms, digest, id)).toBe(false);
		digest[0] ^= 1;
		cms[cms.length - 1] ^= 1;
		expect(await verifyCms(cms, digest, id)).toBe(false);
	});
	it("encodes ECDSA integers minimally and restores fixed-width coordinates", () => {
		const raw = Uint8Array.of(0, 128, 0, 1);
		expect(ecdsaDer(raw)).toEqual(Uint8Array.of(48, 7, 2, 2, 0, 128, 2, 1, 1));
		expect(ecdsaRaw(ecdsaDer(raw), 2)).toEqual(raw);
		expect(() => ecdsaDer(Uint8Array.of(1))).toThrow();
	});
	it("refuses a signing key paired with a different certificate", async () => {
		const load = async (name: string) =>
			readPkcs12(
				Uint8Array.from(readFileSync(`fixtures/digital-id/${name}`)),
				"wren",
			);
		const rsa = await load("rsa-aes256.p12");
		const other = await load("self-signed.p12");
		await expect(
			createCms(new Uint8Array(32), { ...rsa, chain: other.chain }),
		).rejects.toMatchObject({ reason: "mismatch" });
	});
});
