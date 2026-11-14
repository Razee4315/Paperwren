/** Decrypt-only legacy ciphers for PKCS#12 privacy. Never used for signing. */
export class CipherPaddingError extends Error {
	constructor() {
		super("cipher");
		this.name = "CipherPaddingError";
	}
}
const IP = [
	58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38,
	30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1,
	59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39,
	31, 23, 15, 7,
];
const FP = [
	40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14,
	54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28,
	35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9,
	49, 17, 57, 25,
];
const PC1 = [
	57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
	27, 19, 11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38,
	30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];
const PC2 = [
	14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27,
	20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34,
	53, 46, 42, 50, 36, 29, 32,
];
const E = [
	32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16,
	17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29,
	28, 29, 30, 31, 32, 1,
];
const P = [
	16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32,
	27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];
const S = [
	[
		14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2,
		13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7,
		3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
	],
	[
		15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8,
		14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9,
		3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
	],
	[
		10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6,
		10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5,
		10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
	],
	[
		7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15,
		0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14,
		5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
	],
	[
		2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7,
		13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6,
		3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
	],
	[
		12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12,
		9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1,
		13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
	],
	[
		4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1,
		10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0,
		5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
	],
	[
		13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3,
		7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13,
		15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
	],
];

function permutation(bytes: Uint8Array, positions: number[]): Uint8Array {
	const out = new Uint8Array(Math.ceil(positions.length / 8));
	positions.forEach((p, i) => {
		out[i >> 3] |=
			((bytes[(p - 1) >> 3] >>> (7 - ((p - 1) & 7))) & 1) << (7 - (i & 7));
	});
	return out;
}

function desKeys(key: Uint8Array): Uint8Array[] {
	const bits = permutation(key, PC1);
	const view = new DataView(bits.buffer);
	let c = (view.getUint32(0) >>> 4) & 0xfffffff;
	let d = ((bits[3] & 15) << 24) | (bits[4] << 16) | (bits[5] << 8) | bits[6];
	const keys: Uint8Array[] = [];
	for (let round = 0; round < 16; round++) {
		const shift = [0, 1, 8, 15].includes(round) ? 1 : 2;
		c = ((c << shift) | (c >>> (28 - shift))) & 0xfffffff;
		d = ((d << shift) | (d >>> (28 - shift))) & 0xfffffff;
		const subkey = new Uint8Array(8);
		PC2.forEach((p, i) => {
			const n = p <= 28 ? c : d;
			const bit = p <= 28 ? 28 - p : 56 - p;
			subkey[Math.floor(i / 6)] |= ((n >>> bit) & 1) << (5 - (i % 6));
		});
		keys.push(subkey);
	}
	bits.fill(0);
	return keys;
}

function des(
	block: Uint8Array,
	keys: Uint8Array[],
	decrypt: boolean,
): Uint8Array {
	const bytes = permutation(block, IP);
	const view = new DataView(bytes.buffer);
	let left = view.getInt32(0);
	let right = view.getInt32(4);
	for (let round = 0; round < 16; round++) {
		const key = keys[decrypt ? 15 - round : round];
		let substituted = 0;
		for (let i = 0; i < 8; i++) {
			let value = key[i];
			for (let j = 0; j < 6; j++)
				value ^= ((right >>> (32 - E[i * 6 + j])) & 1) << (5 - j);
			const index = ((value & 32) >>> 4) | (value & 1);
			substituted =
				(substituted << 4) | S[i][index * 16 + ((value >>> 1) & 15)];
		}
		let f = 0;
		for (const p of P) f = (f << 1) | ((substituted >>> (32 - p)) & 1);
		const next = left ^ f;
		left = right;
		right = next;
	}
	view.setInt32(0, right);
	view.setInt32(4, left);
	const out = permutation(bytes, FP);
	bytes.fill(0);
	return out;
}

function cbc(
	data: Uint8Array,
	iv: Uint8Array,
	block: (bytes: Uint8Array) => Uint8Array,
	padding: boolean,
): Uint8Array {
	if (!data.length || data.length % 8 || iv.length !== 8)
		throw new Error("cipher");
	const out = new Uint8Array(data.length);
	try {
		for (let at = 0; at < data.length; at += 8) {
			const plain = block(data.subarray(at, at + 8));
			for (let i = 0; i < 8; i++)
				out[at + i] = plain[i] ^ (at ? data[at - 8 + i] : iv[i]);
			plain.fill(0);
		}
		const size = out[out.length - 1];
		if (padding) {
			let bad = size < 1 || size > 8 ? 1 : 0;
			for (let i = 1; i <= 8; i++)
				if (i <= size) bad |= out[out.length - i] ^ size;
			if (bad) throw new CipherPaddingError();
		}
		return out.slice(0, out.length - (padding ? size : 0));
	} finally {
		out.fill(0);
	}
}

