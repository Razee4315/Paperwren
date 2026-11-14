import { expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

const CASES: Array<[string, string]> = [
	["sample.pdf", "Paperwren test page 1 of 3"],
	["sample.docx", ""],
	["sample.doc", "The quick brown fox jumps over the lazy dog."],
	["sample.odt", "The quick brown fox jumps over the lazy dog."],
	["sample.rtf", "The quick brown fox jumps over the lazy dog."],
	["sample.xlsx", ""],
	["sample.xls", ""],
	["sample.ods", ""],
	["sample.csv", "Aisha"],
	["sample.pptx", "Quarterly Review"],
	["sample.ppt", "Quarterly Review"],
	["sample.odp", "Quarterly Review"],
	["sample.txt", "The quick brown fox jumps over the lazy dog."],
];

for (const [file, text] of CASES) {
	test(`opens ${file}`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (e) => errors.push(e.message));
		await boot(page);
		await openFixture(page, file);
		const viewer = page.getByTestId("viewer");
		await expect(viewer).toBeVisible({ timeout: 20_000 });
		await expect(viewer.locator("header")).toContainText(
			file.replace(/\.[^.]+$/, ""),
		);
		if (text) await expect(viewer).toContainText(text, { timeout: 20_000 });
		await expect(page.getByTestId("open-error")).toHaveCount(0);
		await page.getByTestId("viewer-back").click();
		await expect(viewer).toBeHidden();
		await expect(page.getByTestId("recent").first()).toContainText(file);
		expect(errors).toEqual([]);
	});
}

test("spreadsheet grid shows cells and sheet details", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.csv");
	const grid = page.getByTestId("sheet-grid");
	await expect(grid).toContainText("Ravi");
	await grid.getByText("Ravi").click();
	await expect(page.getByTestId("cell-detail")).toContainText("A3");
});

test("an unsupported file says so", async ({ page }) => {
	await boot(page);
	await openFixture(page, "not-a-document.zip");
	await expect(page.getByTestId("open-error")).toContainText(
		"Unsupported file",
	);
	await page.getByTestId("error-ok").click();
	await expect(page.getByTestId("home")).toBeVisible();
});

test("a damaged PDF shows an honest error", async ({ page }) => {
	await boot(page);
	await openFixture(page, "corrupt.pdf");
	await expect(page.getByTestId("pdf-error")).toBeVisible({ timeout: 20_000 });
});

test("text with an unknown extension still opens as text", async ({ page }) => {
	await boot(page);
	await openFixture(page, "archive.xyz");
	await expect(page.getByTestId("viewer")).toContainText("just some bytes");
});

test("spreadsheets zoom from the shared control", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.csv");
	await expect(page.getByTestId("sheet-grid")).toContainText("Ravi");
	const scale = page.getByTestId("sheet-scale");
	await expect(scale).toHaveText("100%");
	await page.getByTestId("sheet-zoom-in").click();
	await expect(scale).toHaveText("120%");
	// Cells still answer taps at the new size.
	await page.getByTestId("sheet-grid").getByText("Ravi").click();
	await expect(page.getByTestId("cell-detail")).toContainText("A3");
	await scale.click();
	await expect(scale).toHaveText("100%");
});

test("Word documents zoom and return to fit width", async ({ page }) => {
	await boot(page);
	await openFixture(page, "sample.docx");
	const scale = page.getByTestId("doc-scale");
	await expect(scale).toHaveText("Fit width", { timeout: 20_000 });
	await page.getByTestId("doc-zoom-in").click();
	await expect(scale).not.toHaveText("Fit width");
	await scale.click();
	await expect(scale).toHaveText("Fit width");
});

test("a Word file with no page settings is read on a whole page", async ({
	page,
}) => {
	await boot(page, {}, "?desktop");
	// sample.docx names no page size or margins, as some exports write.
	await openFixture(page, "sample.docx");
	const sheet = page.locator("section.docx").first();
	await expect(sheet).toBeVisible({ timeout: 20_000 });
	const laid = await sheet.evaluate((el) => {
		const style = getComputedStyle(el);
		return {
			width: Number.parseFloat(style.width),
			margin: Number.parseFloat(style.paddingLeft),
		};
	});
	// Letter or A4 (816 or 794 CSS pixels), with inch margins.
	expect(laid.width).toBeGreaterThan(780);
	expect(laid.margin).toBe(96);
});

test("slide charts are drawn from the file's own numbers", async ({ page }) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/charts.pptx");
	const charts = page.getByTestId("slide-chart");
	await expect(charts).toHaveCount(5, { timeout: 20_000 });
	await expect(charts.first()).toContainText("Quarterly results");
	await expect(charts.first()).toContainText("Revenue");
	// A radar chart is not drawn; it says so instead.
	await expect(page.getByTestId("slide").last()).toContainText("Chart");
});

test("spreadsheet cells keep their bold, colours and fills", async ({
	page,
}) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/styled.xlsx");
	const header = page.getByTestId("sheet-grid").getByText("Owner");
	await expect(header).toBeVisible({ timeout: 20_000 });
	await expect(header).toHaveCSS("background-color", "rgb(31, 78, 120)");
	await expect(header).toHaveCSS("color", "rgb(255, 255, 255)");
	await expect(header).toHaveCSS("font-weight", "700");
	const plain = page.getByTestId("sheet-grid").getByText("Aisha");
	await expect(plain).not.toHaveCSS("font-weight", "700");
});

test("a file dropped on the window opens", async ({ page }) => {
	await boot(page);
	const drag = (type: string) =>
		page.evaluate((type) => {
			const data = new DataTransfer();
			data.items.add(new File(["dropped text"], "dropped.txt"));
			document.body.dispatchEvent(
				new DragEvent(type, {
					dataTransfer: data,
					bubbles: true,
					cancelable: true,
				}),
			);
		}, type);
	await drag("dragenter");
	await expect(page.getByTestId("drop-hint")).toBeVisible();
	await drag("drop");
	await expect(page.getByTestId("drop-hint")).toHaveCount(0);
	await expect(page.getByTestId("viewer")).toContainText("dropped text");
});

test("a page that is a phone photo is shown as stored, not turned by its EXIF (#80)", async ({
	page,
}) => {
	// Android's WebView has no window.chrome, and pdf.js then lets the
	// browser decode JPEGs, which turns them by their EXIF orientation.
	await page.addInitScript(() => {
		(window as { chrome?: unknown }).chrome = undefined;
	});
	await boot(page);
	// The photo is stored 600×400 with a red band along its top, and its
	// EXIF says "turn 90°". On the page it must keep the band on top.
	await openFixture(page, "viewer-regressions/photo-page.pdf");
	const canvas = page.locator(".page canvas").first();
	await expect(canvas).toBeVisible({ timeout: 20_000 });
	await expect
		.poll(
			() =>
				canvas.evaluate((c: HTMLCanvasElement) => {
					const ctx = c.getContext("2d");
					if (!ctx) return "none";
					const red = (x: number, y: number) => {
						const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
						return r > 150 && g < 80 && b < 80;
					};
					const w = c.width;
					const h = c.height;
					if (red(w / 2, h * 0.04) && !red(w * 0.98, h / 2)) return "top";
					if (red(w * 0.98, h / 2)) return "right";
					return "none";
				}),
			{ timeout: 15_000 },
		)
		.toBe("top");
});
