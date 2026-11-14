import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";
import { boot, longPdf, openFixture } from "./helpers";

/** The desktop layout, as the Windows app has it: `?desktop` asks for
 * it in a browser, `&frame` for the window buttons the app draws where
 * it has no native frame. */
const DESKTOP = "?desktop&frame";

const scrollTop = (page: Page, id: string) =>
	page.getByTestId(id).evaluate((el) => el.scrollTop);

test.describe("the desktop layout", () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test("one bar holds the document's controls and the window's buttons", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		// Home: "Open file" is in the bar, and says files can be dropped.
		await expect(page.locator("header").getByTestId("open-file")).toBeVisible();
		await expect(page.getByTestId("drop-tip")).toBeVisible();
		await expect(page.getByTestId("window-controls")).toBeVisible();

		await openFixture(page, "sample.pdf");
		const field = page.getByTestId("pdf-page-field");
		await expect(field).toHaveValue("1", { timeout: 20_000 });
		await expect(page.getByTestId("pdf-page")).toHaveText("/ 3");
		// No bar at the foot: the page and zoom controls are in the top one.
		const viewer = page.getByTestId("viewer");
		await expect(viewer.locator("footer")).toHaveCount(0);
		await expect(
			viewer.locator("header").getByTestId("pdf-zoom-in"),
		).toBeVisible();

		// Type a page number, press Enter.
		await field.fill("3");
		await field.press("Enter");
		await expect(field).toHaveValue("3");
		await expect.poll(() => scrollTop(page, "pdf-scroll")).toBeGreaterThan(500);

		// The zoom level opens a menu of sizes.
		await page.getByTestId("pdf-scale").click();
		const sizes = page.getByTestId("pdf-zoom-menu");
		await expect(sizes).toContainText("Whole page");
		await sizes.getByRole("button", { name: "100%", exact: true }).click();
		await expect(page.getByTestId("pdf-scale")).toHaveText("100%");

		// A menu opens beside its button, not at the foot of the window.
		await page.getByTestId("file-more").click();
		const menu = page.getByTestId("file-menu");
		await expect(menu).toBeVisible();
		const box = await menu.boundingBox();
		expect(box?.y ?? 999).toBeLessThan(120);
		expect(box?.x ?? 0).toBeGreaterThan(700);
		// What the side panel does is not repeated in the menu.
		await expect(page.getByTestId("pdf-pages")).toHaveCount(0);
		// Nor is the bar's full screen button.
		await expect(page.getByTestId("file-fullscreen")).toHaveCount(0);
		await page.keyboard.press("Escape");
		await expect(menu).toHaveCount(0);
	});

	test("every viewer has a full screen button in its bar", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		for (const file of [
			"sample.docx",
			"sample.xlsx",
			"sample.txt",
			"sample.png",
			"sample.pptx",
		]) {
			await openFixture(page, file);
			await expect(
				page.getByTestId("viewer").getByTestId("viewer-fullscreen"),
			).toBeVisible({ timeout: 20_000 });
			// The slide show has an icon of its own, not full screen's.
			if (file.endsWith(".pptx"))
				await expect(
					page.getByTestId("slides-present").locator(".lucide-presentation"),
				).toBeVisible();
			await page.getByTestId("viewer-back").click();
		}
		await openFixture(page, "sample.pdf");
		const button = page.getByTestId("viewer-fullscreen");
		await expect(button).toHaveAttribute("aria-label", "Full screen");
		await button.click();
		await expect(page.locator("html")).toHaveAttribute(
			"data-fullscreen",
			"page",
		);
		// The bar hides; brought back at the top edge, its button says how
		// to leave, and leaves.
		await page.mouse.move(640, 300);
		await page.mouse.move(640, 1);
		await expect(page.locator("html")).toHaveAttribute("data-reveal", "");
		await expect(button).toHaveAttribute("aria-label", "Leave full screen");
		await expect(button).toHaveAttribute("aria-pressed", "true");
		await button.click();
		await expect(page.locator("html")).not.toHaveAttribute(
			"data-fullscreen",
			/./,
		);
		await expect(button).toHaveAttribute("aria-label", "Full screen");
		// A window too narrow for it has it in the menu instead.
		await page.setViewportSize({ width: 600, height: 800 });
		await expect(button).toHaveCount(0);
		await page.getByTestId("file-more").click();
		await expect(page.getByTestId("file-fullscreen")).toBeVisible();
	});

	test("the side panel lists pages and stays open while reading", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		const field = page.getByTestId("pdf-page-field");
		await expect(field).toHaveValue("1", { timeout: 20_000 });
		await expect(page.getByTestId("side-panel")).toHaveCount(0);
		await page.getByTestId("side-toggle").click();
		const panel = page.getByTestId("side-panel");
		await expect(panel.getByTestId("pdf-thumbs")).toBeVisible();
		await panel.locator('[data-page="3"]').click();
		await expect(field).toHaveValue("3");
		await expect(panel).toBeVisible();
		await expect(panel.locator('[data-page="3"]')).toHaveAttribute(
			"aria-current",
			"page",
		);
		await page.getByTestId("side-tab-contents").click();
		await expect(panel).toContainText("This PDF has no outline");

		// The choice is remembered for the next document.
		await page.getByTestId("viewer-back").click();
		await openFixture(page, "viewer-regressions/effects.pptx");
		await expect(page.getByTestId("slide-thumbs")).toBeVisible({
			timeout: 20_000,
		});
		const slide = page.getByTestId("slide-page-field");
		await page.getByTestId("slide-thumb").nth(2).click();
		await expect(slide).toHaveValue("3");
		await slide.fill("1");
		await slide.press("Enter");
		await expect(slide).toHaveValue("1");
	});

	test("the keyboard keeps working after a click on the bar", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		const field = page.getByTestId("pdf-page-field");
		await expect(field).toHaveValue("1", { timeout: 20_000 });
		// Left and Right turn whole pages while the page fits the width.
		await page.keyboard.press("ArrowRight");
		await expect(field).toHaveValue("2");
		await page.keyboard.press("ArrowLeft");
		await expect(field).toHaveValue("1");
		// A click on a button leaves the focus on it; the document must
		// still scroll.
		await page.getByTestId("pdf-zoom-out").click();
		await page.keyboard.press("PageDown");
		await expect.poll(() => scrollTop(page, "pdf-scroll")).toBeGreaterThan(100);
		await page.keyboard.press("Control+End");
		await expect(field).toHaveValue("3");
		await page.keyboard.press("Control+Home");
		await expect(field).toHaveValue("1");
		await expect.poll(() => scrollTop(page, "pdf-scroll")).toBe(0);
	});

	test("a click on the page keeps the keys, and Page Down stops at each page", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		const field = page.getByTestId("pdf-page-field");
		await expect(field).toHaveValue("1", { timeout: 20_000 });
		// The click leaves the keyboard on the page's text: the arrows still
		// turn the pages.
		await page.mouse.click(640, 450);
		await page.keyboard.press("ArrowRight");
		await expect(field).toHaveValue("2");
		await page.keyboard.press("ArrowLeft");
		await expect(field).toHaveValue("1");
		await expect.poll(() => scrollTop(page, "pdf-scroll")).toBe(0);

		// A page taller than the screen: most of a screen, then the top of
		// the next page, not part way down it.
		const pageTop = (n: number) =>
			page.getByTestId("pdf-scroll").evaluate((box, i) => {
				const p = box.querySelectorAll(".page")[i] as HTMLElement;
				return p.getBoundingClientRect().top - box.getBoundingClientRect().top;
			}, n - 1);
		await page.keyboard.press("PageDown");
		await expect.poll(() => scrollTop(page, "pdf-scroll")).toBeGreaterThan(300);
		expect(await pageTop(2)).toBeGreaterThan(0);
		await page.keyboard.press("PageDown");
		await expect.poll(async () => Math.round(await pageTop(2))).toBe(0);
		await expect(field).toHaveValue("2");
		// Space goes the same way, and Shift+Space back.
		await page.keyboard.press("Shift+Space");
		await page.keyboard.press("Shift+Space");
		await expect.poll(() => scrollTop(page, "pdf-scroll")).toBe(0);

		// G: type a page number and press Enter.
		await page.keyboard.press("g");
		await expect(field).toBeFocused();
		await page.keyboard.type("3");
		await page.keyboard.press("Enter");
		await expect(field).toHaveValue("3");
		await expect(field).not.toBeFocused();
	});

	test("find steps with F3 and closes with Escape from anywhere", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		// "Find next" with no search yet opens one.
		await page.keyboard.press("F3");
		const input = page.getByTestId("find-input");
		await expect(input).toBeFocused();
		await input.fill("test page");
		const count = page.getByTestId("find-count");
		await expect(count).toHaveText("1 of 3");
		// Leave the field: the keys still belong to the search.
		await page.getByTestId("pdf-zoom-out").click();
		await page.keyboard.press("F3");
		await expect(count).toHaveText("2 of 3");
		await page.keyboard.press("Shift+F3");
		await expect(count).toHaveText("1 of 3");
		await page.keyboard.press("Control+g");
		await expect(count).toHaveText("2 of 3");
		await page.keyboard.press("Escape");
		await expect(input).toHaveCount(0);
	});

	test("select all takes the document, and a right click offers to find it", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.txt");
		await expect(page.getByTestId("text-scroll")).toContainText(
			"quick brown fox",
			{ timeout: 20_000 },
		);
		await page.keyboard.press("Control+a");
		const picked = await page.evaluate(
			() => window.getSelection()?.toString() ?? "",
		);
		expect(picked).toContain("quick brown fox");
		// Not the app around it: the file's name is in the bar.
		expect(picked).not.toContain("sample.txt");

		await page
			.getByTestId("text-scroll")
			.locator("pre")
			.click({ button: "right", position: { x: 40, y: 12 } });
		const menu = page.getByTestId("selection-menu");
		await expect(menu).toBeVisible();
		await menu.getByTestId("selection-find").click();
		await expect(page.getByTestId("find-input")).not.toHaveValue("");
		await expect(page.getByTestId("find-count")).toContainText(" of ");
	});

	test("a slide show answers to the mouse", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "viewer-regressions/effects.pptx");
		await expect(page.getByTestId("slide-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await page.getByTestId("slides-present").click();
		const show = page.getByTestId("present");
		await expect(show).toBeVisible();
		const counter = page.getByTestId("present-counter");
		await expect(counter).toHaveText("1 / 3");
		// A click goes on, a right click goes back, the wheel turns slides.
		await page.mouse.click(640, 300);
		await expect(counter).toHaveText("2 / 3");
		await page.mouse.click(640, 300, { button: "right" });
		await expect(counter).toHaveText("1 / 3");
		await page.mouse.move(640, 300);
		await page.mouse.wheel(0, 120);
		await expect(counter).toHaveText("2 / 3");
		await page.keyboard.press("Escape");
		await expect(show).toHaveCount(0);
		await expect(page.getByTestId("slide-page-field")).toHaveValue("2");
	});

	test("a slide show's buttons answer to the keyboard", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "viewer-regressions/effects.pptx");
		await expect(page.getByTestId("slide-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await page.getByTestId("slides-present").click();
		const counter = page.getByTestId("present-counter");
		await expect(counter).toHaveText("1 / 3");
		// Enter on a button presses it; it does not turn the slide.
		await page.getByTestId("present-presenter").focus();
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("presenter")).toBeVisible();
		await expect(counter).toHaveText("1 / 3");
		// The bar stays while the keyboard is on it.
		await page.waitForTimeout(3200);
		await expect(page.getByTestId("present-presenter")).toBeVisible();
		// Space on the slide itself still goes on.
		await page.getByTestId("present").focus();
		await page.keyboard.press("Space");
		await expect(counter).toHaveText("2 / 3");
	});

	test("presenter view and the laser pointer", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pptx");
		await expect(page.getByTestId("slide-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await page.getByTestId("slides-present").click();
		const counter = page.getByTestId("present-counter");
		await expect(counter).toHaveText("1 / 3");

		await page.keyboard.press("p");
		const panel = page.getByTestId("presenter");
		await expect(panel).toContainText("Next: slide 2");
		await expect(page.getByTestId("presenter-next")).toBeVisible();
		await expect(page.getByTestId("presenter-notes")).toHaveText(
			"No notes for this slide",
		);
		await expect(page.getByTestId("presenter-watch")).toHaveText(/^0:0\d$/);
		// The slide and the panel sit side by side.
		const slide = await page.getByTestId("present-slide").boundingBox();
		const side = await panel.boundingBox();
		expect((slide?.x ?? 0) + (slide?.width ?? 0)).toBeLessThanOrEqual(
			side?.x ?? 0,
		);
		// Pausing stops the clock; reset starts it again from nothing.
		await page.getByTestId("presenter-pause").click();
		const held = await page.getByTestId("presenter-watch").textContent();
		await page.waitForTimeout(1200);
		await expect(page.getByTestId("presenter-watch")).toHaveText(held ?? "");
		await page.getByTestId("presenter-reset").click();
		await expect(page.getByTestId("presenter-watch")).toHaveText("0:00");

		// Clicking in the panel turns nothing; the keys still do.
		await panel.click();
		await expect(counter).toHaveText("1 / 3");
		await page.keyboard.press("ArrowRight");
		await expect(panel).toContainText("Next: slide 3");
		await page.keyboard.press("ArrowRight");
		await expect(panel).toContainText("End of the show");
		await expect(page.getByTestId("presenter-notes")).toHaveText(
			"Speaker note text",
		);
		await page.keyboard.press("p");
		await expect(panel).toHaveCount(0);

		// The laser: a dot where the mouse is, and a click points, not turns.
		await page.keyboard.press("l");
		await page.mouse.move(500, 300);
		const laser = page.getByTestId("present-laser");
		await expect(laser).toBeVisible();
		await page.mouse.click(520, 320);
		await expect(counter).toHaveText("3 / 3");
		await page.keyboard.press("l");
		await expect(laser).toHaveCount(0);
		await page.mouse.click(640, 300, { button: "right" });
		await expect(counter).toHaveText("2 / 3");
	});

	test("a sheet is walked by the keyboard, as in a spreadsheet program", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "viewer-regressions/styled.xlsx");
		const grid = page.getByTestId("sheet-grid");
		await expect(grid).toBeVisible({ timeout: 20_000 });
		// The zoom control is in the top bar; the sheet tabs stay below.
		const viewer = page.getByTestId("viewer");
		await expect(
			viewer.locator("header").getByTestId("sheet-zoom-in"),
		).toBeVisible();
		await expect(
			viewer.locator("footer").getByTestId("sheet-tab-0"),
		).toBeVisible();

		await grid.focus();
		const at = page.getByTestId("cell-detail");
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Control+Home");
		await expect(at).toContainText("A1");
		// A screen reader hears where the keys went: the cell and its value.
		await expect(grid).toHaveAttribute("role", "application");
		await expect(page.getByTestId("sheet-said")).toContainText("A1");
		await page.keyboard.press("Shift+ArrowRight");
		await expect(page.getByTestId("sheet-said")).toContainText("cells");
		await page.keyboard.press("ArrowLeft");
		// Ctrl+Down: the end of the run of filled cells.
		await page.keyboard.press("Control+ArrowDown");
		await expect(at).toContainText("A4");
		await page.keyboard.press("End");
		await expect(at).toContainText("E4");
		await page.keyboard.press("Home");
		await expect(at).toContainText("A4");
		await page.keyboard.press("Enter");
		await expect(at).toContainText("A5");
		await page.keyboard.press("Control+End");
		await expect(at).toContainText("E7");
		// Ctrl+Page Down: the next sheet.
		await page.keyboard.press("Control+PageDown");
		await expect(page.getByTestId("sheet-tab-1")).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await page.keyboard.press("Control+PageUp");
		await expect(page.getByTestId("sheet-tab-0")).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("a picture taken sideways can be turned", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.png");
		const size = page.getByTestId("image-size");
		await expect(size).toBeVisible({ timeout: 20_000 });
		const [w, h] = ((await size.textContent()) ?? "").split(" × ");
		await page.getByTestId("image-rotate-button").click();
		await expect(page.getByTestId("image")).toHaveAttribute("data-turn", "90");
		if (w !== h) await expect(size).toHaveText(`${h} × ${w}`);
		await page.getByTestId("file-more").click();
		await page.getByTestId("image-rotate-left").click();
		await expect(page.getByTestId("image")).toHaveAttribute("data-turn", "0");
		await expect(size).toHaveText(`${w} × ${h}`);
	});

	test("F11 gives the document the whole screen", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		const html = page.locator("html");
		const bar = page.getByTestId("viewer").locator("header");
		await page.mouse.move(640, 400);
		await page.keyboard.press("F11");
		await expect(html).toHaveAttribute("data-fullscreen", "page");
		// The bar and the window's buttons step aside...
		await expect
			.poll(async () => (await bar.boundingBox())?.y ?? 0)
			.toBeLessThan(-30);
		await expect(page.getByTestId("window-controls")).toBeHidden();
		// ...and the bar comes back while the pointer is at the top edge.
		await page.mouse.move(640, 0);
		await expect.poll(async () => (await bar.boundingBox())?.y ?? -99).toBe(0);
		await page.mouse.move(640, 400);
		await expect
			.poll(async () => (await bar.boundingBox())?.y ?? 0)
			.toBeLessThan(-30);
		await page.keyboard.press("F11");
		await expect(html).not.toHaveAttribute("data-fullscreen", "page");
		await expect.poll(async () => (await bar.boundingBox())?.y ?? -99).toBe(0);
	});

	test("a shortcut is changed in Settings, and the reader follows it", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await page.getByTestId("open-settings").click();
		await page.getByTestId("shortcuts-open").click();
		const next = page.getByTestId("shortcut-nextPage");
		await expect(next).toContainText("→");

		// Click, press the new keys: J turns the page now, the arrow no more.
		await page.getByTestId("shortcut-nextPage-change").click();
		await expect(next).toContainText("Press the new keys");
		await page.keyboard.press("j");
		await expect(next).toContainText("J");
		await expect(next).not.toContainText("→");
		await expect(page.getByTestId("shortcut-nextPage-reset")).toBeVisible();

		// Keys kept for scrolling are refused, said in a message that shows
		// over the open list (the app behind it is inert).
		await page.getByTestId("shortcut-prevPage-change").click();
		await page.keyboard.press("Space");
		const toast = page.getByTestId("toast");
		await expect(toast).toContainText("kept for scrolling");
		expect(await toast.evaluate((el) => !!el.closest("#root"))).toBe(false);
		// Esc gives up listening, and leaves the list open.
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("shortcuts")).toBeVisible();
		await expect(page.getByTestId("shortcut-prevPage")).toContainText("←");

		// Keys another shortcut had move over, with Undo.
		await page.getByTestId("shortcut-goToPage-change").click();
		await page.keyboard.press("f");
		await expect(toast).toContainText("instead of: Full screen");
		await expect(page.getByTestId("shortcut-fullscreen")).toContainText(
			"No keys",
		);
		await toast.getByRole("button", { name: "Undo" }).click();
		await expect(page.getByTestId("shortcut-fullscreen")).toContainText("F");
		await expect(page.getByTestId("shortcut-goToPage")).toContainText("G");

		// In a document, the new keys work and the old ones do not.
		await page.keyboard.press("Escape");
		await page.keyboard.press("Escape");
		await openFixture(page, "sample.pdf");
		const field = page.getByTestId("pdf-page-field");
		await expect(field).toHaveValue("1", { timeout: 20_000 });
		await page.keyboard.press("ArrowRight");
		await expect(field).toHaveValue("1");
		await page.keyboard.press("j");
		await expect(field).toHaveValue("2");
		// The list in the document shows them too.
		await page.keyboard.press("Shift+Slash");
		await expect(page.getByTestId("shortcut-nextPage")).toContainText("J");
		await page.keyboard.press("Escape");

		// Reset all: the arrow again.
		await page.keyboard.press("Control+w");
		await page.getByTestId("open-settings").click();
		await page.getByTestId("shortcuts-open").click();
		await page.getByTestId("shortcuts-reset-all").click();
		await expect(next).toContainText("→");
		await expect(page.getByTestId("shortcuts-reset-all")).toHaveCount(0);
	});

	test("two quick presses of Esc close a sheet and then leave Settings", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await page.getByTestId("open-settings").click();
		await page.getByTestId("shortcuts-open").click();
		await expect(page.getByTestId("shortcuts-sheet")).toBeVisible();
		// Both before the app draws again: the second must not be lost on
		// the sheet the first has already closed.
		await page.evaluate(() => {
			for (let i = 0; i < 2; i++)
				(document.activeElement ?? document.body).dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Escape",
						bubbles: true,
						cancelable: true,
					}),
				);
		});
		await expect(page.getByTestId("home")).toBeVisible();
		await expect(page.getByTestId("settings")).toHaveCount(0);
	});

	test("the close button of a sheet closes it (#55)", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		await page.getByTestId("open-settings").click();
		// What's new and the keyboard shortcuts open as sheets with a handle
		// to pull them down; their Close button must still be a button.
		await page.getByTestId("whats-new-open").click();
		const news = page.getByTestId("whats-new");
		await expect(news).toBeVisible();
		await news.getByRole("button", { name: "Close", exact: true }).click();
		await expect(news).toHaveCount(0);
		await page.getByTestId("shortcuts-open").click();
		const list = page.getByTestId("shortcuts-sheet");
		await list.getByRole("button", { name: "Close", exact: true }).click();
		await expect(list).toHaveCount(0);
		await expect(page.getByTestId("settings")).toBeVisible();
	});

	test("Settings lists the keyboard shortcuts, and Esc leaves it", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await page.getByTestId("open-settings").click();
		// The sections are listed beside it, and go where they say.
		await page.getByTestId("section-about").click();
		await expect(page.getByTestId("section-about")).toHaveAttribute(
			"aria-current",
			"true",
		);
		await page.getByTestId("shortcuts-open").click();
		const keys = page.getByTestId("shortcuts");
		await expect(keys).toContainText("Ctrl+O");
		await expect(keys).toContainText("F11");
		// Esc closes the list first, then Settings.
		await page.keyboard.press("Escape");
		await expect(keys).toHaveCount(0);
		await expect(page.getByTestId("settings")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("settings")).toHaveCount(0);
		await expect(page.getByTestId("home")).toBeVisible();
	});

	test("a menu taller than a short window scrolls, and fades where more of it is", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1082, height: 520 });
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		const menu = page.getByTestId("file-menu");
		const items = menu.locator(":scope > div");
		// The whole menu is inside the window, and says there is more.
		const box = await menu.boundingBox();
		expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(520);
		await expect(items).toHaveAttribute("data-more", "below");
		// At the end the last row shows whole, and the top fades instead.
		await items.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect(items).toHaveAttribute("data-more", "above");
		const last = await page.getByTestId("file-details-open").boundingBox();
		expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(
			(box?.y ?? 0) + (box?.height ?? 0),
		);
	});
});

