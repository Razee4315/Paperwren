import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import {
	PDFDocument,
	concatTransformationMatrix,
	drawObject,
	popGraphicsState,
	pushGraphicsState,
} from "@cantoo/pdf-lib";
import { type Page, expect, test } from "@playwright/test";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { boot, openFixture, pickTool, solidPng } from "./helpers";

test.describe("rename", () => {
	test("a file is renamed from its menu, keeping its extension", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("file-rename").click();
		const field = page.getByTestId("rename-input");
		await expect(field).toHaveValue("sample");
		await expect(page.getByTestId("rename")).toContainText(".pdf");

		// What a file name cannot be is said before anything is tried.
		await field.fill("a/b");
		await expect(page.getByTestId("rename-error")).toContainText(
			"can't contain",
		);
		await expect(page.getByTestId("rename-go")).toBeDisabled();
		// A browser holds a copy: it says before and after that only the
		// app's name changes, never that the file itself was renamed.
		await expect(page.getByTestId("rename-in-app")).toContainText(
			"in Paperwren only",
		);
		await field.fill("Quarterly report ");
		await field.press("Enter");
		await expect(page.getByTestId("rename")).toHaveCount(0);
		await expect(page.getByTestId("toast")).toContainText(
			"Renamed to Quarterly report.pdf in Paperwren. The original file keeps its name.",
		);
		await expect(page.getByTestId("viewer").locator("header")).toContainText(
			"Quarterly report.pdf",
		);
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});

		await page.getByTestId("viewer-back").click();
		const recent = page.getByTestId("recent").first();
		await expect(recent).toContainText("Quarterly report.pdf");
		await expect(page.getByTestId("recent")).toHaveCount(1);

		// And from Home.
		await recent.getByRole("button", { name: /More actions/ }).click();
		await page.getByTestId("menu-rename").click();
		await page.getByTestId("rename-input").fill("Q3");
		await page.getByTestId("rename-go").click();
		await expect(recent).toContainText("Q3.pdf");
		// It still opens.
		await recent.getByRole("button").first().click();
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
	});

	/** Stand in for a system that renames the file itself: every rename
	 * asked for is kept, and `fail` (a desktop refusal's kind and words)
	 * refuses them. */
	async function systemRenames(
		page: Page,
		fail?: { kind: string; message: string },
	) {
		await page.evaluate((fail) => {
			window.__paperwrenTestRenames = [];
			window.__paperwrenTestRename = async (reopen) => {
				if (fail) throw fail;
				return reopen;
			};
		}, fail);
	}

	test("the file itself is renamed, through the backend", async ({ page }) => {
		await boot(page);
		await systemRenames(page);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("file-rename").click();
		// The file itself is renamed: nothing to warn about.
		await expect(page.getByTestId("rename-in-app")).toHaveCount(0);
		await page.getByTestId("rename-input").fill("Q3");
		await page.getByTestId("rename-go").click();
		await expect(page.getByTestId("rename")).toHaveCount(0);
		const toast = page.getByTestId("toast");
		await expect(toast).toContainText("Renamed to Q3.pdf");
		await expect(toast).not.toContainText("in Paperwren");
		const asked = await page.evaluate(() => window.__paperwrenTestRenames);
		expect(asked).toHaveLength(1);
		expect(asked?.[0].name).toBe("Q3.pdf");
		expect(asked?.[0].reopen.kind).toBe("browser");
		await expect(page.getByTestId("viewer").locator("header")).toContainText(
			"Q3.pdf",
		);
	});

	test("a tab follows its file renamed from Home", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await boot(page, {}, "?desktop&frame");
		await systemRenames(page);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		// A second document, so the tabs show at Home.
		const text = readFileSync("fixtures/sample.txt").toString("base64");
		await page.evaluate((b64) => {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], "sample.txt");
		}, text);
		await page.keyboard.press("Control+o");
		const tabs = page.getByTestId("tab");
		await expect(tabs).toHaveText(["sample.pdf", "sample.txt"]);
		await page.getByTestId("tab-home").click();
		const recent = page.getByTestId("recent").filter({ hasText: "sample.pdf" });
		await recent.getByRole("button", { name: /More actions/ }).click();
		await page.getByTestId("menu-rename").click();
		await page.getByTestId("rename-input").fill("Q3");
		await page.getByTestId("rename-go").click();
		const renamed = page.getByTestId("recent").filter({ hasText: "Q3.pdf" });
		await expect(renamed).toHaveCount(1);
		await expect(tabs).toHaveText(["Q3.pdf", "sample.txt"]);
		// Opened again, it is the same tab, under its new name.
		await renamed.getByRole("button").first().click();
		await expect(tabs).toHaveCount(2);
		await expect(page).toHaveTitle(/Q3\.pdf/);
	});

	test("a refused rename keeps the old name everywhere", async ({ page }) => {
		await boot(page);
		await systemRenames(page, {
			kind: "io",
			message:
				"The process cannot access the file because it is being used by another process. (os error 32)",
		});
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("file-rename").click();
		await page.getByTestId("rename-input").fill("Q3");
		await page.getByTestId("rename-go").click();
		await expect(page.getByTestId("rename-error")).toContainText(
			"Another app is using this file",
		);
		const asked = await page.evaluate(() => window.__paperwrenTestRenames);
		expect(asked?.map((a) => a.name)).toEqual(["Q3.pdf"]);
		// Nothing changed: the dialog stays to try again, and the old name
		// is the one shown and kept.
		await expect(page.getByTestId("rename")).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByTestId("viewer").locator("header")).toContainText(
			"sample.pdf",
		);
		await page.getByTestId("viewer-back").click();
		await expect(page.getByTestId("recent").first()).toContainText(
			"sample.pdf",
		);
	});
});

/** Draw a wave on the signature pad. */
async function sign(page: Page) {
	const pad = await page.getByTestId("signature-canvas").boundingBox();
	if (!pad) throw new Error("no pad");
	await page.mouse.move(pad.x + 30, pad.y + pad.height * 0.6);
	await page.mouse.down();
	for (let i = 0; i <= 24; i++)
		await page.mouse.move(
			pad.x + 30 + i * 10,
			pad.y + pad.height * (0.6 + 0.2 * Math.sin(i / 3)),
		);
	await page.mouse.up();
}

/** Save the editor's copy and return its bytes. */
async function saveCopy(page: Page) {
	await page.getByTestId("fill-save").click();
	const download = page.waitForEvent("download");
	await page.getByTestId("fill-save-go").click();
	const file = await download;
	const path = await file.path();
	return {
		name: file.suggestedFilename(),
		bytes: new Uint8Array(readFileSync(path)),
	};
}

