/**
 * Opening password-protected Word, Excel and PowerPoint files
 * (ECMA-376 document encryption, as [MS-OFFCRYPTO] describes it).
 *
 * A protected .docx/.xlsx/.pptx is not a zip: it is an OLE container
 * holding `EncryptionInfo` (how the key is derived from the password)
 * and `EncryptedPackage` (the real file, enciphered). Two schemes are
 * read: "agile" (Office 2010 and later; AES-CBC, usually SHA-512) and
 * "standard" (Office 2007; AES-ECB, SHA-1). The password never leaves
 * this code and nothing is kept: the file is deciphered in memory,
 * each time it is opened.
 *
 * AES is WebCrypto's. The password hashing, tens of thousands of
 * rounds each fed by the last, runs in sha.ts.
 */

import { sha1, sha384, sha512 } from "./sha";

type Lookup = (name: string) => Uint8Array | null;
type Hash = (data: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** Thrown as `Error("password")`: the worker reports that word. */
const wrongPassword = () => new Error("password");
const unsupported = (what: string) =>
	new Error(`unsupported encryption: ${what}`);

const subtle = () => globalThis.crypto.subtle;

const HASHES: Record<string, Hash> = {
	SHA1: sha1,
	SHA384: sha384,
	SHA512: sha512,
	SHA256: async (data) =>
		new Uint8Array(await subtle().digest("SHA-256", data as BufferSource)),
};

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

function le32(n: number): Uint8Array {
	return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24);
}

function utf16le(text: string): Uint8Array {
	const out = new Uint8Array(text.length * 2);
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		out[i * 2] = code & 255;
		out[i * 2 + 1] = code >>> 8;
	}
	return out;
}

function base64(text: string): Uint8Array {
	return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** Cut or pad (with 0x36, as the format says) to exactly `size`. */
function fit(bytes: Uint8Array, size: number): Uint8Array {
	if (bytes.length >= size) return bytes.subarray(0, size);
	const out = new Uint8Array(size).fill(0x36);
	out.set(bytes);
	return out;
}

const same = (a: Uint8Array, b: Uint8Array) =>
	a.length === b.length && a.every((x, i) => x === b[i]);

const importKey = (key: Uint8Array) =>
	subtle().importKey("raw", key as BufferSource, "AES-CBC", false, [
		"encrypt",
		"decrypt",
	]);

/**
 * AES-CBC without padding. WebCrypto insists on PKCS#7 padding, so
 * the block it expects is made first: enciphering nothing, chained
 * from the last block, yields exactly the padding block that follows.
 */
async function cbc(
	key: CryptoKey,
	iv: Uint8Array,
	data: Uint8Array,
): Promise<Uint8Array> {
	const whole = data.subarray(0, data.length - (data.length % 16));
	if (!whole.length) return new Uint8Array(0);
	const tail = await subtle().encrypt(
		{ name: "AES-CBC", iv: whole.subarray(whole.length - 16) as BufferSource },
		key,
		new Uint8Array(0),
	);
	return new Uint8Array(
		await subtle().decrypt(
			{ name: "AES-CBC", iv: iv as BufferSource },
			key,
			concat(whole, new Uint8Array(tail)) as BufferSource,
		),
	);
}

/** AES-ECB, which WebCrypto lacks: CBC with a zero IV, then undo the
 * chaining by XOR-ing each block with the cipher block before it. */
async function ecb(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
	const out = await cbc(key, new Uint8Array(16), data);
	for (let i = out.length - 1; i >= 16; i--) out[i] ^= data[i - 16];
	return out;
}

/** The package's own length: its first 8 bytes, little-endian. */
function packageSize(pkg: Uint8Array): number {
	const view = new DataView(pkg.buffer, pkg.byteOffset, 8);
	const size = view.getUint32(0, true) + view.getUint32(4, true) * 2 ** 32;
	if (size > pkg.length) throw new Error("corrupt: package size");
	return size;
}

// ---------- Agile (Office 2010+) ----------

const BLOCK_VERIFIER_INPUT = Uint8Array.of(
	0xfe,
	0xa7,
	0xd2,
	0x76,
	0x3b,
	0x4b,
	0x9e,
	0x79,
);
const BLOCK_VERIFIER_VALUE = Uint8Array.of(
	0xd7,
	0xaa,
	0x0f,
	0x6d,
	0x30,
	0x61,
	0x34,
	0x4e,
);
const BLOCK_KEY_VALUE = Uint8Array.of(
	0x14,
	0x6e,
	0x0b,
	0xe7,
	0xab,
	0xac,
	0xd0,
	0xd6,
);
const SEGMENT = 4096;

interface AgileParams {
	saltValue: Uint8Array;
	blockSize: number;
	keyBits: number;
	hashSize: number;
	hash: Hash;
}

/** One element's attributes; namespace prefixes are ignored. */
function element(xml: string, name: string): Map<string, string> | null {
	const tag = new RegExp(`<(?:\\w+:)?${name}\\b([^>]*)>`).exec(xml);
	if (!tag) return null;
	const out = new Map<string, string>();
	for (const m of tag[1].matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g))
		out.set(m[1], m[2]);
	return out;
}

