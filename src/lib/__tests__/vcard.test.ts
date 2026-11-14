// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sniffFormat } from "../sniff";
import { parseVCard } from "../vcard";
const card = (s: string) => parseVCard(`BEGIN:VCARD\n${s}\nEND:VCARD`)[0];
const bytes = (s: string) => new TextEncoder().encode(s).buffer;
const fixture = (name: string) => {
	const b = readFileSync(`fixtures/contacts-${name}.vcf`);
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
describe("vCard", () => {
	it("reads all versions and many cards, names, types and structured fields", () => {
		expect(parseVCard(fixture("21"))[0].name).toBe("عائشہ خان");
		const c = parseVCard(fixture("40"));
		expect(c).toHaveLength(2);
		expect(c[1].name).toBe("Rafael Silva");
		expect(c[0].values).toContainEqual({
			kind: "ORG",
			value: "Paperwren · Design",
			types: [],
		});
		expect(c[0].values.find((v) => v.kind === "ADR")?.value).toBe(
			"12 Garden Road\nLahore\n54000\nPakistan",
		);
		expect(card("N:Khan;Aisha;Noor;Dr.;Jr.").name).toBe(
			"Dr. Aisha Noor Khan Jr.",
		);
		for (const params of ["CELL;VOICE", "TYPE=cell,voice", 'TYPE="cell,voice"'])
			expect(card(`item1.TEL;${params}:123`).values[0].types).toEqual([
				"cell",
				"voice",
			]);
		expect(card('TEL;TYPE="cell":123').values[0].types).toEqual(["cell"]);
	});
	it("unfolds CRLF spaces and tabs, QP soft breaks, and decodes escapes", () => {
		expect(card("FN:Ai\r\n sha\r\n\t Khan").name).toBe("Aisha Khan");
		expect(
			card("FN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=D8=B9=\r\n=D9=84=D9=8A")
				.name,
		).toBe("علي");
		expect(
			card(String.raw`NOTE:one\ntwo\,three\;four\\five`).values[0].value,
		).toBe("one\ntwo,three;four\\five");
		expect(card(String.raw`ORG:One\;Two;Unit`).values[0].value).toBe(
			"One;Two · Unit",
		);
	});
	it("decodes base64 text, legacy charsets, raw encoded bytes and unknown charsets", () => {
		expect(card("FN;ENCODING=BASE64:QWlzaGE=").name).toBe("Aisha");
		expect(
			card("FN;ENCODING=QUOTED-PRINTABLE;CHARSET=windows-1252:Andr=E9").name,
		).toBe("André");
		const raw = Uint8Array.from(
			"BEGIN:VCARD\nFN;CHARSET=windows-1252:André\nEND:VCARD",
			(c) => c.charCodeAt(0),
		);
		expect(parseVCard(raw.buffer)[0].name).toBe("André");
		expect(card("FN;ENCODING=b;CHARSET=made-up:QWlzaGE=").name).toBe("Aisha");
	});
	it("accepts only embedded PNG/JPEG photos, folded base64 and data URIs", () => {
		const photo = parseVCard(fixture("30"))[0].photo;
		expect(photo).toMatch(/^data:image\/png;base64,/);
		expect(card(`PHOTO:${photo}`).photo).toBe(photo);
		expect(card("PHOTO:data:image/jpeg,%FF%D8%FF%00").photo).toBe(
			"data:image/jpeg;base64,/9j/AA==",
		);
		expect(card("PHOTO;ENCODING=b:/9j/\r\n AA==").photo).toBe(
			"data:image/jpeg;base64,/9j/AA==",
		);
		for (const value of [
			"https://example.com/a.png",
			"http://example.com",
			"data:image/svg+xml;base64,PHN2Zz4=",
			"garbage",
		])
			expect(card(`PHOTO:${value}`).photo).toBeUndefined();
		expect(
			card(`PHOTO;ENCODING=b:${"A".repeat(4 * 1024 * 1024 + 1)}`).photo,
		).toBeUndefined();
	});
	it("keeps common birthdays readable", () => {
		for (const [input, expected] of [
			["20000102", "2000-01-02"],
			["2000-01-02", "2000-01-02"],
			["--0102", "--01-02"],
			["--01-02", "--01-02"],
			["20000102T120000Z", "2000-01-02T120000Z"],
		])
			expect(card(`BDAY:${input}`).values[0].value).toBe(expected);
	});
	it("tolerates junk, blank lines, BOM, missing END and bad encodings", () => {
		expect(parseVCard("junk\n\n\uFEFF")).toEqual([]);
		expect(
			parseVCard(
				"\uFEFFjunk\nBEGIN:VCARD\nFN:First\nBEGIN:VCARD\nFN:Last\nPHOTO;ENCODING=b:!!",
			).map((c) => c.name),
		).toEqual(["First", "Last"]);
		expect(card("FN;ENCODING=b:!!\nEMAIL:a@b.c").values[0].value).toBe("a@b.c");
	});
	it("decodes UTF-16 BOM in both byte orders and sniffs a misleading extension", () => {
		for (const little of [true, false]) {
			const text = "BEGIN:VCARD\r\nFN:علي\r\nEND:VCARD";
			const b = new Uint8Array(2 + text.length * 2);
			b.set(little ? [255, 254] : [254, 255]);
			const view = new DataView(b.buffer);
			for (let i = 0; i < text.length; i++)
				view.setUint16(2 + i * 2, text.charCodeAt(i), little);
			expect(parseVCard(b.buffer)[0].name).toBe("علي");
			expect(sniffFormat(b.buffer, "wrong.txt")).toBe("vcf");
		}
		expect(
			sniffFormat(bytes("\uFEFFBEGIN:VCARD\nFN:Hi\nEND:VCARD"), "wrong.pdf"),
		).toBe("vcf");
	});
	it("bounds huge contact and field counts", () => {
		expect(
			parseVCard("BEGIN:VCARD\nFN:A\nEND:VCARD\n".repeat(10001)),
		).toHaveLength(10000);
		expect(card("NOTE:x\n".repeat(1001)).values).toHaveLength(1000);
	});
});