test.describe("fill & sign", () => {
	test("desktop signing keeps its controls above the page and adapts to narrow windows", async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 1536, height: 824 });
		await boot(page, { settings_v2: { theme: "dark" } }, "?desktop&frame");
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		const editor = page.getByTestId("fill-sign");
		const pages = page.getByTestId("fill-pages");
		const actions = page.getByTestId("fill-actions");
		await expect(page.getByTestId("fill-sign-here")).toBeVisible();
		for (const width of [1536, 1280, 1100, 1000, 700]) {
			await page.setViewportSize({ width, height: 824 });
			await expect
				.poll(async () => (await pages.boundingBox())?.y)
				.toBeLessThan(width >= 1100 ? 80 : 120);
			const pageBox = await pages.boundingBox();
			if (!pageBox) throw new Error("No document area");
			expect(pageBox.y + pageBox.height).toBe(824);
			const controls = [
				page.getByTestId("fill-close"),
				...["sign", "initials", "text", "date", "check", "cross"].map((kind) =>
					page.getByTestId(`fill-tool-${kind}`),
				),
				actions,
				page.getByTestId("window-controls"),
			];
			const boxes = await Promise.all(
				controls.map((control) => control.boundingBox()),
			);
			for (const box of boxes) {
				if (!box) throw new Error("Missing control");
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.x + box.width).toBeLessThanOrEqual(width);
				expect(box.y + box.height).toBeLessThanOrEqual(pageBox.y);
			}
			const save = await page.getByTestId("fill-save").boundingBox();
			expect((save?.x ?? 0) + (save?.width ?? 0)).toBeLessThanOrEqual(
				width - 138,
			);
		}
		await page.setViewportSize({ width: 1536, height: 824 });
		await page.getByTestId("fill-tool-text").click();
		await expect(page.getByTestId("fill-hint")).toContainText("Text:");
		await page
			.getByTestId("fill-guidance")
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		await expect(page.getByTestId("fill-tool-text")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await actions.getByRole("button", { name: "Zoom in", exact: true }).click();
		await expect(actions).toContainText("150%");
		await actions
			.getByRole("button", { name: "Zoom out", exact: true })
			.click();
		await editor.getByLabel("fullname").fill("Ayesha Khan");
		await expect(page.getByTestId("fill-save")).toBeEnabled();
		await page.screenshot({
			path: testInfo.outputPath("compact-signing-desktop.png"),
		});
		// The native Windows controls must also stay clear of the title in RTL.
		await page.evaluate(() => {
			document.documentElement.dir = "rtl";
		});
		const close = await page.getByTestId("fill-close").boundingBox();
		expect((close?.x ?? 0) + (close?.width ?? 0)).toBeLessThanOrEqual(
			1536 - 138,
		);
		await page.evaluate(() => {
			document.documentElement.dir = "ltr";
		});
		await page.setViewportSize({ width: 360, height: 800 });
		await expect(page.getByTestId("fill-save")).toBeInViewport();
		const smallPage = await pages.boundingBox();
		const smallActions = await actions.boundingBox();
		expect(smallActions?.y).toBe(
			(smallPage?.y ?? 0) + (smallPage?.height ?? 0),
		);
		await page.getByTestId("fill-save").click();
		await expect(page.getByTestId("fill-save-go")).toBeVisible();
	});

	test("ink swatches stay round and pen widths survive expansion, undo and export", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await boot(page, {}, "?desktop");
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		await pickTool(page, "initials");
		const canvas = page.getByTestId("signature-canvas");
		const drawLine = async (x: number) => {
			const box = await canvas.boundingBox();
			if (!box) throw new Error("No signature canvas");
			await page.mouse.move(box.x + box.width * x, box.y + box.height * 0.3);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width * x, box.y + box.height * 0.7, {
				steps: 12,
			});
			await page.mouse.up();
		};
		const pixels = () =>
			canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
		const blue = page.getByRole("button", { name: "Blue ink", exact: true });
		for (const swatch of [
			blue,
			page.getByRole("button", { name: "Black ink", exact: true }),
		]) {
			const outer = await swatch.boundingBox();
			const inner = await swatch.locator("span").boundingBox();
			if (!outer || !inner) throw new Error("Missing ink swatch");
			expect(outer.width).toBeCloseTo(outer.height, 2);
			expect(inner.width).toBeCloseTo(inner.height, 2);
		}
		await expect(
			page.getByRole("button", { name: "Medium pen", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await drawLine(0.2);
		await page.getByTestId("signature-fullscreen").click();
		await expect
			.poll(async () => (await canvas.boundingBox())?.width)
			.toBeGreaterThan(1000);
		await drawLine(0.65);
		await page.getByRole("button", { name: "Thick pen", exact: true }).click();
		await drawLine(0.85);
		await page.getByRole("button", { name: "Thin pen", exact: true }).click();
		await drawLine(0.45);
		await blue.click();
		await expect(blue).toHaveAttribute("aria-pressed", "true");
		const beforeUndo = await pixels();
		await page.getByTestId("signature-undo").click();
		expect(await pixels()).not.toBe(beforeUndo);
		await page.getByTestId("signature-redo").click();
		expect(await pixels()).toBe(beforeUndo);
		await page.getByTestId("signature-fullscreen-done").click();
		await expect(
			page.getByRole("button", { name: "Thin pen", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await page.getByTestId("signature-done").click();
		// Inspect the saved image itself: four separate blue strokes, with the
		// two medium strokes equally thick despite being drawn at different zooms.
		const widths = await page.evaluate(async () => {
			const saved = JSON.parse(
				localStorage.getItem("paperwren.signatures_v1") ?? "[]",
			)[0];
			const image = new Image();
			image.src = saved.src;
			await image.decode();
			const out = document.createElement("canvas");
			out.width = image.width;
			out.height = image.height;
			const ctx = out.getContext("2d");
			if (!ctx) throw new Error("No canvas context");
			ctx.drawImage(image, 0, 0);
			const row = ctx.getImageData(
				0,
				Math.floor(out.height / 2),
				out.width,
				1,
			).data;
			const runs: number[] = [];
			let length = 0;
			for (let x = 0; x <= out.width; x++) {
				if (x < out.width && row[x * 4 + 3] > 128) {
					if (row[x * 4 + 2] < row[x * 4] * 3)
						throw new Error("Ink is not blue");
					length++;
				} else if (length) {
					runs.push(length);
					length = 0;
				}
			}
			return runs;
		});
		expect(widths).toHaveLength(4);
		expect(Math.abs(widths[0] - widths[2])).toBeLessThanOrEqual(1);
		expect(widths[1]).toBeLessThan(widths[0] * 0.7);
		expect(widths[3]).toBeGreaterThan(widths[2] * 1.5);
	});

	test("initials accept touch strokes and the pad stays whole in landscape", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 568 });
		await boot(page);
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		await pickTool(page, "initials");
		// A phone draws on the whole screen: no toggle, nothing to scroll.
		await expect(page.getByTestId("signature-fullscreen")).toHaveCount(0);
		await expect(page.getByTestId("signature-done")).toBeInViewport();
		const canvas = page.getByTestId("signature-canvas");
		const box = await canvas.boundingBox();
		if (!box) throw new Error("No signature canvas");
		const touch = await page.context().newCDPSession(page);
		await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true });
		await touch.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [{ x: box.x + 40, y: box.y + 40 }],
		});
		for (let n = 1; n <= 12; n++) {
			await touch.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: box.x + 40 + n * 12, y: box.y + 40 + n * 16 }],
			});
		}
		await touch.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
		await touch.detach();
		await expect(page.getByTestId("signature-undo")).toBeEnabled();
		const before = await canvas.evaluate((el: HTMLCanvasElement) =>
			el.toDataURL(),
		);
		await page.getByTestId("signature-undo").click();
		await page.getByTestId("signature-redo").click();
		expect(
			await canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL()),
		).toBe(before);
		await page.setViewportSize({ width: 568, height: 320 });
		await expect(page.getByTestId("signature-done")).toBeInViewport();
		await expect
			.poll(async () => (await canvas.boundingBox())?.height)
			.toBeGreaterThan(100);
		await page.getByTestId("signature-done").click();
		await expect(page.getByTestId("signature-pad")).toHaveCount(0);
		const kept = await page.evaluate(
			() =>
				JSON.parse(localStorage.getItem("paperwren.signatures_v1") ?? "[]")[0],
		);
		expect(kept.initials).toBe(true);
		expect(Math.max(kept.w, kept.h)).toBeGreaterThan(1000);
	});

	test("a phone signature fills the screen, keeps its shape on rotation, and supports redo", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await boot(page);
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		await page.getByTestId("fill-sign-here").click();
		const canvas = page.getByTestId("signature-canvas");
		const pixels = () =>
			canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
		const inkShape = () =>
			canvas.evaluate((el: HTMLCanvasElement) => {
				const ctx = el.getContext("2d");
				if (!ctx) throw new Error("No canvas context");
				const data = ctx.getImageData(0, 0, el.width, el.height).data;
				let left = el.width;
				let right = -1;
				let top = el.height;
				let bottom = -1;
				for (let y = 0; y < el.height; y++)
					for (let x = 0; x < el.width; x++) {
						if (data[(y * el.width + x) * 4 + 3] < 32) continue;
						left = Math.min(left, x);
						right = Math.max(right, x);
						top = Math.min(top, y);
						bottom = Math.max(bottom, y);
					}
				return {
					width: right - left + 1,
					ratio: (right - left + 1) / (bottom - top + 1),
				};
			});
		await expect
			.poll(async () => (await canvas.boundingBox())?.height)
			.toBeGreaterThan(400);
		await expect(page.getByTestId("signature-done")).toBeInViewport();
		await sign(page);
		const portrait = await inkShape();
		const drawn = await pixels();
		await page.getByTestId("signature-undo").click();
		await expect(page.getByTestId("signature-undo")).toBeDisabled();
		await page.getByTestId("signature-redo").click();
		expect(await pixels()).toBe(drawn);
		await page.setViewportSize({ width: 800, height: 360 });
		await expect
			.poll(async () => (await canvas.boundingBox())?.width)
			.toBeGreaterThan(700);
		await expect
			.poll(async () => (await inkShape()).ratio)
			.toBeCloseTo(portrait.ratio, 1);
		await expect(page.getByTestId("signature-done")).toBeInViewport();
		await page.setViewportSize({ width: 360, height: 800 });
		await expect
			.poll(async () => (await canvas.boundingBox())?.height)
			.toBeGreaterThan(400);
		await expect
			.poll(async () => (await inkShape()).ratio)
			.toBeCloseTo(portrait.ratio, 1);
		// Turning the phone back and forth cannot shrink the signature.
		const small = await inkShape();
		await page.setViewportSize({ width: 800, height: 360 });
		await page.setViewportSize({ width: 360, height: 800 });
		await expect
			.poll(async () => (await inkShape()).width)
			.toBeCloseTo(small.width, 0);
		await page.getByTestId("signature-undo").click();
		await expect(page.getByTestId("signature-done")).toBeDisabled();
		await sign(page);
		await expect(page.getByTestId("signature-redo")).toBeDisabled();
		await page.getByTestId("signature-clear").click();
		await expect(page.getByTestId("signature-done")).toBeDisabled();
		await expect(page.getByTestId("signature-redo")).toBeDisabled();
		await sign(page);
		await page.getByTestId("signature-done").click();
		await expect(page.getByTestId("fill-item")).toHaveCount(1);
		const kept = await page.evaluate(
			() =>
				JSON.parse(localStorage.getItem("paperwren.signatures_v1") ?? "[]")[0],
		);
		expect(Math.max(kept.w, kept.h)).toBeGreaterThan(1000);
		const saved = await saveCopy(page);
		const doc = await pdfjs.getDocument({
			data: saved.bytes.slice(),
			verbosity: 0,
		}).promise;
		expect((await (await doc.getPage(1)).getOperatorList()).fnArray).toContain(
			pdfjs.OPS.paintImageXObject,
		);
		await doc.destroy();
	});

	test("marks are placed, moved, resized and removed from the keyboard", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await boot(page, {}, "?desktop");
		await openFixture(page, "features/form.pdf");
		await expect(page.getByTestId("pdf-page-field")).toHaveValue("1", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-fill-sign").click();
		const editor = page.getByTestId("fill-sign");
		await expect(editor.getByTestId("fill-field")).toHaveCount(5);

		// A tool chosen from the keyboard is placed at once, in the middle
		// of the page on screen; typed text goes into it.
		await editor.getByTestId("fill-tool-text").focus();
		await page.keyboard.press("Enter");
		const item = editor.getByTestId("fill-item");
		await expect(item).toHaveCount(1);
		await expect(editor.getByTestId("fill-item-text")).toBeFocused();
		await page.keyboard.type("Hello");
		await page.keyboard.press("Enter");
		// The mark keeps the keyboard: the arrows move it, + makes it larger.
		await expect(item).toBeFocused();
		await expect(editor.getByTestId("fill-hint")).toContainText("arrow keys");
		const box = () =>
			item.evaluate((el) => ({
				left: Number.parseFloat((el as HTMLElement).style.left),
				width: Number.parseFloat((el as HTMLElement).style.width),
			}));
		const from = await box();
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("Shift+ArrowRight");
		expect((await box()).left).toBeGreaterThan(from.left + 4);
		await page.keyboard.press("+");
		expect((await box()).width).toBeGreaterThan(from.width);
		await expect(item).toHaveAttribute("aria-label", "Hello");

		// A tick, chosen with Space; Delete takes it away again.
		await editor.getByTestId("fill-tool-check").focus();
		await page.keyboard.press("Space");
		await expect(item).toHaveCount(2);
		await expect(item.nth(1)).toBeFocused();
		await expect(item.nth(1)).toHaveAttribute("aria-label", "Tick");
		await page.keyboard.press("Delete");
		await expect(item).toHaveCount(1);
	});

	test("a form is filled in and signed, and saved as a copy", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/form.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 2", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-fill-sign").click();
		const editor = page.getByTestId("fill-sign");
		await expect(editor.getByTestId("fill-field")).toHaveCount(5);
		await expect(page.getByTestId("fill-save")).toBeDisabled();

		await editor.getByLabel("fullname").fill("Ayesha Khan");
		await editor.getByLabel("agree").click();
		await editor.getByLabel("plan").selectOption("Yearly");
		await editor.getByLabel("size").nth(1).click();

		// The file's signature field: drawn once, kept for next time.
		await editor.getByTestId("fill-sign-here").click();
		await sign(page);
		await page.getByTestId("signature-done").click();
		await expect(editor.getByTestId("fill-item")).toHaveCount(1);
		await expect(editor.getByTestId("fill-sign-here")).toHaveCount(0);

		// A line of text, typed where it was put.
		await editor.getByTestId("fill-tool-text").click();
		const first = await editor.getByTestId("fill-page").first().boundingBox();
		if (!first) throw new Error("no page");
		await page.mouse.click(
			first.x + first.width * 0.1,
			first.y + first.height * 0.4,
		);
		await page.keyboard.type("Approved by the club");
		await page.keyboard.press("Enter");
		// A tick, then taken away again.
		await editor.getByTestId("fill-tool-check").click();
		await page.mouse.click(
			first.x + first.width * 0.8,
			first.y + first.height * 0.6,
		);
		await expect(editor.getByTestId("fill-item")).toHaveCount(3);
		await editor.getByTestId("fill-item-remove").click();
		await expect(editor.getByTestId("fill-item")).toHaveCount(2);

		// The page on its side is signed with the kept signature.
		await editor.getByTestId("fill-page").nth(1).scrollIntoViewIfNeeded();
		await editor.getByTestId("fill-tool-sign").click();
		await page.getByTestId("signature-kept").first().click();
		const second = await editor.getByTestId("fill-page").nth(1).boundingBox();
		if (!second) throw new Error("no page");
		await page.mouse.click(
			second.x + second.width / 2,
			second.y + second.height / 2,
		);
		await expect(editor.getByTestId("fill-item")).toHaveCount(3);

		const saved = await saveCopy(page);
		expect(saved.name).toBe("form (signed).pdf");
		await expect(editor).toHaveCount(0);
		await expect(page.getByText("Saved as form (signed).pdf")).toBeVisible();

		const form = (await PDFDocument.load(saved.bytes)).getForm();
		expect(form.getTextField("fullname").getText()).toBe("Ayesha Khan");
		expect(form.getCheckBox("agree").isChecked()).toBe(true);
		expect(form.getDropdown("plan").getSelected()).toEqual(["Yearly"]);
		expect(form.getRadioGroup("size").getSelected()).toBe("L");
		const doc = await PDFDocument.load(saved.bytes);
		expect(doc.getPage(1).getRotation().angle).toBe(90);
		// The text went in as text, the signatures as pictures.
		const read = await pdfjs.getDocument({
			data: saved.bytes.slice(),
			verbosity: 0,
		}).promise;
		const words = async (n: number) =>
			(await (await read.getPage(n)).getTextContent()).items
				.map((i) => ("str" in i ? i.str : ""))
				.join(" ");
		expect(await words(1)).toContain("Approved by the club");
		for (const n of [1, 2]) {
			const ops = await (await read.getPage(n)).getOperatorList();
			expect(ops.fnArray).toContain(pdfjs.OPS.paintImageXObject);
		}
		await read.destroy();
	});

	test("form fields are drawn once, and their text follows the zoom", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await boot(page, {}, "?desktop");
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		const editor = page.getByTestId("fill-sign");
		const plan = editor.getByLabel("plan");
		await expect(plan).toBeVisible();
		const size = () =>
			plan.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
		const at100 = await size();
		await editor.getByLabel("Zoom in").click();
		await editor.getByLabel("Zoom in").click();
		await expect.poll(size).toBeCloseTo(at100 * 2, 0);
		await plan.scrollIntoViewIfNeeded();
		const canvas = editor.locator("canvas[data-drawn]").first();
		await expect(canvas).toBeAttached();
		// Under the field, the page's picture is bare paper: the file's own
		// "Monthly" is not drawn there too.
		await expect
			.poll(() =>
				plan.evaluate((field) => {
					const page = field.closest("[data-page]");
					const art = page?.querySelector("canvas");
					const ctx = art?.getContext("2d");
					if (!page || !art || !ctx || !art.dataset.drawn) return -1;
					const p = page.getBoundingClientRect();
					const f = field.getBoundingClientRect();
					const k = art.width / p.width;
					const data = ctx.getImageData(
						(f.left - p.left + 4) * k,
						(f.top - p.top + 4) * k,
						(f.width - 8) * k,
						(f.height - 8) * k,
					).data;
					let dark = 0;
					for (let i = 0; i < data.length; i += 4)
						if (data[i] + data[i + 1] + data[i + 2] < 450) dark++;
					return dark;
				}),
			)
			.toBe(0);
	});

	test("leaving with changes asks first; a typed signature works too", async ({
		page,
	}) => {
		await boot(page);
		await openFixture(page, "features/form.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 2", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-fill-sign").click();
		const editor = page.getByTestId("fill-sign");
		await editor.getByTestId("fill-tool-sign").click();
		await page.getByTestId("signature-type").click();
		// The same three faces on every system, bundled; a long name
		// shrinks to show whole.
		await page
			.getByTestId("signature-name")
			.fill("Ayesha Khan Siddiqui Rahman");
		const hands = page.getByTestId("signature-hand");
		await expect(hands).toHaveCount(3);
		await expect
			.poll(() =>
				page.evaluate(() =>
					["Dancing Script", "Great Vibes", "Caveat"].every((face) =>
						document.fonts.check(`20px "${face}"`),
					),
				),
			)
			.toBe(true);
		const sizes = await hands.evaluateAll((els) =>
			els.map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
		);
		expect(Math.min(...sizes)).toBeLessThan(38);
		await page.getByTestId("signature-name").fill("Ayesha Khan");
		await page.getByTestId("signature-keep").uncheck();
		await page.getByTestId("signature-done").click();
		const box = await editor.getByTestId("fill-page").first().boundingBox();
		if (!box) throw new Error("no page");
		await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
		await expect(editor.getByTestId("fill-item")).toHaveCount(1);

		// Dragged by its corner it grows, keeping its shape.
		const item = editor.getByTestId("fill-item");
		const before = await item.boundingBox();
		const corner = await editor.getByTestId("fill-item-size").boundingBox();
		if (!before || !corner) throw new Error("no item");
		await page.mouse.move(corner.x + 9, corner.y + 9);
		await page.mouse.down();
		await page.mouse.move(corner.x + 69, corner.y + 40, { steps: 5 });
		await page.mouse.up();
		const after = await item.boundingBox();
		expect(after?.width ?? 0).toBeGreaterThan(before.width * 1.3);
		expect((after?.width ?? 0) / (after?.height ?? 1)).toBeCloseTo(
			before.width / before.height,
			1,
		);

		await page.keyboard.press("Escape");
		await page.getByTestId("fill-close").click();
		await expect(page.getByTestId("fill-leave")).toBeVisible();
		await page.getByRole("button", { name: "Keep editing" }).click();
		await expect(editor).toBeVisible();
		await page.getByTestId("fill-close").click();
		await page.getByTestId("fill-discard").click();
		await expect(editor).toHaveCount(0);

		// The signature was not kept.
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-fill-sign").click();
		await editor.getByTestId("fill-tool-sign").click();
		await expect(page.getByTestId("signature-pad")).toBeVisible();
	});
});

