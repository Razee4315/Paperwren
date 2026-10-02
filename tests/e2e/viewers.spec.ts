import { expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

test("Word shows the page being read and jumps to a page", async ({ page }) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/multipage.docx");
	const pill = page.getByTestId("doc-page");
	await expect(pill).toHaveText("1 / 3", { timeout: 20_000 });
	await pill.click();
	await page.getByTestId("doc-jump-input").fill("3");
	await page.getByTestId("doc-jump-go").click();
	await expect(pill).toHaveText("3 / 3");
	await expect(page.getByText("page three, the last page")).toBeInViewport();
	// Scrolling by hand moves the counter too.
	const scroller = page.getByTestId("doc-scroll");
	await scroller.evaluate((el) => {
		el.scrollTop = 0;
	});
	await expect(pill).toHaveText("1 / 3");
	await pill.click();
	await page.getByTestId("doc-jump-input").fill("2");
	await page.getByTestId("doc-jump-input").press("Enter");
	await expect(pill).toHaveText("2 / 3");
	// A number outside the document is ignored.
	await pill.click();
	await page.getByTestId("doc-jump-input").fill("9");
	await page.getByTestId("doc-jump-go").click();
	await expect(pill).toHaveText("2 / 3");
});

test("Word finds text on a page that is not on screen", async ({ page }) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/multipage.docx");
	await expect(page.getByTestId("doc-page")).toHaveText("1 / 3", {
		timeout: 20_000,
	});
	await page.getByTestId("doc-find").click();
	await page.getByTestId("find-input").fill("the last page");
	await expect(page.getByTestId("find-count")).toHaveText("1 of 1");
	await expect(page.getByText("page three, the last page")).toBeInViewport();
	await expect(page.getByTestId("doc-page")).toHaveText("3 / 3");
});

test("PDF pages sheet shows every page and goes to the one picked", async ({
	page,
}) => {
	await boot(page);
	await openFixture(page, "sample.pdf");
	const pill = page.getByTestId("pdf-page");
	await expect(pill).toHaveText("1 / 3", { timeout: 20_000 });
	await page.getByTestId("file-more").click();
	await page.getByTestId("pdf-pages").click();
	const thumbs = page.getByTestId("pdf-thumbs").getByRole("button");
	await expect(thumbs).toHaveCount(3);
	await expect(thumbs.first()).toHaveAttribute("aria-current", "page");
	// Each page is really drawn, not left as a blank card.
	for (const n of [0, 1, 2])
		await expect(thumbs.nth(n).locator("canvas")).toHaveAttribute(
			"data-drawn",
			"1",
		);
	const inked = await thumbs
		.first()
		.locator("canvas")
		.evaluate((canvas: HTMLCanvasElement) => {
			const pixels =
				canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height)
					.data ?? [];
			let dark = 0;
			for (let i = 0; i < pixels.length; i += 4)
				if (pixels[i] < 128 && pixels[i + 3] > 0) dark++;
			return dark;
		});
	expect(inked).toBeGreaterThan(5);
	await thumbs.nth(2).click();
	await expect(page.getByTestId("pdf-thumbs")).toHaveCount(0);
	await expect(pill).toHaveText("3 / 3");
});

test.describe("on a touch screen", () => {
	test.use({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 412, height: 420 },
	});

	test("the scrubber appears while scrolling and drags through the pages", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "sample.pdf");
		const pill = page.getByTestId("pdf-page");
		await expect(pill).toHaveText("1 / 3", { timeout: 20_000 });
		const knob = page.getByTestId("scrubber");
		await expect(knob).not.toBeVisible();
		const scroller = page.getByTestId("pdf-scroll");
		await scroller.evaluate((el) => {
			el.scrollTop = 40;
		});
		await expect(knob).toBeVisible();
		const box = await knob.boundingBox();
		const view = await scroller.boundingBox();
		if (!box || !view) throw new Error("no scrubber");
		const cdp = await page.context().newCDPSession(page);
		const touch = (type: string, y?: number) =>
			cdp.send("Input.dispatchTouchEvent", {
				type: type as "touchStart",
				touchPoints: y === undefined ? [] : [{ x: box.x + box.width / 2, y }],
			});
		const from = box.y + box.height / 2;
		const to = view.y + view.height;
		await touch("touchStart", from);
		for (let i = 1; i <= 8; i++)
			await touch("touchMove", from + ((to - from) * i) / 8);
		// While held, the page number rides beside the handle.
		await expect(knob).toContainText("3 / 3");
		await touch("touchEnd");
		await expect(pill).toHaveText("3 / 3");
		expect(
			await scroller.evaluate(
				(el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
			),
		).toBe(true);
		// Left alone, it fades away again.
		await expect(knob).not.toBeVisible({ timeout: 5000 });
	});
});