test.describe("two documents side by side", () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test("a second opens beside the first; each half takes the keys in turn", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		// One document open: Side by side asks for the other, which opens
		// on the right and has the keyboard.
		await page.evaluate(() => {
			window.__paperwrenTestFile = new File(["Beside the PDF"], "notes.txt");
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("file-side-by-side").click();
		const left = page.getByTestId("pane-left");
		const right = page.getByTestId("pane-right");
		await expect(right).toContainText("Beside the PDF", { timeout: 20_000 });
		await expect(left.getByTestId("pdf-page-field")).toBeVisible();
		await expect(right).toHaveAttribute("data-focused", "");
		const halves = async () =>
			Promise.all(
				[left, right].map(async (pane) => (await pane.boundingBox())?.width),
			);
		expect(await halves()).toEqual([640, 640]);
		// The keys go to the half that has them, and to no other.
		await page.keyboard.press("Control+f");
		await expect(right.getByTestId("find-input")).toBeVisible();
		await expect(left.getByTestId("find-input")).toHaveCount(0);
		await page.keyboard.press("Escape");
		// A click in the other half turns to it.
		await left.locator(".pdfViewer").click({ position: { x: 200, y: 300 } });
		await expect(left).toHaveAttribute("data-focused", "");
		await expect(right).not.toHaveAttribute("data-focused", "");
		// The divider moves from the keyboard too.
		const divider = page.getByTestId("split-divider");
		await divider.focus();
		await page.keyboard.press("Shift+ArrowRight");
		await expect(divider).toHaveAttribute("aria-valuenow", "60");
		const [wide] = await halves();
		expect(wide).toBeGreaterThan(700);
		// The sides change places, and back to one at a time.
		await left.getByTestId("file-more").click();
		await page.getByTestId("file-swap-sides").click();
		await expect(right.getByTestId("pdf-page-field")).toBeVisible();
		await right.getByTestId("file-more").click();
		await page.getByTestId("file-side-by-side").click();
		await expect(page.getByTestId("pane-left")).toHaveCount(0);
		await expect(page.locator("[data-testid=viewer]:visible")).toHaveCount(1);
		// With both open, Side by side offers the other one.
		await page
			.locator("[data-testid=viewer]:visible")
			.getByTestId("file-more")
			.click();
		await page.getByTestId("file-side-by-side").click();
		await page.getByTestId("side-by-side-tab").click();
		await expect(page.getByTestId("pane-right")).toContainText(
			"Beside the PDF",
		);
	});

	test("a window too narrow for two keeps one at a time", async ({ page }) => {
		await page.setViewportSize({ width: 800, height: 700 });
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await expect(page.getByTestId("file-menu")).toBeVisible();
		await expect(page.getByTestId("file-side-by-side")).toHaveCount(0);
	});
});

