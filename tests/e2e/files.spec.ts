import { copyFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

// ---------- the file menu ----------

test("the file menu shows details and saves a copy", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.xlsx");
	await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 20_000 });
	await page.getByTestId("file-more").click();
	const menu = page.getByTestId("file-menu");
	await expect(menu).toContainText("sample.xlsx");
	// A browser cannot open another app or show a folder: not offered.
	await expect(page.getByTestId("file-open-with")).toHaveCount(0);
	await expect(page.getByTestId("file-reveal")).toHaveCount(0);
	await expect(page.getByTestId("file-print")).toBeVisible();

	await page.getByTestId("file-details-open").click();
	const details = page.getByTestId("file-details");
	await expect(details).toContainText("sample.xlsx");
	await expect(details).toContainText("XLSX · Sheets");
	await expect(details).toContainText("KB");
	await expect(details).toContainText("This browser");
	await details.getByRole("button", { name: "Done" }).click();
	await expect(details).toHaveCount(0);

	// With no share sheet in this browser, sharing is "Save a copy".
	await page.getByTestId("file-more").click();
	const share = page.getByTestId("file-share");
	await expect(share).toHaveText("Save a copy");
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		share.click(),
	]);
	expect(download.suggestedFilename()).toBe("sample.xlsx");
	await expect(menu).toHaveCount(0);
});

test("a recent's menu shows when it was last opened", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.txt");
	await expect(page.getByTestId("viewer")).toContainText("quick brown fox");
	await page.getByTestId("viewer-back").click();
	await page
		.getByRole("button", { name: "More actions for sample.txt" })
		.click();
	await expect(page.getByTestId("menu-share")).toHaveText("Save a copy");
	await page.getByTestId("menu-details").click();
	const details = page.getByTestId("file-details");
	await expect(details).toContainText("TXT · Text");
	await expect(details).toContainText("Last opened");
	await expect(details).toContainText(String(new Date().getFullYear()));
});

// ---------- printing ----------

/** Hold the print dialog open: the paper layout stays in the page
 * until the test "closes" it. */
async function holdPrint(page: Page) {
	await page.addInitScript(() => {
		window.print = () => {
			(window as unknown as { __printing: boolean }).__printing = true;
		};
	});
}
async function startPrint(page: Page) {
	await page.getByTestId("file-more").click();
	await page.getByTestId("file-print").click();
	await page.waitForFunction(
		() => (window as unknown as { __printing?: boolean }).__printing,
		null,
		{ timeout: 30_000 },
	);
	await page.emulateMedia({ media: "print" });
}
async function endPrint(page: Page) {
	await page.emulateMedia({ media: "screen" });
	await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
	await expect(page.locator("#pw-print > *")).toHaveCount(0);
}

const PRINTS: Array<[string, string, number, string]> = [
	["viewer-regressions/grid.xlsx", "table tr", 65, "Region 60"],
	["viewer-regressions/multipage.docx", "section.docx", 3, "the last page"],
	["sample.pdf", "img.pw-page", 3, ""],
	["viewer-regressions/effects.pptx", '[data-testid="slide"]', 3, "Build"],
	["sample.txt", "pre", 1, "quick brown fox"],
	["sample.doc", "p", 1, "quick brown fox"],
	["sample.png", "img.pw-page", 1, ""],
];

for (const [file, unit, count, text] of PRINTS) {
	test(`printing ${file} lays the whole document out for paper`, async ({
		page,
	}) => {
		await holdPrint(page);
		await boot(page);
		await openFixture(page, file);
		await expect(page.getByTestId("viewer")).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId("file-more")).toBeVisible();
		// Wait for the document itself, not only its frame.
		await page.waitForTimeout(1500);
		await startPrint(page);
		const paper = page.locator("#pw-print");
		// Only the paper layout shows; the app is hidden.
		await expect(paper).toBeVisible();
		await expect(page.getByTestId("viewer")).toBeHidden();
		await expect(page.getByTestId("home")).toBeHidden();
		const units = paper.locator(unit);
		if (count > 1) await expect(units).toHaveCount(count);
		else expect(await units.count()).toBeGreaterThanOrEqual(1);
		if (text) await expect(paper).toContainText(text);
		// Nothing is wider than the sheet of paper.
		const width = await paper.evaluate((el) => el.scrollWidth);
		expect(width).toBeLessThanOrEqual(
			(page.viewportSize()?.width ?? 0) > 800
				? (page.viewportSize()?.width ?? 0)
				: 800,
		);
		await endPrint(page);
		await expect(page.getByTestId("viewer")).toBeVisible();
	});
}

