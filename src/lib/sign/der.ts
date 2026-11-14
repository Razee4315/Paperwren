/** The small BER subset used by PKCS#12, and DER encodings for CMS. */
export interface Asn1 {
	tag: number;
	raw: Uint8Array;
	value: Uint8Array;
	children: Asn1[];
}

export function read(bytes: Uint8Array): Asn1 {
	let count = 0;
	function node(offset: number, end: number, depth: number): [Asn1, number] {
		let at = offset;
		if (depth > 32 || ++count > 16384 || at + 2 > end) throw new Error("asn1");
		const start = at;
		const tag = bytes[at++];
		if (!tag || (tag & 31) === 31) throw new Error("asn1");
		let length = bytes[at++];
		const indefinite = length === 128;
		if (indefinite && !(tag & 32)) throw new Error("asn1");
		if (length > 128) {
			const size = length & 127;
			if (size > 4 || at + size > end) throw new Error("asn1");
			length = 0;
			for (let i = 0; i < size; i++) length = length * 256 + bytes[at++];
		}
		const content = at;
		const stop = indefinite ? end : at + length;
		if (stop > end) throw new Error("asn1");
		const children: Asn1[] = [];
		if (tag & 32) {
			while (at < stop) {
				if (indefinite && at + 1 < stop && !bytes[at] && !bytes[at + 1]) break;
				const [child, next] = node(at, stop, depth + 1);
				children.push(child);
				at = next;
			}
		} else at = stop;
		const contentEnd = at;
		if (indefinite) {
			if (at + 2 > end || bytes[at] || bytes[at + 1]) throw new Error("asn1");
			at += 2;
		} else if (at !== stop) throw new Error("asn1");
		return [
			{
				tag,
				raw: bytes.subarray(start, at),
				value: bytes.subarray(content, contentEnd),
				children,
			},
			at,
		];
	}
	if (bytes.length > 1024 * 1024) throw new Error("asn1");
	const [result, end] = node(0, bytes.length, 0);
	if (end !== bytes.length) throw new Error("asn1");
	return result;
}

export function expectTag(node: Asn1 | undefined, tag: number): Asn1 {
	if (!node || node.tag !== tag) throw new Error("asn1");
	return node;
}

export const sequence = (node: Asn1 | undefined) =>
	expectTag(node, 48).children;

export function number(node: Asn1 | undefined): number {
	const bytes = expectTag(node, 2).value;
	if (!bytes.length || bytes[0] & 128 || bytes.length > 7)
		throw new Error("asn1");
	let n = 0;
	for (const byte of bytes) n = n * 256 + byte;
	if (!Number.isSafeInteger(n)) throw new Error("asn1");
	return n;
}

export function objectId(node: Asn1 | undefined): string {
	const bytes = expectTag(node, 6).value;
	if (!bytes.length || bytes.length > 128) throw new Error("asn1");
	const parts: bigint[] = [];
	let n = 0n;
	let first = true;
	for (const byte of bytes) {
		if (first && byte === 128) throw new Error("asn1");
		n = n * 128n + BigInt(byte & 127);
		first = !(byte & 128);
		if (first) {
			parts.push(n);
			n = 0n;
		}
	}
	if (!first) throw new Error("asn1");
	const head = parts.shift() ?? 0n;
	return [
		head < 40n ? 0n : head < 80n ? 1n : 2n,
		head < 80n ? head % 40n : head - 80n,
		...parts,
	].join(".");
}

export function octets(node: Asn1 | undefined, tag = 4): Uint8Array {
	if (!node) throw new Error("asn1");
	if (node.tag === tag) return node.value.slice();
	if (node.tag !== (tag | 32)) throw new Error("asn1");
	const chunks = node.children.map((child) => octets(child));
	try {
		return concat(...chunks);
	} finally {
		for (const chunk of chunks) chunk.fill(0);
	}
}

export function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

export function der(tag: number, value: Uint8Array): Uint8Array {
	const length: number[] = [];
	for (let n = value.length; n > 0; n = Math.floor(n / 256))
		length.unshift(n & 255);
	return concat(
		Uint8Array.of(
			tag,
			...(value.length < 128
				? [value.length]
				: [128 | length.length, ...length]),
		),
		value,
	);
}

export const seq = (...parts: Uint8Array[]) => der(48, concat(...parts));

export function compare(a: Uint8Array, b: Uint8Array): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++)
		if (a[i] !== b[i]) return a[i] - b[i];
	return a.length - b.length;
}

export const set = (...parts: Uint8Array[]) =>
	der(49, concat(...parts.sort(compare)));
export const octet = (value: Uint8Array) => der(4, value);

export function integer(value: number | Uint8Array): Uint8Array {
	let bytes: Uint8Array;
	if (typeof value === "number") {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error("asn1");
		const out: number[] = [];
		let n = value;
		do {
			out.unshift(n % 256);
			n = Math.floor(n / 256);
		} while (n);
		bytes = Uint8Array.from(out);
	} else bytes = value;
	let start = 0;
	while (start < bytes.length - 1 && !bytes[start]) start++;
	bytes = bytes.subarray(start);
	return der(
		2,
		!bytes.length
			? Uint8Array.of(0)
			: bytes[0] & 128
				? concat(Uint8Array.of(0), bytes)
				: bytes,
	);
}

export function oid(value: string): Uint8Array {
	if (!/^\d+(\.\d+)+$/.test(value)) throw new Error("asn1");
	const parts = value.split(".").map(BigInt);
	if (parts[0] > 2n || (parts[0] < 2n && parts[1] >= 40n))
		throw new Error("asn1");
	const out: number[] = [];
	for (let n of [40n * parts[0] + parts[1], ...parts.slice(2)]) {
		const bytes = [Number(n & 127n)];
		n >>= 7n;
		while (n) {
			bytes.unshift(Number(n & 127n) | 128);
			n >>= 7n;
		}
		out.push(...bytes);
	}
	return der(6, Uint8Array.from(out));
}

export const equal = (a: Uint8Array, b: Uint8Array) => {
	let diff = a.length ^ b.length;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i % (b.length || 1)];
	return diff === 0;
};

/** WebCrypto requires an owned ArrayBuffer, including on older WebViews. */
export const buffer = (bytes: Uint8Array): ArrayBuffer =>
	bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
		? (bytes.buffer as ArrayBuffer)
		: (bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer);
