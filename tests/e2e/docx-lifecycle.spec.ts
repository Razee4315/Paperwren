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
const multipageDocx = readFileSync(
	"fixtures/viewer-regressions/multipage.docx",
);

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

async function openMultipageDocx(page: Page) {
	const b64 = multipageDocx.toString("base64");
	await page.evaluate(
		async (args) => {
			const bytes = Uint8Array.from(atob(args.b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], args.name, {
				type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			});
		},
		{ b64, name: "multipage.docx" },
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

/**
 * docs/15 #4 acceptance: the zoom controls exist in source
 * (DocxViewer topActions) — this verifies they stay reachable and
 * functional on a narrow phone against a real multi-page document:
 * zoom in visibly enlarges, zoom out reverses, fit width restores
 * the fit, zoomed content stays pannable, and the LAST page remains
 * reachable. Browser pinch is disabled by the viewport meta tag, so
 * these controls are the only zoom affordance on mobile.
 */
test("at 320px DOCX zoom controls fit, work, and the last page stays reachable", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 320, height: 700 });
	await openMultipageDocx(page);

	const container = page.getByTestId("docx-container");
	await expect(container.locator("section.docx")).toHaveCount(3);
	await expect
		.poll(async () => container.getAttribute("data-zoom"))
		.not.toBe(null);
	const fitZoom = await container.getAttribute("data-zoom");

	// Every top action is present and clickable at 320px (the
	// filename compresses; the 48px touch targets must not).
	for (const testId of [
		"docx-zoom-out",
		"docx-zoom-in",
		"docx-fit-width",
		"docx-search",
	]) {
		const box = await page.getByTestId(testId).boundingBox();
		if (!box) throw new Error(`${testId} has no bounding box`);
		expect(box.width).toBeGreaterThanOrEqual(44);
	}

	// Zoom in visibly enlarges the rendered page.
	const firstSection = container.locator("section.docx").first();
	const boxBefore = await firstSection.boundingBox();
	if (!boxBefore) throw new Error("first section has no bounding box");
	const widthBefore = boxBefore.width;
	await page.getByTestId("docx-zoom-in").click();
	await expect
		.poll(async () => container.getAttribute("data-zoom"))
		.not.toBe(fitZoom);
	const boxZoomed = await firstSection.boundingBox();
	if (!boxZoomed) throw new Error("zoomed section has no bounding box");
	const widthZoomed = boxZoomed.width;
	expect(widthZoomed).toBeGreaterThan(widthBefore);

	// Zoomed content overflows the reading area and stays pannable
	// through the scroller.
	const scrollState = await page.getByTestId("docx-view").evaluate((el) => ({
		scrollWidth: el.scrollWidth,
		clientWidth: el.clientWidth,
	}));
	expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth);

	// The last page remains reachable while zoomed.
	await container
		.locator("section.docx")
		.last()
		.evaluate((el) => el.scrollIntoView({ block: "start" }));
	const lastVisible = await page.getByTestId("docx-view").evaluate(() => {
		const sections = document.querySelectorAll("section.docx");
		const last = sections[sections.length - 1];
		if (!last) return false;
		const r = last.getBoundingClientRect();
		return r.top < window.innerHeight && r.bottom > 0;
	});
	expect(lastVisible).toBe(true);

	// Zoom out reverses; fit width restores the honest fit.
	await page.getByTestId("docx-zoom-out").click();
	await page.getByTestId("docx-fit-width").click();
	await expect
		.poll(async () => container.getAttribute("data-zoom"))
		.toBe(fitZoom);

	// No document-level horizontal overflow: the scroller owns it.
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
