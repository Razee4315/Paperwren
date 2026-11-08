import { describe, expect, it } from "vitest";
import { textBlocks } from "../textBlocks";

describe("textBlocks", () => {
	it("splits text into blocks of whole lines, every line kept", () => {
		const lines = Array.from({ length: 450 }, (_, i) => `line ${i}`);
		const blocks = textBlocks(lines.join("\n"), true);
		expect(blocks).toHaveLength(3);
		expect(blocks.map((b) => b.text).join("\n")).toBe(lines.join("\n"));
		expect(blocks[0].rows).toBe(200);
	});

	it("keeps an empty last line of a block, which a box would not draw", () => {
		const text = `${"x\n".repeat(199)}\nnext`;
		const [first, second] = textBlocks(text, true);
		expect(first.text.endsWith("\n\n")).toBe(true);
		expect(second.text).toBe("next");
	});

	it("guesses wrapped rows only when the text wraps", () => {
		const long = "y".repeat(300);
		expect(textBlocks(long, true)[0].rows).toBe(4);
		expect(textBlocks(long, false)[0].rows).toBe(1);
	});
});