/** The same layout as the Mac app has it: `&lights` for the system's
 * window buttons over the left end of the bar, and the Mac's keys. */
test.describe("the desktop layout on a Mac", () => {
	test.use({ viewport: { width: 1280, height: 800 } });
	const MAC = "?desktop&lights";
	const left = async (page: Page, selector: string) =>
		(await page.locator(selector).first().boundingBox())?.x ?? 0;

	test("the bar leaves room for the window's buttons, and draws none", async ({
		page,
	}) => {
		await boot(page, {}, MAC);
		await expect(page.getByTestId("window-controls")).toHaveCount(0);
		// Home: the mark starts clear of the three buttons.
		expect(await left(page, '[data-testid="home"] header > *')).toBeGreaterThan(
			80,
		);
		await expect(page.getByTestId("drop-tip")).toContainText("⌘O");

		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		expect(
			await left(page, '[data-testid="viewer"] header button'),
		).toBeGreaterThan(76);
		// Nothing is kept clear at the right, where Windows has its buttons.
		const more = await page.getByTestId("file-more").boundingBox();
		expect((more?.x ?? 0) + (more?.width ?? 0)).toBeGreaterThan(1260);
	});

	test("the keys are the Mac's", async ({ page }) => {
		await boot(page, {}, MAC);
		await page.getByTestId("open-settings").click();
		await page.getByTestId("shortcuts-open").click();
		const keys = page.getByTestId("shortcuts");
		await expect(keys).toContainText("⌘O");
		await expect(keys).toContainText("⌃⌘F");
		await expect(keys).toContainText("⌘↑ · ⌘↓");
		await expect(keys).not.toContainText("Ctrl");
		await expect(keys).not.toContainText("F11");
		await page.keyboard.press("Escape");
		await page.getByTestId("settings-back").click();

		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		// ⌘↓ and ⌘↑: the end and the start of the document.
		await page.keyboard.press("Meta+ArrowDown");
		await expect.poll(() => scrollTop(page, "pdf-scroll")).toBeGreaterThan(500);
		await page.keyboard.press("Meta+ArrowUp");
		await expect.poll(() => scrollTop(page, "pdf-scroll")).toBe(0);
		// ⌘] and ⌘[ turn the pages (a trackpad's swipes send them); ⌘R and
		// ⌘L rotate, as in Preview.
		const field = page.getByTestId("pdf-page-field");
		await page.keyboard.press("Meta+]");
		await expect(field).toHaveValue("2");
		await page.keyboard.press("Meta+[");
		await expect(field).toHaveValue("1");
		const rotation = () =>
			page
				.locator(".pdfViewer .textLayer")
				.first()
				.getAttribute("data-main-rotation");
		await page.keyboard.press("Meta+r");
		await expect.poll(rotation).toBe("90");
		await page.keyboard.press("Meta+l");
		await expect.poll(rotation).toBe("0");
		// ⌘F finds; ⌃⌘F is full screen and opens no search.
		await page.keyboard.press("Control+Meta+f");
		await expect(page.getByRole("search")).toHaveCount(0);
		await page.keyboard.press("Meta+f");
		await expect(page.getByRole("search")).toBeVisible();
		await page.keyboard.press("Escape");
		// ⌘W closes the document.
		await page.keyboard.press("Meta+w");
		await expect(page.getByTestId("viewer")).toHaveCount(0);
	});
});