test.describe("fill & sign by touch", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});

	test("a phone keeps the page first: Save on top, four tools and More, one ink", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 360, height: 640 });
		await boot(page);
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		const editor = page.getByTestId("fill-sign");
		await expect(editor.getByTestId("fill-field")).toHaveCount(5);
		// Save in the top bar, above the page; the tools below it.
		const pages = await page.getByTestId("fill-pages").boundingBox();
		const save = await page.getByTestId("fill-save").boundingBox();
		expect((save?.y ?? 999) + (save?.height ?? 0)).toBeLessThanOrEqual(
			pages?.y ?? 0,
		);
		const bar = editor.locator("[role=toolbar] button");
		await expect(bar).toHaveCount(5);
		for (const box of await bar.evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().toJSON()),
		)) {
			expect(box.left).toBeGreaterThanOrEqual(0);
			expect(box.right).toBeLessThanOrEqual(360);
			expect(box.top).toBeGreaterThanOrEqual(
				(pages?.y ?? 0) + (pages?.height ?? 0) - 1,
			);
		}
		// No hint until there is a next step.
		await expect(page.getByTestId("fill-guidance")).toHaveCount(0);
		await page.getByTestId("fill-tool-text").click();
		await expect(page.getByTestId("fill-hint")).toContainText("Text:");
		await page
			.getByTestId("fill-guidance")
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		await expect(page.getByTestId("fill-guidance")).toHaveCount(0);
		// The rarer tools, the ink and the zoom are in More.
		await page.getByTestId("fill-tool-more").click();
		const more = page.getByTestId("fill-more");
		for (const id of [
			"fill-tool-initials",
			"fill-tool-stamp",
			"fill-tool-cross",
			"fill-zoom-in",
		])
			await expect(more.getByTestId(id)).toBeVisible();
		await more.getByTestId("fill-ink-black").click();
		// The signature takes the same ink.
		await page.getByTestId("fill-tool-sign").click();
		await expect(
			page
				.getByTestId("signature-pad")
				.getByRole("button", { name: "Black ink" }),
		).toHaveAttribute("aria-pressed", "true");
	});

	test("typed words read on a phone while they are typed", async ({ page }) => {
		await boot(page);
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		const editor = page.getByTestId("fill-sign");
		await expect(editor.getByTestId("fill-field")).toHaveCount(5);
		await page.getByTestId("fill-tool-text").click();
		const box = await editor.getByTestId("fill-page").first().boundingBox();
		if (!box) throw new Error("no page");
		await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.75);
		const field = page.getByTestId("fill-item-text");
		await expect(field).toBeFocused();
		await page.keyboard.type("Ayesha Khan, Lahore");
		// At a size that reads, every word in view.
		const typing = await field.evaluate((el: HTMLInputElement) => ({
			size: Number.parseFloat(getComputedStyle(el).fontSize),
			whole: el.scrollWidth <= el.clientWidth + 1 && el.scrollLeft === 0,
		}));
		expect(typing.size).toBeGreaterThanOrEqual(16);
		expect(typing.whole).toBe(true);
		// Typed, the mark is its own size on the page again.
		await page.keyboard.press("Enter");
		await expect(field).toHaveCount(0);
		const placed = await editor
			.getByTestId("fill-item")
			.first()
			.evaluate((el) =>
				Number.parseFloat(
					getComputedStyle(el.querySelector("span") ?? el).fontSize,
				),
			);
		expect(placed).toBeLessThan(16);
	});

	test("a finger scroll places nothing; one tap places one mark", async ({
		page,
	}) => {
		await boot(page);
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		const editor = page.getByTestId("fill-sign");
		await expect(editor.getByTestId("fill-field")).toHaveCount(5);
		await editor.getByTestId("fill-tool-sign").click();
		await page.getByTestId("signature-type").click();
		await page.getByTestId("signature-name").fill("Ayesha Khan");
		await page.getByTestId("signature-keep").uncheck();
		await page.getByTestId("signature-done").click();

		const pages = editor.getByTestId("fill-pages");
		const box = await pages.boundingBox();
		if (!box) throw new Error("no pages");
		await page.touchscreen.tap(box.x + box.width / 2, box.y + 300);
		const items = editor.getByTestId("fill-item");
		await expect(items).toHaveCount(1);
		// The tool is put down: a later touch can't add another.
		await expect(pages).not.toHaveAttribute("data-tool", /./);

		const cdp = await page.context().newCDPSession(page);
		const swipe = async (x: number, y: number, dy: number) => {
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x, y }],
			});
			for (let i = 1; i <= 10; i++)
				await cdp.send("Input.dispatchTouchEvent", {
					type: "touchMove",
					touchPoints: [{ x, y: y + (i * dy) / 10 }],
				});
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			});
		};
		// Let go of the signature, then swipe on it, on paper and on a field.
		await page.touchscreen.tap(box.x + 20, box.y + 100);
		const mark = await items.boundingBox();
		if (!mark) throw new Error("no mark");
		const from = await items.evaluate((el) => el.style.left + el.style.top);
		await swipe(mark.x + mark.width / 2, mark.y + mark.height / 2, -250);
		await expect
			.poll(() => pages.evaluate((el) => el.scrollTop))
			.toBeGreaterThan(50);
		for (let k = 0; k < 5; k++) {
			await swipe(box.x + box.width / 2, box.y + box.height - 80, -250);
			await swipe(box.x + box.width / 2, box.y + 200, 200);
		}
		await cdp.detach();
		await expect(items).toHaveCount(1);
		// The signature scrolled with the page, it was not dragged.
		expect(await items.evaluate((el) => el.style.left + el.style.top)).toBe(
			from,
		);
		await pages.evaluate((el) => {
			el.scrollTop = 0;
		});

		// Signing again is one tap on "Place another", then one on the page.
		await editor.getByTestId("fill-again").tap();
		await page.touchscreen.tap(box.x + box.width / 2, box.y + 450);
		await expect(items).toHaveCount(2);
	});

	test("the pad fits a phone on its side, and two fingers draw nothing", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 740, height: 360 });
		await boot(page);
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		await page.getByTestId("fill-tool-sign").click();
		const pad = page.getByTestId("signature-pad");
		await expect(page.getByTestId("signature-done")).toBeInViewport();
		// Nothing in the dialog scrolls.
		expect(
			await pad.evaluate((d) =>
				[d, ...d.querySelectorAll("*")].some(
					(e) =>
						e.scrollHeight > e.clientHeight + 2 &&
						["auto", "scroll"].includes(getComputedStyle(e).overflowY),
				),
			),
		).toBe(false);
		const box = await page.getByTestId("signature-canvas").boundingBox();
		if (!box) throw new Error("no pad");
		expect(box.height).toBeGreaterThan(100);
		const cdp = await page.context().newCDPSession(page);
		const a = { x: box.x + 60, y: box.y + 30, id: 1 };
		const b = { x: box.x + 200, y: box.y + 30, id: 2 };
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [a],
		});
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [a, b],
		});
		for (let i = 1; i <= 8; i++)
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [
					{ ...a, y: a.y + i * 8 },
					{ ...b, y: b.y + i * 8 },
				],
			});
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
		await cdp.detach();
		await expect(page.getByTestId("signature-done")).toBeDisabled();
	});
});