// ---------- pictures ----------

test("a picture opens, zooms and is filed under Pictures", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.png");
	await expect(page.getByTestId("image-size")).toHaveText("320 × 200", {
		timeout: 20_000,
	});
	const picture = page.getByTestId("image");
	// Fitted, never blown up past its own pixels.
	await expect.poll(async () => (await picture.boundingBox())?.width).toBe(320);
	const scale = page.getByTestId("image-scale");
	await expect(scale).toHaveText("Fit");
	await page.getByTestId("image-zoom-in").click();
	await expect(scale).toHaveText("125%");
	await expect.poll(async () => (await picture.boundingBox())?.width).toBe(400);
	await scale.click();
	await expect(scale).toHaveText("Fit");
	await page.getByTestId("viewer-back").click();
	await expect(page.getByTestId("recent").first()).toContainText("sample.png");
	await expect(page.getByTestId("filter-image")).toContainText("Pictures");
});

test("a picture with the wrong extension is still a picture", async ({
	page,
}) => {
	await boot(page);
	await openFixture(page, "sample.png", "scan.pdf");
	await expect(page.getByTestId("image-size")).toHaveText("320 × 200", {
		timeout: 20_000,
	});
});

// ---------- folders ----------

test("a folder's documents are listed, searched and opened", async ({
	page,
}) => {
	const root = mkdtempSync(join(tmpdir(), "paperwren-"));
	const folder = join(root, "Reports");
	mkdirSync(join(folder, "2026"), { recursive: true });
	copyFileSync("fixtures/sample.pdf", join(folder, "budget.pdf"));
	copyFileSync("fixtures/sample.csv", join(folder, "people.csv"));
	copyFileSync("fixtures/sample.txt", join(folder, "2026", "notes.txt"));
	copyFileSync("fixtures/not-a-document.zip", join(folder, "backup.zip"));

	await boot(page);
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page.getByTestId("browse-folder").click(),
	]);
	await chooser.setFiles(folder);
	const place = page.getByTestId("place-folder");
	await expect(place).toHaveText("Reports");
	await expect(place).toHaveAttribute("aria-pressed", "true");
	const files = page.getByTestId("folder-file");
	// The zip is not a document: left out. Subfolders are looked into.
	await expect(files).toHaveCount(3);
	await expect(files.filter({ hasText: "notes.txt" })).toContainText("2026");

	await page.getByTestId("folder-search").fill("budget");
	await expect(files).toHaveCount(1);
	await page.getByTestId("folder-search").fill("nothing-like-this");
	await expect(page.getByTestId("folder-empty")).toContainText(
		"Nothing matches",
	);
	await page.getByTestId("folder-search").fill("");

	await files.filter({ hasText: "people.csv" }).getByRole("button").click();
	await expect(page.getByTestId("sheet-grid")).toContainText("Ravi", {
		timeout: 20_000,
	});
	await page.getByTestId("viewer-back").click();
	// Opening from a folder adds the file to recents.
	await page.getByTestId("place-recent").click();
	await expect(page.getByTestId("recent").first()).toContainText("people.csv");

	// Removing the folder forgets it; its files are untouched.
	await place.click();
	await page.getByTestId("folder-remove").click();
	await expect(page.getByTestId("place-folder")).toHaveCount(0);
	await expect(page.getByText("Its files are untouched")).toBeVisible();
});
