/**
 * SHA-1, SHA-384 and SHA-512, synchronous.
 *
 * Unlocking an Office file hashes its password 50,000 to 100,000
 * times over, each round fed by the last. WebCrypto can only do that
 * one awaited call at a time, which takes seconds; done here in a
 * plain loop it takes a fraction of one. WebCrypto still does the
 * deciphering itself. The tests hold these against WebCrypto's own
 * digests.
 */

// ---------- SHA-1 ----------

const NARROW_W = new Int32Array(80);

export function sha1(data: Uint8Array): Uint8Array {
	const blocks = padded(data, 64, 8);
	let h0 = 0x67452301;
	let h1 = 0xefcdab89;
	let h2 = 0x98badcfe;
	let h3 = 0x10325476;
	let h4 = 0xc3d2e1f0;
	const w = NARROW_W;
	for (let at = 0; at < blocks.length; at += 64) {
		for (let t = 0; t < 16; t++) w[t] = word(blocks, at + t * 4);
		for (let t = 16; t < 80; t++) {
			const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
			w[t] = (x << 1) | (x >>> 31);
		}
		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		for (let t = 0; t < 80; t++) {
			const f =
				t < 20
					? ((b & c) | (~b & d)) + 0x5a827999
					: t < 40
						? (b ^ c ^ d) + 0x6ed9eba1
						: t < 60
							? ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc
							: (b ^ c ^ d) + 0xca62c1d6;
			const next = (((a << 5) | (a >>> 27)) + f + e + w[t]) | 0;
			e = d;
			d = c;
			c = (b << 30) | (b >>> 2);
			b = a;
			a = next;
		}
		h0 = (h0 + a) | 0;
		h1 = (h1 + b) | 0;
		h2 = (h2 + c) | 0;
		h3 = (h3 + d) | 0;
		h4 = (h4 + e) | 0;
	}
	return bytes(Int32Array.of(h0, h1, h2, h3, h4), 20);
}

// ---------- SHA-512 / SHA-384 ----------

/** floor(n ** (1/k)), exactly. */
function root(n: bigint, k: 2n | 3n): bigint {
	let x = 1n << BigInt(Math.ceil(n.toString(2).length / Number(k)) + 1);
	for (;;) {
		const y = k === 2n ? (x + n / x) >> 1n : (2n * x + n / (x * x)) / 3n;
		if (y >= x) return x;
		x = y;
	}
}

function primes(count: number): bigint[] {
	const out: bigint[] = [];
	for (let n = 2; out.length < count; n++)
		if (out.every((p) => n % Number(p) !== 0)) out.push(BigInt(n));
	return out;
}

/** 64-bit words as [high, low] pairs of 32-bit integers. */
function pairs(words: bigint[]): Int32Array {
	const out = new Int32Array(words.length * 2);
	words.forEach((word, i) => {
		out[i * 2] = Number(BigInt.asIntN(32, word >> 32n));
		out[i * 2 + 1] = Number(BigInt.asIntN(32, word));
	});
	return out;
}

const MASK = (1n << 64n) - 1n;
// The standard derives its constants from the fractional parts of the
// roots of the first primes: computed here rather than typed out.
const PRIMES = primes(80);
const K = pairs(PRIMES.map((p) => root(p << 192n, 3n) & MASK));
const IV512 = pairs(PRIMES.slice(0, 8).map((p) => root(p << 128n, 2n) & MASK));
const IV384 = pairs(PRIMES.slice(8, 16).map((p) => root(p << 128n, 2n) & MASK));

// Scratch space, reused: key derivation calls this 100,000 times.
const WIDE_W = new Int32Array(160);
const WIDE_V = new Int32Array(16);

