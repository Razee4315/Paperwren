import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

/**
 * PDF-01/02/05 browser regressions (docs/14 audit section 9):
 * anchored zoom keeps the focal content point under the same client
 * position through toolbar zoom, wheel zoom, and rotation; no preview
 * transform survives a commit; double-tap zoom works through the
 * gesture controller. Anchor drift tolerance: 2 CSS px.
 */

const samplePdf = readFileSync("fixtures/sample.pdf");

async function bootHome(page: Page) {
	await page.addInitScript(() => {
		window.localStorage.setItem("paperwren.onboarded", "true");
		window.localStorage.setItem(
			"paperwren.settings",
			JSON.stringify({ "viewer.chrome_autohide": false }),
		);
	});
	await page.goto("/");
	await expect(page.getByTestId("home")).toBeVisible();
}

async function openPdf(page: Page) {
	const b64 = samplePdf.toString("base64");
	await page.evaluate(
		async (args) => {
			const bytes = Uint8Array.from(atob(args.b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], args.name, {
				type: "application/pdf",
			});
		},
		{ b64, name: "sample.pdf" },
	);
	await page.getByTestId("empty-open-button").click();
	await expect(page.getByTestId("viewer")).toBeVisible({ timeout: 20_000 });
	await expect(page.locator("[data-page='1']")).toBeVisible({
		timeout: 20_000,
	});
}

/** Vertically center page N in the scroller. */
async function centerPage(page: Page, n: number) {
	await page.evaluate((n) => {
		const scroller = document.querySelector<HTMLElement>(
			"[data-testid='pdf-scroll']",
		);
		const node = document.querySelector<HTMLElement>(`[data-page='${n}']`);
		if (!scroller || !node) throw new Error("missing scroller or page");
		const s = scroller.getBoundingClientRect();
		const r = node.getBoundingClientRect();
		scroller.scrollTop += r.top + r.height / 2 - (s.top + s.height / 2);
	}, n);
}

/**
 * Client position of page N's content fraction (fx, fy) — the point
 * that was under the viewport center when captured.
 */
async function clientPointOfFraction(
	page: Page,
	n: number,
	fraction: { fx: number; fy: number },
) {
	return page.evaluate(
		({ n, fraction }) => {
			const node = document.querySelector<HTMLElement>(`[data-page='${n}']`);
			if (!node) throw new Error("missing page");
			const r = node.getBoundingClientRect();
			return {
				x: r.left + fraction.fx * r.width,
				y: r.top + fraction.fy * r.height,
			};
		},
		{ n, fraction },
	);
}

async function fractionUnderCenter(page: Page, n: number) {
	return page.evaluate((n) => {
		const scroller = document.querySelector<HTMLElement>(
			"[data-testid='pdf-scroll']",
		);
		const node = document.querySelector<HTMLElement>(`[data-page='${n}']`);
		if (!scroller || !node) throw new Error("missing scroller or page");
		const s = scroller.getBoundingClientRect();
		const r = node.getBoundingClientRect();
		return {
			fx: (s.left + s.width / 2 - r.left) / r.width,
			fy: (s.top + s.height / 2 - r.top) / r.height,
		};
	}, n);
}

async function assertNoResidualTransform(page: Page) {
	const transform = await page.evaluate(() => {
		const pages = document.querySelector<HTMLElement>("div[class*='Pages']");
		return pages?.style.transform ?? "";
	});
	expect(transform).toBe("");
}

test("toolbar zoom keeps the focal point under the viewport center", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openPdf(page);

	// Read mid-document, away from scroll boundaries.
	await centerPage(page, 2);
	const before = await fractionUnderCenter(page, 2);
	const center = await page.evaluate(() => {
		const s = document
			.querySelector<HTMLElement>("[data-testid='pdf-scroll']")
			?.getBoundingClientRect();
		return {
			x: (s?.left ?? 0) + (s?.width ?? 0) / 2,
			y: (s?.top ?? 0) + (s?.height ?? 0) / 2,
		};
	});

	await page.getByTestId("pdf-zoom-in").click();
	await expect(page.getByTestId("pdf-fit-pill")).not.toHaveText("Fit width");
	await page.getByTestId("pdf-zoom-in").click();

	const after = await clientPointOfFraction(page, 2, before);
	expect(Math.abs(after.x - center.x)).toBeLessThanOrEqual(2);
	expect(Math.abs(after.y - center.y)).toBeLessThanOrEqual(2);
	await assertNoResidualTransform(page);

	// And zoom back out through the same point.
	await page.getByTestId("pdf-zoom-out").click();
	await page.getByTestId("pdf-zoom-out").click();
	const restoredPoint = await clientPointOfFraction(page, 2, before);
	expect(Math.abs(restoredPoint.x - center.x)).toBeLessThanOrEqual(2);
	expect(Math.abs(restoredPoint.y - center.y)).toBeLessThanOrEqual(2);
	await assertNoResidualTransform(page);
});