function agileParams(attrs: Map<string, string>): AgileParams {
	const need = (name: string) => {
		const value = attrs.get(name);
		if (value === undefined) throw new Error(`corrupt: no ${name}`);
		return value;
	};
	if (need("cipherAlgorithm") !== "AES")
		throw unsupported(need("cipherAlgorithm"));
	if (need("cipherChaining") !== "ChainingModeCBC")
		throw unsupported(need("cipherChaining"));
	const hash = HASHES[need("hashAlgorithm").replace("-", "").toUpperCase()];
	if (!hash) throw unsupported(need("hashAlgorithm"));
	return {
		saltValue: base64(need("saltValue")),
		blockSize: Number(need("blockSize")),
		keyBits: Number(need("keyBits")),
		hashSize: Number(need("hashSize")),
		hash,
	};
}

async function decryptAgile(
	xml: string,
	pkg: Uint8Array,
	password: string,
): Promise<Uint8Array> {
	const keyData = element(xml, "keyData");
	const locked = element(xml, "encryptedKey");
	if (!keyData || !locked) throw unsupported("no password key");
	const data = agileParams(keyData);
	const lock = agileParams(locked);
	const spin = Number(locked.get("spinCount"));
	// The format allows ten million rounds; nothing honest asks for more.
	if (!Number.isInteger(spin) || spin < 0 || spin > 10_000_000)
		throw new Error("corrupt: spin count");

	// The password, hashed with the salt, then round after round.
	let h = await lock.hash(concat(lock.saltValue, utf16le(password)));
	const round = new Uint8Array(4 + h.length);
	for (let i = 0; i < spin; i++) {
		round[0] = i & 255;
		round[1] = (i >>> 8) & 255;
		round[2] = (i >>> 16) & 255;
		round[3] = i >>> 24;
		round.set(h, 4);
		const next = lock.hash(round);
		h = next instanceof Promise ? await next : next;
	}
	const keyFor = async (block: Uint8Array) =>
		importKey(fit(await lock.hash(concat(h, block)), lock.keyBits / 8));
	const iv = fit(lock.saltValue, lock.blockSize);
	const open = async (attr: string, block: Uint8Array) =>
		cbc(await keyFor(block), iv, base64(locked.get(attr) ?? ""));

	// The file carries a random value and its hash, both enciphered:
	// the right password is the one under which they agree.
	const input = (
		await open("encryptedVerifierHashInput", BLOCK_VERIFIER_INPUT)
	).subarray(0, lock.saltValue.length);
	const value = (
		await open("encryptedVerifierHashValue", BLOCK_VERIFIER_VALUE)
	).subarray(0, lock.hashSize);
	if (!value.length || !same(await lock.hash(input), value))
		throw wrongPassword();

	const secret = await importKey(
		(await open("encryptedKeyValue", BLOCK_KEY_VALUE)).subarray(
			0,
			data.keyBits / 8,
		),
	);
	const size = packageSize(pkg);
	const body = pkg.subarray(8);
	const out = new Uint8Array(Math.ceil(body.length / 16) * 16);
	const segments = Math.ceil(body.length / SEGMENT);
	// Each 4096-byte segment has its own IV, from its number.
	const one = async (n: number) => {
		const at = n * SEGMENT;
		const segmentIv = fit(
			await data.hash(concat(data.saltValue, le32(n))),
			data.blockSize,
		);
		out.set(await cbc(secret, segmentIv, body.subarray(at, at + SEGMENT)), at);
	};
	for (let n = 0; n < segments; n += 32)
		await Promise.all(
			Array.from({ length: Math.min(32, segments - n) }, (_, i) => one(n + i)),
		);
	return out.subarray(0, size);
}