export function decryptTripleDes(
	data: Uint8Array,
	key: Uint8Array,
	iv: Uint8Array,
	padding = true,
): Uint8Array {
	if (key.length !== 16 && key.length !== 24) throw new Error("cipher");
	const keys = [
		desKeys(key.subarray(0, 8)),
		desKeys(key.subarray(8, 16)),
		desKeys(key.length === 24 ? key.subarray(16, 24) : key.subarray(0, 8)),
	];
	try {
		return cbc(
			data,
			iv,
			(bytes) => {
				const first = des(bytes, keys[2], true);
				const second = des(first, keys[1], false);
				first.fill(0);
				const out = des(second, keys[0], true);
				second.fill(0);
				return out;
			},
			padding,
		);
	} finally {
		for (const schedule of keys) for (const round of schedule) round.fill(0);
	}
}

// RFC 2268 section 2, the permutation used by RC2 key expansion.
const PI = Uint8Array.from(
	"d978f9c419ddb5ed28e9fd794aa0d89dc67e37832b76538e624c6488448bfba2179a59f587b34f1361456d8d09817d32bd8f40eb86b77b0bf09521225c6b4e8254d66593ce60b21c7356c014a78cf1dc1275ca1f3bbee4d1423dd430a33cb6266fbf0eda4669075727f21d9bbc944303f811c7f690ef3ee706c3d52fc8661ed708e8eade8052eef784aa72ac354d6a2a961ad2715a1549744b9fd05e0418a4ecc2e0416e0f51cbcc2491af50a1f47039997c3a8523b8b47afc02365b255597312d5dfa98e38a92ae05df2910676cbac9d300e6cfe19ea82c6316013f58e289a90d38341bab33ffb0bb480c5fb9b1cd2ec5f3db47e5a59c770aa62068fe7fc1ad".match(
		/../g,
	) ?? [],
	(byte) => Number.parseInt(byte, 16),
);

export function decryptRc2(
	data: Uint8Array,
	key: Uint8Array,
	iv: Uint8Array,
	effectiveBits: number,
	padding = true,
): Uint8Array {
	if (
		!key.length ||
		key.length > 128 ||
		effectiveBits < 1 ||
		effectiveBits > 1024 ||
		!Number.isInteger(effectiveBits)
	)
		throw new Error("cipher");
	const expanded = new Uint8Array(128);
	expanded.set(key);
	for (let i = key.length; i < 128; i++)
		expanded[i] = PI[(expanded[i - 1] + expanded[i - key.length]) & 255];
	const size = Math.ceil(effectiveBits / 8);
	expanded[128 - size] =
		PI[expanded[128 - size] & (255 >>> (size * 8 - effectiveBits))];
	for (let i = 127 - size; i >= 0; i--)
		expanded[i] = PI[expanded[i + 1] ^ expanded[i + size]];
	const words = Uint16Array.from(
		{ length: 64 },
		(_, i) => expanded[2 * i] | (expanded[2 * i + 1] << 8),
	);
	expanded.fill(0);
	try {
		return cbc(
			data,
			iv,
			(bytes) => {
				const r = Uint16Array.from(
					{ length: 4 },
					(_, i) => bytes[2 * i] | (bytes[2 * i + 1] << 8),
				);
				let at = 63;
				for (let round = 15; round >= 0; round--) {
					if (round === 10 || round === 4)
						for (let i = 3; i >= 0; i--) r[i] -= words[r[(i + 3) & 3] & 63];
					for (let i = 3; i >= 0; i--) {
						const shift = [1, 2, 3, 5][i];
						const n = ((r[i] >>> shift) | (r[i] << (16 - shift))) & 65535;
						r[i] =
							n -
							words[at--] -
							(r[(i + 3) & 3] & r[(i + 2) & 3]) -
							(~r[(i + 3) & 3] & r[(i + 1) & 3]);
					}
				}
				const out = Uint8Array.from(
					{ length: 8 },
					(_, i) => r[i >> 1] >>> ((i & 1) * 8),
				);
				r.fill(0);
				return out;
			},
			padding,
		);
	} finally {
		words.fill(0);
	}
}
