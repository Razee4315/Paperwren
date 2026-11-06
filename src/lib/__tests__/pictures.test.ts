import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { looksHeif } from "../pictures";

const file = (name: string) => new Uint8Array(readFileSync(`fixtures/${name}`));

describe("telling a HEIC from other pictures", () => {
	it("knows an iPhone photo", () => {
		expect(looksHeif(file("features/photo.heic"))).toBe(true);
	});

	it("leaves AVIF, JPEG and PNG to the webview", () => {
		expect(looksHeif(file("features/photo.avif"))).toBe(false);
		expect(looksHeif(file("features/photo.jpg"))).toBe(false);
		expect(looksHeif(file("sample.png"))).toBe(false);
		expect(looksHeif(new Uint8Array(4))).toBe(false);
	});
});