/** Hand the next pick a fixture (or bytes). */
async function nextPick(
	page: Page,
	fixture: string | Uint8Array,
	name?: string,
) {
	const bytes =
		typeof fixture === "string"
			? readFileSync(`fixtures/${fixture}`)
			: Buffer.from(fixture);
	await page.evaluate(
		({ b64, name }) => {
			const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([data], name);
		},
		{
			b64: bytes.toString("base64"),
			name:
				name ??
				(typeof fixture === "string" ? fixture.split("/").pop() : "file.pdf"),
		},
	);
}

/** Hand the next pick of several these files, in this order. */
async function nextPicks(
	page: Page,
	files: Array<{ name: string; bytes: Uint8Array }>,
) {
	await page.evaluate(
		(list) => {
			window.__paperwrenTestFiles = list.map(
				({ name, b64 }) =>
					new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name),
			);
		},
		files.map(({ name, bytes }) => ({
			name,
			b64: Buffer.from(bytes).toString("base64"),
		})),
	);
}

/** A fixture, to be picked with others. */
function fixtureFile(fixture: string, name = fixture.split("/").pop() ?? "") {
	return { name, bytes: new Uint8Array(readFileSync(`fixtures/${fixture}`)) };
}

/** The names in the tool's list of files, top to bottom. */
const listed = (page: Page) =>
	page.getByTestId("tool-file").locator("span[dir=auto]");

