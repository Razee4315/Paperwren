import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

/**
 * DOC-01/DOC-02 browser regressions (docs/14 audit section 9): a
 * document whose fit scale is exactly 1 must reach the ready state
 * (the loading note disappears even at 100%), and the manual zoom
 * controls keep their scale across a viewport resize until fit-width
 * is requested again.
 */

const narrowDocx = readFileSync("fixtures/viewer-regressions/narrow-fit.docx");

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

async function openDocx(page: Page) {
	const b64 = narrowDocx.toString("base64");
	await page.evaluate(
		async (args) => {
			const bytes = Uint8Array.from(atob(args.b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], args.name, {
				type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			});
		},
		{ b64, name: "narrow-fit.docx" },
	);
	await page.getByTestId("empty-open-button").click();
	await expect(page.getByTestId("docx-view")).toBeVisible({ timeout: 20_000 });
}

test("a document that fits at exactly 100% reaches ready", async ({ page }) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openDocx(page);

	// The content must be attached and the loading note gone, even
	// though the fit scale is exactly 1.
	const container = page.getByTestId("docx-container");
	await expect(container.locator("section.docx").first()).toBeVisible();
	await expect(page.getByText("Loading document...")).toBeHidden();
	await expect
		.poll(async () => container.getAttribute("data-zoom"))
		.toBe("1.0000");
});

test("manual zoom survives a resize; fit-width re-fits", async ({ page }) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openDocx(page);

	const container = page.getByTestId("docx-container");
	const fitZoom = await container.getAttribute("data-zoom");
	expect(fitZoom).toBe("1.0000");

	// Manual zoom in: 1.0 * 1.25.
	await page.getByTestId("docx-zoom-in").click();
	await expect
		.poll(async () => container.getAttribute("data-zoom"))
		.toBe("1.2500");

	// Resize the viewport: manual zoom must remain manual (DOC-02).
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(300);
	expect(await container.getAttribute("data-zoom")).toBe("1.2500");

	// Fit width re-resolves the honest fit for the new width:
	// (390 - 32) / 380 = 0.9421.
	await page.getByTestId("docx-fit-width").click();
	await expect
		.poll(async () => container.getAttribute("data-zoom"))
		.toBe("0.9421");
});
