import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

/** The colour at the middle of the first copied picture of a PDF page. */
const pictureMiddle = (page: Page) =>
	page
		.locator(".pw-picture")
		.first()
		.evaluate((el) => {
			const canvas = el as HTMLCanvasElement;
			const ctx = canvas.getContext("2d");
			// The left third of the fixture's picture is red.
			const [r, g, b] =
				ctx?.getImageData(canvas.width / 6, canvas.height / 4, 1, 1).data ?? [];
			return [r, g, b];
		});

test.describe("page colour", () => {
	test("a PDF turns dark or sepia from its menu, and its pictures do not", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/pictures.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		const main = page.locator("[data-page-color]");
		await expect(main).toHaveAttribute("data-page-color", "original");

		await page.getByTestId("file-more").click();
		await page.getByTestId("page-color").click();
		await page.getByTestId("page-color-dark").click();
		await expect(main).toHaveAttribute("data-page-color", "dark");
		await expect(page.locator(".pw-picture")).toHaveCount(1);
		await expect(page.locator(".pw-pictures").first()).toBeVisible();
		const [r, g, b] = await pictureMiddle(page);
		expect(r).toBeGreaterThan(200);
		expect(g).toBeLessThan(70);
		expect(b).toBeLessThan(70);

		await page.getByTestId("file-more").click();
		await page.getByTestId("page-color").click();
		await page.getByTestId("page-color-sepia").click();
		await expect(main).toHaveAttribute("data-page-color", "sepia");
		await expect(page.locator(".pw-pictures").first()).toBeVisible();

		await page.getByTestId("file-more").click();
		await page.getByTestId("page-color").click();
		await page.getByTestId("page-color-original").click();
		await expect(page.locator(".pw-pictures").first()).toBeHidden();
	});

	test("the paper can follow the theme, and the old dark pages switch did", async ({
		page,
	}) => {
		await boot(page, {
			settings_v2: { theme: "dark", darkPages: true },
		});
		await openFixture(page, "sample.docx");
		await expect(page.locator("[data-page-color]")).toHaveAttribute(
			"data-page-color",
			"dark",
			{ timeout: 20_000 },
		);
		await page.getByTestId("viewer-back").click();
		await page.getByTestId("open-settings").click();
		await expect(page.getByTestId("page-color-theme")).toHaveAttribute(
			"aria-checked",
			"true",
		);
		await page.getByTestId("page-color-sepia").click();
		await page.getByTestId("settings-back").click();
		await openFixture(page, "sample.txt");
		await expect(page.getByTestId("text-scroll")).toHaveAttribute(
			"data-theme",
			"sepia",
		);
	});
});

test.describe("on a desktop", () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test("two pages side by side are still there after a restart", async ({
		page,
	}) => {
		await boot(page, {}, "?desktop");
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-spread").click();
		const paired = () =>
			page
				.getByTestId("pdf-scroll")
				.locator(".page")
				.evaluateAll((pages) => {
					const [a, b] = pages.map((el) =>
						Math.round(el.getBoundingClientRect().top),
					);
					return a === b;
				});
		await expect.poll(paired).toBe(true);
		// Let the position be saved, then start again.
		await page.waitForTimeout(800);
		await page.getByTestId("viewer-back").click();
		await page.reload();
		await page
			.getByTestId("recent")
			.first()
			.getByRole("button")
			.first()
			.click();
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await expect.poll(paired).toBe(true);
	});
});

test.describe("PDF pages and links", () => {
	test("pages laid sideways turn with a tap on either side", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/pictures.pdf");
		const counter = page.getByTestId("pdf-page");
		await expect(counter).toHaveText("1 / 3", { timeout: 20_000 });
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-across").click();
		const scroller = page.getByTestId("pdf-scroll");
		await expect(scroller).toHaveAttribute("data-flow", "across");
		await expect(page.getByTestId("pdf-scale")).toHaveText("Whole page");
		const box = await scroller.boundingBox();
		if (!box) throw new Error("no scroller");
		await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
		await expect(counter).toHaveText("1 / 3");
		// Taps are a touch screen's: send one.
		await scroller.dispatchEvent("touchstart", {
			touches: [
				{ identifier: 0, clientX: box.x + box.width * 0.9, clientY: 300 },
			],
		});
		await scroller.dispatchEvent("touchend", {
			touches: [],
			changedTouches: [
				{ identifier: 0, clientX: box.x + box.width * 0.9, clientY: 300 },
			],
		});
		await expect(counter).toHaveText("2 / 3");
		// The choice holds for the next PDF.
		await page.getByTestId("viewer-back").click();
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-scroll")).toHaveAttribute(
			"data-flow",
			"across",
			{ timeout: 20_000 },
		);
	});

	test("a page laid sideways sits in the middle of a phone's screen", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 412, height: 892 });
		await boot(page);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-across").click();
		await expect(page.getByTestId("pdf-scale")).toHaveText("Whole page");
		// A whole portrait page is as wide as the phone and shorter than it.
		const middles = () =>
			page.getByTestId("pdf-scroll").evaluate((el) => {
				const box = el.getBoundingClientRect();
				const sheet = el.querySelector(".page")?.getBoundingClientRect();
				return sheet
					? Math.abs(sheet.top + sheet.bottom - box.top - box.bottom) / 2
					: 999;
			});
		await expect.poll(middles).toBeLessThan(3);
	});

	test("Back retraces a link inside a PDF before it closes the document", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/pictures.pdf");
		const counter = page.getByTestId("pdf-page");
		await expect(counter).toHaveText("1 / 3", { timeout: 20_000 });
		await page.locator(".annotationLayer a").first().click();
		await expect(counter).toHaveText("3 / 3");
		await expect(page.getByTestId("pdf-trail")).toHaveText("Back to page 1");
		await page.goBack();
		await expect(counter).toHaveText("1 / 3");
		await expect(page.getByTestId("pdf-trail")).toHaveCount(0);
		await page.goBack();
		await expect(page.getByTestId("home")).toBeVisible();
	});
});