/** The window keeps the system's own title bar there (GNOME, KDE), which
 * names the document; `&linux` asks for that look in a browser. */
test.describe("the desktop layout on Linux", () => {
	test.use({ viewport: { width: 1280, height: 800 } });
	const LINUX = "?desktop&linux";

	/** What the open document's screen shows, as a reader sees it: text that
	 * is hidden is not in it. */
	const seen = async (page: Page) =>
		(await page.getByTestId("viewer").first().innerText()).replace(/\s/g, "");
	const barText = (page: Page) =>
		page
			.locator('[data-testid="viewer"] header')
			.evaluateAll((all) => all.map((el) => (el as HTMLElement).innerText));
	const openMore = async (page: Page, fixture: string) => {
		const b64 = readFileSync(`fixtures/${fixture}`).toString("base64");
		await page.evaluate(
			({ b64, name }) => {
				const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				window.__paperwrenTestFile = new File([bytes], name);
			},
			{ b64, name: fixture },
		);
		await page.keyboard.press("Control+o");
	};

	test("one document: the name is in the window's title, not in the app's bar", async ({
		page,
	}) => {
		await boot(page, {}, LINUX);
		await expect(page.getByTestId("window-controls")).toHaveCount(0);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		// The window's title carries the name; the app's bar does not repeat it.
		await expect(page).toHaveTitle("sample.pdf - Paperwren");
		expect(await seen(page)).not.toContain("sample.pdf");
		expect((await barText(page)).join("")).not.toContain("sample");
		await expect(page.getByTestId("tab-strip")).toHaveCount(0);

		// The bar keeps its controls, the tools still at the right.
		await expect(page.getByTestId("viewer-back")).toBeVisible();
		const more = await page.getByTestId("file-more").boundingBox();
		expect((more?.x ?? 0) + (more?.width ?? 0)).toBeGreaterThan(1240);
		const zoom = await page.getByTestId("pdf-zoom-in").boundingBox();
		expect(zoom?.x ?? 0).toBeGreaterThan(600);

		// What the name was for is still there: the file menu and rename.
		await page.getByTestId("file-more").click();
		await expect(page.getByTestId("file-menu")).toBeVisible();
		await page.getByTestId("file-rename").click();
		await expect(page.getByTestId("rename-input")).toHaveValue("sample");
	});

	test("two documents show their tabs; one again hides the row", async ({
		page,
	}) => {
		await boot(page, {}, LINUX);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await openMore(page, "sample.txt");
		const tabs = page.getByTestId("tab");
		await expect(tabs).toHaveText(["sample.pdf", "sample.txt"]);
		await expect(page).toHaveTitle("sample.txt - Paperwren");
		// The tabs name the documents; the bar under them does not again.
		expect((await barText(page)).join("")).not.toContain("sample");

		await tabs.first().getByRole("tab").click();
		await expect(page).toHaveTitle("sample.pdf - Paperwren");
		await tabs.first().getByTestId("tab-close").click();
		await expect(page.getByTestId("tab-strip")).toHaveCount(0);
		await expect(page).toHaveTitle("sample.txt - Paperwren");
	});

	test("without &linux the bar names the document, as before", async ({
		page,
	}) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		expect(await seen(page)).toContain("sample.pdf");
	});
});

