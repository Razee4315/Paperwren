import { readFileSync } from "node:fs";
import { type CDPSession, type Page, expect, test } from "@playwright/test";

/**
 * docs/15 #3 acceptance: real TOUCH input must hide and restore the
 * PDF toolbar through the SAME controller the shell's auto-hide
 * timer owns, and the restored controls must actually work.
 *
 * The regression this guards: PdfViewer called useViewerChrome()
 * above the shell's provider, so it read a silent no-op default —
 * touch taps toggled nothing while auto-hide kept hiding the real
 * toolbar, and once hidden it could never come back on a phone.
 * Mouse-driven tests passed misleadingly (the shell's own content
 * tap handler is mouse-only by design), so every assertion here
 * runs with hasTouch against the REAL header's geometry and inert
 * state, never a mocked callback.
 */

const samplePdf = readFileSync("fixtures/sample.pdf");

test.use({ hasTouch: true });

async function bootHome(page: Page, settings: Record<string, unknown> = {}) {
	await page.addInitScript(
		(args) => {
			window.localStorage.setItem("paperwren.onboarded", "true");
			window.localStorage.setItem(
				"paperwren.settings",
				JSON.stringify(args.settings),
			);
		},
		{ settings },
	);
	await page.goto("/");
	await expect(page.getByTestId("home")).toBeVisible();
}

async function openPdf(page: Page) {
	const b64 = samplePdf.toString("base64");
	await page.evaluate(
		async (args) => {
			const bytes = Uint8Array.from(atob(args.b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], "sample.pdf", {
				type: "application/pdf",
			});
		},
		{ b64 },
	);
	await page.getByTestId("empty-open-button").click();
	await expect(page.getByTestId("viewer")).toBeVisible({ timeout: 20_000 });
	await expect(page.locator("[data-page='1']")).toBeVisible({
		timeout: 20_000,
	});
}

/** The real toolbar's state, from geometry and inertness — not a
 * mock. Hidden = translated off-screen (top bars translate to
 * -101%) or marked inert. */
async function chromeVisible(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const header = document.querySelector<HTMLElement>("header[data-chrome]");
		if (!header) return false;
		const rect = header.getBoundingClientRect();
		return rect.bottom > 0 && rect.height > 0 && !header.inert;
	});
}

async function expectChrome(page: Page, visible: boolean, timeout = 8_000) {
	await expect
		.poll(() => chromeVisible(page), { timeout, interval: 100 })
		.toBe(visible);
}

async function scrollSurfaceCenter(page: Page) {
	const box = await page.getByTestId("pdf-scroll").boundingBox();
	if (!box) throw new Error("PDF scroll surface missing");
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A validated single tap through the gesture controller: real
 * touch input, not a dispatched click. */
async function tapSurface(page: Page) {
	const { x, y } = await scrollSurfaceCenter(page);
	await page.touchscreen.tap(x, y);
}

/** Two taps with controlled timing (the touchscreen.tap round trips
 * are too slow to guarantee the 320ms double-tap window). */
async function doubleTapSurface(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	const { x, y } = await scrollSurfaceCenter(page);
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [{ x, y }],
	});
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [{ x, y }],
	});
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
	await cdp.detach();
}

/** A touch drag well past the pan slop: panning, never a tap. */
async function panSurface(page: Page) {
	const cdp: CDPSession = await page.context().newCDPSession(page);
	const { x, y } = await scrollSurfaceCenter(page);
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [{ x, y }],
	});
	for (let i = 1; i <= 5; i++) {
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [{ x, y: y - i * 18 }],
		});
	}
	await cdp.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
	await cdp.detach();
}

test("auto-hide hides the toolbar and a touch tap restores it, five cycles", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await openPdf(page);

	for (let cycle = 1; cycle <= 5; cycle++) {
		await expectChrome(page, false);
		await tapSurface(page);
		await expectChrome(page, true);
		// The restored toolbar must be genuinely interactive: a touch
		// tap on Search opens the search sheet.
		if (cycle === 5) {
			const search = page.getByTestId("pdf-search");
			const box = await search.boundingBox();
			if (!box) throw new Error("Search button has no bounding box");
			await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
			await expect(page.getByTestId("pdf-search-sheet")).toBeVisible();
		}
	}
});

test("a single tap hides the toolbar and the next tap shows it (auto-hide on)", async ({
	page,
}) => {
	await bootHome(page);
	await openPdf(page);
	// Idle autohide re-arms when the load-time hold lifts, so the
	// settled state after opening is HIDDEN (2.5s after the parse
	// finishes, scroll or not). Wait for it instead of assuming the
	// toolbar is still visible — on a slow cold start it already
	// hid. This also exercises the re-arm-after-hold path itself.
	await expectChrome(page, false);

	await tapSurface(page);
	// Showing is immediate — a hidden toolbar answers on first touch.
	await expectChrome(page, true);
	await tapSurface(page);
	// The hide direction waits out the 280ms double-tap window.
	await expectChrome(page, false);
	await tapSurface(page);
	await expectChrome(page, true);
});

test("tap-to-toggle works with auto-hide disabled (gesture-owned)", async ({
	page,
}) => {
	await bootHome(page, { "viewer.chrome_autohide": false });
	await openPdf(page);
	await expectChrome(page, true);
	// No auto-hide: the toolbar stays put on its own for a while.
	await page.waitForTimeout(3200);
	await expectChrome(page, true);

	await tapSurface(page);
	await expectChrome(page, false);
	await tapSurface(page);
	await expectChrome(page, true);
});

test("a double-tap zooms and does not toggle chrome", async ({ page }) => {
	await bootHome(page, { "viewer.chrome_autohide": false });
	await openPdf(page);
	await expectChrome(page, true);
	const pill = page.getByTestId("pdf-fit-pill");
	expect(await pill.textContent()).toBe("Fit width");

	await doubleTapSurface(page);

	// The fit mode cycled (width -> page) while the toolbar stayed
	// exactly as it was: the double-tap cancelled the pending
	// single-tap chrome toggle.
	await expect(pill).toHaveText("Fit page", { timeout: 10_000 });
	await expectChrome(page, true);
});

test("panning never restores a hidden toolbar and never hides a visible one", async ({
	page,
}) => {
	await bootHome(page, { "viewer.chrome_autohide": false });
	await openPdf(page);
	await expectChrome(page, true);

	await panSurface(page);
	await expectChrome(page, true);

	await tapSurface(page);
	await expectChrome(page, false);
	await panSurface(page);
	await expectChrome(page, false);
});