test("slides draw shadows, gradients on any outline, and SmartArt", async ({
	page,
}) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/effects.pptx");
	const slides = page.getByTestId("slide");
	await expect(slides).toHaveCount(3, { timeout: 20_000 });
	const first = slides.first();
	// The card's shadow is a filter on the shape, so it follows its outline.
	const card = first
		.getByText("Shadowed card")
		.locator("xpath=ancestor::div[3]");
	await expect(card).toHaveCSS(
		"filter",
		"drop-shadow(rgba(0, 0, 0, 0.45) 4.24px 4.24px 8px)",
	);
	// The triangle is filled by an SVG gradient, not a rectangular one.
	const triangle = first.locator("polygon").first();
	const fill = await triangle.getAttribute("fill");
	expect(fill).toMatch(/^url\(#pw/);
	const id = fill?.slice(5, -1) ?? "";
	await expect(first.locator(`linearGradient[id="${id}"] stop`)).toHaveCount(2);
	await expect(first.locator("radialGradient")).toHaveCount(1);
	// SmartArt: its three boxes, with their text, and no "Diagram" box.
	const second = slides.nth(1);
	await second.scrollIntoViewIfNeeded();
	for (const label of ["Plan", "Build", "Ship"])
		await expect(second.getByText(label, { exact: true })).toBeVisible();
	await expect(second.getByText("Diagram", { exact: true })).toHaveCount(0);
	await expect(second.locator("rect")).toHaveCount(3);
});

test.describe("slides full screen", () => {
	test.use({ hasTouch: true });

	test("shows one slide at a time and moves by swipe, tap and key", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "viewer-regressions/effects.pptx");
		await expect(page.getByTestId("slide")).toHaveCount(3, {
			timeout: 20_000,
		});
		await page.getByTestId("slides-present").click();
		const stage = page.getByTestId("present");
		const counter = page.getByTestId("present-counter");
		await expect(stage).toBeVisible();
		await expect(counter).toHaveText("1 / 3");
		await expect(stage.getByText("Shadowed card")).toBeVisible();
		// The slide fills the screen's width (the deck is 4:3, the phone tall).
		const view = page.viewportSize();
		const box = await page.getByTestId("present-slide").boundingBox();
		expect(box?.width).toBeCloseTo(view?.width ?? 0, 0);
		// Swipe left: the next slide.
		const cdp = await page.context().newCDPSession(page);
		const touch = (type: string, x?: number) =>
			cdp.send("Input.dispatchTouchEvent", {
				type: type as "touchStart",
				touchPoints: x === undefined ? [] : [{ x, y: 450 }],
			});
		const swipe = async (from: number, to: number) => {
			await touch("touchStart", from);
			for (let i = 1; i <= 6; i++)
				await touch("touchMove", from + ((to - from) * i) / 6);
			await touch("touchEnd");
		};
		await swipe(320, 60);
		await expect(counter).toHaveText("2 / 3");
		await expect(stage.getByText("Build", { exact: true })).toBeVisible();
		// A short drag is not a swipe.
		await swipe(220, 190);
		await expect(counter).toHaveText("2 / 3");
		await swipe(60, 320);
		await expect(counter).toHaveText("1 / 3");
		// Nothing before the first slide.
		await swipe(60, 320);
		await expect(counter).toHaveText("1 / 3");
		// Keys, and a tap on the right edge.
		await page.keyboard.press("ArrowRight");
		await expect(counter).toHaveText("2 / 3");
		await page.touchscreen.tap((view?.width ?? 400) - 20, 450);
		await expect(counter).toHaveText("3 / 3");
		// Leaving returns to the list at the slide that was showing.
		await page.keyboard.press("Escape");
		await expect(stage).toHaveCount(0);
		await expect(page.getByTestId("slide-counter")).toHaveText("3 / 3");
	});
});