test.describe("a PDF on the desktop", () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test("shows two pages side by side when asked", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		const tops = () =>
			page
				.getByTestId("pdf-scroll")
				.locator(".page")
				.evaluateAll((pages) =>
					pages.map((el) => Math.round(el.getBoundingClientRect().top)),
				);
		const [first, second] = await tops();
		expect(second).toBeGreaterThan(first + 100);
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-spread").click();
		// Pages pair up as in a book: 1 beside 2, then 3.
		await expect
			.poll(async () => {
				const now = await tops();
				return now[0] === now[1] && now[2] > now[0] + 100;
			})
			.toBe(true);
		await expect(page.getByTestId("pdf-scale")).toHaveText("Fit width");
		await page.getByTestId("file-more").click();
		await expect(page.getByTestId("pdf-spread")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.getByTestId("pdf-spread").click();
		await expect
			.poll(async () => {
				const now = await tops();
				return now[1] > now[0] + 100;
			})
			.toBe(true);
	});

	test("a long one asks which pages to print before drawing any", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			window.print = () => {
				(window as unknown as { __printing: boolean }).__printing = true;
			};
		});
		await boot(page, {}, DESKTOP);
		const pdf = longPdf(12);
		await page.evaluate((text) => {
			window.__paperwrenTestFile = new File([text], "long.pdf");
		}, pdf);
		await page.getByTestId("open-file").click();
		await expect(page.getByTestId("pdf-page")).toHaveText("/ 12", {
			timeout: 20_000,
		});
		const paper = page.locator("#pw-print");
		const ask = page.getByTestId("print-range");

		// Backing out prints nothing, and says nothing went wrong.
		await page.keyboard.press("Control+p");
		await expect(ask).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(ask).toHaveCount(0);
		await expect(paper.locator("img")).toHaveCount(0);
		await expect(page.getByText("Couldn't prepare")).toHaveCount(0);

		// Pages 2 to 4: three sheets, not twelve.
		await page.keyboard.press("Control+p");
		await expect(page.getByTestId("print-all")).toHaveText("All 12 pages");
		await page.getByTestId("print-from").fill("2");
		await page.getByTestId("print-to").fill("4");
		await page.getByTestId("print-range-go").click();
		await page.waitForFunction(
			() => (window as unknown as { __printing?: boolean }).__printing,
			null,
			{ timeout: 30_000 },
		);
		await expect(paper.locator("img.pw-page")).toHaveCount(3);
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
		await expect(paper.locator("img")).toHaveCount(0);
	});
});

