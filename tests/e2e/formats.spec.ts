import { expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

const CASES: Array<[string, string]> = [
	["sample.pdf", "Paperwren test page 1 of 3"],
	["sample.docx", ""],
	["sample.doc", "The quick brown fox jumps over the lazy dog."],
	["sample.odt", "The quick brown fox jumps over the lazy dog."],
	["sample.rtf", "The quick brown fox jumps over the lazy dog."],
	["sample.xlsx", ""],
	["sample.xls", ""],
	["sample.ods", ""],
	["sample.csv", "Aisha"],
	["sample.pptx", "Quarterly Review"],
	["sample.ppt", "Quarterly Review"],
	["sample.odp", "Quarterly Review"],
	["sample.txt", "The quick brown fox jumps over the lazy dog."],
];

for (const [file, text] of CASES) {
	test(`opens ${file}`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (e) => errors.push(e.message));
		await boot(page);
		await openFixture(page, file);
		const viewer = page.getByTestId("viewer");
		await expect(viewer).toBeVisible({ timeout: 20_000 });
		await expect(viewer.locator("header")).toContainText(
			file.replace(/\.[^.]+$/, ""),
		);
		if (text) await expect(viewer).toContainText(text, { timeout: 20_000 });
		await expect(page.getByTestId("open-error")).toHaveCount(0);
		await page.getByTestId("viewer-back").click();
		await expect(viewer).toBeHidden();
		await expect(page.getByTestId("recent").first()).toContainText(file);
		expect(errors).toEqual([]);
	});
}

test("spreadsheet grid shows cells and sheet details", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.csv");
	const grid = page.getByTestId("sheet-grid");
	await expect(grid).toContainText("Ravi");
	await grid.getByText("Ravi").click();
	await expect(page.getByTestId("cell-detail")).toContainText("A3");
});

test("an unsupported file says so", async ({ page }) => {
	await boot(page);
	await openFixture(page, "not-a-document.zip");
	await expect(page.getByTestId("open-error")).toContainText(
		"Unsupported file",
	);
	await page.getByTestId("error-ok").click();
	await expect(page.getByTestId("home")).toBeVisible();
});

test("a damaged PDF shows an honest error", async ({ page }) => {
	await boot(page);
	await openFixture(page, "corrupt.pdf");
	await expect(page.getByTestId("pdf-error")).toBeVisible({ timeout: 20_000 });
});

test("text with an unknown extension still opens as text", async ({ page }) => {
	await boot(page);
	await openFixture(page, "archive.xyz");
	await expect(page.getByTestId("viewer")).toContainText("just some bytes");
});
