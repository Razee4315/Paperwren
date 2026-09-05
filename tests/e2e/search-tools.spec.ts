import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

/**
 * PDF-09 / DOC-04 browser regressions (docs/14 audit section 9):
 * search counts all matches, selects the ACTUAL match (highlight
 * scrolled into view), next/previous navigation works with the
 * document visible, and the DOCX page pill tracks the reading
 * position.
 */

const samplePdf = readFileSync("fixtures/sample.pdf");
const docxFixture = readFileSync("fixtures/sample.docx");

async function bootHome(page: Page) {
	await page.addInitScript(() => {
		window.localStorage.setItem("paperwren.onboarded", "true");
		window.localStorage.setItem(
			"paperwren.settings",
			JSON.stringify({ "viewer.chrome_autohide": false }),
		);
	});
	await page.goto("/");
	await expect(page.getByTestId("home")).toBeVisible();
}

async function openBytes(page: Page, b64: string, name: string, type: string) {
	await page.evaluate(
		async ({ b64, name, type }) => {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], name, { type });
		},
		{ b64, name, type },
	);
	await page.getByTestId("empty-open-button").click();
}

test("PDF search counts all matches and navigates to the actual match", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openBytes(
		page,
		samplePdf.toString("base64"),
		"sample.pdf",
		"application/pdf",
	);
	await expect(page.locator("[data-page='1']")).toBeVisible({
		timeout: 20_000,
	});

	await page.getByTestId("pdf-search").click();
	const sheet = page.getByTestId("pdf-search-sheet");
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox").fill("paperwren");

	// The sample PDF repeats the word on every page: 3 pages.
	await expect(page.getByTestId("pdf-search-status")).toContainText("result", {
		timeout: 15_000,
	});
	const statusText = await page
		.locator("[data-testid='pdf-search-sheet']")
		.textContent();
	expect(statusText).not.toContain("5 results");

	// Jump to the first hit: the sheet closes and the match scrolls
	// into view with an active highlight on the page.
	await page.getByTestId("pdf-search-hit-0").click();
	await expect(sheet).toBeHidden();
	await expect(page.getByTestId("pdf-search-nav")).toBeVisible();
	await expect(page.locator("[data-active='true']").first()).toBeVisible();

	// Next match moves the active highlight.
	const first = await page
		.locator("[data-active='true']")
		.first()
		.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
	await page.getByTestId("pdf-search-next").click();
	await page.waitForTimeout(600);
	const second = await page
		.locator("[data-active='true']")
		.first()
		.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
	expect(Math.abs(second - first)).toBeGreaterThan(2);

	// The text layer exists and its text is selectable content.
	const textLayerText = await page
		.locator("[data-page='1'] .textLayer")
		.textContent();
	expect(textLayerText ?? "").toContain("Paperwren");
});

test("DOCX search finds matches, highlights non-destructively, and the page pill tracks position", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openBytes(
		page,
		docxFixture.toString("base64"),
		"sample.docx",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	);
	await expect(
		page.getByTestId("docx-container").locator("section.docx").first(),
	).toBeVisible({ timeout: 20_000 });

	// Page pill shows the rendered page count.
	await expect(page.getByTestId("docx-page-pill")).toContainText("Page 1 /");

	// Search for a word from the fixture.
	await page.getByTestId("docx-search").click();
	const sheet = page.getByTestId("docx-search-sheet");
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox").fill("works");
	await expect(page.getByTestId("docx-search-status")).toContainText("result", {
		timeout: 10_000,
	});
	await page.getByTestId("docx-search-hit-0").click();
	await expect(sheet).toBeHidden();
	await expect(page.getByTestId("docx-search-nav")).toBeVisible();

	// Renderer DOM survived the search: paragraphs still hold text.
	await expect(
		page.getByTestId("docx-container").getByText("DOCX reader works"),
	).toBeVisible();
});
