import { expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

test("empty Home explains what the app opens", async ({ page }) => {
	await boot(page);
	await expect(page.getByTestId("empty-state")).toContainText(
		"Open any document",
	);
});

test("recents survive a reload and reopen", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.pdf", "2026 tax return.pdf");
	await expect(page.getByTestId("viewer")).toContainText(
		"Paperwren test page 1 of 3",
		{ timeout: 20_000 },
	);
	await page.getByTestId("viewer-back").click();
	await page.reload();
	const row = page.getByTestId("recent").first();
	await expect(row).toContainText("2026 tax return.pdf");
	await row.getByRole("button").first().click();
	await expect(page.getByTestId("viewer")).toContainText(
		"Paperwren test page",
		{ timeout: 20_000 },
	);
});

test("search, filter, pin and remove recents", async ({ page }) => {
	await boot(page);
	for (const f of ["sample.pdf", "sample.csv"]) {
		await openFixture(page, f);
		await expect(page.getByTestId("viewer")).toBeVisible({ timeout: 20_000 });
		await page.getByTestId("viewer-back").click();
	}
	await expect(page.getByTestId("recent")).toHaveCount(2);
	await page.getByTestId("filter-sheet").click();
	await expect(page.getByTestId("recent")).toHaveCount(1);
	await page.getByTestId("filter-all").click();
	await page.getByTestId("search-input").fill("sample.pdf");
	await expect(page.getByTestId("recent")).toHaveCount(1);
	await page.getByTestId("search-input").fill("");
	await page
		.getByRole("button", { name: "More actions for sample.csv" })
		.click();
	await page.getByTestId("menu-pin").click();
	await expect(page.getByTestId("recent").first()).toContainText("sample.csv");
	await page
		.getByRole("button", { name: "More actions for sample.pdf" })
		.click();
	await page.getByTestId("menu-remove").click();
	await expect(page.getByTestId("recent")).toHaveCount(1);
});

test("PDF paging, zoom and find", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.pdf");
	await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
		timeout: 20_000,
	});
	await expect(page.getByTestId("pdf-scale")).toHaveText("Fit width");
	await page.getByTestId("pdf-zoom-in").click();
	await expect(page.getByTestId("pdf-scale")).not.toHaveText("Fit width");
	await page.getByTestId("pdf-find").click();
	await page.getByTestId("find-input").fill("test page");
	await expect(page.getByTestId("find-count")).toHaveText("1 of 3", {
		timeout: 10_000,
	});
	await page.getByTestId("find-next").click();
	await expect(page.getByTestId("find-count")).toHaveText("2 of 3");
	await page.getByTestId("pdf-page").click();
	await page.getByTestId("pdf-jump-input").fill("3");
	await page.getByTestId("pdf-jump-go").click();
	await expect(page.getByTestId("pdf-page")).toHaveText("3 / 3");
});

test("find inside a Word document", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.doc");
	await page.getByTestId("reflow-find").click();
	await page.getByTestId("find-input").fill("fox");
	await expect(page.getByTestId("find-count")).toHaveText("1 of 1");
});

test("slides show a counter", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.pptx");
	await expect(page.getByTestId("slide")).toHaveCount(3, { timeout: 20_000 });
	await expect(page.getByTestId("slide-counter")).toHaveText("1 / 3");
});

test("settings change the theme and system Back closes layers in order", async ({
	page,
}) => {
	await boot(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("theme-dark").click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	expect(await page.evaluate(() => window.__paperwrenHandleBack?.())).toBe(
		true,
	);
	await expect(page.getByTestId("settings")).toBeHidden();
	expect(await page.evaluate(() => window.__paperwrenHandleBack?.())).toBe(
		false,
	);
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("legacy settings from the previous version are migrated", async ({
	page,
}) => {
	await boot(page, {
		settings: { "appearance.theme": "slate", "appearance.pure_black": true },
	});
	await expect(page.locator("html")).toHaveAttribute("data-theme", "black");
});

test("accent colour applies instantly and persists", async ({ page }) => {
	await boot(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("accent-ocean").click();
	await expect(page.locator("html")).toHaveAttribute("data-accent", "ocean");
	await expect(page.getByTestId("accent-ocean")).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-accent", "ocean");
});