test.describe("on a phone", () => {
	test("none of the desktop layout is there", async ({ page }) => {
		await boot(page);
		await expect(page.getByTestId("window-controls")).toHaveCount(0);
		await expect(page.getByTestId("drop-tip")).toHaveCount(0);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		const viewer = page.getByTestId("viewer");
		// The page and zoom controls are at the foot, under the thumb.
		await expect(
			viewer.locator("footer").getByTestId("pdf-page"),
		).toBeVisible();
		await expect(page.getByTestId("pdf-page-field")).toHaveCount(0);
		await expect(page.getByTestId("side-toggle")).toHaveCount(0);
		await page.getByTestId("file-more").click();
		// A phone's own full screen, with no keys to press for it.
		await expect(page.getByTestId("file-fullscreen")).toHaveText("Full screen");
		// The menu is a sheet at the foot of the screen.
		const box = await page.getByTestId("file-menu").boundingBox();
		expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(900);
	});

	test("on Android the shell is asked for the whole screen, and told the theme", async ({
		page,
	}) => {
		// The Android webview turns down a page's own request for full
		// screen; the app asks its shell instead. Stand in for the shell.
		await page.addInitScript(() => {
			const calls: unknown[][] = [];
			(window as unknown as { __calls: unknown[][] }).__calls = calls;
			window.__paperwrenAndroidExtras = {
				immersive: (on: boolean, landscape: boolean) =>
					calls.push(["immersive", on, landscape]),
				systemBars: (dark: boolean) => calls.push(["bars", dark]),
				keepAwake: (on: boolean) => calls.push(["awake", on]),
			} as unknown as typeof window.__paperwrenAndroidExtras;
			// Nothing but the shell may be asked: a request to the page's
			// own full screen would be turned down and end the show.
			Element.prototype.requestFullscreen = () => {
				calls.push(["page-fullscreen"]);
				return Promise.reject(new Error("refused"));
			};
		});
		await boot(page, { settings_v2: { theme: "dark" } });
		const calls = () =>
			page.evaluate(
				() => (window as unknown as { __calls: unknown[][] }).__calls,
			);
		// The status-bar icons follow the app's theme, not the phone's.
		await expect
			.poll(async () => (await calls()).at(-1))
			.toEqual(["bars", true]);

		await openFixture(page, "viewer-regressions/effects.pptx");
		await expect(page.getByTestId("slide-counter")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		await page.getByTestId("slides-present").click();
		await expect(page.getByTestId("present")).toBeVisible();
		// Slides are wider than tall: the screen is turned for them.
		expect(await calls()).toContainEqual(["immersive", true, true]);
		expect(await calls()).not.toContainEqual(["page-fullscreen"]);
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("present")).toHaveCount(0);
		expect((await calls()).filter((c) => c[0] === "immersive").at(-1)).toEqual([
			"immersive",
			false,
			false,
		]);
	});

	test("a Word document can be read as flowing text", async ({ page }) => {
		await boot(page);
		await openFixture(page, "viewer-regressions/multipage.docx");
		const pill = page.getByTestId("doc-page");
		await expect(pill).toHaveText("1 / 3", { timeout: 20_000 });
		const paper = page
			.getByTestId("doc-scroll")
			.locator("section.docx")
			.first();
		const before = (await paper.boundingBox())?.width ?? 0;

		await page.getByTestId("file-more").click();
		await page.getByTestId("doc-reading").click();
		// One column of text at the width of the screen: no pages to count.
		await expect(pill).toHaveCount(0);
		await expect(page.getByTestId("viewer").locator("footer")).toContainText(
			"Reading view",
		);
		await expect(page.getByTestId("doc-scroll")).toContainText("the last page");
		await expect(
			page.getByTestId("doc-scroll").locator("section.docx"),
		).toHaveCount(1);
		const sideways = await page
			.getByTestId("doc-scroll")
			.evaluate((el) => el.scrollWidth - el.clientWidth);
		expect(sideways).toBeLessThanOrEqual(1);

		// And back to its pages.
		await page.getByTestId("file-more").click();
		await page.getByTestId("doc-reading").click();
		await expect(page.getByTestId("doc-page")).toHaveText("1 / 3");
		expect(
			(
				await page
					.getByTestId("doc-scroll")
					.locator("section.docx")
					.first()
					.boundingBox()
			)?.width,
		).toBeCloseTo(before, 0);
	});

	test("text can keep its long lines, and number them", async ({ page }) => {
		await boot(page);
		await openFixture(page, "sample.txt");
		const text = page.getByTestId("text-scroll");
		await expect(text).toContainText("quick brown fox", { timeout: 20_000 });
		const space = () =>
			text.locator("pre").evaluate((el) => getComputedStyle(el).whiteSpace);
		expect(await space()).toBe("pre-wrap");
		await page.getByTestId("file-more").click();
		await page.getByTestId("text-wrap").click();
		expect(await space()).toBe("pre");
		await page.getByTestId("file-more").click();
		await page.getByTestId("text-lines").click();
		await expect(page.getByTestId("text-numbered")).toContainText(
			"quick brown fox",
		);
	});

	test("every slide can be picked from a grid, or by its number", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "viewer-regressions/effects.pptx");
		const counter = page.getByTestId("slide-counter");
		await expect(counter).toHaveText("1 / 3", { timeout: 20_000 });
		await page.getByTestId("file-more").click();
		await page.getByTestId("slides-grid").click();
		await page.getByTestId("slide-thumb").nth(2).click();
		await expect(counter).toHaveText("3 / 3");
		await counter.click();
		await page.getByTestId("slide-jump-input").fill("1");
		await page.getByTestId("slide-jump-go").click();
		await expect(counter).toHaveText("1 / 3");
	});
});

