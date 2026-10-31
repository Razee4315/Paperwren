import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { type Page, expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

async function openReader(page: Page) {
	await openFixture(page, "sample.pdf");
	await expect(
		page.locator('.page[data-page-number="1"] .textLayer span').first(),
	).toBeVisible({ timeout: 20_000 });
}

/** Drag across the first line of the page, as a mouse does. */
async function selectLine(page: Page) {
	const line = page.locator('.page[data-page-number="1"] .textLayer span');
	const box = await line.first().boundingBox();
	if (!box) throw new Error("no line");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 4, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 4, y, { steps: 5 });
	await page.mouse.up();
	await expect(page.getByTestId("selection-bar")).toBeVisible();
}

test.describe("marking while reading", () => {
	test("a highlight is made in one click and comes back", async ({ page }) => {
		await boot(page, {}, "?desktop");
		await openReader(page);
		await selectLine(page);
		await page.getByTestId("selection-color").first().click();
		await expect(page.locator(".pw-marks-under rect")).toHaveCount(1);
		await expect(page.getByTestId("selection-bar")).toHaveCount(0);

		// Time to be written, then a fresh start.
		await page.waitForTimeout(800);
		await page.reload();
		await expect(page.getByTestId("home")).toBeVisible();
		await openReader(page);
		await expect(page.locator(".pw-marks-under rect")).toHaveCount(1);
	});

	test("a note goes on the words, and into the list", async ({ page }) => {
		await boot(page, {}, "?desktop");
		await openReader(page);
		await selectLine(page);
		await page.getByTestId("selection-note").click();
		await page.getByTestId("reader-note-text").fill("Ask about this");
		await page.getByTestId("reader-note-keep").click();
		await page.getByTestId("side-toggle").click();
		await page.getByTestId("side-tab-highlights").click();
		await expect(page.getByTestId("mark-card")).toHaveCount(1);
		await expect(page.getByTestId("mark-card").locator("textarea")).toHaveValue(
			"Ask about this",
		);
	});

	test("a tap on a highlight changes or removes it", async ({ page }) => {
		await boot(page, {}, "?desktop");
		await openReader(page);
		await selectLine(page);
		await page.getByTestId("selection-color").first().click();
		const mark = await page.locator(".pw-marks-under rect").boundingBox();
		if (!mark) throw new Error("no mark");
		await page.mouse.click(mark.x + 10, mark.y + mark.height / 2);
		await expect(page.getByTestId("mark-menu")).toBeVisible();
		await page.getByTestId("mark-menu-remove").click();
		await expect(page.locator(".pw-marks-under rect")).toHaveCount(0);
		await page.getByRole("button", { name: "Undo" }).click();
		await expect(page.locator(".pw-marks-under rect")).toHaveCount(1);
	});

	test("a saved copy carries them; the file is left alone", async ({
		page,
	}) => {
		await boot(page, {}, "?desktop");
		await openReader(page);
		await selectLine(page);
		await page.getByTestId("selection-color").first().click();
		await page.getByTestId("file-more").click();
		const saved = page.waitForEvent("download");
		await page.getByTestId("pdf-save-marks").click();
		const file = await saved;
		const doc = await PDFDocument.load(readFileSync(await file.path()));
		const list = doc.getPage(0).node.Annots();
		expect(list?.size()).toBe(1);
		expect(
			doc.context
				.lookup(list?.get(0), PDFDict)
				.get(PDFName.of("Subtype"))
				?.toString(),
		).toBe("/Highlight");
	});

	test("search lists its pages", async ({ page }) => {
		await boot(page, {}, "?desktop");
		await openReader(page);
		await page.getByTestId("pdf-find").click();
		await page.getByTestId("find-input").fill("test page");
		await expect(page.getByTestId("find-list")).toBeEnabled({
			timeout: 10_000,
		});
		await page.getByTestId("find-list").click();
		await expect(page.getByTestId("find-result")).toHaveCount(3);
	});

	test("the sample opens from an empty Home", async ({ page }) => {
		await boot(page);
		await page.getByTestId("open-sample").click();
		await expect(
			page.locator('.page[data-page-number="1"] .textLayer span').first(),
		).toBeVisible({ timeout: 20_000 });
	});
});
