import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { boot, openFixture } from "./helpers";

type Paper = "clear" | "white" | "photo";

/**
 * Hand the next file picker a picture of a signature made the way people
 * make them: ink on a clear PNG, ink on a white PNG, or a JPEG photo of
 * paper (off-white, a little uneven).
 */
async function nextPicture(page: Page, paper: Paper, ink = "#14213d") {
	await page.evaluate(
		async ({ paper, ink }) => {
			const canvas = document.createElement("canvas");
			canvas.width = 600;
			canvas.height = 220;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("no canvas");
			if (paper === "white") {
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(0, 0, 600, 220);
			} else if (paper === "photo") {
				const g = ctx.createLinearGradient(0, 0, 600, 220);
				g.addColorStop(0, "#e9e6df");
				g.addColorStop(1, "#d8d4cb");
				ctx.fillStyle = g;
				ctx.fillRect(0, 0, 600, 220);
			}
			ctx.strokeStyle = ink;
			ctx.lineWidth = 7;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(40, 150);
			for (let x = 40; x <= 560; x += 8)
				ctx.lineTo(x, 110 + 50 * Math.sin(x / 35));
			ctx.stroke();
			const type = paper === "photo" ? "image/jpeg" : "image/png";
			const blob = await new Promise<Blob | null>((done) =>
				canvas.toBlob(done, type, 0.9),
			);
			if (!blob) throw new Error("no picture");
			window.__paperwrenTestFile = new File(
				[blob],
				paper === "photo" ? "signature.jpg" : "signature.png",
				{ type },
			);
		},
		{ paper, ink },
	);
}

/** How much of a picture on the page is ink (not clear). */
async function inkShare(page: Page, testId: string) {
	return page.getByTestId(testId).evaluate(async (el) => {
		const img = el as HTMLImageElement;
		await img.decode();
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx || !canvas.width) return 0;
		ctx.drawImage(img, 0, 0);
		const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
		let ink = 0;
		for (let i = 3; i < data.length; i += 4) if (data[i] > 16) ink++;
		return ink / (data.length / 4);
	});
}

/** Save the editor's copy and return its bytes. */
async function saveCopy(page: Page) {
	await page.getByTestId("fill-save").click();
	const download = page.waitForEvent("download");
	await page.getByTestId("fill-save-go").click();
	const file = await download;
	return {
		name: file.suggestedFilename(),
		bytes: new Uint8Array(readFileSync(await file.path())),
	};
}

/** How many pictures each page of a PDF paints. */
async function picturesPerPage(bytes: Uint8Array) {
	const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 })
		.promise;
	const out: number[] = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const ops = await (await doc.getPage(n)).getOperatorList();
		out.push(
			ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length,
		);
	}
	await doc.destroy();
	return out;
}

/** Tap a spot on the first page, as a share of its size. */
async function tapPage(page: Page, u: number, v: number) {
	const box = await page.getByTestId("fill-page").first().boundingBox();
	if (!box) throw new Error("no page");
	await page.mouse.click(box.x + box.width * u, box.y + box.height * v);
}

async function openEditor(page: Page, store: Record<string, unknown> = {}) {
	await boot(page, store);
	await openFixture(page, "features/form.pdf");
	await expect(page.getByTestId("pdf-page")).toHaveText("1 / 2", {
		timeout: 20_000,
	});
	await page.getByTestId("file-more").click();
	await page.getByTestId("pdf-fill-sign").click();
	const editor = page.getByTestId("fill-sign");
	await expect(editor.getByTestId("fill-field")).toHaveCount(5);
	return editor;
}