test.describe("a file changed by another app", () => {
	test("says so, and reads it again where the reader was", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		await page.evaluate(() => {
			window.__paperwrenTestStamp = 1;
		});
		await openFixture(page, "sample.txt");
		await expect(page.getByTestId("text-scroll")).toBeVisible();
		const bar = page.getByTestId("file-changed");
		await page.waitForTimeout(2500);
		await expect(bar).toHaveCount(0);

		await page.evaluate(() => {
			window.__paperwrenTestStamp = 2;
		});
		await expect(bar).toBeVisible({ timeout: 5000 });
		await expect(bar).toContainText("This file was changed by another app");
		// Kept as it is: not asked again until it changes once more.
		await page.getByTestId("file-changed-dismiss").click();
		await expect(bar).toHaveCount(0);
		await page.waitForTimeout(2500);
		await expect(bar).toHaveCount(0);

		await page.evaluate(() => {
			window.__paperwrenTestStamp = 3;
		});
		await expect(bar).toBeVisible({ timeout: 5000 });
		await page.getByTestId("file-changed-reload").click();
		await expect(bar).toHaveCount(0);
		await expect(page.getByTestId("text-scroll")).toBeVisible();
		await page.waitForTimeout(2500);
		await expect(bar).toHaveCount(0);
	});
});

/** The desktop app's window, stood in for (lib/fullscreen.ts): maximised
 * on a screen of 1280 × 800 whose taskbar takes the foot, and smaller when
 * restored. A frameless window on Windows is restored before it goes full
 * screen (#58), so the page sees every size on the way, as it would. */