/** The file a "save as picture" hands over, and its size in pixels. */
async function savedPicture(page: Page, item: string) {
	const download = page.waitForEvent("download");
	await page.getByTestId("file-more").click();
	await page.getByTestId(item).click();
	const file = await download;
	const bytes = readFileSync((await file.path()) ?? "");
	return { name: file.suggestedFilename(), bytes };
}

test.describe("a page as a picture", () => {
	test("a PDF page is saved as a PNG, turned as it is shown", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/pictures.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		const first = await savedPicture(page, "pdf-save-page");
		expect(first.name).toBe("pictures - page 1.png");
		// A PNG, portrait: its width and height are in the header.
		expect(first.bytes.subarray(1, 4).toString()).toBe("PNG");
		expect(first.bytes.readUInt32BE(16)).toBeLessThan(
			first.bytes.readUInt32BE(20),
		);
		await expect(page.getByRole("status")).toContainText(
			"Saved as pictures - page 1.png",
		);
		await page.keyboard.press("Control+]");
		const turned = await savedPicture(page, "pdf-save-page");
		expect(turned.bytes.readUInt32BE(16)).toBeGreaterThan(
			turned.bytes.readUInt32BE(20),
		);
	});

	test("a comic's page is saved as it is stored", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/comic.cbz");
		await expect(page.locator("img").first()).toBeVisible({ timeout: 20_000 });
		const saved = await savedPicture(page, "image-save-page");
		expect(saved.name).toBe("comic - page 1.jpg");
		// JPEG bytes, as they were in the archive.
		expect(saved.bytes[0]).toBe(0xff);
		expect(saved.bytes[1]).toBe(0xd8);
	});
});

test.describe("PDF pages on a desktop", () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test("keys, the wheel and a book's cover turn pages laid sideways", async ({
		page,
	}) => {
		await boot(page, { settings_v2: { pdfFlow: "across" } }, "?desktop");
		await openFixture(page, "features/pictures.pdf");
		const field = page.getByTestId("pdf-page-field");
		await expect(field).toHaveValue("1", { timeout: 20_000 });
		await page.keyboard.press("PageDown");
		await expect(field).toHaveValue("2");
		await page.keyboard.press("End");
		await expect(field).toHaveValue("3");
		await page.keyboard.press("Home");
		await expect(field).toHaveValue("1");
		await page.mouse.move(640, 400);
		await page.mouse.wheel(0, 120);
		await expect(field).toHaveValue("2");

		// Two pages at a time, then the first on its own as a cover.
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-spread").click();
		await page.keyboard.press("Home");
		await expect(field).toHaveValue("1");
		await page.keyboard.press("ArrowRight");
		await expect(field).toHaveValue("3");
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-cover").click();
		await page.keyboard.press("Home");
		await page.keyboard.press("ArrowRight");
		await expect(field).toHaveValue("2");

		// Alt+Left after a link, Alt+Right to return; Ctrl+W still closes.
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-spread").click();
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-across").click();
		await page.keyboard.press("Home");
		await page.locator(".annotationLayer a").first().click();
		await expect(field).toHaveValue("3");
		await page.keyboard.press("Alt+ArrowLeft");
		await expect(field).toHaveValue("1");
		await page.keyboard.press("Alt+ArrowRight");
		await expect(field).toHaveValue("3");
		await page.keyboard.press("Control+w");
		await expect(page.getByTestId("home")).toBeVisible();
	});
});

test.describe("what a PDF carries besides its pages", () => {
	test("its comments, attachments, layers and details", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/extras.pdf");
		const counter = page.getByTestId("pdf-page");
		await expect(counter).toHaveText("1 / 2", { timeout: 20_000 });
		// The note's icon ships with the app.
		await expect(page.locator(".annotationLayer img").first()).toHaveJSProperty(
			"complete",
			true,
		);
		expect(
			await page
				.locator(".annotationLayer img")
				.first()
				.evaluate((img) => (img as HTMLImageElement).naturalWidth),
		).toBeGreaterThan(0);

		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-comments").click();
		const comments = page.getByTestId("pdf-comment");
		await expect(comments).toHaveCount(3);
		await expect(comments.first()).toContainText("Ayesha");
		await expect(comments.first()).toContainText("Check this figure");
		await expect(comments.nth(1)).toContainText("Highlight");
		await comments.nth(2).click();
		await expect(counter).toHaveText("2 / 2");

		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-layers").click();
		const layer = page.getByTestId("pdf-layer");
		await expect(layer).toHaveText("Watermark");
		await expect(layer).toHaveAttribute("aria-pressed", "true");
		await layer.click();
		await expect(layer).toHaveAttribute("aria-pressed", "false");
		await page.keyboard.press("Escape");

		await page.getByTestId("file-more").click();
		await page.getByTestId("file-details-open").click();
		await expect(page.getByTestId("file-details")).toContainText("Page size");
		await expect(page.getByTestId("file-details")).toContainText("A4");
		await expect(page.getByTestId("file-details")).toContainText("PDF version");
		await page.getByRole("button", { name: "Done" }).click();

		// An attachment opens over the PDF, and is not kept in recents.
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-attachments").click();
		await page.getByTestId("pdf-attachment").click();
		await expect(page.getByTestId("viewer")).toContainText(
			"the figures are final",
		);
		await page.getByTestId("viewer-back").click();
		await expect(counter).toHaveText(/\/ 2/, { timeout: 20_000 });
		await page.getByTestId("viewer-back").click();
		await expect(page.getByTestId("recent")).toHaveCount(1);
		await expect(page.getByTestId("recent")).toContainText("extras.pdf");
	});

	test("a PDF that asks not to be copied says so", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/nocopy.pdf");
		await expect(page.getByText("This PDF restricts copying")).toBeVisible({
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("file-details-open").click();
		await expect(page.getByTestId("file-details")).toContainText(
			"The author asks that its text not be copied",
		);
	});
});

