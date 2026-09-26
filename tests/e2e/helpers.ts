import { readFileSync } from "node:fs";
import { type Page, expect } from "@playwright/test";

export async function boot(page: Page, storage: Record<string, unknown> = {}) {
	const seeded = { onboarded: true, ...storage };
	await page.addInitScript((entries) => {
		if (sessionStorage.getItem("booted")) return;
		sessionStorage.setItem("booted", "1");
		for (const [k, v] of Object.entries(entries))
			localStorage.setItem(`paperwren.${k}`, JSON.stringify(v));
	}, seeded);
	await page.goto("/");
	await expect(page.getByTestId("home")).toBeVisible();
}

/** Deliver a fixture through the same path the picker uses. */
export async function openFixture(
	page: Page,
	fixture: string,
	name = fixture.split("/").pop() ?? fixture,
) {
	const b64 = readFileSync(`fixtures/${fixture}`).toString("base64");
	await page.evaluate(
		({ b64, name }) => {
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
			window.__paperwrenTestFile = new File([bytes], name);
		},
		{ b64, name },
	);
	await page.getByTestId("open-file").click();
}
