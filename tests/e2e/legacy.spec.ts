import { type Page, expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

function watch(page: Page) {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	return errors;
}

// Old Word and OpenDocument text: formatting, tables and pictures.
const DOCUMENTS: Array<[string, { tables?: number; pictures?: number }]> = [
	["legacy/SampleDoc.doc", {}],
	["legacy/simple-table.doc", { tables: 1 }],
	["legacy/testPictures.doc", { pictures: 1 }],
	["legacy/Lists.doc", {}],
	["odf/feature_table.odt", { tables: 1 }],
	["odf/feature_image_jpg.odt", { pictures: 1 }],
	["odf/listformat.odt", {}],
];

for (const [file, want] of DOCUMENTS) {
	test(`${file} is shown with its formatting`, async ({ page }) => {
		const errors = watch(page);
		await boot(page);
		await openFixture(page, file);
		const body = page.getByTestId("reflow-scroll");
		await expect(body.locator("article, p").first()).toBeVisible({
			timeout: 30_000,
		});
		// The rich reader ran: the banner says formatting is shown.
		await expect(body).toContainText(
			"formatting, tables and pictures are shown",
		);
		// Text beyond the banner, unless the file is only a table or a picture.
		if (!want.tables && !want.pictures) {
			const text = (await body.innerText()).replace(/\s+/g, " ");
			expect(text.length).toBeGreaterThan(120);
		}
		if (want.tables)
			expect(await body.locator("table").count()).toBeGreaterThanOrEqual(
				want.tables,
			);
		if (want.pictures) {
			const picture = body.locator("img").first();
			await expect
				.poll(() =>
					picture.evaluate((img: HTMLImageElement) => img.naturalWidth),
				)
				.toBeGreaterThan(0);
		}
		await expect(page.getByTestId("open-error")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}

// Old PowerPoint and OpenDocument presentations: drawn as slides.
const DECKS = [
	"legacy/SampleShow.ppt",
	"legacy/pictures.ppt",
	"legacy/table_test.ppt",
	"odf/shapes-test.odp",
	"odf/background.odp",
	"odf/rotate_flip.odp",
	"odf/cellspan.odp",
];

for (const file of DECKS) {
	test(`${file} is drawn slide by slide`, async ({ page }) => {
		const errors = watch(page);
		await boot(page);
		await openFixture(page, file);
		const slides = page.getByTestId("slide");
		await expect(slides.first()).toBeVisible({ timeout: 30_000 });
		const total = await slides.count();
		await expect(page.getByTestId("slide-counter")).toHaveText(`1 / ${total}`);
		// Real slides, not the text-only fallback.
		await expect(page.getByText("layout couldn't be read")).toHaveCount(0);
		// Shapes, text or pictures; or, for a slide that is only a
		// background, its colour.
		const drawn = await page
			.getByTestId("slides-scroll")
			.locator("svg, img, p, table")
			.count();
		const background = await slides
			.first()
			.locator("> div")
			.first()
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(drawn > 0 || background !== "rgb(255, 255, 255)").toBe(true);
		const box = await slides.first().boundingBox();
		expect(box?.width).toBeGreaterThan(300);
		expect(errors).toEqual([]);
	});
}

test("a password-protected old Word file says so", async ({ page }) => {
	await boot(page);
	await openFixture(page, "legacy/PasswordProtected.doc");
	await expect(page.getByTestId("viewer")).toContainText(
		"locked with a password",
		{ timeout: 30_000 },
	);
});

test("Word 95 falls back to its text", async ({ page }) => {
	await boot(page);
	await openFixture(page, "legacy/Word95.doc");
	const body = page.getByTestId("reflow-scroll");
	await expect(body.locator("p").first()).toBeVisible({ timeout: 30_000 });
	await expect(body).toContainText("showing its text");
});

// ---------- right-to-left content ----------

test("Urdu and Arabic slide text reads from the right", async ({ page }) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/rtl.pptx");
	const slide = page.getByTestId("slide").first();
	const title = slide.getByText("اردو پیشکش");
	await expect(title).toBeVisible({ timeout: 20_000 });
	const para = (text: string) =>
		slide.getByText(text).locator("xpath=ancestor-or-self::p[1]");
	// No direction flag on the title: detected from the text itself.
	await expect(para("اردو پیشکش")).toHaveAttribute("dir", "rtl");
	await expect(para("پہلا نکتہ")).toHaveAttribute("dir", "rtl");
	await expect(para("پہلا نکتہ")).toHaveCSS("text-align", "right");
	await expect(para("مرحبا بالعالم")).toHaveAttribute("dir", "rtl");
	// English in the same box stays as it was.
	await expect(para("English stays left to right")).not.toHaveAttribute(
		"dir",
		"rtl",
	);
});

test("a text file in Urdu starts from the right, line by line", async ({
	page,
}) => {
	await boot(page);
	await page.evaluate(() => {
		window.__paperwrenTestFile = new File(
			["یہ ایک اردو سطر ہے۔\nThis line is English.\n"],
			"note.txt",
		);
	});
	await page.getByTestId("open-file").click();
	const text = page.getByTestId("text-scroll").locator("pre");
	await expect(text).toContainText("اردو");
	// The first line hugs the right edge, the second the left.
	const edges = await text.evaluate((pre) => {
		const node = pre.firstChild as Text;
		const full = node.data;
		const at = full.indexOf("\n");
		const range = document.createRange();
		range.setStart(node, 0);
		range.setEnd(node, at);
		const first = range.getBoundingClientRect();
		range.setStart(node, at + 1);
		range.setEnd(node, full.length - 1);
		const second = range.getBoundingClientRect();
		const box = pre.getBoundingClientRect();
		return {
			firstGapRight: box.right - first.right,
			firstGapLeft: first.left - box.left,
			secondGapLeft: second.left - box.left,
		};
	});
	expect(edges.firstGapRight).toBeLessThan(40);
	expect(edges.firstGapLeft).toBeGreaterThan(60);
	expect(edges.secondGapLeft).toBeLessThan(40);
});

test("a sheet cell with Arabic text is right-to-left in a left-to-right grid", async ({
	page,
}) => {
	await boot(page);
	await page.evaluate(() => {
		window.__paperwrenTestFile = new File(
			["name,city\nمحمد,القاهرة\nRavi,Pune\n"],
			"people.csv",
		);
	});
	await page.getByTestId("open-file").click();
	const grid = page.getByTestId("sheet-grid");
	await expect(grid.getByText("محمد")).toHaveAttribute("dir", "rtl");
	await expect(grid.getByText("Ravi")).not.toHaveAttribute("dir", "rtl");
	// Columns still run A, B from the left.
	const a = await grid.getByText("محمد").boundingBox();
	const b = await grid.getByText("القاهرة").boundingBox();
	expect(a?.x).toBeLessThan(b?.x ?? 0);
});
