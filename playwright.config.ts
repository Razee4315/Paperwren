import { defineConfig } from "@playwright/test";

/**
 * Browser tests against the production build (`vite preview`).
 * CI: npm ci && npm i --no-save @playwright/test &&
 *     npx playwright install chromium --with-deps &&
 *     npm run build && npx playwright test
 * Set PW_CHROMIUM to use a preinstalled Chromium binary instead.
 */
export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 60_000,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL: "http://127.0.0.1:4173",
		viewport: { width: 412, height: 915 },
		trace: "retain-on-failure",
		launchOptions: process.env.PW_CHROMIUM
			? { executablePath: process.env.PW_CHROMIUM }
			: undefined,
	},
	webServer: {
		command:
			"node node_modules/vite/bin/vite.js preview --port 4173 --strictPort --host 127.0.0.1",
		reuseExistingServer: false,
		timeout: 60_000,
	},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
