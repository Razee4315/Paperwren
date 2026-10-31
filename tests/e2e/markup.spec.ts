import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { type Page, expect, test } from "@playwright/test";
import { boot, openFixture } from "./helpers";

async function openMarkUp(page: Page) {
	await boot(page);
	await openFixture(page, "sample.pdf");
	await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
		timeout: 20_000,
	});
	await page.getByTestId("file-more").click();
	await page.getByTestId("pdf-mark-up").click();
	await expect(page.locator('[data-page="0"] canvas[data-drawn]')).toHaveCount(
		1,
		{ timeout: 20_000 },
	);
	return page.locator('[data-page="0"]');
}

const strokes = (page: Page) => page.locator('[data-testid="mark-layer"] path');

/** The kinds of annotation on the first page of a saved PDF. */
async function savedKinds(path: string) {
	const doc = await PDFDocument.load(readFileSync(path));
	const list = doc.getPage(0).node.Annots();
	return Array.from({ length: list?.size() ?? 0 }, (_, i) =>
		doc.context
			.lookup(list?.get(i), PDFDict)
			.get(PDFName.of("Subtype"))
			?.toString(),
	);
}

test.describe("mark up", () => {
	test("pen, highlight and a note end up in the saved copy", async ({
		page,
	}) => {
		const sheet = await openMarkUp(page);
		const box = await sheet.boundingBox();
		if (!box) throw new Error("no page");
		const at = (u: number, v: number) =>
			[box.x + u * box.width, box.y + v * box.height] as const;

		await page.mouse.move(...at(0.2, 0.6));
		await page.mouse.down();
		await page.mouse.move(...at(0.5, 0.7), { steps: 5 });
		await page.mouse.up();
		await expect(strokes(page)).toHaveCount(1);

		await page.getByTestId("mark-undo").click();
		await expect(strokes(page)).toHaveCount(0);
		await page.getByTestId("mark-redo").click();
		await expect(strokes(page)).toHaveCount(1);

		// The line under the heading of the fixture.
		await page.getByTestId("mark-tool-highlight").click();
		await page.mouse.move(...at(0.13, 0.135));
		await page.mouse.down();
		await page.mouse.move(...at(0.4, 0.135), { steps: 5 });
		await page.mouse.up();

		await page.getByTestId("mark-tool-note").click();
		await page.mouse.click(...at(0.8, 0.5));
		await page.getByTestId("mark-note-text").fill("Check this");
		await page.getByTestId("mark-note-keep").click();
		await expect(page.getByTestId("mark-note-pin")).toHaveCount(1);

		await page.getByTestId("mark-save").click();
		const download = page.waitForEvent("download");
		await page.getByTestId("mark-save-go").click();
		const saved = await download;
		expect(saved.suggestedFilename()).toBe("sample (marked up).pdf");
		expect(await savedKinds(await saved.path())).toEqual([
			"/Ink",
			"/Highlight",
			"/Text",
		]);
	});

	test("the eraser takes a stroke away", async ({ page }) => {
		const sheet = await openMarkUp(page);
		const box = await sheet.boundingBox();
		if (!box) throw new Error("no page");
		await page.mouse.move(box.x + 100, box.y + 200);
		await page.mouse.down();
		await page.mouse.move(box.x + 250, box.y + 200, { steps: 4 });
		await page.mouse.up();
		await expect(strokes(page)).toHaveCount(1);
		await page.getByTestId("mark-tool-erase").click();
		await page.mouse.click(box.x + 170, box.y + 200);
		await expect(strokes(page)).toHaveCount(0);
	});

	test("leaving asks nothing: the marks are kept", async ({ page }) => {
		const sheet = await openMarkUp(page);
		const box = await sheet.boundingBox();
		if (!box) throw new Error("no page");
		await page.mouse.move(box.x + 100, box.y + 200);
		await page.mouse.down();
		await page.mouse.move(box.x + 250, box.y + 200, { steps: 4 });
		await page.mouse.up();
		await page.getByTestId("mark-done").click();
		await expect(page.getByTestId("mark-up")).toHaveCount(0);
		await expect(page.locator(".pw-marks-over path")).toHaveCount(1);
	});

	test("a text box and a measurement end up in the saved copy", async ({
		page,
	}) => {
		const sheet = await openMarkUp(page);
		const box = await sheet.boundingBox();
		if (!box) throw new Error("no page");
		await page.getByTestId("mark-tool-text").click();
		await page.mouse.click(box.x + 100, box.y + 300);
		await page.getByTestId("mark-note-text").fill("In any language: اردو");
		await page.getByTestId("mark-note-keep").click();
		await expect(page.getByTestId("mark-text")).toHaveCount(1);

		await page.getByTestId("mark-tool-measure").click();
		await page.mouse.move(box.x + 100, box.y + 400);
		await page.mouse.down();
		await page.mouse.move(box.x + 300, box.y + 400, { steps: 4 });
		await page.mouse.up();
		await expect(page.getByTestId("measure-label")).toHaveCount(1);

		await page.getByTestId("mark-save").click();
		const download = page.waitForEvent("download");
		await page.getByTestId("mark-save-go").click();
		const saved = await download;
		expect(await savedKinds(await saved.path())).toEqual([
			"/FreeText",
			"/Line",
		]);
	});

	test.describe("on a touch screen", () => {
		test.use({ hasTouch: true });

		test("one finger writes, two fingers move the page", async ({ page }) => {
			const sheet = await openMarkUp(page);
			const box = await sheet.boundingBox();
			if (!box) throw new Error("no page");
			const cdp = await page.context().newCDPSession(page);
			const touch = (
				type: string,
				points: Array<{ x: number; y: number; id: number }>,
			) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
			const x = box.x + 80;
			const y = box.y + 120;

			await touch("touchStart", [{ x, y, id: 1 }]);
			await touch("touchMove", [{ x: x + 60, y: y + 30, id: 1 }]);
			await touch("touchMove", [{ x: x + 120, y: y + 10, id: 1 }]);
			await touch("touchEnd", []);
			await expect(strokes(page)).toHaveCount(1);

			const pages = page.getByTestId("mark-pages");
			const before = await pages.evaluate((el) => el.scrollTop);
			await touch("touchStart", [{ x, y: y + 200, id: 1 }]);
			await touch("touchStart", [
				{ x, y: y + 200, id: 1 },
				{ x: x + 80, y: y + 200, id: 2 },
			]);
			for (const step of [40, 80, 120, 160])
				await touch("touchMove", [
					{ x, y: y + 200 - step, id: 1 },
					{ x: x + 80, y: y + 200 - step, id: 2 },
				]);
			await touch("touchEnd", []);
			await expect
				.poll(() => pages.evaluate((el) => el.scrollTop))
				.toBeGreaterThan(before);
			await expect(strokes(page)).toHaveCount(1);
		});
	});
});