// ---------- Standard (Office 2007) ----------

const AES_KEY_BITS: Record<number, number> = {
	26126: 128,
	26127: 192,
	26128: 256,
};
const STANDARD_SPIN = 50_000;

async function decryptStandard(
	info: Uint8Array,
	pkg: Uint8Array,
	password: string,
): Promise<Uint8Array> {
	const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
	const headerSize = view.getUint32(8, true);
	const header = 12;
	const algorithm = view.getUint32(header + 8, true);
	const hashAlgorithm = view.getUint32(header + 12, true);
	const keyBits = view.getUint32(header + 16, true) || AES_KEY_BITS[algorithm];
	if (!AES_KEY_BITS[algorithm]) throw unsupported("not AES");
	// 0x8004 is SHA-1; zero means "the default", which is SHA-1 too.
	if (hashAlgorithm !== 0x8004 && hashAlgorithm !== 0)
		throw unsupported("hash");
	const verifier = header + headerSize;
	const saltSize = view.getUint32(verifier, true);
	const salt = info.subarray(verifier + 4, verifier + 4 + saltSize);
	const encryptedVerifier = info.subarray(
		verifier + 4 + saltSize,
		verifier + 20 + saltSize,
	);
	const hashSize = view.getUint32(verifier + 20 + saltSize, true);
	const encryptedHash = info.subarray(
		verifier + 24 + saltSize,
		verifier + 56 + saltSize,
	);
	if (encryptedHash.length < 32) throw new Error("corrupt: verifier");

	let h = sha1(concat(salt, utf16le(password)));
	const round = new Uint8Array(24);
	for (let i = 0; i < STANDARD_SPIN; i++) {
		round[0] = i & 255;
		round[1] = (i >>> 8) & 255;
		round[2] = (i >>> 16) & 255;
		round[3] = i >>> 24;
		round.set(h, 4);
		h = sha1(round);
	}
	const last = sha1(concat(h, le32(0)));
	const mixed = (pad: number) => {
		const block = new Uint8Array(64).fill(pad);
		for (let i = 0; i < last.length; i++) block[i] ^= last[i];
		return sha1(block);
	};
	const key = await importKey(
		concat(mixed(0x36), mixed(0x5c)).subarray(0, keyBits / 8),
	);

	const check = await ecb(key, encryptedVerifier);
	const expected = (await ecb(key, encryptedHash)).subarray(0, hashSize);
	if (!same(sha1(check), expected)) throw wrongPassword();

	const size = packageSize(pkg);
	return (await ecb(key, pkg.subarray(8))).subarray(0, size);
}

// ---------- Entry ----------

/**
 * The real file inside a protected one. `lookup` reads a stream of
 * the OLE container. Rejects with `Error("password")` when the
 * password is wrong, and with "unsupported encryption" for schemes
 * not read here (certificates, rights management, ciphers other
 * than AES).
 */
export async function decryptPackage(
	lookup: Lookup,
	password: string,
): Promise<Uint8Array> {
	const info = lookup("EncryptionInfo");
	const pkg = lookup("EncryptedPackage");
	if (!info || !pkg || info.length < 8 || pkg.length < 8)
		throw new Error("corrupt: not an encrypted package");
	const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
	const major = view.getUint16(0, true);
	const minor = view.getUint16(2, true);
	if (major === 4 && minor === 4)
		return decryptAgile(
			new TextDecoder().decode(info.subarray(8)),
			pkg,
			password,
		);
	if (minor === 2 && major >= 2 && major <= 4)
		return decryptStandard(info, pkg, password);
	throw unsupported(`version ${major}.${minor}`);
}
