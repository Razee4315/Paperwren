// @vitest-environment node
import {
	createCipheriv,
	createHmac,
	createPrivateKey,
	pbkdf2Sync,
} from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { certificate } from "../sign/certificate";
import {
	der,
	integer,
	octet,
	oid,
	read,
	seq,
	sequence,
	set,
} from "../sign/der";
import { OID } from "../sign/oids";
import { pkcs12Kdf, readPkcs12 } from "../sign/pkcs12";

const fixture = (name: string) =>
	Uint8Array.from(readFileSync(`fixtures/digital-id/${name}`));
const pem = (name: string) =>
	Uint8Array.from(
		Buffer.from(
			readFileSync(`fixtures/digital-id/${name}`, "utf8").replace(
				/-----[^-]+-----|\s/g,
				"",
			),
			"base64",
		),
	);
const key = () =>
	Uint8Array.from(
		createPrivateKey(readFileSync("fixtures/digital-id/rsa.key")).export({
			type: "pkcs8",
			format: "der",
		}),
	);
const data = (bytes: Uint8Array) => seq(oid(OID.data), der(160, octet(bytes)));
const certBag = (cert: Uint8Array, id?: number) =>
	seq(
		oid(OID.certBag),
		der(160, seq(oid(OID.x509Certificate), der(160, octet(cert)))),
		...(id === undefined ? [] : [attrs(id)]),
	);
const attrs = (id: number) =>
	set(seq(oid(OID.localKeyId), set(octet(Uint8Array.of(id)))));
const keyBag = (bytes: Uint8Array, id?: number) =>
	seq(
		oid(OID.keyBag),
		der(160, bytes),
		...(id === undefined ? [] : [attrs(id)]),
	);
const pfx = (...bags: Uint8Array[]) =>
	seq(integer(3), data(seq(data(seq(...bags)))));

