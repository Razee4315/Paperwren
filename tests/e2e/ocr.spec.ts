import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { type Page, expect, test } from "@playwright/test";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { boot } from "./helpers";

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
	await expect(page.getByTestId("tool-go")).toBeEnabled({ timeout: 20_000 });
}

test.describe("make a scan searchable", () => {
	test("a scan comes back with words, offline", async ({ page }) => {
		const asked: string[] = [];
		page.on("request", (r) => asked.push(r.url()));
		await boot(page);
		const bytes = await scan(page);
		await openTool(page, bytes);
		await expect(page.getByTestId("tool-ocr-language")).toHaveValue("en");
		await page.getByTestId("tool-ocr-language").selectOption("en");
		const saved = page.waitForEvent("download", { timeout: 90_000 });
		await page.getByTestId("tool-go").click();
		const file = await saved;
		expect(file.suggestedFilename()).toBe("scan (searchable).pdf");

		const out = new Uint8Array(readFileSync(await file.path()));
		const doc = await pdfjs.getDocument({ data: out.slice(), verbosity: 0 })
			.promise;
		const { items } = await (await doc.getPage(1)).getTextContent();
		const text = items.map((i) => ("str" in i ? i.str : "")).join(" ");
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

	test("a PDF that already has words is left alone", async ({ page }) => {
		await boot(page);
		const bytes = readFileSync("fixtures/sample.pdf");
		await openTool(page, new Uint8Array(bytes));
		await page.getByTestId("tool-go").click();
		await expect(page.getByTestId("ocr-outcome")).toContainText(
			"no copy was made",
			{ timeout: 30_000 },
		);
	});

	test("cancelling stops the reading and saves nothing", async ({ page }) => {
		await boot(page);
		const bytes = await scan(page);
		await openTool(page, bytes);
		let saved = false;
		page.on("download", () => {
			saved = true;
		});
		await page.getByTestId("tool-go").click();
		await expect(page.getByTestId("ocr-progress")).toContainText("1 of 1");
		await page.getByTestId("ocr-cancel").click();
		await expect(page.getByTestId("ocr-cancel")).toHaveCount(0);
		await expect(page.getByTestId("ocr-progress")).toHaveCount(0);
		expect(saved).toBe(false);
		await expect(page.getByRole("alert")).toHaveCount(0);
	});
});
