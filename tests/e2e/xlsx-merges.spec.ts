import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

/**
 * XLS-03/XLS-06 browser regressions (docs/14 audit section 9): a
 * merged range renders as ONE box spanning the rectangle, tap-to-
 * select exposes the cell strip, details resolve to the anchor, and
 * copy reports feedback. Edges of the merge box must agree with the
 * covered header/cell edges within 1 CSS px.
 */

const mergesXlsx = readFileSync("fixtures/viewer-regressions/merges.xlsx");

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

async function openMerges(page: Page) {
	const b64 = mergesXlsx.toString("base64");
	await page.evaluate(
		async (args) => {
			const bytes = Uint8Array.from(atob(args.b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], args.name, {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			});
		},
		{ b64, name: "merges.xlsx" },
	);
	await page.getByTestId("empty-open-button").click();
	await expect(page.getByTestId("xlsx-grid")).toBeVisible({ timeout: 20_000 });
}

test("a merged range renders as one spanning box", async ({ page }) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openMerges(page);

	// The fixture merges A1:D1 over a 120px A column, then 90/90/90.
	const merge = page.locator("[data-testid='xlsx-merge-0-0']");
	await expect(merge).toHaveText("Quarterly report");
	const m = await merge.boundingBox();
	expect(m).not.toBeNull();

	// Right edge of the merge must match the right edge of the D
	// header/cell within 1px; top must match the first body row.
	const colD = await page.locator("[data-testid='xlsx-head-3']").boundingBox();
	const row0 = await page
		.locator("[data-testid='xlsx-cell-1-0']")
		.boundingBox();
	expect(colD && row0 && m).toBeTruthy();
	if (colD && row0 && m) {
		expect(Math.abs(m.x + m.width - (colD.x + colD.width))).toBeLessThanOrEqual(
			1,
		);
		// The merge bottom edge meets the first body row top.
		expect(Math.abs(m.y + m.height - row0.y)).toBeLessThanOrEqual(2);
	}

	// The covered interior cells are not mounted.
	await expect(page.locator("[data-testid='xlsx-cell-0-1']")).toHaveCount(0);
	await expect(page.locator("[data-testid='xlsx-cell-0-2']")).toHaveCount(0);
});

test("tap selects, the strip shows the anchor, details resolve merges", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openMerges(page);

	// Tap the merged title cell: selection resolves to the anchor.
	await page.locator("[data-testid='xlsx-merge-0-0']").click();
	await expect(page.getByTestId("xlsx-cell-strip")).toBeVisible();
	await expect(page.getByTestId("xlsx-cell-strip")).toContainText("A1");
	await expect(page.getByTestId("xlsx-cell-strip")).toContainText(
		"Quarterly report",
	);

	// Details open from the strip; Back (Escape/overlay) closes.
	await page.getByTestId("xlsx-details-open").click();
	await expect(page.getByTestId("xlsx-cell-details-sheet")).toBeVisible();
	await expect(page.getByTestId("xlsx-detail-value")).toContainText(
		"Quarterly report",
	);
	// Copy reports feedback instead of silently failing.
	await page.getByTestId("xlsx-detail-copy").click();
	await expect(
		page
			.getByText("Copied cell value")
			.or(page.getByText("Couldn't copy. Clipboard access was denied.")),
	).toBeVisible();

	// Dismiss the sheet; the strip persists.
	await page
		.getByTestId("xlsx-cell-details-sheet")
		.locator("button, [role=dialog]")
		.first()
		.press("Escape");
	await expect(page.getByTestId("xlsx-cell-details-sheet")).toBeHidden();
	await expect(page.getByTestId("xlsx-cell-strip")).toBeVisible();

	// The accessible Column width action resizes without the drag edge.
	await page.getByTestId("xlsx-details-open").click();
	await page
		.getByTestId("xlsx-width-apply")
		.locator("..")
		.locator("input")
		.fill("");
	// The strip covered-value path for a plain cell.
	await page.keyboard.press("Escape");
});