test.describe("notes", () => {
	test("a note keeps itself, and is found again", async ({ page }) => {
		await boot(page);
		await page.getByTestId("home-notes").click();
		await expect(page.getByTestId("notes-empty")).toBeVisible();

		await page.getByTestId("note-new").click();
		await page.getByTestId("note-title").fill("Lecture 4");
		await page.getByTestId("note-text").first().fill("Mitochondria");
		await page.getByTestId("note-add-drawing").click();
		const sheet = await page.getByTestId("note-sketch").boundingBox();
		if (!sheet) throw new Error("no sheet");
		await page.mouse.move(sheet.x + 40, sheet.y + 40);
		await page.mouse.down();
		await page.mouse.move(sheet.x + 120, sheet.y + 90, { steps: 4 });
		await page.mouse.up();
		await page.getByTestId("note-back").click();

		await expect(page.getByTestId("note-row")).toContainText("Lecture 4");
		await page.getByTestId("notes-search").fill("ribosome");
		await expect(page.getByTestId("note-row")).toHaveCount(0);
		await page.getByTestId("notes-search").fill("MITOCHONDRIA");
		await expect(page.getByTestId("note-row")).toHaveCount(1);

		await page.reload();
		await page.getByTestId("home-notes").click();
		await page.getByTestId("note-row").click();
		await expect(page.getByTestId("note-title")).toHaveValue("Lecture 4");
		await expect(page.locator('[data-testid="note-sketch"] path')).toHaveCount(
			1,
		);

		await page.getByTestId("note-more").click();
		const download = page.waitForEvent("download");
		await page.getByTestId("note-pdf").click();
		expect((await download).suggestedFilename()).toBe("Lecture 4.pdf");
	});

	test("an empty note leaves nothing behind", async ({ page }) => {
		await boot(page);
		await page.getByTestId("home-notes").click();
		await page.getByTestId("note-new").click();
		await page.getByTestId("note-back").click();
		await expect(page.getByTestId("notes-empty")).toBeVisible();
	});

	test("a deleted note is gone", async ({ page }) => {
		await boot(page);
		await page.getByTestId("home-notes").click();
		await page.getByTestId("note-new").click();
		await page.getByTestId("note-title").fill("Shopping");
		await page.getByTestId("note-more").click();
		await page.getByTestId("note-delete").click();
		await page.getByTestId("note-delete-go").click();
		await expect(page.getByTestId("notes-empty")).toBeVisible();
	});
});

test.describe("more tools", () => {
	test("Compress says when a file cannot get smaller", async ({ page }) => {
		await boot(page);
		await page.getByTestId("open-tools").click();
		await page.getByTestId("tool-compress").click();
		const b64 = readFileSync("fixtures/sample.pdf").toString("base64");
		await page.evaluate((b64) => {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], "sample.pdf");
		}, b64);
		await page.getByTestId("tool-add").click();
		await page.getByTestId("tool-go").click();
		await expect(page.getByTestId("compress-outcome")).toContainText(
			"no copy was made",
		);
	});
});
