/**
 * Screenshot every screen on an emulated phone (touch, DPR 2).
 * Usage: node scripts/mobile-shots.mjs [baseUrl] [outDir]
 * Needs @playwright/test (npm i --no-save @playwright/test).
 */
import { readFileSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:1420";
const out = process.argv[3] ?? "mobile-shots";
const browser = await chromium.launch({
	executablePath: process.env.PW_CHROMIUM || undefined,
});

async function run(theme) {
	const ctx = await browser.newContext({
		...devices["Pixel 7"],
		colorScheme: theme === "dark" ? "dark" : "light",
	});
	const page = await ctx.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	const shot = (n) => page.screenshot({ path: `${out}/${theme}-${n}.png` });
	await page.goto(base);
	// First run: the welcome.
	await page.waitForSelector("[data-testid=onboarding]");
	for (let i = 0; i < 4; i++) {
		await page.waitForTimeout(1300);
		await shot(`00-onboarding-${i + 1}`);
		if (i < 3) await page.getByTestId("onboarding-next").tap();
	}
	await page
		.getByTestId(theme === "dark" ? "theme-aurora" : "theme-glass")
		.tap();
	await page.waitForTimeout(700);
	await shot("00-onboarding-5-picked");
	await page.getByTestId(theme === "dark" ? "theme-dark" : "theme-light").tap();
	await page.getByTestId("onboarding-next").tap();
	await page.waitForTimeout(350);
	await shot("00-onboarding-6-confetti");
	await page.waitForSelector("[data-testid=onboarding]", { state: "detached" });
	await page.waitForTimeout(900);
	await shot("01-home-empty");
	const open = async (f) => {
		const b64 = readFileSync(`fixtures/${f}`).toString("base64");
		await page.evaluate(
			({ b64, f }) => {
				window.__paperwrenTestFile = new File(
					[Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))],
					f,
				);
			},
			{ b64, f },
		);
		await page.getByTestId("open-file").tap();
		await page.getByTestId("viewer").waitFor();
		await page.waitForTimeout(1400);
	};
	const shots = [
		["sample.pdf", "pdf"],
		["report.docx", "docx"],
		["sample.xlsx", "xlsx"],
		["sample.pptx", "pptx"],
		["sample.doc", "doc"],
		["sample.txt", "txt"],
	];
	for (const [f, n] of shots) {
		await open(f);
		await shot(`02-view-${n}`);
		if (n === "pdf") {
			await page.getByTestId("pdf-find").tap();
			await page.getByTestId("find-input").fill("page");
			await page.waitForTimeout(700);
			await shot("03-pdf-find");
			await page
				.getByTestId("pdf-more")
				.tap()
				.catch(() => {});
			await page.waitForTimeout(500);
			await shot("04-pdf-menu");
			await page.keyboard.press("Escape");
		}
		for (let i = 0; i < 4; i++) {
			const consumed = await page.evaluate(() =>
				window.__paperwrenHandleBack?.(),
			);
			await page.waitForTimeout(250);
			if (!consumed) break;
		}
	}
	await shot("05-home-list");
	await page
		.getByRole("button", { name: /More actions/ })
		.first()
		.tap();
	await page.waitForTimeout(500);
	await shot("06-row-menu");
	await page.keyboard.press("Escape");
	await page.getByTestId("open-settings").tap();
	await page.waitForTimeout(600);
	await shot("07-settings");
	await page.evaluate(() => window.__paperwrenHandleBack?.());
	await open("not-a-document.zip").catch(() => {});
	await page.waitForTimeout(600);
	await shot("08-error");
	if (theme === "light") {
		for (const t of ["paper", "sepia", "glass", "aurora"]) {
			await page.evaluate((t) => {
				const s = JSON.parse(
					localStorage.getItem("paperwren.settings_v2") || "{}",
				);
				localStorage.setItem(
					"paperwren.settings_v2",
					JSON.stringify({ ...s, theme: t }),
				);
			}, t);
			await page.reload();
			await page.waitForSelector("[data-testid=recent]");
			await page.waitForTimeout(900);
			await page.screenshot({ path: `${out}/theme-${t}.png` });
		}
	}
	console.log(theme, "errors:", errors);
	await ctx.close();
}
await run("light");
await run("dark");
await browser.close();
