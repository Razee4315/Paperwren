import { describe, expect, it } from "vitest";
import { prettyXml } from "../xml";

const long = (inner: string) =>
	`<?xml version="1.0"?><root xmlns="urn:x" a="1 &amp; 2">${inner}${"<pad/>".repeat(60)}</root>`;

describe("prettyXml", () => {
	it("indents a file written on one line, keeping its declaration", () => {
		const out = prettyXml(long('<item id="7"><name>Wren</name></item>'));
		const lines = out.split("\n");
		expect(lines[0]).toBe('<?xml version="1.0"?>');
		expect(lines[1]).toBe('<root xmlns="urn:x" a="1 &amp; 2">');
		expect(lines[2]).toBe('  <item id="7">');
		expect(lines[3]).toBe("    <name>Wren</name>");
		expect(lines[4]).toBe("  </item>");
		expect(lines[5]).toBe("  <pad/>");
		expect(lines.at(-1)).toBe("</root>");
		// Namespaces are declared once, where the file declared them.
		expect(out.match(/xmlns/g)).toHaveLength(1);
	});

	it("keeps prose on one line", () => {
		const out = prettyXml(long("<p>Read <b>this</b> first &lt;now&gt;</p>"));
		expect(out).toContain("  <p>Read <b>this</b> first &lt;now&gt;</p>");
	});

	it("leaves alone what is already laid out, or does not parse", () => {
		const tidy = "<a>\n  <b>1</b>\n</a>";
		expect(prettyXml(tidy)).toBe(tidy);
		const broken = `<a>${"<b>".repeat(100)}`;
		expect(prettyXml(broken)).toBe(broken);
	});
});
