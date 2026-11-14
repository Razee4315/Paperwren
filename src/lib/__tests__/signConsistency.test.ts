// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { PDFDocument, PDFNumber } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fillAndSign } from "../pdfTools";
import {
	type DigitalId,
	PdfSignError,
	canSign,
	prepareSigningCopy,
	readDigitalId,
	signPdf,
} from "../sign";
import {
	stream,
	PdfBuilder,
	baseObjects,
	bytes,
	content,
	page,
	text,
} from "./signConsistencySupport";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
	import.meta.url,
).toString();
const now = new Date("2026-11-14T00:00:00Z");
let id: DigitalId;
let signedPrefix: Uint8Array;
let signedCatalog: string;
const options = { appearance: null, now };
beforeAll(async () => {
	id = await readDigitalId(
		Uint8Array.from(readFileSync("fixtures/digital-id/p256.p12")),
		"wren",
	);
	const b = new PdfBuilder();
	for (const [n, body] of baseObjects()) b.object(n, body);
	signedPrefix = await signPdf(b.finish(), id, options);
	signedCatalog = (await PDFDocument.load(signedPrefix)).catalog.toString();
});

async function shown(pdf: Uint8Array) {
	const reader = await pdfjs.getDocument({
		data: pdf.slice(),
		verbosity: 0,
		isEvalSupported: false,
	}).promise;
	try {
		const pages = [];
		for (let n = 1; n <= reader.numPages; n++) {
			const p = await reader.getPage(n);
			pages.push({
				view: p.view,
				rotate: p.rotate,
				width: p.getViewport({ scale: 1 }).width,
				height: p.getViewport({ scale: 1 }).height,
				text: (await p.getTextContent()).items.map((i) =>
					"str" in i ? i.str : "",
				),
			});
		}
		return pages;
	} finally {
		await reader.destroy();
	}
}

/** Catch only signing refusals; comparison failures must escape this function. */
async function invariant(input: Uint8Array, signed: boolean) {
	expect((await canSign(input)).signed).toBe(signed);
	const rewrite = vi.fn(() => fillAndSign(input, { fields: [], marks: [] }));
	let output: Uint8Array;
	let base = input;
	try {
		base = signed ? input : await prepareSigningCopy(input, rewrite);
		output = await signPdf(base, id, options);
	} catch (error) {
		expect(error).toBeInstanceOf(PdfSignError);
		expect((await canSign(base)).blocker).toBe((error as PdfSignError).reason);
		if ((await canSign(input)).blocker) expect(rewrite).not.toHaveBeenCalled();
		return "refused";
	}
	expect(await shown(output)).toEqual(await shown(input));
	return "accepted-and-equal";
}

