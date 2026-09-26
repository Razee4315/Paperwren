import { readFileSync } from "node:fs";
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
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("the Sand theme applies instantly and persists", async ({ page }) => {
	await boot(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("theme-sepia").click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
	await expect(page.getByTestId("theme-sepia")).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
});

test("first run: a playful welcome that can restyle the app", async ({
	page,
}) => {
	await page.goto("/");
	const welcome = page.getByTestId("onboarding");
	await expect(welcome).toBeVisible();
	for (let i = 0; i < 3; i++) await page.getByTestId("onboarding-next").click();
	await page.getByTestId("theme-sepia").click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
	await page.getByTestId("onboarding-next").click();
	await expect(welcome).toBeHidden({ timeout: 5000 });
	await expect(page.getByTestId("empty-state")).toBeVisible();
	await page.reload();
	await expect(page.getByTestId("home")).toBeVisible();
	await expect(page.getByTestId("onboarding")).toHaveCount(0);
	await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
});

test("skip leaves the welcome immediately", async ({ page }) => {
	await page.goto("/");
	await page.getByTestId("onboarding-skip").click();
	await expect(page.getByTestId("onboarding")).toBeHidden({ timeout: 5000 });
});

/** A recent whose file is gone: the not-found dialog must be able to
 * remove it, locate it, or simply close. */
const MISSING = {
	recents_v2: [
		{
			id: "gone",
			name: "Moved report.pdf",
			format: "pdf",
			size: 1234,
			reopen: { kind: "browser", key: "no-such-file" },
			openedAt: Date.now(),
			pinned: false,
		},
	],
};

test("a missing recent can be removed from the not-found dialog", async ({
	page,
}) => {
	await boot(page, MISSING);
	await page.getByTestId("recent").first().getByRole("button").first().click();
	const dialog = page.getByTestId("open-error");
	await expect(dialog).toContainText("File not found");
	await dialog.getByRole("button", { name: "Remove" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("viewer")).toHaveCount(0);
	await expect(page.getByTestId("empty-state")).toBeVisible();
});

test("the not-found dialog closes with Escape and system Back", async ({
	page,
}) => {
	await boot(page, MISSING);
	const row = page.getByTestId("recent").first().getByRole("button").first();
	await row.click();
	const dialog = page.getByTestId("open-error");
	await expect(dialog).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("home")).toBeVisible();

	await row.click();
	await expect(dialog).toBeVisible();
	expect(await page.evaluate(() => window.__paperwrenHandleBack?.())).toBe(
		true,
	);
	await expect(dialog).toBeHidden();
	// The recent stays (marked unavailable) until the user removes it.
	await expect(page.getByTestId("recent")).toHaveCount(1);
});

test("Locate file replaces a missing recent with the chosen file", async ({
	page,
}) => {
	await boot(page, MISSING);
	await page.getByTestId("recent").first().getByRole("button").first().click();
	const dialog = page.getByTestId("open-error");
	await expect(dialog).toBeVisible();
	const b64 = readFileSync("fixtures/sample.pdf").toString("base64");
	await page.evaluate((b64) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		window.__paperwrenTestFile = new File([bytes], "Moved report.pdf");
	}, b64);
	await dialog.getByRole("button", { name: "Locate file" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("viewer")).toContainText(
		"Paperwren test page",
		{ timeout: 20_000 },
	);
	await page.getByTestId("viewer-back").click();
	await expect(page.getByTestId("recent")).toHaveCount(1);
	await expect(page.getByTestId("recent").first()).not.toContainText(
		"Unavailable",
	);
});
