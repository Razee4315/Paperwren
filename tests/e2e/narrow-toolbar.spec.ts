import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

/**
 * SH-01 regression (docs/14 audit section 9): the PDF toolbar must
 * fit narrow phones honestly — Back, filename, Search and More at
 * 320px, with zoom/fit reachable through the tools sheet, no
 * toolbar-induced horizontal overflow, and more actions only when
 * measured space allows.
 */

const samplePdf = readFileSync("fixtures/sample.pdf");

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

async function openPdf(page: Page, name = "sample.pdf") {
	const b64 = samplePdf.toString("base64");
	await page.evaluate(
		async (args) => {
			const bytes = Uint8Array.from(atob(args.b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], args.name, {
				type: "application/pdf",
			});
		},
		{ b64, name },
	);
	await page.getByTestId("empty-open-button").click();
	await expect(page.getByTestId("viewer")).toBeVisible({ timeout: 20_000 });
	await expect(page.locator("[data-page='1']")).toBeVisible({
		timeout: 20_000,
	});
}

async function assertNoHorizontalOverflow(page: Page) {
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
}

test("at 320px the toolbar shows Back, filename, Search, More and fits", async ({
	page,
}) => {
	await bootHome(page);
	await page.setViewportSize({ width: 320, height: 700 });
	await openPdf(page, "a very long and descriptive quarterly report file.pdf");

	await expect(page.getByTestId("pdf-search")).toBeVisible();
	await expect(page.getByTestId("pdf-more-tools")).toBeVisible();
	await expect(page.getByTestId("pdf-zoom-out")).toBeHidden();
	await expect(page.getByTestId("pdf-zoom-in")).toBeHidden();
	await assertNoHorizontalOverflow(page);

	// The filename must stay discoverable (nonzero width, truncated).
	const nameBox = await page
		.getByTestId("viewer")
		.getByText("a very long and descriptive quarterly report file.pdf")
		.boundingBox();
	expect(nameBox).not.toBeNull();
	expect(nameBox?.width ?? 0).toBeGreaterThan(40);
});

test("at 320px zoom and fit live in the tools sheet and still work", async ({
	page,
}) => {
	await bootHome(page);
	await page.setViewportSize({ width: 320, height: 700 });
	await openPdf(page);

	await page.getByTestId("pdf-more-tools").click();
	const tools = page.getByTestId("pdf-tools-sheet");
	await expect(tools).toBeVisible();

	const fitPill = page.getByTestId("pdf-fit-pill");
	const before = await fitPill.textContent();

	await tools.getByTestId("pdf-tools-zoom-in").click();
	await expect(tools).toBeHidden();
	const after = await fitPill.textContent();
	expect(after).not.toBe(before);
	await assertNoHorizontalOverflow(page);
});

test("at 412px zoom buttons return to the toolbar; at 800px fit buttons too", async ({
	page,
}) => {
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openPdf(page);
	await expect(page.getByTestId("pdf-zoom-in")).toBeVisible();
	await expect(page.getByTestId("pdf-zoom-out")).toBeVisible();
	await expect(page.getByRole("button", { name: "Fit width" })).toBeHidden();
	await assertNoHorizontalOverflow(page);

	await page.setViewportSize({ width: 800, height: 900 });
	await expect(page.getByRole("button", { name: "Fit width" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Fit page" })).toBeVisible();
	await assertNoHorizontalOverflow(page);
});
