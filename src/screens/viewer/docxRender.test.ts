import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { indentTables } from "./docxRender";

const W =
	'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A one-part .docx whose body is `body`. */
function docx(body: string): ArrayBuffer {
	const zip = zipSync({
		"[Content_Types].xml": strToU8(
			'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
		),
		"_rels/.rels": strToU8(
			'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
		),
		"word/document.xml": strToU8(
			`<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
		),
	});
	return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
}

const table = (props: string) =>
	`<w:tbl><w:tblPr>${props}</w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;

async function parsed(body: string) {
	const { parseAsync } = await import("docx-preview");
	const doc = await parseAsync(docx(body), { keepOrigin: true } as never);
	const tables: Array<{ cssStyle?: Record<string, string> }> = [];
	const walk = (n: { type?: string; children?: unknown[] }) => {
		if (n.type === "table") tables.push(n as never);
		for (const c of n.children ?? []) walk(c as never);
	};
	walk(doc.documentPart.body);
	return { doc, tables };
}

describe("a Word table's indent", () => {
	it("pulls a table into the margin as Word does", async () => {
		const { doc, tables } = await parsed(
			`${table('<w:tblW w:w="9000" w:type="dxa"/><w:tblInd w:w="-1026" w:type="dxa"/>')}<w:p/>${table("")}`,
		);
		expect(indentTables(doc)).toBe(1);
		expect(tables[0].cssStyle?.["margin-left"]).toBe("-51.3pt");
		expect(tables[1].cssStyle?.["margin-left"]).toBeUndefined();
	});

	it("leaves a centred table where it centres itself", async () => {
		const { doc, tables } = await parsed(
			table('<w:jc w:val="center"/><w:tblInd w:w="400" w:type="dxa"/>'),
		);
		indentTables(doc);
		expect(tables[0].cssStyle?.["margin-left"]).toBe("auto");
	});
});