test.describe("a signature from a picture", () => {
	for (const paper of ["clear", "white", "photo"] as const)
		test(`ink on ${paper} paper is shown and used`, async ({ page }) => {
			const editor = await openEditor(page);
			await editor.getByTestId("fill-sign-here").click();
			await page.getByTestId("signature-photo").click();
			await nextPicture(page, paper);
			await page.getByTestId("signature-pick").click();
			const preview = page.getByTestId("signature-preview");
			await expect(preview).toBeVisible();
			const share = await inkShare(page, "signature-preview");
			// The ink is there, and the paper is not.
			expect(share).toBeGreaterThan(0.02);
			expect(share).toBeLessThan(0.6);
			await page.getByTestId("signature-done").click();
			await expect(page.getByTestId("signature-pad")).toHaveCount(0);
			await expect(editor.getByTestId("fill-item")).toHaveCount(1);
		});
});

test("an uploaded signature is placed, kept, and saved into the PDF", async ({
	page,
}) => {
	const editor = await openEditor(page);
	await editor.getByTestId("fill-tool-sign").click();
	await page.getByTestId("signature-photo").click();
	await nextPicture(page, "clear");
	await page.getByTestId("signature-pick").click();
	await page.getByTestId("signature-done").click();
	await expect(page.getByTestId("fill-hint")).toContainText("Signature");
	await tapPage(page, 0.5, 0.75);
	await expect(editor.getByTestId("fill-item")).toHaveCount(1);
	// Kept for next time.
	await editor.getByTestId("fill-tool-sign").click();
	await editor.getByTestId("fill-tool-sign").click();
	await expect(page.getByTestId("signature-kept")).toHaveCount(1);
	await page.keyboard.press("Escape");
	const saved = await saveCopy(page);
	expect(saved.name).toBe("form (signed).pdf");
	expect((await picturesPerPage(saved.bytes))[0]).toBeGreaterThanOrEqual(1);
});

test("a picture with nothing on it says so, and Use it is never silent", async ({
	page,
}) => {
	const editor = await openEditor(page);
	await editor.getByTestId("fill-sign-here").click();
	await page.getByTestId("signature-photo").click();
	await page.evaluate(async () => {
		const canvas = document.createElement("canvas");
		canvas.width = 200;
		canvas.height = 80;
		const blob = await new Promise<Blob | null>((done) =>
			canvas.toBlob(done, "image/png"),
		);
		if (!blob) throw new Error("no picture");
		window.__paperwrenTestFile = new File([blob], "empty.png", {
			type: "image/png",
		});
	});
	await page.getByTestId("signature-pick").click();
	await expect(
		page.getByText("No signature was found in that picture"),
	).toBeVisible();
	await expect(page.getByTestId("signature-done")).toBeDisabled();
});

