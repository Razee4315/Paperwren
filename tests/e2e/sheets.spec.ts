import { type Page, expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

test.use({ viewport: { width: 900, height: 700 }, hasTouch: true });

const cell = (page: Page, r: number, c: number) =>
	page.getByTestId("sheet-grid").locator(`[data-r="${r}"][data-c="${c}"]`);

async function openGrid(page: Page) {
	await boot(page);
	await openFixture(page, "viewer-regressions/grid.xlsx");
	await expect(cell(page, 1, 2)).toHaveText("100", { timeout: 20_000 });
}

async function centre(page: Page, r: number, c: number) {
	const box = await cell(page, r, c).boundingBox();
	if (!box) throw new Error(`cell ${r},${c} is not on screen`);
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("dragging a range shows its sum, average and count", async ({ page }) => {
	await openGrid(page);
	const from = await centre(page, 1, 2);
	const to = await centre(page, 4, 4);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 6 });
	await page.mouse.up();
	const detail = page.getByTestId("cell-detail");
	await expect(detail).toContainText("C2:E5");
	await expect(detail).toContainText("4 × 3 cells");
	await expect(page.getByTestId("range-stats")).toHaveText(
		"Sum 1,264 · Average 105.3333 · Count 12",
	);
	// Shift-click stretches the same range from its first cell.
	await cell(page, 2, 3).click({ modifiers: ["Shift"] });
	await expect(detail).toContainText("C2:D3");
});

test("a tap selects and the grip stretches the selection by touch", async ({
	page,
}) => {
	await openGrid(page);
	await cell(page, 1, 2).tap();
	const detail = page.getByTestId("cell-detail");
	await expect(detail).toContainText("C2");
	const box = await cell(page, 1, 2).boundingBox();
	if (!box) throw new Error("no cell");
	// The grip sits on the selection's bottom-right corner.
	const grip = { x: box.x + box.width, y: box.y + box.height };
	const to = await centre(page, 5, 5);
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: string, at?: { x: number; y: number }) =>
		cdp.send("Input.dispatchTouchEvent", {
			type: type as "touchStart",
			touchPoints: at ? [{ x: at.x, y: at.y }] : [],
		});
	await touch("touchStart", grip);
	for (let i = 1; i <= 6; i++)
		await touch("touchMove", {
			x: grip.x + ((to.x - grip.x) * i) / 6,
			y: grip.y + ((to.y - grip.y) * i) / 6,
		});
	await touch("touchEnd");
	await expect(detail).toContainText("C2:F6");
	await expect(page.getByTestId("range-stats")).toContainText("Count 20");
});

test("columns resize by dragging and fit their text on double-click", async ({
	page,
}) => {
	await openGrid(page);
	const width = async () => (await cell(page, 1, 2).boundingBox())?.width ?? 0;
	const before = await width();
	const edge = await page.getByTestId("col-resize-2").boundingBox();
	if (!edge) throw new Error("no resizer");
	const x = edge.x + edge.width / 2;
	const y = edge.y + edge.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 60, y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(width).toBe(before + 60);
	// The next column moved along with the edge.
	const next = await cell(page, 1, 3).boundingBox();
	const here = await cell(page, 1, 2).boundingBox();
	expect(next?.x).toBeCloseTo((here?.x ?? 0) + before + 60, 0);
	// Double-click: just wide enough for "100".."1xx", far narrower.
	await page.getByTestId("col-resize-2").dblclick();
	await expect.poll(width).toBeLessThan(before);
	const fitted = cell(page, 1, 2);
	expect(await fitted.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
		true,
	);
});

test("find walks the matches on every sheet", async ({ page }) => {
	await openGrid(page);
	await page.getByTestId("sheet-find").click();
	await page.getByTestId("find-input").fill("Region 7");
	const count = page.getByTestId("find-count");
	await expect(count).toHaveText("1 of 2");
	const detail = page.getByTestId("cell-detail");
	await expect(detail).toContainText("A8");
	await page.getByTestId("find-next").click();
	await expect(count).toHaveText("2 of 2");
	await expect(page.getByTestId("sheet-tab-1")).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(detail).toContainText("A2");
	await expect(detail).toContainText("Region 7");
	await page.getByTestId("find-next").click();
	await expect(page.getByTestId("sheet-tab-0")).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(detail).toContainText("A8");
	// A match that exists only on another sheet takes the reader there.
	await page.getByTestId("find-input").fill("Elsewhere");
	await expect(count).toHaveText("1 of 1");
	await expect(page.getByTestId("sheet-tab-1")).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(detail).toContainText("A3");
});

