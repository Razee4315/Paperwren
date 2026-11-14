// @vitest-environment node
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, degrees } from "@cantoo/pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { fromShare } from "../../screens/viewer/pdfCrop";
import { type CropChoice, boxByHand } from "../crop";
import { type CropBox, cropCopy } from "../pdfTools";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	"../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
	import.meta.url,
).toString();

async function source() {
	const doc = await PDFDocument.create();
	for (let i = 0; i < 4; i++) doc.addPage([600, 800]);
	return doc.save();
}

describe("cropped copies", () => {
	it.each<CropChoice>([
		{ auto: false, all: [0.1, 0.2, 0.8, 0.9] },
		{ auto: false, odd: [0.1, 0.2, 0.8, 0.9] },
		{ auto: false, even: [0.1, 0.2, 0.8, 0.9] },
		{ auto: false, pages: { 2: [0.1, 0.2, 0.8, 0.9] } },
	])("keeps scope and page count: %j", async (choice) => {
		const bytes = await source();
		const before = bytes.slice();
		const boxes = Array.from({ length: 4 }, (_, i) => {
			const share = boxByHand(choice, i + 1);
			return share ? fromShare(share, [0, 0, 600, 800]) : null;
		});
		const copy = await PDFDocument.load(await cropCopy(bytes, boxes));
		expect(copy.getPageCount()).toBe(4);
		for (const [i, page] of copy.getPages().entries()) {
			expect(page.getCropBox()).toEqual(
				boxes[i]
					? { x: 60, y: 160, width: 420, height: 560 }
					: { x: 0, y: 0, width: 600, height: 800 },
			);
			if (!boxes[i]) expect(page.node.has(PDFName.of("CropBox"))).toBe(false);
		}
		expect(bytes).toEqual(before);
	});

	it.each([0, 90, 180, 270])(
		"uses the editor's inverse viewport at %i degrees with UserUnit and an existing crop",
		async (turn) => {
			const doc = await PDFDocument.create();
			const page = doc.addPage();
			page.setMediaBox(-50, 30, 600, 800);
			page.setCropBox(10, 80, 400, 600);
			page.setRotation(degrees(turn));
			page.node.set(PDFName.of("UserUnit"), doc.context.obj(2));
			const bytes = await doc.save();
			const reader = await pdfjs.getDocument({ data: bytes.slice() }).promise;
			try {
				const pg = await reader.getPage(1);
				const vp = pg.getViewport({ scale: 1 });
				const a = vp.convertToPdfPoint(vp.width * 0.1, vp.height * 0.2);
				const b = vp.convertToPdfPoint(vp.width * 0.8, vp.height * 0.9);
				const box: CropBox = [
					Math.min(a[0], b[0]),
					Math.min(a[1], b[1]),
					Math.max(a[0], b[0]),
					Math.max(a[1], b[1]),
				];
				const copy = await PDFDocument.load(await cropCopy(bytes, [box]));
				const saved = copy.getPage(0);
				expect(saved.getCropBox()).toEqual({
					x: box[0],
					y: box[1],
					width: box[2] - box[0],
					height: box[3] - box[1],
				});
				expect(saved.getRotation().angle).toBe(turn);
				const reopened = await pdfjs.getDocument({ data: await copy.save() })
					.promise;
				try {
					const shown = (await reopened.getPage(1)).getViewport({ scale: 1 });
					expect(shown.width).toBeCloseTo(vp.width * 0.7);
					expect(shown.height).toBeCloseTo(vp.height * 0.7);
				} finally {
					await reopened.destroy();
				}
			} finally {
				await reader.destroy();
			}
		},
	);

	it("clamps, skips empty, inverted and nonfinite boxes, and contains auxiliary boxes", async () => {
		const doc = await PDFDocument.load(await source());
		const page = doc.getPage(0);
		page.setBleedBox(0, 0, 600, 800);
		page.setTrimBox(100, 200, 50, 50);
		page.setArtBox(500, 700, 30, 30);
		const copy = await PDFDocument.load(
			await cropCopy(await doc.save(), [
				[-10, 100, 400, 900],
				[3, 3, 2, 4],
				[0, 0, 0, 5],
				[0, 0, Number.NaN, 5],
			]),
		);
		expect(copy.getPage(0).getCropBox()).toEqual({
			x: 0,
			y: 100,
			width: 400,
			height: 700,
		});
		expect(copy.getPage(0).getBleedBox()).toEqual(copy.getPage(0).getCropBox());
		expect(copy.getPage(0).getTrimBox()).toEqual({
			x: 100,
			y: 200,
			width: 50,
			height: 50,
		});
		expect(copy.getPage(0).getArtBox()).toEqual(copy.getPage(0).getCropBox());
		for (const pg of copy.getPages().slice(1))
			expect(pg.node.has(PDFName.of("CropBox"))).toBe(false);
	});

	it("keeps form values without regenerating appearances", async () => {
		const doc = await PDFDocument.load(await source());
		const field = doc.getForm().createTextField("answer");
		field.setText("kept");
		field.addToPage(doc.getPage(0));
		const copy = await PDFDocument.load(
			await cropCopy(await doc.save(), [[10, 20, 500, 700]]),
		);
		expect(copy.getForm().getTextField("answer").getText()).toBe("kept");
	});

	it("uses the neighbouring tools' password policy on the locked fixture", async () => {
		const bytes = new Uint8Array(
			readFileSync("fixtures/viewer-regressions/locked.pdf"),
		);
		await expect(cropCopy(bytes, [])).rejects.toMatchObject({
			reason: "password",
		});
		await expect(
			cropCopy(bytes, [], { password: "wrong" }),
		).rejects.toMatchObject({ reason: "password" });
		const copy = await PDFDocument.load(
			await cropCopy(bytes, [[10, 20, 200, 300]], { password: "wren" }),
		);
		expect(copy.getPage(0).getCropBox()).toEqual({
			x: 10,
			y: 20,
			width: 190,
			height: 280,
		});
	});
});
