// @vitest-environment node
import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptRc2, decryptTripleDes } from "../sign/legacyCiphers";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const zero = new Uint8Array(8);

describe("legacy PKCS#12 decryption", () => {
	// NIST CAVP tdesmmt.zip, TCBCMMT3.rsp, counts 0 and 1.
	it.each([
		[
			"46133dcbf232b51964e0d95e83208f156732bf75b673abf1",
			"34814c87f47fd59d",
			"092368405296744a",
			"de655a0ea771436c",
		],
		[
			"6d0d67da68ab166d1f43c7204c4c2aa4c81a528515f1dff2",
			"68e63a07b22e33eb",
			"5274be183f5dfb6b018f22b322f0392d",
			"4346c4e81380626fa0b2776d30a4fc05",
		],
	])("decrypts the NIST CBC vector with key %s", (key, iv, cipher, plain) => {
		expect(
			hex(decryptTripleDes(bytes(cipher), bytes(key), bytes(iv), false)),
		).toBe(plain);
	});
	it("reduces to the published DES example when all three keys agree", () => {
		expect(
			hex(
				decryptTripleDes(
					bytes("85e813540f0ab405"),
					bytes("133457799bbcdff1133457799bbcdff1133457799bbcdff1"),
					zero,
					false,
				),
			),
		).toBe("0123456789abcdef");
	});
	it("decrypts the NIST two-key CBC vector", () => {
		expect(
			hex(
				decryptTripleDes(
					bytes("1b3889c9dbe10d03"),
					bytes("bcfe7f25f2b0a72c6276ae1f389d8ae9"),
					bytes("f29d4ba5172fd297"),
					false,
				),
			),
		).toBe("0611a474fb090978");
	});
	it("decrypts OpenSSL RC2-40 CBC with a full padding block", () => {
		// printf 12345678 | openssl enc -rc2-40-cbc -provider legacy
		// -provider default -K 0102030405 -iv 0000000000000000
		const cipher = bytes("0178dbfa78ff5adfe7a931953c2c310f");
		expect(
			new TextDecoder().decode(
				decryptRc2(cipher, bytes("0102030405"), zero, 40),
			),
		).toBe("12345678");
		cipher[7] ^= 1;
		expect(() => decryptRc2(cipher, bytes("0102030405"), zero, 40)).toThrow(
			"cipher",
		);
	});
	it("accepts two-key 3DES and checks every padding byte", () => {
		const key = bytes("0123456789abcdeffedcba9876543210");
		for (let size = 0; size <= 17; size++) {
			const plain = Buffer.alloc(size, 65);
			const cipher = createCipheriv("des-ede-cbc", key, zero);
			const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
			expect(decryptTripleDes(encrypted, key, zero)).toEqual(
				Uint8Array.from(plain),
			);
		}
		const cipher = createCipheriv("des-ede-cbc", key, zero);
		cipher.setAutoPadding(false);
		const bad = Buffer.concat([
			cipher.update(bytes("0000000000030203")),
			cipher.final(),
		]);
		expect(() => decryptTripleDes(bad, key, zero)).toThrow("cipher");
	});
	// RFC 2268 section 5. The RFC has no 40-bit vector; OpenSSL pins that below.
	it.each([
		["0000000000000000", 63, "ebb773f993278eff", "0000000000000000"],
		["ffffffffffffffff", 64, "278b27e42e2f0d49", "ffffffffffffffff"],
		["3000000000000000", 64, "30649edf9be7d2c2", "1000000000000001"],
		["88", 64, "61a8a244adacccf0", "0000000000000000"],
		["88bca90e90875a", 64, "6ccf4308974c267f", "0000000000000000"],
		[
			"88bca90e90875a7f0f79c384627bafb2",
			64,
			"1a807d272bbe5db1",
			"0000000000000000",
		],
		[
			"88bca90e90875a7f0f79c384627bafb2",
			128,
			"2269552ab0f85ca6",
			"0000000000000000",
		],
		[
			"88bca90e90875a7f0f79c384627bafb216f80a6f85920584c42fceb0be255daf1e",
			129,
			"5b78d3a43dfff1f1",
			"0000000000000000",
		],
	])(
		"decrypts RFC 2268 key %s at %i effective bits",
		(key, bits, cipher, plain) => {
			expect(
				hex(decryptRc2(bytes(cipher), bytes(key), zero, bits, false)),
			).toBe(plain);
		},
	);
	it("rejects malformed cipher parameters", () => {
		expect(() => decryptTripleDes(zero, zero, zero)).toThrow("cipher");
		expect(() => decryptRc2(zero, zero, zero, 0)).toThrow("cipher");
		expect(() => decryptRc2(new Uint8Array(7), zero, zero, 40)).toThrow(
			"cipher",
		);
	});
});
