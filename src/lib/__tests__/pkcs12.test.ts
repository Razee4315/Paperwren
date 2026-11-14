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
import { readDigitalId } from "../sign";

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

const pbes2 = (
	rounds: number,
	iv = new Uint8Array(16),
	prf: string = OID.hmacSha256,
	length = 16,
	cipher: string = OID.aes128,
) =>
	seq(
		oid(OID.pbes2),
		seq(
			seq(
				oid(OID.pbkdf2),
				seq(
					octet(new Uint8Array(8)),
					integer(rounds),
					integer(length),
					seq(oid(prf), der(5, new Uint8Array())),
				),
			),
			seq(oid(cipher), octet(iv)),
		),
	);
const encryptedSafe = (algorithm: Uint8Array, bytes: Uint8Array) =>
	seq(
		oid(OID.encryptedData),
		der(160, seq(integer(0), seq(oid(OID.data), algorithm, der(128, bytes)))),
	);
const emptySafe = (algorithm: Uint8Array) => {
	const cipher = createCipheriv(
		"aes-128-cbc",
		new Uint8Array(16),
		new Uint8Array(16),
	);
	return encryptedSafe(
		algorithm,
		Buffer.concat([cipher.update(seq()), cipher.final()]),
	);
};

describe("PKCS#12 digital IDs", () => {
	it("surfaces a stripped MAC in the public summary", async () => {
		const parts = sequence(read(fixture("rsa-aes256.p12")));
		const stripped = seq(parts[0].raw, parts[1].raw);
		expect((await readDigitalId(stripped, "wren")).summary.unprotected).toBe(
			true,
		);
		expect(
			(await readDigitalId(fixture("rsa-aes256.p12"), "wren")).summary
				.unprotected,
		).toBe(false);
		expect(
			(await readDigitalId(fixture("rsa-nomac.p12"), "wren")).summary
				.unprotected,
		).toBe(true);
	});
	it("reports invalid decrypted ASN.1 in a MAC-less safe as a password failure", async () => {
		const derived = pbkdf2Sync("wren", new Uint8Array(8), 1, 16, "sha256");
		const cipher = createCipheriv("aes-128-cbc", derived, new Uint8Array(16));
		const encrypted = Buffer.concat([
			cipher.update(Uint8Array.of(48, 255)),
			cipher.final(),
		]);
		await expect(
			readPkcs12(
				seq(integer(3), data(seq(encryptedSafe(pbes2(1), encrypted)))),
				"wren",
			),
		).rejects.toMatchObject({ reason: "password" });
	});
	it("counts legacy key and IV blocks together with the MAC before doing work", async () => {
		const algorithm = seq(
			oid(OID.pbeTripleDes),
			seq(octet(new Uint8Array(8)), integer(1600000)),
		);
		const contents = seq(encryptedSafe(algorithm, new Uint8Array(8)));
		const file = seq(
			integer(3),
			data(contents),
			seq(
				seq(seq(oid(OID.sha1)), octet(new Uint8Array(20))),
				octet(new Uint8Array(8)),
				integer(1600000),
			),
		);
		const start = performance.now();
		await expect(readPkcs12(file, "wren")).rejects.toMatchObject({
			reason: "unsupported",
		});
		expect(performance.now() - start).toBeLessThan(1000);
	});
	it("charges hidden derivations to the file's remaining work budget", async () => {
		const keyCipher = createCipheriv(
			"aes-128-cbc",
			new Uint8Array(16),
			new Uint8Array(16),
		);
		const keyBytes = Buffer.concat([
			keyCipher.update(key()),
			keyCipher.final(),
		]);
		const bag = seq(
			oid(OID.shroudedKeyBag),
			der(160, seq(pbes2(1500000), octet(keyBytes))),
		);
		const cipher = createCipheriv(
			"aes-128-cbc",
			new Uint8Array(16),
			new Uint8Array(16),
		);
		const safe = Buffer.concat([
			cipher.update(seq(...Array.from({ length: 4 }, () => bag))),
			cipher.final(),
		]);
		const file = seq(
			integer(3),
			data(seq(encryptedSafe(pbes2(1500000), safe))),
		);
		const derive = vi
			.spyOn(crypto.subtle, "deriveBits")
			.mockResolvedValue(new ArrayBuffer(16));
		try {
			await expect(readPkcs12(file, "wren")).rejects.toMatchObject({
				reason: "unsupported",
			});
			expect(derive).toHaveBeenCalledTimes(4);
		} finally {
			derive.mockRestore();
		}
	});
	it("lets a caller stop waiting for a WebCrypto derivation", async () => {
		let finish: ((value: ArrayBuffer) => void) | undefined;
		const controller = new AbortController();
		const derive = vi.spyOn(crypto.subtle, "deriveBits").mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
					controller.abort();
				}),
		);
		try {
			await expect(
				readPkcs12(
					seq(integer(3), data(seq(emptySafe(pbes2(1))))),
					"wren",
					controller.signal,
				),
			).rejects.toMatchObject({ name: "AbortError" });
			const bytes = new Uint8Array(16).fill(7);
			finish?.(bytes.buffer);
			await Promise.resolve();
			expect(bytes.every((n) => n === 0)).toBe(true);
		} finally {
			derive.mockRestore();
		}
	});
	it.each([
		["content count", 9, 1],
		["derivation cap", 1, 2000001],
		["total work", 5, 1500000],
	] as const)(
		"refuses excessive %s before any expensive derivation",
		async (_, count, rounds) => {
			const derive = vi.spyOn(crypto.subtle, "deriveBits");
			try {
				const file = seq(
					integer(3),
					data(
						seq(
							...Array.from({ length: count }, () => emptySafe(pbes2(rounds))),
						),
					),
				);
				const start = performance.now();
				await expect(readPkcs12(file, "wren")).rejects.toMatchObject({
					reason: "unsupported",
				});
				expect(performance.now() - start).toBeLessThan(1000);
				expect(derive).not.toHaveBeenCalled();
			} finally {
				derive.mockRestore();
			}
		},
	);
	it("yields during a legacy derivation and lets the caller cancel it", async () => {
		const contents = seq(data(seq()));
		const file = seq(
			integer(3),
			data(contents),
			seq(
				seq(seq(oid(OID.sha1)), octet(new Uint8Array(20))),
				octet(new Uint8Array(8)),
				integer(50000),
			),
		);
		const controller = new AbortController();
		let ticked = false;
		const timer = setTimeout(() => {
			ticked = true;
			controller.abort();
		}, 0);
		try {
			await expect(
				readDigitalId(file, "wren", controller.signal),
			).rejects.toMatchObject({ name: "AbortError" });
			expect(ticked).toBe(true);
			expect(file.every((n) => n === 0)).toBe(true);
		} finally {
			clearTimeout(timer);
		}
	});
	it.each([
		["AES IV", pbes2(1, new Uint8Array(15)), "not-digital-id"],
		[
			"3DES IV",
			pbes2(1, new Uint8Array(7), OID.hmacSha256, 24, OID.tripleDes),
			"not-digital-id",
		],
		["PRF", pbes2(1, new Uint8Array(16), OID.sha256), "unsupported"],
		[
			"key length",
			pbes2(1, new Uint8Array(16), OID.hmacSha256, 32),
			"not-digital-id",
		],
	] as const)(
		"reports a malformed PBES2 %s as a structural problem",
		async (_, algorithm, reason) => {
			await expect(
				readPkcs12(seq(integer(3), data(seq(emptySafe(algorithm)))), "wren"),
			).rejects.toMatchObject({ reason });
		},
	);
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
				: name === "long-issuer.p12"
					? 2
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
			const derived = await pkcs12Kdf("SHA-1", bytes, salt, 1, 3, 20);
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
	it("agrees with OpenSSL PKCS12KDF for key, IV and MAC derivation", async () => {
		const password = Uint8Array.from(
			Buffer.from("0073006d006500670000", "hex"),
		);
		const salt = Uint8Array.from(Buffer.from("0a58cf64530d823f", "hex"));
		const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
		expect(hex(await pkcs12Kdf("SHA-1", password, salt, 1, 1, 24))).toBe(
			"8aaae6297b6cb04642ab5b077851284eb7128f1a2a7fbca3",
		);
		expect(hex(await pkcs12Kdf("SHA-1", password, salt, 1, 2, 8))).toBe(
			"79993dfe048d3b76",
		);
		expect(hex(await pkcs12Kdf("SHA-256", password, salt, 2048, 3, 32))).toBe(
			"e4388cd88983083b1d1552867406cb3426e16cbcf4358c7bf5a97cdb2a11db46",
		);
		await expect(
			pkcs12Kdf("SHA-1", password, salt, 10000001, 1, 24),
		).rejects.toThrow();
	});
});
