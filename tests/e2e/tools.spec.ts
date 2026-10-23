import { readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { type Page, expect, test } from "@playwright/test";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { boot, openFixture } from "./helpers";

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
		await field.fill("Quarterly report ");
		await field.press("Enter");
		await expect(page.getByTestId("rename")).toHaveCount(0);
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
		await page.getByTestId("fill-tool-initials").click();
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

	test("initials accept touch strokes and the compact dialog stays reachable in landscape", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 320, height: 568 });
		await boot(page);
		await page.getByTestId("home-tool-sign").click();
		await addFile(page, "features/form.pdf");
		await page.getByTestId("tool-go").click();
		await page.getByTestId("fill-tool-initials").click();
		await page.getByTestId("signature-fullscreen").click();
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
		await page.getByTestId("signature-fullscreen-done").click();
		await page.getByTestId("signature-done").click();
		await expect(page.getByTestId("signature-pad")).toHaveCount(0);
		const kept = await page.evaluate(
			() =>
				JSON.parse(localStorage.getItem("paperwren.signatures_v1") ?? "[]")[0],
		);
		expect(kept.initials).toBe(true);
		expect(Math.max(kept.w, kept.h)).toBeGreaterThan(1000);
	});

	test("a phone signature expands, keeps its shape on rotation, and supports redo", async ({
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
		const compact = await canvas.boundingBox();
		if (!compact) throw new Error("No compact canvas");
		await page.getByTestId("signature-fullscreen").click();
		await expect
			.poll(async () => (await canvas.boundingBox())?.height)
			.toBeGreaterThan(500);
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
		await expect(
			page.getByTestId("signature-fullscreen-done"),
		).toBeInViewport();
		await page.setViewportSize({ width: 360, height: 800 });
		await expect
			.poll(async () => (await canvas.boundingBox())?.height)
			.toBeGreaterThan(500);
		await page.getByTestId("signature-fullscreen-done").click();
		await expect(page.getByTestId("signature-fullscreen")).toBeFocused();
		await expect
			.poll(async () => (await canvas.boundingBox())?.height)
			.toBeCloseTo(compact.height, 0);
		await expect
			.poll(async () => (await inkShape()).ratio)
			.toBeCloseTo(portrait.ratio, 1);
		const small = await inkShape();
		// Repeated expansion cannot progressively shrink the signature.
		await page.getByTestId("signature-fullscreen").click();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("signature-pad")).toBeVisible();
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
		await page.getByTestId("signature-fullscreen").click();
		await sign(page);
		await page.evaluate(() => window.__paperwrenHandleBack?.());
		await expect(page.getByTestId("signature-done")).toBeVisible();
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