test("a locked PDF asks for its password until it is right", async ({
	page,
}) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/locked.pdf");
	const field = page.getByTestId("pdf-password");
	await expect(field).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText("Enter the password for")).toBeVisible();
	// The field has the keyboard, and what is typed can be shown.
	await expect(field).toBeFocused();
	await expect(field).toHaveAttribute("type", "password");
	await page.getByTestId("pdf-password-show").click();
	await expect(field).toHaveAttribute("type", "text");
	await field.fill("sparrow");
	await page.getByTestId("pdf-unlock").click();
	await expect(page.getByText("That password didn't work")).toBeVisible();
	await field.fill("wren");
	await field.press("Enter");
	await expect(page.getByTestId("pdf-page")).toHaveText("1 / 2", {
		timeout: 20_000,
	});
	await expect(page.getByTestId("viewer")).toContainText(
		"Locked fixture, page 1",
	);
});

test("a PDF keeps its details and reopens after its bytes moved to the engine", async ({
	page,
}) => {
	await boot(page);
	await openFixture(page, "sample.pdf");
	await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
		timeout: 20_000,
	});
	await page.getByTestId("file-more").click();
	await page.getByTestId("file-details-open").click();
	const details = page.getByTestId("file-details");
	await expect(details).toContainText("KB");
	await expect(details).not.toContainText("0 B");
	await page.keyboard.press("Escape");
	await page.getByTestId("viewer-back").click();
	await page.getByTestId("recent").first().getByRole("button").first().click();
	await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
		timeout: 20_000,
	});
});

test("a very large file is only read after the reader agrees", async ({
	page,
}) => {
	await boot(page);
	const inject = () =>
		page.evaluate(() => {
			window.__paperwrenTestFile = new File(
				[new Uint8Array(41 * 1024 * 1024)],
				"huge.xlsx",
			);
		});
	await inject();
	await page.getByTestId("open-file").click();
	const warning = page.getByTestId("large-file");
	await expect(warning).toContainText("huge.xlsx");
	await expect(warning).toContainText("41.0 MB");
	// Cancel: nothing was read, nothing was remembered.
	await warning.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByTestId("home")).toBeVisible();
	await expect(page.getByTestId("recent")).toHaveCount(0);
	// Open anyway: the file is read (and, being blank, turned away).
	await inject();
	await page.getByTestId("open-file").click();
	await page.getByTestId("large-open").click();
	await expect(page.getByTestId("open-error")).toBeVisible({ timeout: 30_000 });
	// A file under the limit opens with no question asked.
	await page.getByTestId("error-ok").click();
	await openFixture(page, "sample.xlsx");
	await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 20_000 });
	await expect(warning).toHaveCount(0);
});

test("a protected workbook opens with its password", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await boot(page);
	await openFixture(page, "viewer-regressions/locked-agile.xlsx");
	const field = page.getByTestId("office-password");
	await expect(field).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText("Enter the password for")).toBeVisible();
	await field.fill("sparrow");
	await page.getByTestId("office-unlock").click();
	await expect(page.getByText("That password didn't work")).toBeVisible({
		timeout: 30_000,
	});
	await field.fill("wren");
	await field.press("Enter");
	await expect(page.getByTestId("sheet-grid")).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByTestId("viewer").locator("header")).toContainText(
		"locked-agile",
	);
	// It is remembered as a spreadsheet, and asks again when reopened.
	await page.getByTestId("viewer-back").click();
	const recent = page.getByTestId("recent").first();
	await expect(recent).toContainText("locked-agile.xlsx");
	await recent.getByRole("button").first().click();
	await expect(field).toBeVisible({ timeout: 20_000 });
	// Cancel: back to Home, nothing shown.
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByTestId("home")).toBeVisible();
	await expect(page.getByTestId("viewer")).toHaveCount(0);
	expect(errors).toEqual([]);
});

test("a document protected the Office 2007 way opens too", async ({ page }) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/locked-standard.docx");
	const field = page.getByTestId("office-password");
	await expect(field).toBeVisible({ timeout: 20_000 });
	await field.fill("wren");
	await page.getByTestId("office-unlock").click();
	await expect(page.getByTestId("doc-page")).toHaveText("1 / 1", {
		timeout: 30_000,
	});
	await expect(page.getByTestId("viewer")).toContainText(
		"If you can read this, the DOCX reader works.",
	);
});