test.describe("find, as a reader means it", () => {
	test("match case and whole words, on a phone, in each kind of file", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/pictures.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		await page.getByTestId("pdf-find").click();
		await page.getByTestId("find-input").fill("chapter");
		await expect(page.getByTestId("find-count")).toHaveText(/of 4\d/, {
			timeout: 10_000,
		});
		await page.getByTestId("find-case").click();
		await expect(page.getByTestId("find-count")).toHaveText("No results");
		await page.getByTestId("viewer-back").click();

		await openFixture(page, "sample.txt");
		await page.getByTestId("text-find").click();
		await page.getByTestId("find-input").fill("fix");
		await expect(page.getByTestId("find-count")).toHaveText("1 of 1");
		await page.getByTestId("find-words").click();
		await expect(page.getByTestId("find-count")).toHaveText("No results");
		await page.getByTestId("find-input").fill("fixture");
		await expect(page.getByTestId("find-count")).toHaveText("1 of 1");
		await page.getByTestId("viewer-back").click();

		await openFixture(page, "sample.xlsx");
		await page.getByTestId("sheet-find").click();
		await page.getByTestId("find-input").fill("a");
		await expect(page.getByTestId("find-count")).toHaveText(/of \d/);
		await page.getByTestId("find-words").click();
		await expect(page.getByTestId("find-count")).toHaveText("No results");
	});
});

test("crop margins fills the screen with text, cuts nothing and is remembered", async ({
	page,
}) => {
	await boot(page);
	await openFixture(page, "features/margins.pdf");
	const counter = page.getByTestId("pdf-page");
	await expect(counter).toHaveText("1 / 4", { timeout: 20_000 });
	// The first line of text, as tall as it is drawn.
	const lineHeight = () =>
		page
			.locator(".pdfViewer .page")
			.first()
			.locator(".textLayer span", { hasText: "line 1:" })
			.first()
			.evaluate((el) => el.getBoundingClientRect().height);
	await expect.poll(lineHeight).toBeGreaterThan(0);
	const before = await lineHeight();
	await page.getByTestId("file-more").click();
	await page.getByTestId("pdf-crop").click();
	// The text grows to fill the width the margins took.
	await expect.poll(lineHeight).toBeGreaterThan(before * 1.5);
	// The page that prints further out keeps all of it.
	const widths = await page
		.locator(".pdfViewer .page")
		.evaluateAll((pages) =>
			pages.map((el) => el.getBoundingClientRect().width),
		);
	expect(widths[2]).toBeGreaterThan(widths[0] * 1.3);
	await page.waitForTimeout(600);
	await page.getByTestId("viewer-back").click();
	await page.getByTestId("recent").first().getByRole("button").first().click();
	await expect(counter).toHaveText("1 / 4", { timeout: 20_000 });
	await expect.poll(lineHeight).toBeGreaterThan(before * 1.5);
	await page.getByTestId("file-more").click();
	await expect(page.getByTestId("pdf-crop")).toHaveAttribute(
		"aria-pressed",
		"true",
	);
});

test.describe("pages turned sideways", () => {
	test("a book turns page by page, and opens again on its page", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/book.epub");
		const scroller = page.getByTestId("epub-scroll");
		await expect(scroller).toBeVisible({ timeout: 20_000 });
		await page.getByTestId("file-more").click();
		await page.getByTestId("pages-sideways").click();
		await expect(scroller).toHaveAttribute("data-flow", "across");
		const count = page.getByTestId("paged-count");
		await expect(count).toHaveText(/^1 of \d+$/);
		// Each page is exactly one screen wide, and the keys turn them.
		const size = await scroller.evaluate((el) => [
			el.scrollWidth,
			el.clientWidth,
		]);
		expect(size[0] % size[1]).toBe(0);
		await page.keyboard.press("ArrowRight");
		await expect(count).toHaveText(/^2 of /);
		await page.keyboard.press("PageDown");
		await expect(count).toHaveText(/^3 of /);
		await page.keyboard.press("ArrowLeft");
		await expect(count).toHaveText(/^2 of /);
		// The place is kept: back to the shelf and in again.
		await page.waitForTimeout(700);
		await page.getByTestId("viewer-back").click();
		await page.getByText("book.epub").first().click();
		await expect(page.getByTestId("paged-count")).toHaveText(/^2 of /, {
			timeout: 20_000,
		});
	});

	test("one choice turns every flowing document sideways", async ({ page }) => {
		await boot(page, { settings_v2: { pdfFlow: "across" } });
		await openFixture(page, "features/notes.md");
		await expect(page.getByTestId("text-scroll")).toHaveAttribute(
			"data-flow",
			"across",
			{ timeout: 20_000 },
		);
		await page.getByTestId("viewer-back").click();
		await openFixture(page, "report.docx");
		await expect(page.getByTestId("doc-scroll")).toBeVisible({
			timeout: 20_000,
		});
		// A Word document's own pages scroll; its reading view turns.
		await expect(page.getByTestId("doc-scroll")).not.toHaveAttribute(
			"data-flow",
			"across",
		);
		await page.getByTestId("file-more").click();
		await page.getByTestId("doc-reading").click();
		await expect(page.getByTestId("doc-scroll")).toHaveAttribute(
			"data-flow",
			"across",
			{ timeout: 20_000 },
		);
		await expect(page.getByTestId("paged-count")).toHaveText(/^1 of [2-9]/);
	});
});

