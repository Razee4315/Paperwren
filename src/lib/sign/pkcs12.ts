import { sha1, sha256, sha384, sha512 } from "../office/sha";
import { certificate } from "./certificate";
import {
	buffer,
	type Asn1,
	equal,
	expectTag,
	number,
	objectId,
	octets,
	read,
	sequence,
} from "./der";
import { DigitalIdError } from "./errors";
import {
	CipherPaddingError,
	decryptRc2,
	decryptTripleDes,
} from "./legacyCiphers";
import { OID } from "./oids";

export type Hash = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
export type KeyKind = "RSA" | "P-256" | "P-384" | "P-521";

export interface ImportedId {
	unprotected: boolean;
	key: CryptoKey;
	chain: Uint8Array[];
	hash: Exclude<Hash, "SHA-1">;
	kind: KeyKind;
	bits: number;
}

const hashes: Record<
	Hash,
	{ digest: (bytes: Uint8Array) => Uint8Array; size: number; block: number }
> = {
	"SHA-1": { digest: sha1, size: 20, block: 64 },
	"SHA-256": { digest: sha256, size: 32, block: 64 },
	"SHA-384": { digest: sha384, size: 48, block: 128 },
	"SHA-512": { digest: sha512, size: 64, block: 128 },
};
const hashIds: Record<string, Hash> = {
	[OID.sha1]: "SHA-1",
	[OID.hmacSha1]: "SHA-1",
	[OID.sha256]: "SHA-256",
	[OID.hmacSha256]: "SHA-256",
	[OID.sha384]: "SHA-384",
	[OID.hmacSha384]: "SHA-384",
	[OID.sha512]: "SHA-512",
	[OID.hmacSha512]: "SHA-512",
};
const unsupported = (id: string): never => {
	throw new DigitalIdError("unsupported", id);
};
const hashFor = (id: string) => hashIds[id] ?? unsupported(id);
const prfs = new Set<string>([
	OID.hmacSha1,
	OID.hmacSha256,
	OID.hmacSha384,
	OID.hmacSha512,
]);
const prfFor = (id: string) => {
	if (!prfs.has(id)) unsupported(id);
	return hashFor(id);
};

const maxRounds = 2000000;
const maxWork = 6000000;