describe("PKCS#12 digital IDs", () => {
	it("falls back when an engine refuses an empty PBKDF2 password", async () => {
		const original = crypto.subtle.importKey.bind(crypto.subtle);
		const spy = vi
			.spyOn(crypto.subtle, "importKey")
			.mockImplementation(
				(...args: Parameters<typeof crypto.subtle.importKey>) => {
					if (args[2] === "PBKDF2") throw new Error("empty");
					return original(...args);
				},
			);
		try {
			expect(
				(await readPkcs12(fixture("rsa-empty-password.p12"), "")).kind,
			).toBe("RSA");
		} finally {
			spy.mockRestore();
		}
	});
	const names = readdirSync("fixtures/digital-id").filter(
		(name) =>
			name.endsWith(".p12") &&
			!["certs-only.p12", "rsa-aes192.p12"].includes(name),
	);
	it.each(names)("opens %s and consumes its input", async (name) => {
		const file = fixture(name);
		const password = name.includes("empty-password")
			? ""
			: name.includes("unicode")
				? "wrénøß"
				: "wren";
		const result = await readPkcs12(file, password);
		expect(result.key.extractable).toBe(false);
		expect(result.key.usages).toEqual(["sign"]);
		expect(file.every((n) => n === 0)).toBe(true);
		expect(result.chain.length).toBe(
			name.includes("empty-password") ||
				name.includes("unicode") ||
				name === "self-signed.p12"
				? 1
				: 3,
		);
		expect(result.chain[0].length).toBeGreaterThan(300);
		if (result.chain.length === 3) {
			expect(certificate(result.chain[0]).issuer.raw).toEqual(
				certificate(result.chain[1]).subject.raw,
			);
			expect(certificate(result.chain[1]).issuer.raw).toEqual(
				certificate(result.chain[2]).subject.raw,
			);
		}
	});
	it.each([
		"rsa-aes256.p12",
		"rsa-legacy.p12",
		"rsa-nomac.p12",
		"rsa-pbmac1.p12",
	])("rejects a wrong password for %s", async (name) => {
		const file = fixture(name);
		await expect(readPkcs12(file, "incorrect")).rejects.toMatchObject({
			reason: "password",
		});
		expect(file.every((n) => n === 0)).toBe(true);
	});
	it.each([
		["certs-only.p12", "no-key"],
		["rsa-aes192.p12", "unsupported"],
	])("reports %s as %s", async (name, reason) => {
		await expect(readPkcs12(fixture(name), "wren")).rejects.toMatchObject({
			reason,
		});
	});
	it("rejects corruption and overlarge files without leaking error details", async () => {
		for (const file of [
			Uint8Array.of(1, 2, 3),
			fixture("rsa-aes256.p12").slice(0, 100),
			new Uint8Array(1048577),
		]) {
			await expect(readPkcs12(file, "secret-value")).rejects.toMatchObject({
				reason: "not-digital-id",
				message: "not-digital-id",
			});
			expect(file.every((n) => n === 0)).toBe(true);
		}
		const corrupt = fixture("rsa-aes256.p12");
		corrupt[100] ^= 1;
		await expect(readPkcs12(corrupt, "wren")).rejects.toMatchObject({
			reason: "password",
		});
	});
	it("matches public keys without attributes, drops unrelated certs and tries later keys", async () => {
		const wrongKey = Uint8Array.from(
			createPrivateKey(readFileSync("fixtures/digital-id/p256.key")).export({
				type: "pkcs8",
				format: "der",
			}),
		);
		const result = await readPkcs12(
			pfx(
				keyBag(wrongKey, 1),
				keyBag(key(), 2),
				certBag(pem("rsa.pem"), 2),
				certBag(pem("self.pem")),
				certBag(pem("ca.pem")),
				certBag(pem("issuer.pem")),
			),
			"",
		);
		expect(result.kind).toBe("RSA");
		expect(result.bits).toBe(2048);
		expect(result.chain).toHaveLength(3);
		const fallback = await readPkcs12(
			pfx(keyBag(key()), certBag(pem("rsa.pem"))),
			"",
		);
		expect(fallback.kind).toBe("RSA");
	});
	it("self-checks even a localKeyId match and the single-leaf fallback", async () => {
		for (const id of [undefined, 1])
			await expect(
				readPkcs12(pfx(keyBag(key(), id), certBag(pem("p256.pem"), id)), ""),
			).rejects.toMatchObject({ reason: "mismatch" });
	});
	it("refuses unsupported key types and excessive bag counts", async () => {
		const parts = sequence(read(key()));
		const bad = seq(
			parts[0].raw,
			seq(oid("1.2.840.113549.1.1.10")),
			parts[2].raw,
		);
		await expect(
			readPkcs12(pfx(keyBag(bad), certBag(pem("rsa.pem"))), ""),
		).rejects.toMatchObject({ reason: "key-type" });
		await expect(
			readPkcs12(
				pfx(...Array.from({ length: 65 }, () => certBag(pem("rsa.pem")))),
				"",
			),
		).rejects.toMatchObject({ reason: "not-digital-id" });
	});
	it("supports absent SHA-1 PRF and explicit SHA-384/512 PBKDF2 parameters", async () => {
		for (const [hash, prf] of [
			["sha1", undefined],
			["sha384", OID.hmacSha384],
			["sha512", OID.hmacSha512],
		] as const) {
			const salt = new Uint8Array(8).fill(7);
			const iv = new Uint8Array(16).fill(9);
			const derived = pbkdf2Sync("wren", salt, 10, 16, hash);
			const cipher = createCipheriv("aes-128-cbc", derived, iv);
			const encrypted = Buffer.concat([cipher.update(key()), cipher.final()]);
			const params = seq(
				octet(salt),
				integer(10),
				integer(16),
				...(prf ? [seq(oid(prf), der(5, new Uint8Array()))] : []),
			);
			const algorithm = seq(
				oid(OID.pbes2),
				seq(seq(oid(OID.pbkdf2), params), seq(oid(OID.aes128), octet(iv))),
			);
			const bag = seq(
				oid(OID.shroudedKeyBag),
				der(160, seq(algorithm, octet(encrypted))),
			);
			const result = await readPkcs12(
				pfx(bag, certBag(pem("rsa.pem"))),
				"wren",
			);
			expect(result.kind).toBe("RSA");
		}
	});
	it("accepts the legacy empty and widened UTF-8 MAC password encodings", async () => {
		for (const password of ["", "wrénøß"]) {
			const bytes = password
				? Uint8Array.from(
						[...Buffer.from(password)].flatMap((n) => [0, n]).concat([0, 0]),
					)
				: new Uint8Array();
			const contents = seq(data(seq(keyBag(key()), certBag(pem("rsa.pem")))));
			const salt = Uint8Array.of(1, 2, 3, 4);
			const derived = pkcs12Kdf("SHA-1", bytes, salt, 1, 3, 20);
			const digest = createHmac("sha1", derived).update(contents).digest();
			const file = seq(
				integer(3),
				data(contents),
				seq(
					seq(seq(oid(OID.sha1), der(5, new Uint8Array())), octet(digest)),
					octet(salt),
					integer(1),
				),
			);
			expect((await readPkcs12(file, password)).kind).toBe("RSA");
		}
	});
	it("agrees with OpenSSL PKCS12KDF for key, IV and MAC derivation", () => {
		const password = Uint8Array.from(
			Buffer.from("0073006d006500670000", "hex"),
		);
		const salt = Uint8Array.from(Buffer.from("0a58cf64530d823f", "hex"));
		const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
		expect(hex(pkcs12Kdf("SHA-1", password, salt, 1, 1, 24))).toBe(
			"8aaae6297b6cb04642ab5b077851284eb7128f1a2a7fbca3",
		);
		expect(hex(pkcs12Kdf("SHA-1", password, salt, 1, 2, 8))).toBe(
			"79993dfe048d3b76",
		);
		expect(hex(pkcs12Kdf("SHA-256", password, salt, 2048, 3, 32))).toBe(
			"e4388cd88983083b1d1552867406cb3426e16cbcf4358c7bf5a97cdb2a11db46",
		);
		expect(() => pkcs12Kdf("SHA-1", password, salt, 10000001, 1, 24)).toThrow();
	});
});