test.describe("bookmarks", () => {
	test("are added, named, gone back to, kept and deleted", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/pictures.pdf");
		const counter = page.getByTestId("pdf-page");
		await expect(counter).toHaveText("1 / 3", { timeout: 20_000 });
		const jump = async (n: string) => {
			await counter.click();
			await page.getByTestId("pdf-jump-input").fill(n);
			await page.getByTestId("pdf-jump-go").click();
			await expect(counter).toHaveText(`${n} / 3`);
		};
		await jump("2");
		await page.getByTestId("file-more").click();
		await page.getByTestId("bookmark-add").click();
		await expect(page.getByText("Bookmark added")).toBeVisible();
		await jump("1");
		await page.getByTestId("file-more").click();
		await page.getByTestId("bookmarks").click();
		const marks = page.getByTestId("bookmark");
		await expect(marks).toHaveText(["Page 2"]);
		await marks.first().getByRole("button").first().click();
		await expect(counter).toHaveText("2 / 3");

		// Kept on this device, with the file.
		await page.getByTestId("viewer-back").click();
		await page.reload();
		await page
			.getByTestId("recent")
			.first()
			.getByRole("button")
			.first()
			.click();
		await expect(counter).toHaveText(/\/ 3/, { timeout: 20_000 });
		await page.getByTestId("file-more").click();
		await page.getByTestId("bookmarks").click();
		await expect(marks).toHaveText(["Page 2"]);
		await page.getByTestId("bookmark-remove").click();
		await expect(marks).toHaveCount(0);
		await expect(page.getByTestId("bookmark-list")).toContainText(
			"No bookmarks yet",
		);
	});

	test("a Word document's bookmark is named after its words", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "viewer-regressions/multipage.docx");
		const scroller = page.getByTestId("doc-scroll");
		await expect(scroller).toBeVisible({ timeout: 20_000 });
		await expect
			.poll(() =>
				scroller.evaluate((el) => el.scrollHeight > el.clientHeight * 2),
			)
			.toBe(true);
		await scroller.evaluate((el) => {
			el.scrollTop = el.scrollHeight / 2;
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("bookmark-add").click();
		await page.getByTestId("file-more").click();
		await page.getByTestId("bookmarks").click();
		const label = (await page.getByTestId("bookmark").textContent()) ?? "";
		expect(label.length).toBeGreaterThan(3);
		expect(label).not.toContain("% through");
		await page.keyboard.press("Escape");
		await scroller.evaluate((el) => {
			el.scrollTop = 0;
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("bookmarks").click();
		await page.getByTestId("bookmark").getByRole("button").first().click();
		await expect
			.poll(() => scroller.evaluate((el) => el.scrollTop))
			.toBeGreaterThan(100);
	});
});

test.describe("bookmarks on a desktop", () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test("Ctrl+D adds one, and the side panel lists them", async ({ page }) => {
		await boot(page, {}, "?desktop");
		await openFixture(page, "sample.pptx");
		await expect(page.getByTestId("slide-page-field")).toBeVisible({
			timeout: 20_000,
		});
		await page.keyboard.press("ArrowRight");
		await expect(page.getByTestId("slide-page-field")).toHaveValue("2");
		await page.keyboard.press("Control+d");
		await page.getByTestId("side-toggle").click();
		await page.getByTestId("side-tab-bookmarks").click();
		await expect(page.getByTestId("bookmark")).toHaveText(["Slide 2"]);
		await page.keyboard.press("Home");
		await page.getByTestId("bookmark").getByRole("button").first().click();
		await expect(page.getByTestId("slide-page-field")).toHaveValue("2");
	});
});

test.describe("books", () => {
	test("an EPUB reads as one text, with its contents, pictures and notes", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/book.epub", "The Wren's Year.epub");
		const book = page.getByTestId("epub-scroll");
		await expect(book).toContainText("The first wren of spring", {
			timeout: 20_000,
		});
		// The book's own styles (and their web address) are left out.
		await expect(book.locator("link, style")).toHaveCount(0);
		// The cover picture, drawn from inside the book.
		const cover = book.locator("img").first();
		await expect(cover).toHaveAttribute("src", /^blob:/);
		await expect
			.poll(() =>
				cover.evaluate((img) => (img as HTMLImageElement).naturalWidth),
			)
			.toBe(300);
		// A right-to-left chapter reads from the right.
		await expect(book.locator('section[dir="rtl"]')).toContainText("بہار");

		await page.getByTestId("file-more").click();
		await page.getByTestId("epub-contents").click();
		await expect(page.getByTestId("epub-toc")).toHaveText([
			"Spring",
			"Summer",
			"The hot days",
			"بہار",
		]);
		await page.getByTestId("epub-toc").nth(1).click();
		await expect
			.poll(() =>
				page
					.locator("#pw-c2")
					.evaluate((el) => Math.round(el.getBoundingClientRect().top)),
			)
			.toBeLessThan(160);

		// A note's link leads to the note.
		await page.locator("#pw-c1").scrollIntoViewIfNeeded();
		await page.locator('a[href="#pw-c4-n1"]').click();
		await expect(page.locator("#pw-c4-n1")).toBeInViewport();

		await page.getByTestId("epub-find").click();
		await page.getByTestId("find-input").fill("hedge");
		await expect(page.getByTestId("find-count")).toHaveText(/1 of 8\d/);
		await page.keyboard.press("Escape");

		await page.getByTestId("file-more").click();
		await page.getByTestId("file-details-open").click();
		await expect(page.getByTestId("file-details")).toContainText("Hedge Press");
	});

	test("a book locked by its store says so", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/locked.epub");
		await expect(page.getByTestId("epub-error")).toContainText(
			"This book is locked",
			{ timeout: 20_000 },
		);
	});
});

/** A speech engine that says each piece in a moment and notes it down,
 * with one voice on the device and one that would send text away. */
function fakeSpeech() {
	type Said = { text: string; rate: number; voice?: string };
	const w = window as unknown as {
		__spoken: Said[];
		SpeechSynthesisUtterance: unknown;
	};
	w.__spoken = [];
	let current: Record<string, unknown> | null = null;
	w.SpeechSynthesisUtterance = class {
		constructor(public text: string) {}
	};
	const synth = {
		getVoices: () => [
			{ lang: "en-US", localService: true, default: true, name: "Local" },
			{ lang: "en-US", localService: false, name: "Cloud" },
		],
		speak(u: Record<string, unknown>) {
			current = u;
			w.__spoken.push({
				text: u.text as string,
				rate: u.rate as number,
				voice: (u.voice as { name: string } | undefined)?.name,
			});
			u.timer = setTimeout(() => {
				if (current !== u) return;
				current = null;
				(u.onend as () => void)?.();
			}, 150);
		},
		cancel() {
			const u = current;
			current = null;
			if (!u) return;
			clearTimeout(u.timer as number);
			(u.onerror as (e: unknown) => void)?.({ error: "interrupted" });
		},
		addEventListener() {},
	};
	Object.defineProperty(window, "speechSynthesis", {
		value: synth,
		configurable: true,
	});
}