type Case = {
	name: string;
	change: (
		b: PdfBuilder,
		objects: Map<number, string>,
	) => Uint8Array | undefined;
	expected?: string;
};
const cases: Case[] = [];
function add(name: string, change: Case["change"], expected?: string) {
	cases.push({ name, change, expected });
}
const replacements = new Map([
	[3, page.replace("600 800", "300 400").replace("4 0 R", "11 0 R")],
	[4, content("Writer selected")],
	[2, "<< /Type /Pages /Kids [3 0 R 3 0 R] /Count 2 >>"],
	[1, "<< /Type /Catalog /Pages 12 0 R >>"],
	[
		5,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
	],
	[
		7,
		stream(
			"1 0 0 rg 0 0 20 20 re f",
			"/Type /XObject /Subtype /Form /BBox [0 0 20 20]",
		),
	],
]);
for (const [n, label] of [
	[3, "page"],
	[4, "content stream"],
	[2, "Pages node"],
	[1, "catalog"],
	[5, "font resource"],
	[7, "XObject and annotation appearance"],
] as const) {
	for (const order of ["after", "before"] as const)
		add(`duplicate ${label} ${order} indexed definition`, (b, o) => {
			if (order === "before") b.object(n, replacements.get(n) as string, false);
			for (const [k, body] of o) b.object(k, body);
			if (order === "after") b.object(n, replacements.get(n) as string, false);
			return b.finish();
		});
}
add("compressed duplicate with plain xref", (b) => {
	b.compressed(3, replacements.get(3) as string, 20, false);
	return b.finish();
});
add("plain duplicate with type-2 xref", (b) => {
	b.compressed(3, page, 20);
	b.object(3, replacements.get(3) as string, false);
	return b.finish("stream");
});
add("two object streams with the same number", (b) => {
	b.compressed(3, page, 20);
	b.compressed(3, replacements.get(3) as string, 21, false);
	return b.finish("stream");
});
add(
	"object stream slot marked free",
	(b) => {
		b.compressed(3, page, 20);
		b.entries.set(3, [0, 0, 1]);
		return b.finish("stream");
	},
	"refused",
);
add(
	"legitimate incremental redefinition",
	(b) => {
		const first = b.finish();
		const next = new PdfBuilder(first);
		next.object(4, content("Updated legitimately"));
		return next.finish();
	},
	"accepted-and-equal",
);
add(
	"incremental redefinition then unreferenced definition",
	(b) => {
		const next = new PdfBuilder(b.finish());
		next.object(4, content("Updated legitimately"));
		next.object(4, content("Unreferenced"), false);
		return next.finish();
	},
	"refused",
);
add("different generation beside live generation", (b) => {
	b.object(3, replacements.get(3) as string, false, 1);
	return b.finish();
});
add(
	"free entry for reachable live object",
	(b) => {
		b.entries.set(3, [0, 4, 1]);
		return b.finish();
	},
	"refused",
);
add("xref points to header inside stream data", (b) => {
	const at = b.object(22, stream(`3 0 obj\n${page}\nendobj`));
	b.entries.set(3, [1, b.source.indexOf("3 0 obj", at), 0]);
	return b.finish();
});
add(
	"object header look-alike inside stream",
	(b) => {
		b.object(22, stream("3 0 obj\n<< /Fake true >>\nendobj"));
		return b.finish();
	},
	"accepted-and-equal",
);
add(
	"object header look-alike inside string",
	(b) => {
		b.object(22, "(3 0 obj << /Fake true >> endobj)");
		return b.finish();
	},
	"accepted-and-equal",
);
add(
	"object header look-alike inside comment",
	(b) => {
		b.source += "% 3 0 obj << /Fake true >> endobj\n";
		return b.finish();
	},
	"accepted-and-equal",
);
for (const header of ["3  0  obj\n", "3\r0\robj\r", "3 0 obj"])
	add(
		`legal header ${JSON.stringify(header)}`,
		(b) => {
			b.object(3, page, true, 0, header);
			return b.finish();
		},
		"accepted-and-equal",
	);