test.describe("full screen from a maximised window (#86)", () => {
	test.use({ viewport: { width: 1280, height: 752 } });

	async function standIn(page: Page, refuse = false) {
		await page.exposeFunction("__resizeTo", (width: number, height: number) =>
			page.setViewportSize({ width, height }),
		);
		await page.addInitScript((refuse) => {
			const resize = (
				window as unknown as {
					__resizeTo(width: number, height: number): Promise<void>;
				}
			).__resizeTo;
			const state = { full: false, max: true };
			const apply = () =>
				state.full
					? resize(1280, 800)
					: state.max
						? resize(1280, 752)
						: resize(860, 600);
			window.__paperwrenWindow = {
				isFullscreen: async () => state.full,
				isMaximized: async () => state.max,
				setFullscreen: async (on) => {
					if (refuse) throw new Error("refused");
					state.full = on;
					await apply();
				},
				maximize: async () => {
					if (refuse) throw new Error("refused");
					state.max = true;
					await apply();
				},
				unmaximize: async () => {
					state.max = false;
					await apply();
				},
				onResized: async (then) => {
					window.addEventListener("resize", then);
					return () => window.removeEventListener("resize", then);
				},
			};
		}, refuse);
	}

	interface Frame {
		top: number;
		width: number;
		veil: number;
	}
	interface Taken {
		drawn: { [page: string]: number };
		frames: Frame[];
	}

	/** From now on, every page drawn and, frame by frame, where the third
	 * page is, how wide, and how thick the veil over the document is. */
	const record = (page: Page) =>
		page.evaluate(() => {
			const w = window as unknown as { rec: Taken };
			const rec: Taken = { drawn: {}, frames: [] };
			w.rec = rec;
			new MutationObserver((list) => {
				for (const m of list)
					for (const n of m.addedNodes) {
						if (!(n instanceof Element)) continue;
						if (n.nodeName !== "CANVAS" && !n.querySelector("canvas")) continue;
						const at =
							n.closest(".page")?.getAttribute("data-page-number") ?? "?";
						rec.drawn[at] = (rec.drawn[at] ?? 0) + 1;
					}
			}).observe(document.body, { childList: true, subtree: true });
			const frame = () => {
				if (w.rec !== rec) return;
				const third = document.querySelector(
					'[data-testid="pdf-scroll"] .page[data-page-number="3"]',
				);
				const body = document.querySelector('[data-testid="viewer-body"]');
				const veil = body ? getComputedStyle(body, "::after") : null;
				const box = third?.getBoundingClientRect();
				rec.frames.push({
					top: Math.round((box?.top ?? 0) * 10) / 10,
					width: Math.round(box?.width ?? 0),
					veil: !veil || veil.content === "none" ? 0 : Number(veil.opacity),
				});
				requestAnimationFrame(frame);
			};
			requestAnimationFrame(frame);
		});
	const taken = (page: Page) =>
		page.evaluate(() => (window as unknown as { rec: Taken }).rec);

	/** The largest step the page takes between two frames that show it. */
	const jump = (frames: Frame[]) => {
		let most = 0;
		for (let i = 1; i < frames.length; i++) {
			const [a, b] = [frames[i - 1], frames[i]];
			if (a.veil > 0.95 || b.veil > 0.95) continue;
			most = Math.max(most, Math.abs(b.top - a.top));
		}
		return most;
	};

	/** At rest: the window settled, the veil gone. */
	const settled = async (page: Page) => {
		await expect(page.locator("html")).not.toHaveAttribute("data-fs-veil");
		await page.waitForTimeout(500);
		expect(
			await page.getByTestId("viewer-body").evaluate((el) => {
				const veil = getComputedStyle(el, "::after");
				return veil.content === "none" ? 0 : Number(veil.opacity);
			}),
		).toBe(0);
	};

	const openLong = async (page: Page) => {
		await page.evaluate((text) => {
			window.__paperwrenTestFile = new File([text], "long.pdf");
		}, longPdf(12));
		await page.getByTestId("open-file").click();
		const field = page.getByTestId("pdf-page-field");
		await expect(field).toHaveValue("1", { timeout: 20_000 });
		await field.fill("3");
		await field.press("Enter");
		await expect(field).toHaveValue("3");
		await page.waitForTimeout(800);
	};

	test("going in and out is one calm change: drawn once, no jump, the place kept", async ({
		page,
	}) => {
		await standIn(page);
		await boot(page, {}, DESKTOP);
		await openLong(page);
		const html = page.locator("html");
		const field = page.getByTestId("pdf-page-field");
		await page.mouse.move(640, 400);

		for (const way of ["in", "out"]) {
			await record(page);
			await page.keyboard.press("F11");
			if (way === "in")
				await expect(html).toHaveAttribute("data-fullscreen", "page");
			else await expect(html).not.toHaveAttribute("data-fullscreen", /./);
			await settled(page);
			const rec = await taken(page);
			// Never fitted to the restored window on the way: the window
			// ends as wide as it began, so the pages keep their one size...
			expect([...new Set(rec.frames.map((f) => f.width))]).toHaveLength(1);
			// ...and each page on show is drawn once at most.
			for (const times of Object.values(rec.drawn))
				expect(times).toBeLessThanOrEqual(1);
			// The page never jumps where it can be seen...
			expect(jump(rec.frames)).toBeLessThanOrEqual(1);
			// ...because what moves, moves under the veil.
			expect(rec.frames.some((f) => f.veil > 0.95)).toBe(true);
			// The same page is being read.
			await expect(field).toHaveValue("3");
		}
		expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([
			1280, 752,
		]);
	});

	test("with reduced motion the veil comes and goes without a fade", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await standIn(page);
		await boot(page, {}, DESKTOP);
		await openLong(page);
		await record(page);
		await page.keyboard.press("F11");
		await expect(page.locator("html")).toHaveAttribute(
			"data-fullscreen",
			"page",
		);
		await settled(page);
		const { frames } = await taken(page);
		expect(frames.some((f) => f.veil > 0.95)).toBe(true);
		expect(frames.filter((f) => f.veil > 0.05 && f.veil < 0.95)).toEqual([]);
	});

	test("a window that turns full screen down: the veil goes and the page fits the window", async ({
		page,
	}) => {
		await standIn(page, true);
		await boot(page, {}, DESKTOP);
		await openLong(page);
		const third = page.locator(
			'[data-testid="pdf-scroll"] .page[data-page-number="3"]',
		);
		const wide = async () => (await third.boundingBox())?.width ?? 0;
		const before = await wide();
		await page.keyboard.press("F11");
		// Restored, and refused both full screen and maximised again: the
		// window is left smaller, and the page fits it.
		await expect.poll(() => page.evaluate(() => innerWidth)).toBe(860);
		await settled(page);
		await expect(page.locator("html")).not.toHaveAttribute(
			"data-fullscreen",
			/./,
		);
		await expect.poll(wide).toBeLessThan(before);
		// And it goes on following the window.
		await page.setViewportSize({ width: 1280, height: 752 });
		await expect.poll(wide).toBeGreaterThan(before - 2);
	});
});