test.describe("read aloud", () => {
	test("reads a book from the place on show, sentence by sentence", async ({
		page,
	}) => {
		await page.addInitScript(fakeSpeech);
		await boot(page);
		await openFixture(page, "features/book.epub");
		await expect(page.getByTestId("epub-scroll")).toContainText("Spring", {
			timeout: 20_000,
		});
		await page.locator("#pw-c1").scrollIntoViewIfNeeded();
		await page.getByTestId("file-more").click();
		await page.getByTestId("read-aloud-start").click();
		await expect(page.getByTestId("read-aloud")).toBeVisible();
		const spoken = () =>
			page.evaluate(
				() =>
					(window as unknown as { __spoken: Array<{ text: string }> }).__spoken,
			);
		await expect.poll(async () => (await spoken()).length).toBeGreaterThan(2);
		const said = await spoken();
		// From the chapter on show, in a voice on the device.
		expect(said[0].text).toBe("Spring");
		expect(said[1].text).toContain("The first wren of spring");
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { __spoken: Array<{ voice: string }> })
						.__spoken[0].voice,
			),
		).toBe("Local");

		await page.getByTestId("read-aloud-pause").click();
		const paused = (await spoken()).length;
		await page.waitForTimeout(500);
		expect((await spoken()).length).toBe(paused);
		await page.getByTestId("read-aloud-play").click();
		await page.getByTestId("read-aloud-rate").click();
		await expect(page.getByTestId("read-aloud-rate")).toHaveText("1.25×");
		await expect
			.poll(
				async () =>
					(
						await page.evaluate(
							() =>
								(window as unknown as { __spoken: Array<{ rate: number }> })
									.__spoken,
						)
					).at(-1)?.rate,
			)
			.toBe(1.25);
		await page.getByTestId("read-aloud-stop").click();
		await expect(page.getByTestId("read-aloud")).toHaveCount(0);
	});

	test("reads a PDF page after page, and leaves with the document", async ({
		page,
	}) => {
		await page.addInitScript(fakeSpeech);
		await boot(page);
		await openFixture(page, "features/pictures.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("read-aloud-start").click();
		await expect
			.poll(() =>
				page.evaluate(() =>
					(
						window as unknown as { __spoken: Array<{ text: string }> }
					).__spoken.map((s) => s.text),
				),
			)
			.toContainEqual(expect.stringContaining("Chapter two, line 1"));
		// The reading takes the pages with it.
		await expect(page.getByTestId("pdf-page")).toHaveText("2 / 3");
		await page.getByTestId("viewer-back").click();
		await expect(page.getByTestId("read-aloud")).toHaveCount(0);
	});

	test("is not offered where no voice speaks on the device", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, "speechSynthesis", {
				value: {
					getVoices: () => [{ lang: "en-US", localService: false }],
					addEventListener() {},
					cancel() {},
				},
				configurable: true,
			});
		});
		await boot(page);
		await openFixture(page, "sample.txt");
		await page.getByTestId("file-more").click();
		await expect(page.getByTestId("file-menu")).toBeVisible();
		await expect(page.getByTestId("read-aloud-start")).toHaveCount(0);
	});
});

test.describe("reading on a phone", () => {
	const tap = async (page: Page, testId: string, at: number) => {
		const box = await page.getByTestId(testId).boundingBox();
		if (!box) throw new Error(`no ${testId}`);
		await page.getByTestId(testId).dispatchEvent("touchstart", {
			touches: [
				{ identifier: 0, clientX: box.x + box.width * at, clientY: 400 },
			],
		});
		await page.getByTestId(testId).dispatchEvent("touchend", {
			touches: [],
			changedTouches: [
				{ identifier: 0, clientX: box.x + box.width * at, clientY: 400 },
			],
		});
	};
	const scrollTop = (page: Page, testId: string) =>
		page.getByTestId(testId).evaluate((el) => el.scrollTop);
	const barsHidden = (page: Page) =>
		page
			.getByTestId("viewer")
			.locator("header")
			.evaluate((h) => h.hasAttribute("inert"));

	test("the volume keys and the sides of the screen turn pages", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			const w = window as unknown as {
				__paperwrenAndroidExtras: Record<string, unknown>;
				__volumeOn: boolean;
			};
			w.__paperwrenAndroidExtras = {
				volumeKeys: (on: boolean) => {
					w.__volumeOn = on;
				},
			};
		});
		await boot(page, { settings_v2: { volumeKeys: true, tapToTurn: true } });
		await openFixture(page, "features/book.epub");
		await expect(page.getByTestId("epub-scroll")).toContainText("Spring", {
			timeout: 20_000,
		});
		expect(
			await page.evaluate(
				() => (window as unknown as { __volumeOn: boolean }).__volumeOn,
			),
		).toBe(true);
		await page.evaluate(() =>
			(
				window as unknown as { __paperwrenVolumeKey: (d: number) => void }
			).__paperwrenVolumeKey(1),
		);
		await expect
			.poll(() => scrollTop(page, "epub-scroll"))
			.toBeGreaterThan(300);
		const after = await scrollTop(page, "epub-scroll");
		await tap(page, "epub-scroll", 0.9);
		await expect
			.poll(() => scrollTop(page, "epub-scroll"))
			.toBeGreaterThan(after + 300);
		await tap(page, "epub-scroll", 0.1);
		await expect
			.poll(() => scrollTop(page, "epub-scroll"))
			.toBeLessThan(after + 50);
		// The middle still shows and hides the bars.
		await tap(page, "epub-scroll", 0.5);
		await expect.poll(() => barsHidden(page)).toBe(true);
		await tap(page, "epub-scroll", 0.5);
		await expect.poll(() => barsHidden(page)).toBe(false);
		// Leaving the document gives the keys back to the volume.
		await page.getByTestId("viewer-back").click();
		expect(
			await page.evaluate(
				() => (window as unknown as { __volumeOn: boolean }).__volumeOn,
			),
		).toBe(false);
	});

	test("the bars go while reading on, and one tap brings them back", async ({
		page,
	}) => {
		await boot(page, { settings_v2: { autoHideBars: true } });
		await openFixture(page, "features/book.epub");
		const book = page.getByTestId("epub-scroll");
		await expect(book).toContainText("Spring", { timeout: 20_000 });
		await book.evaluate((el) => {
			el.scrollTop += 300;
		});
		await expect.poll(() => barsHidden(page)).toBe(true);
		await tap(page, "epub-scroll", 0.5);
		await expect.poll(() => barsHidden(page)).toBe(false);
		await book.evaluate((el) => {
			el.scrollTop += 300;
		});
		await expect.poll(() => barsHidden(page)).toBe(true);
		await book.evaluate((el) => {
			el.scrollTop -= 100;
		});
		await expect.poll(() => barsHidden(page)).toBe(false);
	});

	test("the screen dims, and the document scrolls by itself", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/book.epub");
		await expect(page.getByTestId("epub-scroll")).toContainText("Spring", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("dim").click();
		await page.getByTestId("dim-range").fill("50");
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("dim-layer")).toHaveCSS("opacity", "0.35");

		const before = await scrollTop(page, "epub-scroll");
		await page.getByTestId("file-more").click();
		await page.getByTestId("auto-scroll-start").click();
		await expect
			.poll(() => scrollTop(page, "epub-scroll"))
			.toBeGreaterThan(before + 20);
		await page.getByTestId("auto-scroll-faster").click();
		await expect(page.getByTestId("auto-scroll-speed")).toHaveText("50");
		await page.getByTestId("auto-scroll-pause").click();
		const paused = await scrollTop(page, "epub-scroll");
		await page.waitForTimeout(500);
		expect(await scrollTop(page, "epub-scroll")).toBe(paused);
		await page.getByTestId("auto-scroll-stop").click();
		await expect(page.getByTestId("auto-scroll")).toHaveCount(0);
	});
});