/** Add a file to the open tool. */
async function addFile(
	page: Page,
	fixture: string | Uint8Array,
	name?: string,
) {
	const before = await page.getByTestId("tool-file").count();
	await nextPick(page, fixture, name);
	await page.getByTestId("tool-add").click();
	await expect(page.getByTestId("tool-file")).toHaveCount(before + 1);
}

/** Run the tool and return what it saved. */
async function runTool(page: Page) {
	const download = page.waitForEvent("download");
	await page.getByTestId("tool-go").click();
	const file = await download;
	return {
		name: file.suggestedFilename(),
		bytes: new Uint8Array(readFileSync(await file.path())),
	};
}

async function texts(bytes: Uint8Array, password?: string) {
	const doc = await pdfjs.getDocument({
		data: bytes.slice(),
		password,
		verbosity: 0,
	}).promise;
	const out: Array<{ text: string; rotate: number }> = [];
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n);
		out.push({
			text: (await page.getTextContent()).items
				.map((i) => ("str" in i ? i.str : ""))
				.join(" "),
			rotate: page.rotate,
		});
	}
	await doc.destroy();
	return out;
}

async function openTool(page: Page, id: string) {
	await page.getByTestId("open-tools").click();
	await expect(page.getByTestId("tools")).toBeVisible();
	await page.getByTestId(`tool-${id}`).click();
}

test("home exposes labeled shortcuts and the complete tools collection on a small phone", async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 568 });
	await boot(page);
	for (const id of ["scan", "sign", "merge", "organize"] as const) {
		const shortcut = page.getByTestId(`home-tool-${id}`);
		await expect(shortcut).toBeInViewport();
		await shortcut.click();
		await expect(page.getByTestId("tools")).toBeVisible();
		await expect(page.getByTestId("tools").locator("h1")).toHaveText(
			{
				scan: "Scan a document",
				sign: "Fill & sign",
				merge: "Merge PDFs",
				organize: "Organize pages",
			}[id],
		);
		await page.getByTestId("tools-back").click();
		await expect(page.getByTestId("home")).toBeVisible();
	}
	await page.getByRole("button", { name: "All tools" }).click();
	for (const id of [
		"sign",
		"scan",
		"merge",
		"organize",
		"extract",
		"images",
		"pictures",
		"numbers",
		"watermark",
		"protect",
		"unlock",
	])
		await expect(page.getByTestId(`tool-${id}`)).toBeAttached();
});

