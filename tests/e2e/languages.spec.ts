import { expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

test("the interface changes language at once and keeps it", async ({
	page,
}) => {
	await boot(page);
	await page.getByTestId("open-settings").click();
	const title = page.getByTestId("settings").locator("h1");
	await expect(title).toHaveText("Settings");
	await page.getByTestId("language-es").click();
	await expect(title).toHaveText("Ajustes");
	await expect(page.locator("html")).toHaveAttribute("lang", "es");
	await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
	await page.getByTestId("language-zh").click();
	await expect(title).toHaveText("设置");
	// Home, behind Settings, changed too.
	await page.getByTestId("settings-back").click();
	await expect(page.getByTestId("open-file")).toContainText("打开文件");
	await expect(page.getByTestId("empty-state")).toContainText("打开任何文档");
	// After a restart the app opens straight in that language.
	await page.reload();
	await expect(page.getByTestId("open-file")).toContainText("打开文件");
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("language-zh")).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await page.getByTestId("language-en").click();
	await expect(title).toHaveText("Settings");
});

test("Urdu and Arabic turn the app around, but not the document", async ({
	page,
}) => {
	await boot(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("language-ur").click();
	await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
	const settings = page.getByTestId("settings");
	await expect(settings.locator("h1")).toHaveText("ترتیبات");
	// The back button sits on the right and its arrow points right.
	const back = page.getByTestId("settings-back");
	const box = await back.boundingBox();
	const view = page.viewportSize();
	expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(
		(view?.width ?? 0) - 20,
	);
	await expect(back.locator("svg")).toHaveCSS(
		"transform",
		"matrix(-1, 0, 0, 1, 0, 0)",
	);
	await page.getByTestId("language-ar").click();
	await expect(settings.locator("h1")).toHaveText("الإعدادات");
	await back.click();
	// A spreadsheet keeps its own left-to-right grid inside the mirrored app.
	await openFixture(page, "sample.csv");
	const grid = page.getByTestId("sheet-grid");
	await expect(grid).toContainText("Ravi");
	await expect(grid).toHaveCSS("direction", "ltr");
	const first = await grid.getByText("Ravi").boundingBox();
	expect(first?.x).toBeLessThan(200);
	await grid.getByText("Ravi").click();
	await expect(page.getByTestId("cell-detail")).toContainText("A3");
	await expect(page.getByTestId("viewer-back")).toHaveAttribute(
		"aria-label",
		"رجوع",
	);
	await page.getByTestId("sheet-find").click();
	await page.getByTestId("find-input").fill("zzz");
	await expect(page.getByTestId("find-count")).toHaveText("لا نتائج");
});

test.describe("on a French phone", () => {
	test.use({ locale: "fr-FR" });
	test("the app starts in French without being asked", async ({ page }) => {
		await boot(page);
		await expect(page.getByTestId("open-file")).toContainText(
			"Ouvrir un fichier",
		);
		await page.getByTestId("open-settings").click();
		await expect(page.getByTestId("language-system")).toHaveAttribute(
			"aria-checked",
			"true",
		);
	});
});