test.describe("stamps", () => {
	test("a stamp is made, placed twice, kept, and saved", async ({ page }) => {
		const editor = await openEditor(page);
		await editor.getByTestId("fill-tool-stamp").click();
		const pad = page.getByTestId("stamp-pad");
		await expect(pad).toBeVisible();
		await expect(page.getByTestId("stamp-done")).toBeDisabled();
		await pad.getByRole("button", { name: "APPROVED" }).click();
		await page.getByTestId("stamp-shape-round").click();
		await page.getByTestId("stamp-date").check();
		await expect(page.getByTestId("stamp-preview")).toBeVisible();
		expect(await inkShare(page, "stamp-preview")).toBeGreaterThan(0.03);
		await page.getByTestId("stamp-text").fill("Checked by Lena");
		await expect(page.getByTestId("stamp-preview")).toBeVisible();
		await page.getByTestId("stamp-done").click();
		await expect(pad).toHaveCount(0);
		await expect(page.getByTestId("fill-hint")).toContainText("Stamp");
		await tapPage(page, 0.3, 0.8);
		await tapPage(page, 0.7, 0.85);
		await expect(editor.getByTestId("fill-item")).toHaveCount(2);
		await expect(
			editor.locator('[data-testid="fill-item"][data-kind="stamp"]'),
		).toHaveCount(2);
		// Kept: the next stamp is a tap away.
		await editor.getByTestId("fill-tool-stamp").click();
		await editor.getByTestId("fill-tool-stamp").click();
		await expect(page.getByTestId("stamp-kept")).toHaveCount(1);
		await page.getByTestId("stamp-kept").click();
		await tapPage(page, 0.5, 0.5);
		await expect(editor.getByTestId("fill-item")).toHaveCount(3);
		const saved = await saveCopy(page);
		expect(saved.name).toBe("form (filled in).pdf");
		expect((await picturesPerPage(saved.bytes))[0]).toBe(3);
	});

	test("a stamp from a clear PNG keeps its colour", async ({ page }) => {
		const editor = await openEditor(page);
		await editor.getByTestId("fill-tool-stamp").click();
		await page.getByTestId("stamp-upload").click();
		await nextPicture(page, "clear", "#c62828");
		await page.getByTestId("stamp-pick").click();
		await expect(page.getByTestId("stamp-preview")).toBeVisible();
		// Already clear: nothing to make clear.
		await expect(page.getByTestId("stamp-clear")).toHaveCount(0);
		const share = await inkShare(page, "stamp-preview");
		expect(share).toBeGreaterThan(0.02);
		expect(share).toBeLessThan(0.6);
		const red = await page.getByTestId("stamp-preview").evaluate((el) => {
			const img = el as HTMLImageElement;
			const c = document.createElement("canvas");
			c.width = img.naturalWidth;
			c.height = img.naturalHeight;
			const ctx = c.getContext("2d");
			if (!ctx) return false;
			ctx.drawImage(img, 0, 0);
			const d = ctx.getImageData(0, 0, c.width, c.height).data;
			for (let i = 0; i < d.length; i += 4)
				if (d[i + 3] > 200) return d[i] > 150 && d[i + 1] < 90;
			return false;
		});
		expect(red).toBe(true);
		await page.getByTestId("stamp-done").click();
		await tapPage(page, 0.5, 0.8);
		await expect(editor.getByTestId("fill-item")).toHaveCount(1);
	});

	test("a scanned stamp on white has its paper made clear, or kept", async ({
		page,
	}) => {
		const editor = await openEditor(page);
		await editor.getByTestId("fill-tool-stamp").click();
		await page.getByTestId("stamp-upload").click();
		await nextPicture(page, "white", "#1a3c8c");
		await page.getByTestId("stamp-pick").click();
		const clear = page.getByTestId("stamp-clear");
		await expect(clear).toBeChecked();
		expect(await inkShare(page, "stamp-preview")).toBeLessThan(0.6);
		await clear.uncheck();
		await expect
			.poll(() => inkShare(page, "stamp-preview"))
			.toBeGreaterThan(0.95);
		await page.getByTestId("stamp-done").click();
		await tapPage(page, 0.5, 0.8);
		await expect(editor.getByTestId("fill-item")).toHaveCount(1);
	});

	test("kept stamps can be forgotten in Settings", async ({ page }) => {
		await boot(page, {
			stamps_v1: [
				{ id: "t1", src: "data:image/png;base64,iVBORw0KGgo=", w: 10, h: 4 },
			],
		});
		await page.getByTestId("open-settings").click();
		const forget = page.getByTestId("clear-stamps");
		await expect(forget).toBeEnabled();
		await forget.click();
		await expect(forget).toBeDisabled();
		await expect(page.getByText("Stamps forgotten")).toBeVisible();
		await page.getByRole("button", { name: "Undo" }).click();
		await expect(forget).toBeEnabled();
	});
});

test("on a desktop the signature and stamp dialogs have room", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	const editor = await openEditor(page);
	await editor.getByTestId("fill-tool-sign").click();
	const sign = await page.getByTestId("signature-pad").boundingBox();
	expect(sign?.width).toBeGreaterThan(560);
	const pad = await page.getByTestId("signature-canvas").boundingBox();
	expect(pad?.width).toBeGreaterThan(500);
	await page.keyboard.press("Escape");
	await editor.getByTestId("fill-tool-stamp").click();
	const stamp = await page.getByTestId("stamp-pad").boundingBox();
	expect(stamp?.width).toBeGreaterThan(560);
});