test.describe("PDF tools", () => {
	test("merge puts PDFs together in the order set", async ({ page }) => {
		await boot(page);
		await openTool(page, "merge");
		await addFile(page, "features/pictures.pdf");
		await addFile(page, "sample.pdf");
		await expect(page.getByText("6 pages in all")).toBeVisible();
		// sample.pdf first.
		await page.getByTestId("tool-file-up").nth(1).click();
		await expect(page.getByTestId("tool-file").first()).toContainText(
			"sample.pdf",
		);
		const out = await runTool(page);
		expect(out.name).toBe("sample (merged).pdf");
		const pages = await texts(out.bytes);
		expect(pages).toHaveLength(6);
		expect(pages[0].text).toContain("Paperwren test page 1 of 3");
		expect(pages[3].text).not.toContain("Paperwren test page");
		await expect(page.getByTestId("tools").getByRole("status")).toContainText(
			"Saved as sample (merged).pdf",
		);
	});

	test("pages are organized from inside a PDF", async ({ page }) => {
		await boot(page);
		await openFixture(page, "sample.pdf");
		await expect(page.getByTestId("pdf-page")).toHaveText("1 / 3", {
			timeout: 20_000,
		});
		await page.getByTestId("file-more").click();
		await page.getByTestId("pdf-tools").click();
		await page.getByTestId("tool-organize").click();
		await expect(page.getByTestId("tool-page")).toHaveCount(3);
		// Page 3 turned and moved to the front; page 2 taken out.
		await page.getByTestId("tool-page").nth(2).click();
		await page.getByTestId("tool-turn-right").click();
		await page.getByTestId("tool-earlier").click();
		await page.getByTestId("tool-earlier").click();
		await page.getByTestId("tool-page").nth(0).click();
		await page.getByTestId("tool-page").nth(2).click();
		await page.getByTestId("tool-delete").click();
		await expect(page.getByTestId("tool-page")).toHaveCount(2);
		const out = await runTool(page);
		expect(out.name).toBe("sample (organized).pdf");
		const pages = await texts(out.bytes);
		expect(pages.map((p) => p.text.match(/page (\d) of 3/)?.[1])).toEqual([
			"3",
			"1",
		]);
		expect(pages.map((p) => p.rotate)).toEqual([90, 0]);
		// Back leaves the tool, then the tools, back to the document.
		await page.getByTestId("tools-back").click();
		await expect(page.getByTestId("tool-organize")).toBeVisible();
		await page.getByTestId("tools-back").click();
		await expect(page.getByTestId("tools")).toHaveCount(0);
		await expect(page.getByTestId("pdf-scroll")).toBeVisible();
	});

	test("replacing an organized PDF clears the old page order and selection", async ({
		page,
	}) => {
		await boot(page);
		await openTool(page, "organize");
		await addFile(page, "sample.pdf");
		await expect(page.getByTestId("tool-page")).toHaveCount(3);
		await page.getByTestId("tool-page").nth(2).click();
		await page.getByTestId("tool-delete").click();
		await expect(page.getByTestId("tool-page")).toHaveCount(2);
		await page.getByRole("button", { name: "Reset pages" }).click();
		await expect(page.getByTestId("tool-page")).toHaveCount(3);
		await expect(page.getByTestId("tool-go")).toBeDisabled();
		await page.getByTestId("tool-page").nth(2).click();
		await page.getByTestId("tool-turn-right").click();
		await page.getByTestId("tool-file-remove").click();
		await addFile(page, "features/form.pdf");
		await expect(page.getByTestId("tool-page")).toHaveCount(2);
		await expect(page.getByTestId("tool-page").first()).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await expect(page.getByTestId("tool-turn-right")).toBeDisabled();
		await expect(page.getByTestId("tool-go")).toBeDisabled();
	});

	test("pages are extracted, or split one to a file", async ({ page }) => {
		await boot(page);
		await openTool(page, "extract");
		await addFile(page, "sample.pdf");
		await page.getByTestId("tool-pages-field").fill("9");
		await expect(page.getByTestId("tool-go")).toBeDisabled();
		await expect(page.getByText("The document has 3 pages")).toBeVisible();
		await page.getByTestId("tool-pages-field").fill("3, 1");
		const some = await runTool(page);
		expect(
			(await texts(some.bytes)).map((p) => p.text.match(/page (\d)/)?.[1]),
		).toEqual(["3", "1"]);
		await page.getByTestId("tool-pages-field").fill("");
		await page.getByTestId("tool-each").check();
		const all = await runTool(page);
		expect(all.name).toBe("sample (pages).zip");
		const { unzipSync } = await import("fflate");
		const parts = unzipSync(all.bytes);
		expect(Object.keys(parts).sort()).toEqual([
			"sample - page 1.pdf",
			"sample - page 2.pdf",
			"sample - page 3.pdf",
		]);
		expect((await texts(parts["sample - page 2.pdf"]))[0].text).toContain(
			"page 2 of 3",
		);
	});

	test("pictures become a PDF, and a PDF becomes pictures", async ({
		page,
	}) => {
		await boot(page);
		await openTool(page, "images");
		await addFile(page, "sample.png");
		await addFile(page, "features/photo.jpg");
		await addFile(page, "features/photo.avif");
		const made = await runTool(page);
		expect(made.name).toBe("sample (pictures).pdf");
		const doc = await PDFDocument.load(made.bytes);
		expect(doc.getPageCount()).toBe(3);
		// A4, turned to suit each picture: the sample is wide.
		const { width, height } = doc.getPage(0).getSize();
		expect([Math.round(width), Math.round(height)]).toEqual([842, 595]);

		await page.getByTestId("tools-back").click();
		await page.getByTestId("tool-pictures").click();
		await addFile(page, "sample.pdf");
		const shots = await runTool(page);
		expect(shots.name).toBe("sample (pictures).zip");
		const { unzipSync } = await import("fflate");
		const jpegs = Object.values(unzipSync(shots.bytes));
		expect(jpegs).toHaveLength(3);
		expect([jpegs[0][0], jpegs[0][1]]).toEqual([0xff, 0xd8]);
	});

	test("page numbers and a watermark", async ({ page }) => {
		await boot(page);
		await openTool(page, "numbers");
		await addFile(page, "sample.pdf");
		await expect(page.getByTestId("tool-style-of")).toHaveText("Page 1 of 9");
		await page.getByTestId("tool-style-of").click();
		const numbered = await texts((await runTool(page)).bytes);
		expect(numbered[2].text).toContain("Page 3 of 3");

		await page.getByTestId("tools-back").click();
		await page.getByTestId("tool-watermark").click();
		await addFile(page, "sample.pdf");
		await page.getByTestId("tool-mark").fill("CONFIDENTIAL");
		const marked = await texts((await runTool(page)).bytes);
		expect(marked.every((p) => p.text.includes("CONFIDENTIAL"))).toBe(true);
	});

	test("a password is added, and taken off again", async ({ page }) => {
		await boot(page);
		await openTool(page, "protect");
		await addFile(page, "sample.pdf");
		await page.getByTestId("tool-new-password").fill("wren-42");
		await page.getByTestId("tool-new-password-again").fill("wren-43");
		await expect(page.getByTestId("tool-go")).toBeDisabled();
		await page.getByTestId("tool-new-password-again").fill("wren-42");
		const locked = await runTool(page);
		expect(locked.name).toBe("sample (locked).pdf");
		await expect(texts(locked.bytes)).rejects.toThrow();
		expect(await texts(locked.bytes, "wren-42")).toHaveLength(3);

		await page.getByTestId("tools-back").click();
		await page.getByTestId("tool-unlock").click();
		await nextPick(page, locked.bytes, "sample (locked).pdf");
		await page.getByTestId("tool-add").click();
		await page.getByTestId("tool-password").fill("nope");
		await page.getByTestId("tool-unlock").click();
		await expect(page.getByText("That password didn't work")).toBeVisible();
		await page.getByTestId("tool-password").fill("wren-42");
		await page.getByTestId("tool-unlock").click();
		await expect(page.getByTestId("tool-file")).toHaveCount(1);
		const open = await runTool(page);
		expect(
			(await texts(open.bytes)).map((p) => p.text.match(/page (\d)/)?.[1]),
		).toEqual(["1", "2", "3"]);
	});

	test("several pictures come in at once, sort by name, and make a PDF in that order", async ({
		page,
	}) => {
		await boot(page);
		await openTool(page, "images");
		// Wider pictures are later: the width shows which page is which.
		const wide = (name: string, px: number) => ({
			name,
			bytes: solidPng(px, 40),
		});
		await nextPicks(page, [
			wide("Scan 10.png", 160),
			wide("Scan 2.png", 80),
			wide("scan 1.png", 40),
			wide("Scan 3.png", 120),
		]);
		await page.getByTestId("tool-add").click();
		// In the order the picker gave them, none of them lost.
		await expect(listed(page)).toHaveText([
			"Scan 10.png",
			"Scan 2.png",
			"scan 1.png",
			"Scan 3.png",
		]);
		await expect(page.getByTestId("tool-add")).toHaveText("Add pictures");
		// Sorted as a person reads: 2 before 10, whatever the case.
		await page.getByTestId("tool-files-sort").click();
		await expect(listed(page)).toHaveText([
			"scan 1.png",
			"Scan 2.png",
			"Scan 3.png",
			"Scan 10.png",
		]);
		// Moved, and one taken away.
		await page
			.getByTestId("tool-file")
			.first()
			.getByRole("button", { name: "Move down" })
			.click();
		await page.getByRole("button", { name: "Remove Scan 10.png" }).click();
		await expect(listed(page)).toHaveText([
			"Scan 2.png",
			"scan 1.png",
			"Scan 3.png",
		]);
		await page.getByTestId("tool-paper-fit").click();
		const made = await runTool(page);
		expect(made.name).toBe("Scan 2 (pictures).pdf");
		const doc = await PDFDocument.load(made.bytes);
		expect(doc.getPageCount()).toBe(3);
		// 96 pixels to the inch, as points: 80, 40 and 120 pixels wide.
		expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([
			60, 30, 90,
		]);
	});

	test("a file that is not a PDF is said and skipped, the rest of the pick still comes in", async ({
		page,
	}) => {
		await boot(page);
		await openTool(page, "merge");
		await nextPicks(page, [
			fixtureFile("sample.pdf"),
			fixtureFile("sample.txt"),
			fixtureFile("features/form.pdf"),
			fixtureFile("features/pictures.pdf"),
		]);
		await page.getByTestId("tool-add").click();
		await expect(page.getByTestId("toast")).toContainText(
			"sample.txt isn't a PDF",
		);
		await expect(listed(page)).toHaveText([
			"sample.pdf",
			"form.pdf",
			"pictures.pdf",
		]);
		await expect(page.getByText("8 pages in all")).toBeVisible();
		const out = await runTool(page);
		expect(out.name).toBe("sample (merged).pdf");
		const pages = await texts(out.bytes);
		expect(pages).toHaveLength(8);
		expect(pages[0].text).toContain("Paperwren test page 1 of 3");
		expect(pages[2].text).toContain("Paperwren test page 3 of 3");
		expect(pages[3].text).not.toContain("Paperwren test page");
		expect(pages[5].text).not.toContain("Paperwren test page");
	});

	test("a protected PDF in a pick asks for its password, and can be skipped or tried again", async ({
		page,
	}) => {
		await boot(page);
		await openTool(page, "merge");
		await nextPicks(page, [
			fixtureFile("sample.pdf"),
			fixtureFile("viewer-regressions/locked.pdf"),
			fixtureFile("features/form.pdf"),
		]);
		await page.getByTestId("tool-add").click();
		await expect(page.getByText("Enter the password for")).toBeVisible();
		// Cancelled: that one is left out, the one after it still comes in.
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(listed(page)).toHaveText(["sample.pdf", "form.pdf"]);
		await expect(page.getByTestId("tool-add")).toHaveText("Add PDFs");

		await nextPicks(page, [fixtureFile("viewer-regressions/locked.pdf")]);
		await page.getByTestId("tool-add").click();
		await page.getByTestId("tool-password").fill("sparrow");
		await page.getByTestId("tool-unlock").click();
		await expect(page.getByText("That password didn't work")).toBeVisible();
		await page.getByTestId("tool-password").fill("wren");
		await page.getByTestId("tool-unlock").click();
		await expect(listed(page)).toHaveText([
			"sample.pdf",
			"form.pdf",
			"locked.pdf",
		]);
		await expect(page.getByText("7 pages in all")).toBeVisible();
		const pages = await texts((await runTool(page)).bytes);
		expect(pages).toHaveLength(7);
		expect(pages[5].text).toContain("Locked fixture, page 1");
	});

	test("a cancelled pick changes nothing, and one pick adds no more than 200", async ({
		page,
	}) => {
		await boot(page);
		await openTool(page, "images");
		await nextPicks(page, [
			{ name: "one.png", bytes: solidPng(8, 8) },
			{ name: "two.png", bytes: solidPng(8, 8) },
		]);
		await page.getByTestId("tool-add").click();
		await expect(page.getByTestId("tool-file")).toHaveCount(2);
		// Cancelled: the list stays, and the button can be used again.
		await nextPicks(page, []);
		await page.getByTestId("tool-add").click();
		await expect(page.getByTestId("tool-add")).toBeEnabled();
		await expect(listed(page)).toHaveText(["one.png", "two.png"]);

		// What the button said while the files came in.
		await page.evaluate(() => {
			const seen: string[] = [];
			(window as unknown as { seen: string[] }).seen = seen;
			new MutationObserver(() => {
				const text = document.querySelector(
					'[data-testid="tool-add"]',
				)?.textContent;
				if (text) seen.push(text.trim());
			}).observe(document.body, {
				subtree: true,
				childList: true,
				characterData: true,
			});
		});
		const tiny = solidPng(1, 1);
		await nextPicks(
			page,
			Array.from({ length: 203 }, (_, i) => ({
				name: `page ${i + 1}.png`,
				bytes: tiny,
			})),
		);
		await page.getByTestId("tool-add").click();
		await expect(page.getByTestId("toast")).toContainText(
			"Only the first 200 were added",
		);
		await expect(page.getByTestId("tool-file")).toHaveCount(202, {
			timeout: 30_000,
		});
		await expect(page.getByTestId("tool-add")).toHaveText("Add pictures");
		await expect(listed(page).last()).toHaveText("page 200.png");
		const seen = await page.evaluate(
			() => (window as unknown as { seen: string[] }).seen,
		);
		expect(seen).toContain("Adding 200 of 200…");
	});

	/** A PDF of `pages` pages, each a large photo-like picture: soft
	 * colour with a little grain, stored packed but not as a JPEG. */
	async function photoPdf(pages: number) {
		const doc = await PDFDocument.create();
		const [w, h] = [1200, 900];
		let seed = 7;
		for (let p = 0; p < pages; p++) {
			const rgb = new Uint8Array(w * h * 3);
			for (let y = 0, i = 0; y < h; y++)
				for (let x = 0; x < w; x++, i += 3) {
					seed = (seed * 1103515245 + 12345) >>> 0;
					const grain = (seed >>> 28) - 8;
					rgb[i] = (x * 200) / w + 30 + grain;
					rgb[i + 1] = (y * 180) / h + 40 + grain;
					rgb[i + 2] = ((x + y + p * 300) % 255) * 0.6 + grain;
				}
			const ref = doc.context.register(
				doc.context.stream(deflateSync(rgb), {
					Type: "XObject",
					Subtype: "Image",
					Width: w,
					Height: h,
					BitsPerComponent: 8,
					ColorSpace: "DeviceRGB",
					Filter: "FlateDecode",
				}),
			);
			const page = doc.addPage([600, 450]);
			const name = page.node.newXObject("Photo", ref);
			page.pushOperators(
				pushGraphicsState(),
				concatTransformationMatrix(600, 0, 0, 450, 0, 0),
				drawObject(name),
				popGraphicsState(),
			);
		}
		return doc.save();
	}

	test("compress aims under a size and keeps every page", async ({ page }) => {
		test.setTimeout(120_000);
		await boot(page);
		await openTool(page, "compress");
		const photos = await photoPdf(2);
		expect(photos.length).toBeGreaterThan(2_000_000);
		await addFile(page, photos, "photos.pdf");
		await page.getByTestId("compress-size-200k").click();
		await expect(page.getByTestId("compress-size-200k")).toHaveAttribute(
			"aria-checked",
			"true",
		);
		const small = await runTool(page);
		expect(small.name).toBe("photos (compressed).pdf");
		expect(small.bytes.length).toBeLessThanOrEqual(200_000);
		expect((await PDFDocument.load(small.bytes)).getPageCount()).toBe(2);
		await expect(page.getByTestId("compress-outcome")).toContainText("smaller");
		// A size typed in, in megabytes: a larger copy, still under it.
		await page.getByTestId("compress-typed").fill("1.5");
		await page.getByTestId("compress-unit").selectOption("mb");
		await expect(page.getByTestId("compress-size-200k")).toHaveAttribute(
			"aria-checked",
			"false",
		);
		const typed = await runTool(page);
		expect(typed.bytes.length).toBeLessThanOrEqual(1_500_000);
		expect(typed.bytes.length).toBeGreaterThan(small.bytes.length);
		expect((await PDFDocument.load(typed.bytes)).getPageCount()).toBe(2);
	});
});