test.describe("pictures and code", () => {
	const natural = (page: Page) =>
		page
			.getByTestId("image")
			.evaluate(
				(img) =>
					`${(img as HTMLImageElement).naturalWidth}x${(img as HTMLImageElement).naturalHeight}`,
			);

	test("SVG, AVIF and TIFF are drawn; a drawing's script never runs", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/drawing.svg");
		await expect.poll(() => natural(page), { timeout: 20_000 }).toBe("240x160");
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { __svgScriptRan?: boolean }).__svgScriptRan,
			),
		).toBeUndefined();
		await page.getByTestId("viewer-back").click();

		await openFixture(page, "features/photo.avif");
		await expect.poll(() => natural(page), { timeout: 20_000 }).toBe("160x120");
		await page.getByTestId("viewer-back").click();

		// A TIFF's two pages, a page at a time.
		await openFixture(page, "features/scan.tif");
		await expect(page.getByTestId("picture-page")).toHaveText("1 / 2", {
			timeout: 20_000,
		});
		await expect.poll(() => natural(page)).toBe("200x260");
		await page.getByTestId("picture-page").click();
		await page.getByTestId("picture-jump-input").fill("2");
		await page.getByTestId("picture-jump-go").click();
		await expect(page.getByTestId("picture-page")).toHaveText("2 / 2");
	});

	test("a comic book turns its pages in order, and is remembered", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/comic.cbz");
		const counter = page.getByTestId("picture-page");
		await expect(counter).toHaveText("1 / 3", { timeout: 20_000 });
		const scroller = page.getByTestId("image-scroll");
		const box = await scroller.boundingBox();
		if (!box) throw new Error("no scroller");
		// A tap on the right side, its two halves sent together: a tap is
		// one only if it is quick.
		await scroller.evaluate(
			(el, x) => {
				const touch = new Touch({
					identifier: 0,
					target: el,
					clientX: x,
					clientY: 400,
				});
				el.dispatchEvent(
					new TouchEvent("touchstart", {
						touches: [touch],
						changedTouches: [touch],
						bubbles: true,
						cancelable: true,
					}),
				);
				el.dispatchEvent(
					new TouchEvent("touchend", {
						touches: [],
						changedTouches: [touch],
						bubbles: true,
						cancelable: true,
					}),
				);
			},
			box.x + box.width * 0.9,
		);
		await expect(counter).toHaveText("2 / 3");
		await page
			.getByTestId("image")
			.evaluate((img) => img.getAttribute("data-page"));
		// "page10" comes after "page2".
		await counter.click();
		await page.getByTestId("picture-jump-input").fill("3");
		await page.getByTestId("picture-jump-go").click();
		await expect(counter).toHaveText("3 / 3");
		await page.waitForTimeout(500);
		await page.getByTestId("viewer-back").click();
		await expect(page.getByTestId("recent").first()).toContainText("Page 3");
		await page
			.getByTestId("recent")
			.first()
			.getByRole("button")
			.first()
			.click();
		await expect(counter).toHaveText("3 / 3", { timeout: 20_000 });
	});

	test("a HEIC photo is drawn by the system where the webview cannot", async ({
		page,
	}) => {
		const jpeg = (await import("node:fs"))
			.readFileSync("fixtures/features/photo.jpg")
			.toString("base64");
		await page.addInitScript((answer) => {
			const w = window as unknown as {
				__paperwrenAndroidExtras: Record<string, unknown>;
				__paperwrenDecoded: (token: string, jpeg: string) => void;
			};
			w.__paperwrenAndroidExtras = {
				decodePicture: (_b64: string, token: string) => {
					setTimeout(() => w.__paperwrenDecoded(token, answer), 20);
					return true;
				},
			};
		}, jpeg);
		await boot(page);
		await openFixture(page, "features/photo.heic");
		await expect.poll(() => natural(page), { timeout: 20_000 }).toBe("320x200");
	});

	test("with nothing to draw it, a HEIC photo says so", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/photo.heic");
		await expect(page.getByTestId("image-error")).toContainText("HEIC", {
			timeout: 20_000,
		});
	});

	test("a photo's camera details, and a mirror", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/photo.jpg");
		await expect.poll(() => natural(page), { timeout: 20_000 }).toBe("320x200");
		await page.getByTestId("file-more").click();
		await page.getByTestId("image-flip-x").click();
		await expect(page.getByTestId("image")).toHaveCSS(
			"transform",
			"matrix(-1, 0, 0, 1, 0, 0)",
		);
		await page.getByTestId("file-more").click();
		await page.getByTestId("file-details-open").click();
		const details = page.getByTestId("file-details");
		await expect(details).toContainText("Canon EOS R6");
		await expect(details).toContainText("1/125 s · f/2.8 · ISO 400 · 50 mm");
		await expect(details).toContainText("34.0500° N, 118.2500° W");
	});

	test("code is coloured, with line numbers and in Markdown", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/wren.py");
		await expect(page.getByTestId("text-code")).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.locator(".hljs-keyword").first()).toHaveText("import");
		// What the code says is text, never markup.
		await expect(page.getByTestId("text-code")).toContainText("<silent>");
		await page.getByTestId("file-more").click();
		await page.getByTestId("text-lines").click();
		await expect(
			page.getByTestId("text-numbered").locator("> div"),
		).toHaveCount(15);
		await expect(page.locator(".hljs-comment")).toHaveCount(1);
		await page.getByTestId("viewer-back").click();
		await openFixture(page, "features/notes.md");
		await expect(page.locator("article .hljs-keyword").first()).toHaveText(
			"def",
			{ timeout: 20_000 },
		);
	});
});

