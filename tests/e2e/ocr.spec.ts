import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { type Page, expect, test } from "@playwright/test";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { boot, openFixture } from "./helpers";

test.setTimeout(120_000);

const LINES = [
	"The council met on Tuesday to review the budget.",
	"Members agreed that the library should stay open.",
	"Repairs to the old bridge will begin in the spring.",
];

/** A page of words as a picture inside a PDF, as a scanner makes one. */
async function scan(page: Page): Promise<Uint8Array> {
	const b64 = await page.evaluate((lines) => {
		const canvas = document.createElement("canvas");
		canvas.width = 1654;
		canvas.height = 2339;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("no canvas");
		context.fillStyle = "#f6f4ef";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = "#1c1c1c";
		context.font = '40px "Times New Roman", serif';
		lines.forEach((line, i) => context.fillText(line, 180, 300 + i * 70));
		return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
	}, LINES);
	const doc = await PDFDocument.create();
	const picture = await doc.embedJpg(Buffer.from(b64, "base64"));
	doc
		.addPage([595.28, 841.89])
		.drawImage(picture, { x: 0, y: 0, width: 595.28, height: 841.89 });
	return doc.save();
}

async function openTool(page: Page, bytes: Uint8Array) {
	await page.getByTestId("open-tools").click();
	await page.getByTestId("tool-ocr").click();
	await page.evaluate((b64) => {
		const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		window.__paperwrenTestFile = new File([data], "scan.pdf");
	}, Buffer.from(bytes).toString("base64"));
	await page.getByTestId("tool-add").click();
	await expect(page.getByTestId("read-start")).toBeVisible({ timeout: 20_000 });
}

test.describe("read text", () => {
	test("a scan is read on the screen, offline", async ({ page }) => {
		const asked: string[] = [];
		page.on("request", (r) => asked.push(r.url()));
		await boot(page);
		await openTool(page, await scan(page));
		await expect(page.getByTestId("read-language")).toHaveValue("en");
		await page.getByTestId("read-start").click();
		await expect(page.getByTestId("read-beam")).toBeVisible();
		await expect(page.getByTestId("read-copy")).toBeVisible({
			timeout: 90_000,
		});
		const text = await page.getByTestId("read-result").innerText();
		expect(text.replace(/\s+/g, " ")).toContain("old bridge");
		expect(text).toContain("library");

		// Everything it needed came from the app itself.
		const origin = new URL(page.url()).origin;
		expect(asked.filter((url) => url.startsWith("http"))).toEqual(
			asked.filter((url) => url.startsWith(origin)),
		);
		expect(asked.some((url) => url.endsWith("/ocr/eng.traineddata"))).toBe(
			true,
		);
	});

	test("the searchable copy holds the words", async ({ page }) => {
		await boot(page);
		await openTool(page, await scan(page));
		await page.getByTestId("read-start").click();
		await expect(page.getByTestId("read-save-pdf")).toBeVisible({
			timeout: 90_000,
		});
		const saved = page.waitForEvent("download");
		await page.getByTestId("read-save-pdf").click();
		const file = await saved;
		expect(file.suggestedFilename()).toBe("scan (searchable).pdf");
		const out = new Uint8Array(readFileSync(await file.path()));
		const doc = await pdfjs.getDocument({ data: out.slice(), verbosity: 0 })
			.promise;
		const { items } = await (await doc.getPage(1)).getTextContent();
		const text = items.map((i) => ("str" in i ? i.str : "")).join(" ");
		expect(text.replace(/\s+/g, " ")).toContain("old bridge");
	});

	test("the words can be saved as a text file", async ({ page }) => {
		await boot(page);
		await openTool(page, new Uint8Array(readFileSync("fixtures/sample.pdf")));
		await page.getByTestId("read-start").click();
		await expect(page.getByTestId("read-save-text")).toBeVisible({
			timeout: 30_000,
		});
		// A PDF's own words need no reading, and no searchable copy.
		await expect(page.getByTestId("read-save-pdf")).toHaveCount(0);
		const saved = page.waitForEvent("download");
		await page.getByTestId("read-save-text").click();
		const file = await saved;
		expect(file.suggestedFilename()).toBe("sample.txt");
		expect(readFileSync(await file.path(), "utf-8")).toContain(
			"Paperwren test page 2 of 3",
		);
	});

	test("stopping keeps what was read and asks nothing", async ({ page }) => {
		await boot(page);
		await openTool(page, await scan(page));
		await page.getByTestId("read-start").click();
		await expect(page.getByTestId("read-stop")).toBeVisible();
		await page.getByTestId("read-stop").click();
		await expect(page.getByTestId("read-stop")).toHaveCount(0);
		await expect(page.getByTestId("read-more")).toBeVisible();
		await expect(page.getByRole("alert")).toHaveCount(0);
	});

	test("a scan offers to be read where it is opened", async ({ page }) => {
		await boot(page);
		const bytes = await scan(page);
		await page.evaluate((b64) => {
			const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([data], "scan.pdf");
		}, Buffer.from(bytes).toString("base64"));
		await page.getByTestId("open-file").click();
		await expect(page.getByTestId("scan-offer")).toBeVisible({
			timeout: 30_000,
		});
		await page.getByTestId("scan-offer-go").click();
		await expect(page.getByTestId("read-start")).toBeVisible();
	});

	test("a PDF with words of its own offers nothing", async ({ page }) => {
		await boot(page);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		await page.waitForTimeout(1000);
		await expect(page.getByTestId("scan-offer")).toHaveCount(0);
	});
});
