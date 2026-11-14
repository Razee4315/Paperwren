import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { type Page, expect } from "@playwright/test";

/** Start the app with `storage` already saved. `query` picks a layout:
 * "?desktop" for the desktop one (the phone layout is the default). */
export async function boot(
	page: Page,
	storage: Record<string, unknown> = {},
	query = "",
) {
	const seeded = { onboarded: true, ...storage };
	await page.addInitScript((entries) => {
		if (sessionStorage.getItem("booted")) return;
		sessionStorage.setItem("booted", "1");
		for (const [k, v] of Object.entries(entries))
			localStorage.setItem(`paperwren.${k}`, JSON.stringify(v));
	}, seeded);
	await page.goto(`/${query}`);
	await expect(page.getByTestId("home")).toBeVisible();
}

/** Deliver a fixture through the same path the picker uses. */
export async function openFixture(
	page: Page,
	fixture: string,
	name = fixture.split("/").pop() ?? fixture,
) {
	const b64 = readFileSync(`fixtures/${fixture}`).toString("base64");
	await page.evaluate(
		({ b64, name }) => {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], name);
		},
		{ b64, name },
	);
	await page.getByTestId("open-file").click();
}

/** A Fill & sign tool, from the bar or, where a phone keeps the rarer
 * ones, from More. */
export async function pickTool(page: Page, kind: string) {
	const more = page.getByTestId("fill-tool-more");
	const inBar = page.getByTestId("fill-sign").getByTestId(`fill-tool-${kind}`);
	if ((await more.isVisible()) && !(await inBar.count())) await more.click();
	await page.getByTestId(`fill-tool-${kind}`).click();
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** A PNG of one colour, as many pixels as asked: small, and a picture
 * whose size says which one it is. */
export function solidPng(
	width: number,
	height: number,
	[r, g, b]: [number, number, number] = [200, 60, 60],
): Uint8Array {
	const chunk = (type: string, data: Uint8Array) => {
		const out = new Uint8Array(12 + data.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		out.set(Buffer.from(type, "ascii"), 4);
		out.set(data, 8);
		view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
		return out;
	};
	const head = new Uint8Array(13);
	const view = new DataView(head.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	head.set([8, 2, 0, 0, 0], 8);
	const rows = Buffer.alloc((1 + width * 3) * height);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			rows.set([r, g, b], y * (1 + width * 3) + 1 + x * 3);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", head),
		chunk("IDAT", deflateSync(rows)),
		chunk("IEND", new Uint8Array(0)),
	]);
}

/** A plain PDF of `count` pages, each saying which it is: for a document
 * longer than any fixture. */
export function longPdf(count: number): string {
	const objects: string[] = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Count ${count} /Kids [${Array.from(
			{ length: count },
			(_, i) => `${4 + i * 2} 0 R`,
		).join(" ")}] >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	for (let i = 0; i < count; i++) {
		const text = `BT /F1 28 Tf 72 700 Td (Long page ${i + 1}) Tj ET`;
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
			`<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
		);
	}
	let out = "%PDF-1.4\n";
	const offsets = objects.map((body, i) => {
		const at = out.length;
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
		return at;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return out;
}