test("the screen is kept on only while a document is open, and only if asked", async ({
	page,
}) => {
	// Stand in for the system: count the wake locks held.
	await page.addInitScript(() => {
		const state = { held: 0, asked: 0 };
		Object.assign(window, { __wake: state });
		Object.defineProperty(navigator, "wakeLock", {
			configurable: true,
			value: {
				request: async () => {
					state.asked++;
					state.held++;
					return {
						release: async () => {
							state.held--;
						},
					};
				},
			},
		});
	});
	const wake = () =>
		page.evaluate(
			() =>
				(window as unknown as { __wake: { held: number; asked: number } })
					.__wake,
		);
	await boot(page);
	// Off by default: opening a file asks for nothing.
	await openFixture(page, "sample.txt");
	await expect(page.getByTestId("viewer")).toContainText("quick brown fox");
	expect(await wake()).toEqual({ held: 0, asked: 0 });
	await page.getByTestId("viewer-back").click();
	// Turn it on in Settings.
	await page.getByTestId("open-settings").click();
	await page.getByTestId("keep-awake").click();
	expect((await wake()).asked).toBe(0);
	await page.getByTestId("settings-back").click();
	await page.getByTestId("recent").first().getByRole("button").first().click();
	await expect(page.getByTestId("viewer")).toContainText("quick brown fox");
	await expect.poll(async () => (await wake()).held).toBe(1);
	// Leaving the document lets the screen sleep again.
	await page.getByTestId("viewer-back").click();
	await expect.poll(async () => (await wake()).held).toBe(0);
	// The choice survives a restart.
	await page.reload();
	await page.getByTestId("open-settings").click();
	await expect(page.getByTestId("keep-awake")).toHaveAttribute(
		"aria-checked",
		"true",
	);
});

test("a link in a document is never followed; its address can be copied", async ({
	page,
}) => {
	await boot(page);
	await page.evaluate(() => {
		window.__paperwrenTestFile = new File(
			[
				"# Notes\n\nSee [the site](https://example.com/page) and [a file](other.md).",
			],
			"notes.md",
		);
	});
	await page.getByTestId("open-file").click();
	const viewer = page.getByTestId("viewer");
	await expect(viewer).toContainText("See the site");

	// A relative link leads nowhere, and goes nowhere.
	await viewer.getByRole("link", { name: "a file" }).click();
	await expect(page.getByTestId("link-guard")).toHaveCount(0);

	await viewer.getByRole("link", { name: "the site" }).click();
	await expect(page.getByTestId("link-address")).toHaveText(
		"https://example.com/page",
	);
	expect(new URL(page.url()).pathname).toBe("/");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("link-guard")).toHaveCount(0);
	await expect(viewer).toBeVisible();
});

test("a Chinese PDF that names its font instead of carrying it is readable", async ({
	page,
}) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/cjk.pdf");
	// The text is only there to select and find if the reader can map
	// the file's character codes, which takes pdf.js's own tables.
	await expect(page.locator(".textLayer").first()).toContainText("季度报告", {
		timeout: 20_000,
	});
});

test("the keyboard reads a document without a click into it first", async ({
	page,
}) => {
	await boot(page);
	await openFixture(page, "viewer-regressions/multipage.docx");
	const pill = page.getByTestId("doc-page");
	await expect(pill).toHaveText("1 / 3", { timeout: 20_000 });
	// The window is named after the document.
	await expect(page).toHaveTitle("multipage.docx - Paperwren");
	await page.keyboard.press("End");
	await expect(pill).toHaveText("3 / 3");
	await page.keyboard.press("Home");
	await expect(pill).toHaveText("1 / 3");
	await page.keyboard.press("Space");
	await expect
		.poll(() => page.getByTestId("doc-scroll").evaluate((el) => el.scrollTop))
		.toBeGreaterThan(100);
	// Ctrl+W closes the document, as in a desktop reader.
	await page.keyboard.press("Control+w");
	await expect(page.getByTestId("viewer")).toBeHidden();
	await expect(page).toHaveTitle("Paperwren");
	// On Home, Ctrl+F goes to the search box.
	await page.keyboard.press("Control+f");
	await expect(page.getByTestId("search-input")).toBeFocused();
});
