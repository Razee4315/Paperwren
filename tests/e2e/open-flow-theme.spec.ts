import { readFileSync } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

/**
 * docs/15 #2 regression, browser level: changing the theme while a
 * document is open must NOT restart the byte read or the PDF parse.
 *
 * The device symptom was "nothing visibly opens until I change the
 * theme". The confirmed source defect behind it: the recents
 * callbacks depended on the whole settings object, so an appearance
 * change replaced recordOpen — and the viewer's read effect, which
 * depends on recordOpen, cancelled and restarted the read (dropping
 * any in-flight bytes). These specs drive the same
 * update("appearance.theme") path the settings screen uses and
 * assert, through the open-flow trace ring buffer
 * (window.__paperwrenOpenTrace — the same buffer a device bug
 * report would dump), that the pipeline runs exactly once per open
 * and that each open carries its own request id.
 */

const samplePdf = readFileSync("fixtures/sample.pdf");

async function bootHome(page: Page, init?: () => void) {
	await page.addInitScript(() => {
		window.localStorage.setItem("paperwren.onboarded", "true");
	});
	if (init) await page.addInitScript(init);
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

interface TraceCounts {
	readStarts: number;
	readDones: number;
	parseStarts: number;
	parseReadies: number;
	firstPaints: number;
	openIds: number;
}

async function traceCounts(page: Page): Promise<TraceCounts> {
	return page.evaluate(() => {
		const trace = window.__paperwrenOpenTrace?.() ?? [];
		const readStarts = trace.filter((e) => e.event === "read:start");
		return {
			readStarts: readStarts.length,
			readDones: trace.filter((e) => e.event === "read:done").length,
			parseStarts: trace.filter((e) => e.event === "pdf:parse:start").length,
			parseReadies: trace.filter((e) => e.event === "pdf:parse:ready").length,
			firstPaints: trace.filter((e) => e.event === "pdf:first-paint").length,
			openIds: new Set(readStarts.map((e) => e.open)).size,
		};
	});
}

/** Real toolbar visibility, from geometry and inertness. */
async function chromeVisible(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const header = document.querySelector<HTMLElement>("header[data-chrome]");
		if (!header) return false;
		const rect = header.getBoundingClientRect();
		return rect.bottom > 0 && rect.height > 0 && !header.inert;
	});
}

async function tapSurface(page: Page) {
	const box = await page.getByTestId("pdf-scroll").boundingBox();
	if (!box) throw new Error("PDF scroll surface missing");
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** Back to Home from the viewer, tolerating idle autohide: if the
 * toolbar already hid, a touch tap restores it first. */
async function closeViewer(page: Page) {
	if (!(await chromeVisible(page))) {
		await tapSurface(page);
	}
	await page.getByTestId("viewer-back").click();
	await expect(page.getByTestId("home")).toBeVisible();
}

test("theme change while a document is open does not restart the read or parse", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await bootHome(page);
	await openPdf(page);

	// The whole open pipeline ran exactly once for open #1: bytes
	// read, sniffed, parsed, and first RASTER painted. First paint
	// is polled (not assumed): the page box can be laid out slightly
	// before the first raster swap publishes visible content.
	await expect
		.poll(async () => (await traceCounts(page)).firstPaints, {
			timeout: 30_000,
		})
		.toBe(1);
	let counts = await traceCounts(page);
	expect(counts.readStarts).toBe(1);
	expect(counts.readDones).toBe(1);
	expect(counts.parseStarts).toBe(1);
	expect(counts.parseReadies).toBe(1);

	// Leave the viewer mounted on the navigation stack (Back → Home),
	// then change the theme exactly the way the settings screen does.
	await closeViewer(page);
	await page.getByTestId("open-settings").click();
	await page.getByTestId("settings-appearance").click();
	await page.getByTestId("theme-option-light").click();

	// The hidden viewer must NOT have restarted its read: the old
	// settings-coupled recordOpen cancelled and reran it on every
	// appearance change (docs/15 #2).
	counts = await traceCounts(page);
	expect(counts.readStarts).toBe(1);
	expect(counts.parseStarts).toBe(1);
	expect(counts.readDones).toBe(1);

	// Reopen from recents: a SECOND open request — it reads again and
	// carries its own request id in the trace. (The Continue reading
	// card only exists for entries with a saved position; the recents
	// card is always there. The card precedes its actions button in
	// DOM order, so .first() is the card itself.)
	await page.getByTestId("settings-back").click();
	await page.getByTestId("settings-back").click();
	await page.locator("[data-testid^='recent-']").first().click();
	await expect(page.locator("[data-page='1']")).toBeVisible({
		timeout: 20_000,
	});

	counts = await traceCounts(page);
	expect(counts.readStarts).toBe(2);
	expect(counts.openIds).toBe(2);
	expect(counts.parseStarts).toBe(2);
});

test("a theme change during a slow read does not cancel or restart the read", async ({
	page,
}) => {
	test.setTimeout(120_000);
	// Controlled slow read (test hook): the bytes take 20s to arrive,
	// so the theme change below lands while the read is IN FLIGHT —
	// the exact shape of the reported stall window. The theme is
	// changed through the settings' own update() path (test hook):
	// the settings UI is only reachable from Home, but the user's
	// report has the theme changing WHILE the document is opening.
	await bootHome(page, () => {
		window.__paperwrenTestReadDelay = 20_000;
	});

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
	// Loading state: the branded opening page is up while the slowed
	// read runs — the viewer shell only mounts once bytes arrive.
	await expect(page.getByTestId("opening-screen")).toBeVisible({
		timeout: 20_000,
	});
	await expect(page.locator("[data-page='1']")).not.toBeVisible();

	// The theme flips mid-read.
	await page.evaluate(() => {
		window.__paperwrenTestUpdate?.("appearance.theme", "light");
	});

	// Still exactly one open attempt and no completion yet.
	let counts = await traceCounts(page);
	expect(counts.readStarts).toBe(1);
	expect(counts.readDones).toBe(0);

	// The in-flight read completes exactly once — neither cancelled
	// by the appearance change nor duplicated (the old
	// settings-coupled recordOpen restarted it here, throwing away
	// the elapsed wait — docs/15 #2) — then the parse finishes and
	// the document appears without any further interaction. The
	// read/parse boundary races the poll, so wait for the whole
	// pipeline state.
	await expect
		.poll(
			async () => {
				const c = await traceCounts(page);
				return `${c.readDones}:${c.parseStarts}:${c.parseReadies}`;
			},
			{ timeout: 30_000 },
		)
		.toBe("1:1:1");
	counts = await traceCounts(page);
	expect(counts.readStarts).toBe(1);
	expect(counts.openIds).toBe(1);
	await expect(page.locator("[data-page='1']")).toBeVisible({
		timeout: 20_000,
	});
});