add(
	"hybrid table and stream disagreement",
	(b) => {
		const at = b.object(3, replacements.get(3) as string, false);
		return b.finish("hybrid", new Map([[3, [1, at, 0]]]));
	},
	"refused",
);
add(
	"predictor hybrid disagreement",
	(b) => {
		const at = b.object(3, replacements.get(3) as string, false);
		return b.finish("hybrid", new Map([[3, [1, at, 0]]]), true);
	},
	"refused",
);
add(
	"hybrid with a compressed supplemental page",
	(b) => {
		b.compressed(3, page, 20);
		b.entries.delete(3);
		return b.finish("hybrid", new Map([[3, [2, 20, 0]]]));
	},
	"accepted-and-equal",
);
add(
	"hybrid supplement revives a free content entry",
	(b) => {
		const at = b.object(4, content("Supplement only"), false);
		b.entries.set(4, [0, 0, 1]);
		return b.finish("hybrid", new Map([[4, [1, at, 0]]]));
	},
	"refused",
);
add(
	"repeated table subsection selects a different content offset",
	(b) => {
		const at = b.object(4, content("Repeated subsection"), false);
		return bytes(
			text(b.finish()).replace(
				"trailer\n",
				`4 1\n${String(at).padStart(10, "0")} 00000 n \ntrailer\n`,
			),
		);
	},
	"refused",
);
add("linearized-style forward Prev disagreement", (b) => {
	const firstXref = b.source.length;
	const oldPrev = b.previous;
	b.previous = 0;
	const first = text(b.finish()).replace("/Prev 0", "/Prev 0000000000");
	const next = new PdfBuilder(bytes(first));
	next.previous = oldPrev;
	next.object(4, content("Main section disagrees"));
	const mainXref = next.source.length;
	return bytes(
		text(next.finish())
			.replace(
				"/Prev 0000000000",
				`/Prev ${String(mainXref).padStart(10, "0")}`,
			)
			.replace(
				/startxref\s+\d+\s+%%EOF\s*$/,
				`startxref\n${firstXref}\n%%EOF\n`,
			),
	);
});
add("indirect wrong stream Length", (b) => {
	b.object(8, "1");
	b.object(
		4,
		"<< /Length 8 0 R >>\nstream\nBT /F1 18 Tf 40 700 Td (Reader shown) Tj ET\nendstream",
	);
	return b.finish();
});
add(
	"ordinary indirect stream Length",
	(b) => {
		const data = "BT /F1 18 Tf 40 700 Td (Reader shown) Tj ET";
		b.object(8, String(data.length));
		b.object(4, `<< /Length 8 0 R >>\nstream\n${data}\nendstream`);
		return b.finish();
	},
	"accepted-and-equal",
);
add(
	"indirect Length spans an embedded endstream marker",
	(b) => {
		const data =
			"BT /F1 18 Tf 40 700 Td (Reader shown) Tj ET\n% endstream\nBT /F1 18 Tf 40 650 Td (Also shown) Tj ET";
		b.object(8, String(data.length));
		b.object(4, `<< /Length 8 0 R >>\nstream\n${data}\nendstream`);
		return b.finish();
	},
	"refused",
);
for (const key of ["Contents", "Resources", "MediaBox", "Rotate"])
	add(`Pages inheritance of ${key}`, (b, o) => {
		const values: Record<string, string> = {
			Contents: "4 0 R",
			Resources: "<< /Font << /F1 5 0 R >> >>",
			MediaBox: "[0 0 600 800]",
			Rotate: "90",
		};
		let body = page;
		if (key === "Contents") body = body.replace("/Contents 4 0 R", "");
		if (key === "Resources") body = body.replace(/\/Resources <<.*? >> >>/, "");
		if (key === "MediaBox") body = body.replace("/MediaBox [0 0 600 800]", "");
		b.object(3, body);
		b.object(
			2,
			(o.get(2) as string).replace(
				"/Count 1",
				`/Count 1 /${key} ${values[key]}`,
			),
		);
		return b.finish();
	});
add(
	"Contents array",
	(b) => {
		b.object(3, page.replace("/Contents 4 0 R", "/Contents [4 0 R 11 0 R]"));
		return b.finish();
	},
	"accepted-and-equal",
);
add("newest Root differs from previous trailer", (b) => {
	const next = new PdfBuilder(b.finish());
	next.object(30, "<< /Type /Catalog /Pages 2 0 R >>");
	next.root = "30 0 R";
	return next.finish();
});
add(
	"broken xref repaired by scanning",
	(b) => {
		b.entries.set(3, [1, 1, 0]);
		return b.finish();
	},
	"refused",
);

describe("the document signed is the document shown", () => {
	for (const c of cases)
		for (const signed of [false, true])
			it(`${c.name}: ${signed ? "incremental signed" : "prepare unsigned"}`, async () => {
				const b = new PdfBuilder(signed ? signedPrefix : undefined);
				const objects = baseObjects();
				if (signed) objects.set(1, signedCatalog);
				objects.set(11, content("Second content"));
				objects.set(12, "<< /Type /Pages /Kids [3 0 R] /Count 1 /Rotate 90 >>");
				if (signed) b.size = 128;
				if (!c.name.startsWith("duplicate "))
					for (const [n, body] of objects) b.object(n, body);
				const input = c.change(b, objects) ?? b.finish();
				const outcome = await invariant(input, signed);
				if (c.expected) expect(outcome).toBe(c.expected);
				console.info(
					`${c.name} (${signed ? "signed" : "unsigned"}): ${outcome}`,
				);
			});
});