test.describe("tabs on a desktop", () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	/** Open a fixture with Ctrl+O, as from inside a document. */
	const openMore = async (page: Page, fixture: string) => {
		const b64 = (await import("node:fs"))
			.readFileSync(`fixtures/${fixture}`)
			.toString("base64");
		await page.evaluate(
			({ b64, name }) => {
				const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				window.__paperwrenTestFile = new File([bytes], name);
			},
			{ b64, name: fixture.split("/").pop() ?? fixture },
		);
		await page.keyboard.press("Control+o");
	};

	test("documents open side by side, one on show, and close in turn", async ({
		page,
	}) => {
		await boot(page, {}, "?desktop&frame");
		await openFixture(page, "features/pictures.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		// One document is just a document: no row of tabs.
		await expect(page.getByTestId("tab-strip")).toHaveCount(0);

		await openMore(page, "features/book.epub");
		const tabs = page.getByTestId("tab");
		await expect(tabs).toHaveText(["pictures.pdf", "book.epub"]);
		await expect(page.getByTestId("epub-scroll")).toBeVisible();
		await expect(page.getByTestId("pdf-scroll")).toBeHidden();
		// The window's buttons sit in the row of tabs.
		const strip = await page.getByTestId("tab-strip").boundingBox();
		const buttons = await page.getByTestId("window-controls").boundingBox();
		expect(Math.round(buttons?.y ?? -1)).toBe(Math.round(strip?.y ?? -2));

		await tabs.first().getByRole("tab").click();
		await expect(page.getByTestId("pdf-scroll")).toBeVisible();
		await page.keyboard.press("Control+Tab");
		await expect(page.getByTestId("epub-scroll")).toBeVisible();
		await page.keyboard.press("Control+1");
		await expect(page.getByTestId("pdf-scroll")).toBeVisible();

		// Home, with the tabs kept; a document already open is not opened twice.
		await page.getByTestId("tab-home").click();
		await expect(page.getByTestId("home")).toBeVisible();
		await expect(tabs).toHaveCount(2);
		await page
			.getByTestId("recent")
			.filter({ hasText: "book.epub" })
			.getByRole("button")
			.first()
			.click();
		await expect(tabs).toHaveCount(2);
		await expect(page.getByTestId("epub-scroll")).toBeVisible();

		// Closing shows the tab shown before it; the last one leaves Home.
		await page.keyboard.press("Control+w");
		await expect(tabs).toHaveCount(0);
		await expect(page.getByTestId("pdf-scroll")).toBeVisible();
		await page.getByTestId("viewer-back").click();
		await expect(page.getByTestId("home")).toBeVisible();
		await expect(page.getByTestId("tab-strip")).toHaveCount(0);
	});

	test("files dropped together open a tab each", async ({ page }) => {
		await boot(page, {}, "?desktop");
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await openMore(page, "sample.docx");
		await openMore(page, "sample.txt");
		await expect(page.getByTestId("tab")).toHaveCount(3);
		await page.getByTestId("tab").nth(1).getByTestId("tab-close").click();
		await expect(page.getByTestId("tab")).toHaveText([
			"sample.pdf",
			"sample.txt",
		]);
	});
});

test.describe("office details", () => {
	test("a deck and a document say who made them and when", async ({ page }) => {
		await boot(page);
		await openFixture(page, "sample.pptx");
		await page.getByTestId("file-more").click();
		await page.getByTestId("file-details-open").click();
		const details = page.getByTestId("file-details");
		await expect(details).toContainText("Last changed by");
		await expect(details).toContainText("Steve Canny");
		await expect(details).toContainText("2013");
		await page.keyboard.press("Escape");
		await page.getByTestId("viewer-back").click();

		await openFixture(page, "sample.odt");
		await page.getByTestId("file-more").click();
		await page.getByTestId("file-details-open").click();
		await expect(details).toContainText("Author");
		await expect(details).toContainText("python-docx");
	});
});

test.describe("markdown and JSON", () => {
	test("Markdown has its contents and its maths", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/notes.md");
		// KaTeX draws the maths: a line of it, and a block.
		await expect(page.locator("article .katex").first()).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.locator("article .katex-display")).toHaveCount(1);
		await expect(page.locator("article .katex")).toHaveCount(2);
		// Prices are prose.
		await expect(page.locator("article")).toContainText("costs $5 or $10");
		await expect(page.locator("article .katex-error")).toHaveCount(0);

		await page.getByTestId("file-more").click();
		await page.getByTestId("doc-contents").click();
		await expect(page.getByTestId("heading")).toHaveText([
			"Notes",
			"Maths",
			"Data",
			"A small heading",
		]);
		await page.getByTestId("heading").nth(3).click();
		await expect(page.locator("article h3")).toBeInViewport();
	});

	test("Markdown contents sit in the side panel on a desktop", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await boot(page, {}, "?desktop");
		await openFixture(page, "features/notes.md");
		await page.getByTestId("side-toggle").click();
		await expect(page.getByTestId("heading")).toHaveCount(4);
		await page.getByTestId("heading").nth(1).click();
		await expect(page.locator("article h2").first()).toBeInViewport();
	});

	test("JSON folds as a tree, and can be text again", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/data.json");
		const tree = page.getByTestId("json-tree");
		await expect(tree).toBeVisible();
		await expect(tree).toContainText("9007199254740993");
		await expect(tree).toContainText('"tags": [');
		// Deep branches start folded, saying what they hold.
		await expect(tree.getByText("found me")).toBeHidden();
		await expect(tree).toContainText("1 key");
		await tree.locator("summary", { hasText: '"deep"' }).click();
		await tree.locator("summary", { hasText: '"deeper"' }).click();
		await expect(tree.getByText("found me")).toBeVisible();

		await page.getByTestId("file-more").click();
		await page.getByTestId("tree-fold").click();
		await expect(tree.locator("details[open]")).toHaveCount(0);

		// Find unfolds what it looks through.
		await page.getByTestId("text-find").click();
		await page.getByTestId("find-input").fill("found");
		await expect(page.getByTestId("find-count")).toHaveText("1 of 1");
		await expect(tree.getByText("found me")).toBeVisible();
		await page.keyboard.press("Escape");

		await page.getByTestId("file-more").click();
		await page.getByTestId("text-tree").click();
		await expect(tree).toHaveCount(0);
		await expect(page.getByTestId("text-code")).toContainText('"found me"');
	});
});

