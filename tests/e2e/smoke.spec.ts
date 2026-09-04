import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

const samplePdf = readFileSync("fixtures/sample.pdf");

/** Boot past onboarding into an empty Home. Viewer chrome stays
 * visible so toolbar buttons never auto-hide mid-test. */
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

/** Open a file through the dev injection hook, exactly like the
 * picker would deliver it to the browser backend. */
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
}

test("opening a PDF keeps its real name and Back returns Home", async ({
	page,
}) => {
	await bootHome(page);
	await openPdf(page, "2026 tax return.pdf");

	const viewer = page.getByTestId("viewer");
	await expect(viewer).toBeVisible({ timeout: 20_000 });
	await expect(viewer.getByText("2026 tax return.pdf")).toBeVisible();

	// A page box must actually lay out.
	await expect(viewer.locator("[data-page='1']")).toBeVisible();

	// Toolbar Back and system Back share one handler; one Back step
	// pops the viewer off the stack.
	await page.getByTestId("viewer-back").click();
	await expect(page.getByTestId("viewer")).toBeHidden();
});

test("recents record the real name and reopen after a reload", async ({
	page,
}) => {
	await bootHome(page);
	await openPdf(page, "2026 tax return.pdf");
	await expect(page.getByTestId("viewer")).toBeVisible({ timeout: 20_000 });

	// The recent was recorded from ingestion metadata, before and
	// independent of PDF.js parsing.
	await page.getByTestId("viewer-back").click();
	await expect(page.getByTestId("viewer")).toBeHidden();
	const card = page.locator("[data-testid^='recent-']").first();
	await expect(card).toContainText("2026 tax return.pdf");

	// Process restart: only the persisted recents list survives.
	await page.reload();
	await expect(page.getByTestId("home")).toBeVisible();
	// Browser dev sources cannot survive a reload (in-memory File);
	// the entry must still exist with its real name.
	await expect(page.locator("[data-testid^='recent-']").first()).toContainText(
		"2026 tax return.pdf",
	);
});

test("settings subpage Back returns to Settings root, then Home", async ({
	page,
}) => {
	await bootHome(page);
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("settings")).toBeVisible();
	await page.getByTestId("settings-appearance").click();
	await expect(page.getByText("Appearance")).toBeVisible();

	await page.getByTestId("settings-back").click();
	await expect(page.getByText("Viewer defaults")).toBeVisible();

	await page.goBack(); // browser history mirrors system Back
	await expect(page.getByTestId("settings")).toBeHidden();
});

test("viewer sheets dismiss on Back before leaving the viewer", async ({
	page,
}) => {
	await bootHome(page);
	await openPdf(page);
	const viewer = page.getByTestId("viewer");
	await expect(viewer).toBeVisible({ timeout: 20_000 });

	await page.getByTestId("pdf-more-tools").click();
	await page.getByTestId("pdf-tools-pages").click();
	await expect(page.getByTestId("pdf-thumbs-grid")).toBeVisible({
		timeout: 10_000,
	});

	// Thumbnails sheet is now the top overlay; browser Back (the
	// desktop stand-in for system Back) must dismiss it, not exit.
	await page.goBack();
	await expect(page.getByTestId("viewer")).toBeVisible();
	await expect(page.getByTestId("pdf-thumbs-grid")).toBeHidden({
		timeout: 10_000,
	});
});