function sha2Wide(data: Uint8Array, iv: Int32Array, size: number): Uint8Array {
	const blocks = padded(data, 128, 16);
	const h = Int32Array.from(iv);
	const w = WIDE_W;
	const v = WIDE_V;
	for (let at = 0; at < blocks.length; at += 128) {
		for (let t = 0; t < 32; t++) w[t] = word(blocks, at + t * 4);
		for (let t = 16; t < 80; t++) {
			const ah = w[(t - 15) * 2];
			const al = w[(t - 15) * 2 + 1];
			const bh = w[(t - 2) * 2];
			const bl = w[(t - 2) * 2 + 1];
			// s0 = rotr 1 ^ rotr 8 ^ shr 7; s1 = rotr 19 ^ rotr 61 ^ shr 6
			const s0h =
				((ah >>> 1) | (al << 31)) ^ ((ah >>> 8) | (al << 24)) ^ (ah >>> 7);
			const s0l =
				((al >>> 1) | (ah << 31)) ^
				((al >>> 8) | (ah << 24)) ^
				((al >>> 7) | (ah << 25));
			const s1h =
				((bh >>> 19) | (bl << 13)) ^ ((bl >>> 29) | (bh << 3)) ^ (bh >>> 6);
			const s1l =
				((bl >>> 19) | (bh << 13)) ^
				((bh >>> 29) | (bl << 3)) ^
				((bl >>> 6) | (bh << 26));
			const low =
				(w[(t - 16) * 2 + 1] >>> 0) +
				(s0l >>> 0) +
				(w[(t - 7) * 2 + 1] >>> 0) +
				(s1l >>> 0);
			w[t * 2 + 1] = low | 0;
			w[t * 2] =
				(w[(t - 16) * 2] +
					s0h +
					w[(t - 7) * 2] +
					s1h +
					((low / 0x100000000) | 0)) |
				0;
		}
		v.set(h);
		for (let t = 0; t < 80; t++) {
			const ah = v[0];
			const al = v[1];
			const eh = v[8];
			const el = v[9];
			// S1 = rotr 14 ^ rotr 18 ^ rotr 41
			const S1h =
				((eh >>> 14) | (el << 18)) ^
				((eh >>> 18) | (el << 14)) ^
				((el >>> 9) | (eh << 23));
			const S1l =
				((el >>> 14) | (eh << 18)) ^
				((el >>> 18) | (eh << 14)) ^
				((eh >>> 9) | (el << 23));
			const chh = (eh & v[10]) ^ (~eh & v[12]);
			const chl = (el & v[11]) ^ (~el & v[13]);
			const t1low =
				(v[15] >>> 0) +
				(S1l >>> 0) +
				(chl >>> 0) +
				(K[t * 2 + 1] >>> 0) +
				(w[t * 2 + 1] >>> 0);
			const t1l = t1low | 0;
			const t1h =
				(v[14] +
					S1h +
					chh +
					K[t * 2] +
					w[t * 2] +
					((t1low / 0x100000000) | 0)) |
				0;
			// S0 = rotr 28 ^ rotr 34 ^ rotr 39
			const S0h =
				((ah >>> 28) | (al << 4)) ^
				((al >>> 2) | (ah << 30)) ^
				((al >>> 7) | (ah << 25));
			const S0l =
				((al >>> 28) | (ah << 4)) ^
				((ah >>> 2) | (al << 30)) ^
				((ah >>> 7) | (al << 25));
			const majh = (ah & v[2]) ^ (ah & v[4]) ^ (v[2] & v[4]);
			const majl = (al & v[3]) ^ (al & v[5]) ^ (v[3] & v[5]);
			const t2low = (S0l >>> 0) + (majl >>> 0);
			const t2h = (S0h + majh + ((t2low / 0x100000000) | 0)) | 0;
			// h = g, g = f, f = e, e = d + T1, d = c, c = b, b = a, a = T1 + T2
			for (let i = 15; i > 1; i--) v[i] = v[i - 2];
			const elow = (v[9] >>> 0) + (t1l >>> 0);
			v[9] = elow | 0;
			v[8] = (v[8] + t1h + ((elow / 0x100000000) | 0)) | 0;
			const alow = (t1l >>> 0) + (t2low >>> 0);
			v[1] = alow | 0;
			v[0] = (t1h + t2h + ((alow / 0x100000000) | 0)) | 0;
		}
		for (let i = 0; i < 16; i += 2) {
			const low = (h[i + 1] >>> 0) + (v[i + 1] >>> 0);
			h[i + 1] = low | 0;
			h[i] = (h[i] + v[i] + ((low / 0x100000000) | 0)) | 0;
		}
	}
	return bytes(h, size);
}

export const sha512 = (data: Uint8Array) => sha2Wide(data, IV512, 64);
export const sha384 = (data: Uint8Array) => sha2Wide(data, IV384, 48);

// ---------- Shared ----------

/** The message, its 0x80 marker and its bit length, in whole blocks. */
function padded(data: Uint8Array, block: number, lengthBytes: number) {
	const total = Math.ceil((data.length + 1 + lengthBytes) / block) * block;
	const out = new Uint8Array(total);
	out.set(data);
	out[data.length] = 0x80;
	const bits = data.length * 8;
	// Lengths here fit 53 bits; the upper bytes of the field stay zero.
	const high = Math.floor(bits / 0x100000000);
	for (let i = 0; i < 4; i++) {
		out[total - 8 + i] = high >>> (24 - i * 8);
		out[total - 4 + i] = bits >>> (24 - i * 8);
	}
	return out;
}

const word = (b: Uint8Array, at: number) =>
	(b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];

function bytes(words: Int32Array, size: number): Uint8Array {
	const out = new Uint8Array(size);
	for (let i = 0; i < size; i++) out[i] = words[i >> 2] >>> (24 - (i & 3) * 8);
	return out;
}