test("a long file name does not stretch fill & sign past a narrow phone", async ({
	page,
}) => {
	await page.setViewportSize({ width: 360, height: 780 });
	await boot(page);
	await openFixture(
		page,
		"features/form.pdf",
		"Документы_для_подписи_заявление_на_получение_пособия_2026_окончательная_версия.pdf",
	);
	await expect(page.getByTestId("pdf-page")).toHaveText("1 / 2", {
		timeout: 20_000,
	});
	await page.getByTestId("file-more").click();
	await page.getByTestId("pdf-fill-sign").click();
	const editor = page.getByTestId("fill-sign");
	await expect(editor.getByTestId("fill-field")).toHaveCount(5);
	expect(
		await editor.evaluate((el) => el.scrollWidth - el.clientWidth),
	).toBeLessThanOrEqual(0);
	const save = await page.getByTestId("fill-save").boundingBox();
	expect((save?.x ?? 999) + (save?.width ?? 0)).toBeLessThanOrEqual(360);
});

test("fill & sign starts from the tools too", async ({ page }) => {
	await boot(page);
	await openTool(page, "sign");
	await expect(page.getByTestId("tool-go")).toHaveCount(0);
	await addFile(page, "features/form.pdf");
	await page.getByTestId("tool-go").click();
	const editor = page.getByTestId("fill-sign");
	await expect(editor.getByTestId("fill-field")).toHaveCount(5);
	await editor.getByLabel("fullname").fill("Lena");
	const saved = await saveCopy(page);
	expect(saved.name).toBe("form (filled in).pdf");
	expect(
		(await PDFDocument.load(saved.bytes))
			.getForm()
			.getTextField("fullname")
			.getText(),
	).toBe("Lena");
});

test("editor keeps window controls separate and nested dialogs keep keyboard focus", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await boot(page, {}, "?desktop&frame");
	await openTool(page, "sign");
	await addFile(page, "features/form.pdf");
	await page.getByTestId("tool-go").click();
	const editor = page.getByTestId("fill-sign");
	await expect(editor.getByTestId("fill-field")).toHaveCount(5);
	const save = await page.getByTestId("fill-save").boundingBox();
	const controls = await page.getByTestId("window-controls").boundingBox();
	if (!save || !controls) throw new Error("Missing Save or window controls");
	expect(save.x + save.width).toBeLessThanOrEqual(controls.x);
	await expect(page.locator("#root")).toHaveAttribute("inert", "");
	await editor.getByLabel("fullname").fill("Ayesha");
	await page.getByTestId("fill-save").click();
	await expect(page.getByTestId("fill-save-ask")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("fill-save-ask")).toHaveCount(0);
	await expect(page.getByTestId("fill-leave")).toHaveCount(0);
	await expect(editor).toBeVisible();
	await expect(page.locator("#root")).toHaveAttribute("inert", "");
	await expect(page.getByTestId("fill-save")).toBeFocused();
	// The ink for text and marks is one stop on the way to the page.
	await page.keyboard.press("Tab");
	await expect(page.getByTestId("fill-ink-blue")).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByTestId("fill-ink-black")).toBeFocused();
	await expect(page.getByTestId("fill-ink-black")).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await page.keyboard.press("Tab");
	await expect(editor.getByLabel("fullname")).toBeFocused();
	await page.getByTestId("fill-close").focus();
	await page.keyboard.press("Shift+Tab");
	await expect(editor.getByTestId("fill-sign-here")).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(page.getByTestId("fill-close")).toBeFocused();
});

test("kept signatures can be forgotten in Settings", async ({ page }) => {
	await boot(page, {
		signatures_v1: [
			{ id: "s1", src: "data:image/png;base64,iVBORw0KGgo=", w: 10, h: 4 },
		],
	});
	await page.getByTestId("open-settings").click();
	const forget = page.getByTestId("clear-signatures");
	await expect(forget).toContainText("1 signature or initials");
	await forget.click();
	await expect(forget).toBeDisabled();
	await expect(page.getByText("Signatures forgotten")).toBeVisible();
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(forget).toBeEnabled();
});

/** Hand the next digital ID picked a fixture of fixtures/digital-id. */
async function nextDigitalId(page: Page, fixture: string) {
	const b64 = readFileSync(`fixtures/digital-id/${fixture}`).toString("base64");
	await page.evaluate(
		({ b64, name }) => {
			const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestDigitalId = new File([data], name);
		},
		{ b64, name: fixture },
	);
}

/** The PDF's text as bytes, for finding its dictionaries. */
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** Every /ByteRange in the file, as numbers. */
function byteRanges(bytes: Uint8Array) {
	return [
		...latin1(bytes).matchAll(
			/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g,
		),
	].map((m) => m.slice(1, 5).map(Number));
}

/** Choose a digital ID in Fill & sign: a wrong password first, then the
 * right one, and the summary of whose it is. */
async function chooseDigitalId(page: Page, fixture = "rsa-aes256.p12") {
	await nextDigitalId(page, fixture);
	await page.getByTestId("fill-tool-digital").click();
	const password = page.getByTestId("digital-id-password");
	await expect(password).toBeVisible();
	await expect(
		page.getByText(`Enter the password for “${fixture}”.`),
	).toBeVisible();
	await password.fill("sparrow");
	await page.getByTestId("digital-id-unlock").click();
	await expect(
		page.getByText("That password didn't work. Try again."),
	).toBeVisible();
	await expect(password).toHaveValue("");
	await password.fill("wren");
	await page.getByTestId("digital-id-unlock").click();
	const summary = page.getByTestId("digital-id-summary");
	await expect(summary).toBeVisible();
	await expect(page.getByTestId("digital-id-name")).toHaveText(
		"Test Signer rsa",
	);
	await expect(page.getByTestId("digital-id-issuer")).toContainText(
		"Paperwren Test CA",
	);
	await expect(page.getByTestId("digital-id-valid")).toContainText("2045");
	await expect(page.getByTestId("digital-id-warning")).toHaveCount(0);
	await expect(summary).toContainText(
		"Whether the signature is trusted is decided by the app that opens the PDF, not by Paperwren.",
	);
	await expect(summary).toContainText("There's no timestamp");
	return summary;
}

