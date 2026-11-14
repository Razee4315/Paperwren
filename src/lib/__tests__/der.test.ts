import { describe, expect, it } from "vitest";
import {
	concat,
	der,
	integer,
	number,
	objectId,
	octet,
	octets,
	oid,
	read,
	seq,
	set,
} from "../sign/der";

describe("BER and DER", () => {
	it("reads nested indefinite lengths and constructed octet strings", () => {
		const node = read(
			Uint8Array.of(48, 128, 36, 128, 4, 1, 65, 36, 3, 4, 1, 66, 0, 0, 0, 0),
		);
		expect(octets(node.children[0])).toEqual(Uint8Array.of(65, 66));
	});
	it("round trips long lengths, identifiers and positive integers", () => {
		for (const size of [0, 127, 128, 255, 256, 65536]) {
			const bytes = new Uint8Array(size).fill(91);
			expect(octets(read(octet(bytes)))).toEqual(bytes);
		}
		for (const id of [
			"0.0",
			"1.2.840.113549.1.7.1",
			"2.999.1234567890123456789",
		])
			expect(objectId(read(oid(id)))).toBe(id);
		for (const n of [0, 127, 128, 256, 10000000])
			expect(number(read(integer(n)))).toBe(n);
		expect(integer(Uint8Array.of(0, 0, 128))).toEqual(
			Uint8Array.of(2, 2, 0, 128),
		);
		expect(integer(new Uint8Array())).toEqual(Uint8Array.of(2, 1, 0));
	});
	it("sorts SET OF by complete DER encoding", () => {
		expect(set(integer(256), integer(1), integer(0))).toEqual(
			der(49, concat(integer(0), integer(1), integer(256))),
		);
	});
	it("refuses truncation, trailing data, invalid tags and escaped parent lengths", () => {
		for (const bytes of [
			[],
			[4],
			[4, 2, 1],
			[48, 2, 4, 1, 1],
			[4, 128, 0, 0],
			[48, 128, 4, 0],
			[31, 0],
			[0, 0],
			[4, 0, 0, 0],
			[4, 133, 0, 0, 0, 0, 0],
		])
			expect(() => read(Uint8Array.from(bytes))).toThrow("asn1");
	});
	it("caps depth and node count", () => {
		let nested = integer(1);
		for (let i = 0; i < 33; i++)
			nested = seq(nested) as Uint8Array<ArrayBuffer>;
		expect(() => read(nested)).toThrow("asn1");
		expect(() =>
			read(seq(...Array.from({ length: 16384 }, () => integer(0)))),
		).toThrow("asn1");
	});
});