class Work {
	private remaining = maxWork;
	constructor(readonly signal?: AbortSignal) {}
	check() {
		if (this.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
	}
	use(hash: Hash, rounds: number, length: number) {
		this.check();
		const cost = rounds * Math.ceil(length / hashes[hash].size);
		if (cost > this.remaining) throw new DigitalIdError("unsupported");
		this.remaining -= cost;
	}
	async tick() {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		this.check();
	}
	async bytes(promise: Promise<ArrayBuffer>): Promise<Uint8Array> {
		const signal = this.signal;
		if (!signal) return new Uint8Array(await promise);
		return new Promise((resolve, reject) => {
			const abort = () => reject(new DOMException("Cancelled", "AbortError"));
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			promise.then(
				(value) => {
					signal.removeEventListener("abort", abort);
					const bytes = new Uint8Array(value);
					if (signal.aborted) bytes.fill(0);
					else resolve(bytes);
				},
				(error) => {
					signal.removeEventListener("abort", abort);
					reject(error);
				},
			);
		});
	}
}

function iterations(value: Asn1 | undefined, fallback = 1): number {
	const n = value ? number(value) : fallback;
	if (n < 1) throw new DigitalIdError("not-digital-id");
	if (n > maxRounds) throw new DigitalIdError("unsupported");
	return n;
}

/** RFC 7292 appendix B. Password bytes are already BMP-encoded. */
export async function pkcs12Kdf(
	hash: Hash,
	password: Uint8Array,
	salt: Uint8Array,
	rounds: number,
	id: 1 | 2 | 3,
	length: number,
	work = new Work(),
): Promise<Uint8Array> {
	if (rounds < 1 || !Number.isInteger(rounds) || length < 1 || length > 128)
		throw new DigitalIdError("not-digital-id");
	if (rounds > maxRounds) throw new DigitalIdError("unsupported");
	work.use(hash, rounds, length);
	const { digest, size, block } = hashes[hash];
	const saltSize = Math.ceil(salt.length / block) * block;
	const passwordSize = Math.ceil(password.length / block) * block;
	const input = new Uint8Array(block + saltSize + passwordSize);
	input.fill(id, 0, block);
	for (let i = 0; i < saltSize; i++) input[block + i] = salt[i % salt.length];
	for (let i = 0; i < passwordSize; i++)
		input[block + saltSize + i] = password[i % password.length];
	const out = new Uint8Array(Math.ceil(length / size) * size);
	const b = new Uint8Array(block);
	let a = new Uint8Array();
	try {
		for (let at = 0; at < out.length; at += size) {
			a = digest(input) as Uint8Array<ArrayBuffer>;
			for (let i = 1; i < rounds; i++) {
				if (i % 2048 === 0) await work.tick();
				const next = digest(a);
				a.fill(0);
				a = next as Uint8Array<ArrayBuffer>;
			}
			out.set(a, at);
			for (let i = 0; i < block; i++) b[i] = a[i % size];
			for (let offset = block; offset < input.length; offset += block) {
				let carry = 1;
				for (let i = block - 1; i >= 0; i--) {
					carry += input[offset + i] + b[i];
					input[offset + i] = carry;
					carry >>>= 8;
				}
			}
			a.fill(0);
		}
		return out.slice(0, length);
	} finally {
		input.fill(0);
		out.fill(0);
		b.fill(0);
		a.fill(0);
	}
}

function bmp(password: string, oldUtf8 = false): Uint8Array {
	const utf8 = oldUtf8 ? new TextEncoder().encode(password) : undefined;
	const size = utf8?.length ?? password.length;
	const out = new Uint8Array((size + 1) * 2);
	for (let i = 0; i < size; i++) {
		const n = utf8 ? utf8[i] : password.charCodeAt(i);
		out[2 * i] = n >>> 8;
		out[2 * i + 1] = n;
	}
	utf8?.fill(0);
	return out;
}

function pbkdfParams(algorithm: Asn1 | undefined) {
	const [id, params] = sequence(algorithm);
	const name = objectId(id);
	if (name !== OID.pbkdf2) unsupported(name);
	const parts = sequence(params);
	const salt = expectTag(parts[0], 4).value;
	const rounds = iterations(parts[1]);
	const length = parts[2]?.tag === 2 ? number(parts[2]) : undefined;
	if (length !== undefined && (length < 1 || length > 128))
		throw new DigitalIdError("not-digital-id");
	const prf = parts[2]?.tag === 2 ? parts[3] : parts[2];
	const partsPrf = prf ? sequence(prf) : undefined;
	if (
		partsPrf &&
		(partsPrf.length > 2 ||
			(partsPrf[1] && (partsPrf[1].tag !== 5 || partsPrf[1].value.length)))
	)
		throw new DigitalIdError("not-digital-id");
	const hash = partsPrf ? prfFor(objectId(partsPrf[0])) : "SHA-1";
	return { salt, rounds, length, hash };
}

async function pbkdf(
	password: Uint8Array,
	params: ReturnType<typeof pbkdfParams>,
	length: number,
	work: Work,
): Promise<Uint8Array> {
	if (params.length !== undefined && params.length !== length)
		throw new DigitalIdError("not-digital-id");
	work.use(params.hash, params.rounds, length);
	let key: CryptoKey;
	try {
		key = await crypto.subtle.importKey(
			"raw",
			buffer(password),
			"PBKDF2",
			false,
			["deriveBits"],
		);
	} catch (error) {
		if (password.length) throw error;
		// Some older engines refuse an empty raw PBKDF2 key.
		return emptyPbkdf(params, length, work);
	}
	return work.bytes(
		crypto.subtle.deriveBits(
			{
				name: "PBKDF2",
				salt: buffer(params.salt),
				iterations: params.rounds,
				hash: params.hash,
			},
			key,
			length * 8,
		),
	);
}

async function emptyPbkdf(
	params: ReturnType<typeof pbkdfParams>,
	length: number,
	work: Work,
): Promise<Uint8Array> {
	const { digest, size, block } = hashes[params.hash];
	const inner = new Uint8Array(block + Math.max(size, params.salt.length + 4));
	const outer = new Uint8Array(block + size);
	inner.fill(0x36, 0, block);
	outer.fill(0x5c, 0, block);
	const hmac = (data: Uint8Array) => {
		inner.set(data, block);
		const middle = digest(inner.subarray(0, block + data.length));
		outer.set(middle, block);
		middle.fill(0);
		return digest(outer);
	};
	const out = new Uint8Array(Math.ceil(length / size) * size);
	const first = new Uint8Array(params.salt.length + 4);
	first.set(params.salt);
	try {
		for (let at = 0; at < out.length; at += size) {
			new DataView(first.buffer).setUint32(first.length - 4, at / size + 1);
			let u = hmac(first);
			out.set(u, at);
			for (let i = 1; i < params.rounds; i++) {
				if (i % 2048 === 0) await work.tick();
				const next = hmac(u);
				u.fill(0);
				u = next;
				for (let j = 0; j < size; j++) out[at + j] ^= u[j];
			}
			u.fill(0);
		}
		return out.slice(0, length);
	} finally {
		inner.fill(0);
		outer.fill(0);
		out.fill(0);
		first.fill(0);
	}
}

async function mac(
	hash: Hash,
	key: Uint8Array,
	data: Uint8Array,
): Promise<Uint8Array> {
	const imported = await crypto.subtle.importKey(
		"raw",
		buffer(key),
		{ name: "HMAC", hash },
		false,
		["sign"],
	);
	return new Uint8Array(
		await crypto.subtle.sign("HMAC", imported, buffer(data)),
	);
}

async function checkMac(
	node: Asn1,
	data: Uint8Array,
	password: Uint8Array,
	utf8: Uint8Array,
	work: Work,
): Promise<boolean> {
	const [digestInfo, salt, count] = sequence(node);
	const [algorithm, expected] = sequence(digestInfo);
	const [id, params] = sequence(algorithm);
	const name = objectId(id);
	let hash: Hash;
	let key: Uint8Array;
	if (name === OID.pbmac1) {
		const [kdf, scheme] = sequence(params);
		const derivation = pbkdfParams(kdf);
		hash = prfFor(objectId(sequence(scheme)[0]));
		if (!derivation.length) throw new DigitalIdError("not-digital-id");
		key = await pbkdf(utf8, derivation, derivation.length, work);
	} else {
		hash = hashFor(name);
		key = await pkcs12Kdf(
			hash,
			password,
			expectTag(salt, 4).value,
			iterations(count),
			3,
			hashes[hash].size,
			work,
		);
	}
	try {
		const actual = await mac(hash, key, data);
		try {
			return equal(actual, expectTag(expected, 4).value);
		} finally {
			actual.fill(0);
		}
	} finally {
		key.fill(0);
	}
}

function encryption(algorithm: Asn1 | undefined) {
	const [id, params] = sequence(algorithm);
	const name = objectId(id);
	if (name === OID.pbes2) {
		const [kdf, scheme] = sequence(params);
		const derivation = pbkdfParams(kdf);
		const [encId, encParams] = sequence(scheme);
		const enc = objectId(encId);
		const size =
			enc === OID.aes128
				? 16
				: enc === OID.aes256
					? 32
					: enc === OID.tripleDes
						? 24
						: unsupported(enc);
		const cipher = enc === OID.tripleDes ? ("3des" as const) : ("aes" as const);
		const iv = expectTag(encParams, 4).value;
		if (
			iv.length !== (cipher === "aes" ? 16 : 8) ||
			(derivation.length !== undefined && derivation.length !== size)
		)
			throw new DigitalIdError("not-digital-id");
		return { derivation, size, cipher, iv };
	}
	const size =
		name === OID.pbeTripleDes
			? 24
			: name === OID.pbeTwoKeyDes || name === OID.pbeRc2
				? 16
				: name === OID.pbeRc240
					? 5
					: unsupported(name);
	const [salt, count] = sequence(params);
	const rounds = iterations(count);
	const cipher =
		name === OID.pbeRc2 || name === OID.pbeRc240
			? ("rc2" as const)
			: ("3des" as const);
	return { salt: expectTag(salt, 4).value, rounds, size, cipher };
}

function encryptionWork(algorithm: Asn1 | undefined, work: Work) {
	const plan = encryption(algorithm);
	if (plan.derivation)
		work.use(plan.derivation.hash, plan.derivation.rounds, plan.size);
	else {
		work.use("SHA-1", plan.rounds, plan.size);
		work.use("SHA-1", plan.rounds, 8);
	}
}

function macWork(node: Asn1, work: Work) {
	const [digestInfo, , count] = sequence(node);
	const [algorithm] = sequence(digestInfo);
	const [id, params] = sequence(algorithm);
	if (objectId(id) === OID.pbmac1) {
		const [kdf, scheme] = sequence(params);
		const derivation = pbkdfParams(kdf);
		prfFor(objectId(sequence(scheme)[0]));
		if (!derivation.length) throw new DigitalIdError("not-digital-id");
		work.use(derivation.hash, derivation.rounds, derivation.length);
	} else {
		const hash = hashFor(objectId(id));
		work.use(hash, iterations(count), hashes[hash].size);
	}
}

async function decrypt(
	algorithm: Asn1 | undefined,
	data: Uint8Array,
	password: Uint8Array,
	utf8: Uint8Array,
	work: Work,
): Promise<Uint8Array> {
	const plan = encryption(algorithm);
	const block = plan.cipher === "aes" ? 16 : 8;
	if (!data.length || data.length % block)
		throw new DigitalIdError("not-digital-id");
	let key: Uint8Array = new Uint8Array();
	let iv: Uint8Array = new Uint8Array();
	try {
		if (plan.derivation) {
			iv = plan.iv.slice();
			key = await pbkdf(utf8, plan.derivation, plan.size, work);
		} else {
			key = await pkcs12Kdf(
				"SHA-1",
				password,
				plan.salt,
				plan.rounds,
				1,
				plan.size,
				work,
			);
			iv = await pkcs12Kdf(
				"SHA-1",
				password,
				plan.salt,
				plan.rounds,
				2,
				8,
				work,
			);
		}
		work.check();
		if (plan.cipher === "3des") return decryptTripleDes(data, key, iv);
		if (plan.cipher === "rc2") return decryptRc2(data, key, iv, plan.size * 8);
		const imported = await crypto.subtle.importKey(
			"raw",
			buffer(key),
			"AES-CBC",
			false,
			["decrypt"],
		);
		return new Uint8Array(
			await crypto.subtle.decrypt(
				{ name: "AES-CBC", iv: buffer(iv) },
				imported,
				buffer(data),
			),
		);
	} catch (error) {
		if (
			error instanceof CipherPaddingError ||
			(error instanceof DOMException && error.name === "OperationError")
		)
			throw new DigitalIdError("password");
		throw error;
	} finally {
		key.fill(0);
		iv.fill(0);
	}
}

interface Bag {
	bytes: Uint8Array;
	localId?: Uint8Array;
}

function keyInfo(bytes: Uint8Array) {
	const parts = sequence(read(bytes));
	const algorithm = sequence(parts[1]);
	const id = objectId(algorithm[0]);
	if (id !== OID.rsa && id !== OID.ec) throw new DigitalIdError("key-type", id);
	const privateKey = sequence(read(expectTag(parts[2], 4).value));
	if (id === OID.rsa) {
		const modulus = expectTag(privateKey[1], 2).value;
		let start = 0;
		while (start < modulus.length - 1 && !modulus[start]) start++;
		const n = modulus.subarray(start);
		return {
			kind: "RSA" as const,
			hash: "SHA-256" as const,
			bits: n.length * 8 - Math.clz32(n[0]) + 24,
			publicBytes: n,
		};
	}
	if (id !== OID.ec) throw new DigitalIdError("key-type", id);
	if (algorithm[1]?.tag !== 6) throw new DigitalIdError("key-type");
	const curve = objectId(algorithm[1]);
	const kind: KeyKind | undefined =
		curve === OID.p256
			? "P-256"
			: curve === OID.p384
				? "P-384"
				: curve === OID.p521
					? "P-521"
					: undefined;
	if (!kind) throw new DigitalIdError("key-type", curve);
	const point = privateKey.find((part) => part.tag === 161)?.children[0];
	return {
		kind,
		hash:
			kind === "P-384"
				? ("SHA-384" as const)
				: kind === "P-521"
					? ("SHA-512" as const)
					: ("SHA-256" as const),
		bits: kind === "P-256" ? 256 : kind === "P-384" ? 384 : 521,
		publicBytes: point ? expectTag(point, 3).value.subarray(1) : undefined,
	};
}

function publicBytes(bytes: Uint8Array): Uint8Array {
	const spki = sequence(certificate(bytes).spki);
	const bits = expectTag(spki[1], 3).value.subarray(1);
	if (objectId(sequence(spki[0])[0]) !== OID.rsa) return bits;
	const modulus = expectTag(sequence(read(bits))[0], 2).value;
	return modulus[0] ? modulus : modulus.subarray(1);
}

async function match(
	keys: Bag[],
	certs: Bag[],
): Promise<Omit<ImportedId, "unprotected">> {
	if (!keys.length) throw new DigitalIdError("no-key");
	let keyError: DigitalIdError | undefined;
	for (const bag of keys) {
		let info: ReturnType<typeof keyInfo>;
		try {
			info = keyInfo(bag.bytes);
		} catch (error) {
			if (error instanceof DigitalIdError) {
				keyError = error;
				continue;
			}
			throw error;
		}
		const endEntities = certs.filter((cert) => !certificate(cert.bytes).ca);
		const cert =
			certs.find(
				(cert) =>
					bag.localId && cert.localId && equal(bag.localId, cert.localId),
			) ??
			certs.find(
				(cert) =>
					info.publicBytes && equal(info.publicBytes, publicBytes(cert.bytes)),
			) ??
			(endEntities.length === 1 ? endEntities[0] : undefined);
		if (!cert) continue;
		const algorithm =
			info.kind === "RSA"
				? { name: "RSASSA-PKCS1-v1_5", hash: info.hash }
				: { name: "ECDSA", namedCurve: info.kind };
		let key: CryptoKey;
		try {
			key = await crypto.subtle.importKey(
				"pkcs8",
				buffer(bag.bytes),
				algorithm,
				false,
				["sign"],
			);
			const pub = await crypto.subtle.importKey(
				"spki",
				buffer(certificate(cert.bytes).spki.raw),
				algorithm,
				false,
				["verify"],
			);
			const challenge = new Uint8Array(32);
			const signing =
				info.kind === "RSA"
					? "RSASSA-PKCS1-v1_5"
					: { name: "ECDSA", hash: info.hash };
			const signature = await crypto.subtle.sign(signing, key, challenge);
			if (!(await crypto.subtle.verify(signing, pub, signature, challenge)))
				continue;
		} catch {
			continue;
		}
		const chain = [cert.bytes];
		let current = certificate(cert.bytes);
		while (!current.selfSigned && chain.length <= certs.length) {
			const issuer = certs.find(
				(candidate) =>
					!chain.includes(candidate.bytes) &&
					equal(current.issuer.raw, certificate(candidate.bytes).subject.raw),
			);
			if (!issuer) break;
			chain.push(issuer.bytes);
			current = certificate(issuer.bytes);
		}
		return { key, chain, hash: info.hash, kind: info.kind, bits: info.bits };
	}
	throw keyError ?? new DigitalIdError("mismatch");
}

/** Consumes and erases file, including on failure. Retains only public DER and a non-extractable key. */
export async function readPkcs12(
	file: Uint8Array,
	password: string,
	signal?: AbortSignal,
): Promise<ImportedId> {
	const work = new Work(signal);
	const secrets: Uint8Array[] = [];
	const keep = (bytes: Uint8Array) => {
		secrets.push(bytes);
		return bytes;
	};
	const utf8 = keep(new TextEncoder().encode(password));
	let encoded = keep(bmp(password));
	try {
		work.check();
		const pfx = sequence(read(file));
		if (number(pfx[0]) !== 3 || pfx.length < 2 || pfx.length > 3)
			throw new Error("asn1");
		const auth = sequence(pfx[1]);
		const authType = objectId(auth[0]);
		if (authType !== OID.data) unsupported(authType);
		const data = keep(octets(expectTag(auth[1], 160).children[0]));
		const infos = sequence(read(data));
		if (infos.length > 8) throw new DigitalIdError("unsupported");
		// Reject visible aggregate costs before starting any cryptography. Costs
		// hidden in encrypted safes and password retries use the same live budget.
		const estimate = new Work(signal);
		let preflightError: unknown;
		try {
			if (pfx[2]) macWork(pfx[2], estimate);
			let visibleBags = 0;
			const scan = (bytes: Uint8Array, depth = 0) => {
				if (depth > 32) throw new Error("asn1");
				for (const bag of sequence(read(bytes))) {
					if (++visibleBags > 64) throw new Error("asn1");
					const [id, wrapped] = sequence(bag);
					const value = expectTag(wrapped, 160).children[0];
					if (objectId(id) === OID.shroudedKeyBag)
						encryptionWork(sequence(value)[0], estimate);
					else if (objectId(id) === OID.safeContentsBag)
						scan(value.raw, depth + 1);
				}
			};
			for (const info of infos) {
				const [type, wrapped] = sequence(info);
				const value = expectTag(wrapped, 160).children[0];
				if (objectId(type) === OID.encryptedData)
					encryptionWork(sequence(sequence(value)[1])[1], estimate);
				else if (objectId(type) === OID.data) scan(keep(octets(value)));
				else unsupported(objectId(type));
			}
		} catch (error) {
			if (
				(error instanceof DigitalIdError &&
					error.reason === "unsupported" &&
					error.message === "unsupported") ||
				(error instanceof DOMException && error.name === "AbortError")
			)
				throw error;
			// A corrupt authenticated safe should still fail its MAC first.
			preflightError = error;
		}
		if (pfx[2] && !(await checkMac(pfx[2], data, encoded, utf8, work))) {
			if (!password.length) encoded = keep(new Uint8Array());
			else if (Array.from(password).some((char) => char.charCodeAt(0) > 127))
				encoded = keep(bmp(password, true));
			else throw new DigitalIdError("password");
			if (!(await checkMac(pfx[2], data, encoded, utf8, work)))
				throw new DigitalIdError("password");
		}
		if (preflightError) throw preflightError;
		const keys: Bag[] = [];
		const certs: Bag[] = [];
		let bags = 0;
		async function contents(bytes: Uint8Array, depth = 0): Promise<void> {
			if (depth > 32) throw new Error("asn1");
			for (const bag of sequence(read(bytes))) {
				if (++bags > 64) throw new Error("asn1");
				const [bagId, wrapped, attributes] = sequence(bag);
				const type = objectId(bagId);
				const value = expectTag(wrapped, 160).children[0];
				let localId: Uint8Array | undefined;
				if (attributes)
					for (const attribute of expectTag(attributes, 49).children) {
						const [id, values] = sequence(attribute);
						if (objectId(id) === OID.localKeyId)
							localId = octets(expectTag(values, 49).children[0]);
					}
				if (type === OID.keyBag)
					keys.push({ bytes: keep(value.raw.slice()), localId });
				else if (type === OID.shroudedKeyBag) {
					const [algorithm, encrypted] = sequence(value);
					const plain = keep(
						await decrypt(
							algorithm,
							expectTag(encrypted, 4).value,
							encoded,
							utf8,
							work,
						),
					);
					try {
						sequence(read(plain));
					} catch {
						throw new DigitalIdError("password");
					}
					keys.push({ bytes: plain, localId });
				} else if (type === OID.certBag) {
					const [certType, certValue] = sequence(value);
					const certId = objectId(certType);
					if (certId !== OID.x509Certificate) unsupported(certId);
					const cert = octets(expectTag(certValue, 160).children[0]);
					certificate(cert);
					certs.push({ bytes: cert, localId });
				} else if (type === OID.safeContentsBag)
					await contents(value.raw, depth + 1);
			}
		}
		for (const info of infos) {
			work.check();
			const [type, wrapped] = sequence(info);
			const id = objectId(type);
			const value = expectTag(wrapped, 160).children[0];
			if (id === OID.data) await contents(keep(octets(value)));
			else if (id === OID.encryptedData) {
				const encryptedData = sequence(value);
				const [contentType, algorithm, encrypted] = sequence(encryptedData[1]);
				if (objectId(contentType) !== OID.data)
					unsupported(objectId(contentType));
				const encryptedBytes = keep(octets(encrypted, 128));
				const plain = keep(
					await decrypt(algorithm, encryptedBytes, encoded, utf8, work),
				);
				try {
					await contents(plain);
				} catch (error) {
					if (
						error instanceof DigitalIdError ||
						(error instanceof DOMException && error.name === "AbortError")
					)
						throw error;
					throw new DigitalIdError("password");
				}
			} else unsupported(id);
		}
		const result = await match(keys, certs);
		work.check();
		return { ...result, unprotected: !pfx[2] };
	} catch (error) {
		if (
			error instanceof DigitalIdError ||
			(error instanceof DOMException && error.name === "AbortError")
		)
			throw error;
		throw new DigitalIdError("not-digital-id");
	} finally {
		for (const secret of secrets) secret.fill(0);
		file.fill(0);
	}
}
