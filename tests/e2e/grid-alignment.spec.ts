import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

/**
 * XLS-01/XLS-02 regression (docs/14 audit section 9): the column
 * header cells and body cells of the spreadsheet grid must share one
 * geometry. Edge positions are measured from the live DOM at several
 * horizontal offsets — including after a column resize — and must
 * agree within 1 CSS px. No getBoundingClientRect mocking: this test
 * only reads what the browser laid out.
 */

const gridXlsx = readFileSync("fixtures/viewer-regressions/grid-align.xlsx");

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

async function openSpreadsheet(page: Page) {
	const b64 = gridXlsx.toString("base64");
	await page.evaluate(
		async (args) => {
			const bytes = Uint8Array.from(atob(args.b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], args.name, {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			});
		},
		{ b64, name: "align.xlsx" },
	);
	await page.getByTestId("empty-open-button").click();
	await expect(page.getByTestId("xlsx-grid")).toBeVisible({
		timeout: 20_000,
	});
}

interface EdgeResult {
	col: number;
	headerLeft: number;
	headerRight: number;
	cellLeft: number;
	cellRight: number;
}

/** Measure header vs body edges for every rendered column. */
async function measureEdges(page: Page): Promise<EdgeResult[]> {
	return page.evaluate(() => {
		const scroller = document.querySelector<HTMLElement>(
			"[data-testid='xlsx-grid']",
		);
		if (!scroller) throw new Error("grid scroller missing");
		const results: EdgeResult[] = [];
		const headers = scroller.querySelectorAll<HTMLElement>(
			"[data-testid^='xlsx-head-']",
		);
		for (const head of headers) {
			const col = Number(head.dataset.col);
			const cell = scroller.querySelector<HTMLElement>(
				`[data-testid='xlsx-cell-0-${col}']`,
			);
			if (!cell) continue;
			const h = head.getBoundingClientRect();
			const b = cell.getBoundingClientRect();
			results.push({
				col,
				headerLeft: h.left,
				headerRight: h.right,
				cellLeft: b.left,
				cellRight: b.right,
			});
		}
		return results;
	});
}

test("column headers track their cells at every horizontal offset", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openSpreadsheet(page);

	const scroller = page.getByTestId("xlsx-grid");
	const offsets = [0, 1, 47, 48, 95, 193, 640];
	for (const offset of offsets) {
		await scroller.evaluate((el, x) => {
			el.scrollLeft = x;
		}, offset);
		// Let the scroll event + virtualization settle before measuring.
		await page.waitForFunction(
			() => document.querySelectorAll("[data-testid^='xlsx-head-']").length > 0,
		);
		const edges = await measureEdges(page);
		expect(edges.length, `scrollLeft=${offset}`).toBeGreaterThan(2);
		for (const e of edges) {
			expect(
				Math.abs(e.headerLeft - e.cellLeft),
				`scrollLeft=${offset} col=${e.col} left edges`,
			).toBeLessThanOrEqual(1);
			expect(
				Math.abs(e.headerRight - e.cellRight),
				`scrollLeft=${offset} col=${e.col} right edges`,
			).toBeLessThanOrEqual(1);
		}
	}
});

test("headers and cells stay aligned through the far right and after a resize", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openSpreadsheet(page);

	const scroller = page.getByTestId("xlsx-grid");

	// Far right: the last columns must still line up.
	await scroller.evaluate((el) => {
		el.scrollLeft = el.scrollWidth;
	});
	await page.waitForFunction(
		() => document.querySelectorAll("[data-testid^='xlsx-head-']").length > 0,
	);
	for (const e of await measureEdges(page)) {
		expect(Math.abs(e.headerLeft - e.cellLeft)).toBeLessThanOrEqual(1);
		expect(Math.abs(e.headerRight - e.cellRight)).toBeLessThanOrEqual(1);
	}

	// Resize the first rendered column via its handle, then re-check.
	const handle = page
		.locator("[data-testid^='xlsx-head-'] [data-resize]")
		.first();
	await handle.scrollIntoViewIfNeeded();
	const box = await handle.boundingBox();
	if (!box) throw new Error("resize handle not visible");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, {
		steps: 4,
	});
	await page.mouse.up();

	await scroller.evaluate((el) => {
		el.scrollLeft = 0;
	});
	await scroller.evaluate((el) => {
		el.scrollLeft = 130;
	});
	await page.waitForFunction(
		() => document.querySelectorAll("[data-testid^='xlsx-head-']").length > 0,
	);
	for (const e of await measureEdges(page)) {
		expect(
			Math.abs(e.headerLeft - e.cellLeft),
			`after resize col=${e.col} left`,
		).toBeLessThanOrEqual(1);
		expect(
			Math.abs(e.headerRight - e.cellRight),
			`after resize col=${e.col} right`,
		).toBeLessThanOrEqual(1);
	}
});
