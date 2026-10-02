import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha1, sha384, sha512 } from "./sha";

const hex = (b: Uint8Array) =>
	Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const reference = async (name: string, data: Uint8Array) =>
	hex(new Uint8Array(await webcrypto.subtle.digest(name, data)));

describe("synchronous SHA", () => {
	it("matches the published SHA-1 and SHA-512 digests of 'abc'", () => {
		const abc = new TextEncoder().encode("abc");
		expect(hex(sha1(abc))).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
		expect(hex(sha512(abc))).toBe(
			"ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
		);
	});

	it("agrees with WebCrypto at every length around the block edges", async () => {
		// Deterministic noise: lengths 0..300 cross one and two blocks of
		// both sizes, and every padding case.
		let seed = 12345;
		const noise = (n: number) =>
			Uint8Array.from({ length: n }, () => {
				seed = (seed * 1103515245 + 12345) & 0x7fffffff;
				return seed >>> 16;
			});
		for (let n = 0; n <= 300; n++) {
			const data = noise(n);
			expect(hex(sha1(data)), `sha1 ${n}`).toBe(await reference("SHA-1", data));
			expect(hex(sha512(data)), `sha512 ${n}`).toBe(
				await reference("SHA-512", data),
			);
			expect(hex(sha384(data)), `sha384 ${n}`).toBe(
				await reference("SHA-384", data),
			);
		}
	});

	it("survives a chain of rounds, as key derivation runs it", async () => {
		let mine = new Uint8Array(64);
		let theirs = new Uint8Array(64);
		for (let i = 0; i < 500; i++) {
			mine = sha512(mine) as Uint8Array<ArrayBuffer>;
			theirs = new Uint8Array(await webcrypto.subtle.digest("SHA-512", theirs));
		}
		expect(hex(mine)).toBe(hex(theirs));
	});
});