it("accepts several ordinary pdf-lib incremental saves", async () => {
	let input = signedPrefix;
	for (let n = 0; n < 4; n++) {
		const doc = await PDFDocument.load(input, {
			forIncrementalUpdate: true,
			updateMetadata: false,
		});
		doc.context.assign(doc.context.register(PDFNumber.of(n)), PDFNumber.of(n));
		input = await doc.save({ useObjectStreams: false });
		expect((await canSign(input)).blocker).toBeUndefined();
	}
	expect(await invariant(input, true)).toBe("accepted-and-equal");
});

it("guards the UI rewrite callback before fillAndSign runs", async () => {
	const digital = readFileSync("src/screens/tools/DigitalId.tsx", "utf8");
	const fill = readFileSync("src/screens/tools/FillSign.tsx", "utf8");
	expect(digital).toContain("await canSign(await pdf())");
	expect(fill).toMatch(
		/await prepareSigningCopy\(original,\s*\(\) =>\s*fillAndSign\(original,/,
	);
	const rewrite = vi.fn(() =>
		fillAndSign(bytes("broken"), { fields: [], marks: [] }),
	);
	await expect(
		prepareSigningCopy(bytes("broken"), rewrite),
	).rejects.toMatchObject({ reason: "damaged" });
	expect(rewrite).not.toHaveBeenCalled();
});

it("matches an explicit recursive fixture inventory", async () => {
	const expected: Record<string, string> = {
		"corrupt.pdf": "damaged",
		"sample.pdf": "accepted",
		"digital-id/certified-nochanges.pdf": "certified",
		"digital-id/mixed-certified.pdf": "accepted",
		"digital-id/shadow-signed.pdf": "damaged",
		"digital-id/shadow-unsigned.pdf": "damaged",
		"digital-id/signed-once.pdf": "accepted",
		"digital-id/linearized-table.pdf": "accepted",
		"digital-id/linearized-stream.pdf": "accepted",
		"digital-id/linearized-signed.pdf": "accepted",
		"digital-id/linearized-multi.pdf": "accepted",
		"features/pictures.pdf": "accepted",
		"features/nocopy.pdf": "encrypted",
		"features/margins.pdf": "accepted",
		"features/form.pdf": "accepted",
		"features/extras.pdf": "accepted",
		"viewer-regressions/wide-fit.pdf": "accepted",
		"viewer-regressions/photo-page.pdf": "accepted",
		"viewer-regressions/locked.pdf": "encrypted",
		"viewer-regressions/cjk.pdf": "accepted",
	};
	const paths = readdirSync("fixtures", { recursive: true })
		.map(String)
		.filter((p) => p.endsWith(".pdf"))
		.map((p) => p.replaceAll("\\", "/"))
		.sort();
	expect(paths).toEqual(Object.keys(expected).sort());
	for (const p of paths)
		expect(
			(await canSign(Uint8Array.from(readFileSync(`fixtures/${p}`)))).blocker ??
				"accepted",
			p,
		).toBe(expected[p]);
});

it("checks thousands of objects and tens of megabytes in roughly linear time", async () => {
	const times = [];
	for (const scale of [1, 2]) {
		const b = new PdfBuilder();
		b.size = 4000 * scale + 100;
		for (const [n, body] of baseObjects()) b.object(n, body);
		for (let n = 100; n < b.size; n++) b.object(n, stream("x".repeat(4096)));
		const input = b.finish();
		const start = performance.now();
		expect(await canSign(input)).toEqual({ signed: false });
		const elapsed = performance.now() - start;
		times.push(elapsed);
		console.info(
			`canSign: ${input.length} bytes, ${b.entries.size} objects, ${elapsed.toFixed(0)} ms`,
		);
		expect(elapsed).toBeLessThan(12000);
	}
	expect(times[1]).toBeLessThan(times[0] * 5 + 1000);
}, 30000);