test("Ctrl+wheel zooms the document without scrolling the page", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openPdf(page);
	await centerPage(page, 2);

	const pill = page.getByTestId("pdf-fit-pill");
	const before = await pill.textContent();

	const cursor = { x: 206, y: 450 };
	await page.mouse.move(cursor.x, cursor.y);
	// Content fraction under the cursor before the zoom.
	const fraction = await page.evaluate(
		({ cx, cy }) => {
			const scroller = document.querySelector<HTMLElement>(
				"[data-testid='pdf-scroll']",
			);
			if (!scroller) throw new Error("missing scroller");
			const nodes = [...scroller.querySelectorAll<HTMLElement>("[data-page]")];
			const node = nodes.find((el) => {
				const r = el.getBoundingClientRect();
				return cy >= r.top && cy <= r.bottom;
			});
			if (!node) throw new Error("cursor not over a page");
			const r = node.getBoundingClientRect();
			return {
				page: Number(node.dataset.page),
				fx: (cx - r.left) / r.width,
				fy: (cy - r.top) / r.height,
			};
		},
		{ cx: cursor.x, cy: cursor.y },
	);

	await page.keyboard.down("Control");
	await page.mouse.wheel(0, -240);
	await page.keyboard.up("Control");

	await expect
		.poll(async () => pill.textContent(), { timeout: 5_000 })
		.not.toBe(before);

	// The content point under the cursor stays under the cursor.
	const after = await clientPointOfFraction(page, fraction.page, {
		fx: fraction.fx,
		fy: fraction.fy,
	});
	expect(Math.abs(after.x - cursor.x)).toBeLessThanOrEqual(2);
	expect(Math.abs(after.y - cursor.y)).toBeLessThanOrEqual(2);
});

test.describe("double-tap", () => {
	test.use({ hasTouch: true });

	test("double-tap on the page cycles fit mode through the gesture controller", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await bootHome(page);
		await page.setViewportSize({ width: 412, height: 915 });
		await openPdf(page);
		await centerPage(page, 2);

		const pill = page.getByTestId("pdf-fit-pill");
		expect(await pill.textContent()).toBe("Fit width");

		// Two quick touch taps: the double-tap path wins over the delayed
		// single-tap chrome toggle (audit PDF-03).
		await page.touchscreen.tap(206, 450);
		await page.touchscreen.tap(206, 450);

		await expect
			.poll(async () => pill.textContent(), { timeout: 5_000 })
			.toBe("Fit page");
		// The chrome must not have been hidden by the first tap's delayed
		// toggle that lost the double-tap race.
		await expect(page.getByTestId("pdf-zoom-in")).toBeVisible();
	});
});

test("rotation keeps the reading point and swaps the page box", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await page.setViewportSize({ width: 412, height: 915 });
	await openPdf(page);
	await centerPage(page, 2);

	const before = await fractionUnderCenter(page, 2);
	const center = await page.evaluate(() => {
		const s = document
			.querySelector<HTMLElement>("[data-testid='pdf-scroll']")
			?.getBoundingClientRect();
		return {
			x: (s?.left ?? 0) + (s?.width ?? 0) / 2,
			y: (s?.top ?? 0) + (s?.height ?? 0) / 2,
		};
	});
	const boxBefore = await page.evaluate(() => {
		const r = document
			.querySelector<HTMLElement>("[data-page='2']")
			?.getBoundingClientRect();
		return { w: r?.width ?? 0, h: r?.height ?? 0 };
	});

	await page.getByTestId("pdf-more-tools").click();
	await page
		.getByRole("button", { name: "Rotate clockwise" })
		.click({ timeout: 10_000 });

	// Page box swapped orientation (fit-width fills the width in both
	// orientations, so height changes).
	const boxAfter = await page.evaluate(() => {
		const r = document
			.querySelector<HTMLElement>("[data-page='2']")
			?.getBoundingClientRect();
		return { w: r?.width ?? 0, h: r?.height ?? 0 };
	});
	expect(boxAfter.w).toBeCloseTo(boxBefore.w, 0);
	expect(boxAfter.h).toBeLessThan(boxBefore.h - 50);

	// The same content point is still under the viewport center.
	const after = await clientPointOfFraction(page, 2, before);
	expect(Math.abs(after.x - center.x)).toBeLessThanOrEqual(2);
	expect(Math.abs(after.y - center.y)).toBeLessThanOrEqual(2);
	await assertNoResidualTransform(page);
});

test.describe("wide-page fit conversion (audit PDF-02)", () => {
	test.use({ hasTouch: true });

	const widePdf = readFileSync("fixtures/viewer-regressions/wide-fit.pdf");

	test("converting fit to manual preserves a fit scale far below 0.5", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await bootHome(page);
		await page.setViewportSize({ width: 412, height: 915 });
		const b64 = widePdf.toString("base64");
		await page.evaluate(
			async (args) => {
				const bytes = Uint8Array.from(atob(args.b64), (c) => c.charCodeAt(0));
				window.__paperwrenTestFile = new File([bytes], args.name, {
					type: "application/pdf",
				});
			},
			{ b64, name: "wide-fit.pdf" },
		);
		await page.getByTestId("empty-open-button").click();
		await expect(page.locator("[data-page='1']")).toBeVisible({
			timeout: 20_000,
		});

		// Fit-width on a 1200pt-wide page in ~380px: scale ~0.317.
		const pageWidth = await page.evaluate(
			() =>
				document
					.querySelector<HTMLElement>("[data-page='1']")
					?.getBoundingClientRect().width ?? 0,
		);
		expect(pageWidth).toBeGreaterThan(300);

		// Double-tap cycles fit -> page -> none in two steps; from
		// fit-page the conversion must keep the page's honest scale, so
		// the page box stays close to its fit size (NOT clamped to the
		// old 0.5 minimum, which would blow it up to 400+ px height-wise
		// and 600px width-wise for this page).
		await page.touchscreen.tap(206, 450);
		await page.touchscreen.tap(206, 450);
		await expect(page.getByTestId("pdf-fit-pill")).toHaveText("Fit page", {
			timeout: 5_000,
		});
		await page.touchscreen.tap(206, 450);
		await page.touchscreen.tap(206, 450);
		await expect(page.getByTestId("pdf-fit-pill")).toHaveText(/^32%|31%|33%$/, {
			timeout: 5_000,
		});
	});
});