async function openForm(page: Page, fixture = "features/form.pdf") {
	await page.setViewportSize({ width: 1280, height: 800 });
	await boot(page, {}, "?desktop");
	await openTool(page, "sign");
	await addFile(page, fixture);
	await page.getByTestId("tool-go").click();
	const editor = page.getByTestId("fill-sign");
	await expect(editor).toBeVisible();
	return editor;
}

// Fixme until the signing library (src/lib/sign, branch digital-id) and its fixtures are merged.
test.describe.fixme("sign with a digital ID", () => {
	test("an invisible signature is added to a copy, and the file opened stays as it was", async ({
		page,
	}) => {
		const original = readFileSync("fixtures/features/form.pdf");
		const editor = await openForm(page);
		await editor.getByLabel("fullname").fill("Ayesha Khan");
		await chooseDigitalId(page);
		await page.getByTestId("digital-id-invisible").click();
		await page.getByTestId("digital-id-continue").click();
		await expect(page.getByTestId("fill-hint")).toHaveText(
			"Your digital signature will be added when you save.",
		);
		await expect(page.getByTestId("fill-save")).toHaveText(
			"Save a signed copy",
		);
		await page.getByTestId("fill-save").click();
		await expect(page.getByTestId("fill-signed-as")).toContainText(
			"Signed as Test Signer rsa.",
		);
		const download = page.waitForEvent("download");
		await page.getByTestId("fill-save-go").click();
		const file = await download;
		const bytes = new Uint8Array(readFileSync(await file.path()));
		expect(file.suggestedFilename()).toBe("form (signed).pdf");
		const text = latin1(bytes);
		expect(text).toMatch(/\/Type\s*\/Sig\b/);
		expect(text).toContain("/SubFilter /ETSI.CAdES.detached");
		expect(text).toMatch(/\/Rect\s*\[\s*0\s+0\s+0\s+0\s*\]/);
		// One signature, over the whole file but its own contents.
		const ranges = byteRanges(bytes);
		expect(ranges).toHaveLength(1);
		const [start, a, b, rest] = ranges[0];
		expect(start).toBe(0);
		expect(b + rest).toBe(bytes.length);
		expect(text.slice(a, b)).toMatch(/^<[0-9a-fA-F]+>$/);
		// The form was filled in on the way.
		expect(
			(await PDFDocument.load(bytes))
				.getForm()
				.getTextField("fullname")
				.getText(),
		).toBe("Ayesha Khan");
		// The ID is let go once the copy is saved, and the file opened is
		// the same bytes as before.
		expect(readFileSync("fixtures/features/form.pdf").equals(original)).toBe(
			true,
		);
		expect(latin1(new Uint8Array(original))).not.toContain("/ByteRange");
	});

	test("a visible signature goes in the form's signature field with its caption", async ({
		page,
	}) => {
		const editor = await openForm(page);
		await chooseDigitalId(page);
		await expect(page.getByTestId("digital-id-visible")).toHaveAttribute(
			"aria-checked",
			"true",
		);
		await page.getByTestId("digital-id-continue").click();
		// No signature kept yet: the pad makes one.
		await expect(page.getByTestId("signature-pad")).toBeVisible();
		await sign(page);
		await page.getByTestId("signature-done").click();
		await expect(page.getByTestId("fill-hint")).toContainText("Digital ID:");
		await editor.getByTestId("fill-sign-here").click();
		const item = editor.locator(
			'[data-testid="fill-item"][data-kind="digital"]',
		);
		await expect(item).toHaveCount(1);
		await expect(item.getByTestId("fill-digital-caption")).toContainText(
			"Digitally signed by Test Signer rsa",
		);
		await expect(editor.getByTestId("fill-sign-here")).toHaveCount(0);
		const saved = await saveCopy(page);
		expect(saved.name).toBe("form (signed).pdf");
		const text = latin1(saved.bytes);
		expect(text).toContain("/SubFilter /ETSI.CAdES.detached");
		expect(byteRanges(saved.bytes)).toHaveLength(1);
		const doc = await PDFDocument.load(saved.bytes);
		const field = doc.getForm().getSignature("signature");
		const widget = field.acroField.getWidgets()[0];
		expect(widget.getRectangle().width).toBeGreaterThan(0);
		expect(field.acroField.dict.toString()).toMatch(/\/V\s+\d+\s+0\s+R/);
		expect(widget.getNormalAppearance()).toBeTruthy();
	});

	test("a visible signature can be placed anywhere, one at a time", async ({
		page,
	}) => {
		const editor = await openForm(page, "sample.pdf");
		await chooseDigitalId(page, "p256.p12");
		await page.getByTestId("digital-id-continue").click();
		await sign(page);
		await page.getByTestId("signature-done").click();
		const first = await editor.getByTestId("fill-page").first().boundingBox();
		if (!first) throw new Error("no page");
		await page.mouse.click(
			first.x + first.width * 0.5,
			first.y + first.height * 0.8,
		);
		await expect(
			editor.locator('[data-testid="fill-item"][data-kind="digital"]'),
		).toHaveCount(1);
		const saved = await saveCopy(page);
		expect(latin1(saved.bytes)).toContain("/SubFilter /ETSI.CAdES.detached");
		expect(byteRanges(saved.bytes)).toHaveLength(1);
	});

	test("a PDF already signed takes the digital signature alone, after its own bytes", async ({
		page,
	}) => {
		const original = new Uint8Array(
			readFileSync("fixtures/digital-id/signed-once.pdf"),
		);
		const editor = await openForm(page, "digital-id/signed-once.pdf");
		const typed = editor.getByTestId("fill-field").first();
		const hasField = (await typed.count()) > 0;
		if (hasField) await typed.fill("changed");
		await chooseDigitalId(page);
		await page.getByTestId("digital-id-invisible").click();
		await page.getByTestId("digital-id-continue").click();
		// The other tools wait, and a change already made has to go first.
		await expect(editor.getByTestId("fill-tool-text")).toBeDisabled();
		if (hasField) {
			await expect(page.getByTestId("fill-hint")).toContainText(
				"only the digital signature can be added",
			);
			await page.getByTestId("fill-save").click();
			await expect(page.getByTestId("fill-save-go")).toBeDisabled();
			await page.keyboard.press("Escape");
			await typed.evaluate((el: HTMLInputElement) => {
				el.readOnly = false;
			});
			await typed.fill("");
		}
		await page.getByTestId("fill-save").click();
		await expect(page.getByTestId("fill-save-ask")).toContainText(
			"The earlier signature stays valid: only your digital signature is added.",
		);
		const download = page.waitForEvent("download");
		await page.getByTestId("fill-save-go").click();
		const bytes = new Uint8Array(readFileSync(await (await download).path()));
		// Every byte of the signed file is kept as it was; the new
		// signature covers it and what was added after.
		expect(
			Buffer.from(bytes.subarray(0, original.length)).equals(
				Buffer.from(original),
			),
		).toBe(true);
		const ranges = byteRanges(bytes);
		expect(ranges).toHaveLength(2);
		const [, , b, rest] = ranges[1];
		expect(b + rest).toBe(bytes.length);
	});

	test("a digital ID that isn't one, or a PDF locked with a password, is refused plainly", async ({
		page,
	}) => {
		await openForm(page);
		await nextDigitalId(page, "certs-only.p12");
		await page.getByTestId("fill-tool-digital").click();
		await page.getByTestId("digital-id-password").fill("wren");
		await page.getByTestId("digital-id-unlock").click();
		await expect(page.getByTestId("digital-id-problem-text")).toHaveText(
			"This file has a certificate but no private key, so it can't sign. Export it again with the private key included.",
		);
		await page.getByTestId("digital-id-problem-close").click();
		await expect(page.getByTestId("fill-tool-digital")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		await page.getByTestId("fill-close").click();

		// A locked PDF: refused before any digital ID is asked for.
		await page.getByTestId("tools-back").click();
		await openTool(page, "sign");
		await nextPick(page, "viewer-regressions/locked.pdf");
		await page.getByTestId("tool-add").click();
		await page.getByTestId("tool-password").fill("wren");
		await page.getByTestId("tool-unlock").click();
		await expect(page.getByTestId("tool-file")).toHaveCount(1);
		await page.getByTestId("tool-go").click();
		await expect(page.getByTestId("fill-tool-digital")).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		await page.getByTestId("fill-tool-digital").click();
		await expect(
			page.getByText(
				"This PDF is locked with a password. Remove the password first (Remove a password), then sign that copy.",
			),
		).toBeVisible();
		await expect(page.getByTestId("digital-id-password")).toHaveCount(0);
	});
});