test("a sheet's chart and picture are drawn over the grid", async ({
	page,
}) => {
	await openGrid(page);
	const objects = page.getByTestId("sheet-object");
	await expect(objects).toHaveCount(2);
	const chart = objects.getByTestId("slide-chart");
	await expect(chart).toContainText("First regions");
	await expect(chart).toContainText("Region 1");
	await expect(chart).toContainText("Q1");
	const picture = objects.locator("img");
	await expect
		.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth))
		.toBe(120);
	// Anchored at I3: one default column past the last used one (G).
	const lastHead = await page
		.getByRole("button", { name: "Select column G" })
		.boundingBox();
	const x = async () => (await objects.first().boundingBox())?.x ?? 0;
	const start = await x();
	expect(start).toBeCloseTo(
		(lastHead?.x ?? 0) + (lastHead?.width ?? 0) + 96,
		0,
	);
	// Objects hang from their columns: widening one moves them along.
	const edge = await page.getByTestId("col-resize-2").boundingBox();
	if (!edge) throw new Error("no resizer");
	await page.mouse.move(edge.x + 7, edge.y + 10);
	await page.mouse.down();
	await page.mouse.move(edge.x + 47, edge.y + 10, { steps: 4 });
	await page.mouse.up();
	await expect.poll(x).toBe(start + 40);
	// The grid reaches far enough right to scroll the chart into view.
	const grid = page.getByTestId("sheet-grid");
	await grid.evaluate((el) => {
		el.scrollLeft = el.scrollWidth;
	});
	await expect(chart).toBeInViewport();
});

test("frozen rows and columns stay put while the grid scrolls", async ({
	page,
}) => {
	await openGrid(page);
	const header = page.getByTestId("frozen-rows").getByText("Region", {
		exact: true,
	});
	const name = page.getByTestId("frozen-cols").getByText("Region 30", {
		exact: true,
	});
	const top = (await header.boundingBox())?.y;
	const grid = page.getByTestId("sheet-grid");
	await grid.evaluate((el) => {
		el.scrollTop = 600;
		el.scrollLeft = 300;
	});
	await expect(name).toBeVisible();
	expect((await header.boundingBox())?.y).toBe(top);
	const left = (await name.boundingBox())?.x;
	await grid.evaluate((el) => {
		el.scrollLeft = 500;
	});
	await expect(page.getByTestId("frozen-cols")).toBeVisible();
	expect((await name.boundingBox())?.x).toBe(left);
});

test("long text runs over empty cells, across the freeze line too", async ({
	page,
}) => {
	await openGrid(page);
	const grid = page.getByTestId("sheet-grid");
	await grid.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
	});
	const long = "This remark is far longer than its column and runs on";
	// A64 sits in a frozen column: the pane clips it at the freeze line
	// and the scrolling pane carries the same run on from there.
	const run = grid.getByText(long, { exact: true });
	await expect(run).toHaveCount(2);
	const pane = await page.getByTestId("frozen-cols").boundingBox();
	const [frozen, carried] = await Promise.all([
		run.first().boundingBox(),
		run.last().boundingBox(),
	]);
	const freezeLine = (pane?.x ?? 0) + (pane?.width ?? 0);
	expect(carried?.x).toBe(frozen?.x);
	expect((carried?.x ?? 0) + (carried?.width ?? 0)).toBeGreaterThan(freezeLine);
	expect(
		await run.last().evaluate((el) => el.scrollWidth <= el.clientWidth),
	).toBe(true);
	// The carried text is not a cell: a click on it picks the cell below.
	await page.mouse.click(freezeLine + 20, (carried?.y ?? 0) + 10);
	await expect(page.getByTestId("cell-detail")).toContainText("C64");
	// A65 has a neighbour with a value, so it is cut off at its own edge.
	const stopped = grid.getByText("Blocked by a neighbour, so it is cut off");
	await expect(stopped).toHaveCount(1);
	const a = await cell(page, 64, 0).boundingBox();
	const b = await cell(page, 64, 1).boundingBox();
	expect((a?.x ?? 0) + (a?.width ?? 0)).toBe(b?.x);
});