test.describe("sheets", () => {
	/** The values down a column of the grid, top to bottom. */
	const column = (page: Page, c: number) =>
		page
			.locator(`[data-testid="sheet-grid"] [data-c="${c}"]`)
			.evaluateAll((cells) =>
				cells
					.map((el) => ({
						r: Number(el.getAttribute("data-r")),
						text: el.textContent ?? "",
					}))
					.sort((a, b) => a.r - b.r)
					.filter((cell, i, all) => i === 0 || cell.r !== all[i - 1].r)
					.map((cell) => cell.text),
			);
	const cell = (page: Page, r: number, c: number) =>
		page.locator(`[data-testid="sheet-grid"] [data-r="${r}"][data-c="${c}"]`);

	test("rows sort and filter for reading, and the file's gridlines are kept", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/birds.xlsx");
		await expect(page.getByTestId("sheet-grid")).toBeVisible({
			timeout: 20_000,
		});
		// The file turns its gridlines off.
		const borders = () =>
			cell(page, 1, 0).evaluate((el) => getComputedStyle(el).borderRightColor);
		expect(await borders()).toBe("rgba(0, 0, 0, 0)");

		// Sorting needs a column: until a cell is picked, it says so.
		await page.getByTestId("file-more").click();
		await expect(page.getByTestId("sheet-sort-up")).toBeDisabled();
		await page.keyboard.press("Escape");

		await cell(page, 1, 1).click();
		await page.getByTestId("file-more").click();
		await page.getByTestId("sheet-sort-down").click();
		await expect(page.getByTestId("sheet-arranged")).toContainText(
			"Sorted by column B",
		);
		expect(await column(page, 0)).toEqual([
			"Bird",
			"Owl",
			"Kite",
			"Wren",
			"robin",
			"Finch",
		]);
		// A cell keeps its own address.
		await cell(page, 1, 0).click();
		await expect(page.getByTestId("cell-detail")).toContainText("A5");

		await cell(page, 1, 2).click();
		await page.getByTestId("file-more").click();
		await page.getByTestId("sheet-filter").click();
		await page.getByTestId("sheet-filter-input").fill("lahore");
		await page.getByTestId("sheet-filter-input").press("Enter");
		await expect(page.getByTestId("sheet-arranged")).toContainText(
			"Showing 4 of 6 rows",
		);
		expect(await column(page, 0)).toEqual(["Bird", "Kite", "Wren", "Finch"]);

		// Find looks through the rows as shown.
		await page.getByTestId("sheet-find").click();
		await page.getByTestId("find-input").fill("owl");
		await expect(page.getByTestId("find-count")).toHaveText("No results");
		await page.keyboard.press("Escape");

		await page.getByTestId("sheet-arranged-clear").click();
		await expect(page.getByTestId("sheet-arranged")).toHaveCount(0);
		expect(await column(page, 0)).toEqual([
			"Bird",
			"Wren",
			"robin",
			"Finch",
			"Owl",
			"Kite",
		]);

		await page.getByTestId("file-more").click();
		await page.getByTestId("sheet-gridlines").click();
		expect(await borders()).not.toBe("rgba(0, 0, 0, 0)");
		// The file's conditional formatting: over 100 in light red, and a
		// white-to-green scale.
		await expect(cell(page, 4, 1)).toHaveCSS(
			"background-color",
			"rgb(255, 199, 206)",
		);
		await expect(cell(page, 5, 3)).toHaveCSS(
			"background-color",
			"rgb(99, 190, 123)",
		);
	});

	test("a CSV in another encoding can be read in it", async ({ page }) => {
		await boot(page);
		await openFixture(page, "features/towns.csv");
		await expect(page.getByTestId("sheet-grid")).toBeVisible({
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("sheet-encoding").click();
		await page
			.getByRole("button", { name: "WINDOWS-1252", exact: true })
			.click();
		await expect(cell(page, 1, 0)).toHaveText("Zoë");
		await expect(cell(page, 1, 1)).toHaveText("Saint-Étienne");
	});
});

test.describe("reading font", () => {
	const face = (page: Page, selector: string) =>
		page
			.locator(selector)
			.first()
			.evaluate((el) => getComputedStyle(el).fontFamily);

	test("books and Markdown take the face picked; code keeps its own", async ({
		page,
	}) => {
		await boot(page, { settings_v2: { readingFont: "sans" } });
		await openFixture(page, "features/book.epub");
		await expect(page.locator("#pw-c1")).toBeVisible({ timeout: 20_000 });
		expect(await face(page, "#pw-c1 p")).toContain("Manrope");
		await page.getByTestId("viewer-back").click();

		await page.getByTestId("open-settings").click();
		await page.getByTestId("reading-font-serif").click();
		await page.getByTestId("settings-back").click();
		await openFixture(page, "features/notes.md");
		await expect(page.locator("article h1")).toBeVisible();
		expect(await face(page, "article p")).toContain("Georgia");
		expect(await face(page, "article pre code")).not.toContain("Georgia");
	});
});
