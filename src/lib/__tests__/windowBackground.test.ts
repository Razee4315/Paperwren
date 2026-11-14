import { describe, expect, it } from "vitest";
import { cssColorRgb } from "../windowBackground";

describe("the window's background colour", () => {
	it("reads the hex colours the themes are written in", () => {
		expect(cssColorRgb("#e7e4dd")).toEqual([231, 228, 221]);
		expect(cssColorRgb(" #0A0A0B ")).toEqual([10, 10, 11]);
		expect(cssColorRgb("#fff")).toEqual([255, 255, 255]);
		expect(cssColorRgb("#ffffff80")).toEqual([255, 255, 255]);
		expect(cssColorRgb("#0008")).toEqual([0, 0, 0]);
	});

	it("reads rgb() as a browser gives it back", () => {
		expect(cssColorRgb("rgb(22, 24, 27)")).toEqual([22, 24, 27]);
		expect(cssColorRgb("rgba(22, 24, 27, 0.5)")).toEqual([22, 24, 27]);
		expect(cssColorRgb("rgb(22 24 27 / 50%)")).toEqual([22, 24, 27]);
	});

	it("gives nothing for what it cannot read", () => {
		for (const value of [
			"",
			"var(--bg)",
			"transparent",
			"#ggg",
			"#12345",
			"rgb(300, 0, 0)",
			"hsl(0 0% 50%)",
		])
			expect(cssColorRgb(value)).toBeNull();
	});
});
