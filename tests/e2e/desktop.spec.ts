import { type Page, expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

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
		await expect(page.getByTestId("file-fullscreen")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(menu).toHaveCount(0);
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

	test("Settings lists the keyboard shortcuts", async ({ page }) => {
		await boot(page, {}, DESKTOP);
		await page.getByTestId("open-settings").click();
		const keys = page.getByTestId("shortcuts");
		await expect(keys).toContainText("Ctrl+O");
		await expect(keys).toContainText("F11");
	});
});

/** A plain PDF of `count` pages, each saying which it is: no fixture
 * is long enough to be asked "which pages?" before printing. */
function longPdf(count: number): string {
	const objects: string[] = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Count ${count} /Kids [${Array.from(
			{ length: count },
			(_, i) => `${4 + i * 2} 0 R`,
		).join(" ")}] >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	for (let i = 0; i < count; i++) {
		const text = `BT /F1 28 Tf 72 700 Td (Long page ${i + 1}) Tj ET`;
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
			`<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
		);
	}
	let out = "%PDF-1.4\n";
	const offsets = objects.map((body, i) => {
		const at = out.length;
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
		return at;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return out;
}

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
		await expect(page.getByTestId("file-fullscreen")).toHaveCount(0);
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
