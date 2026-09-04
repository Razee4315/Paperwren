import { defineConfig } from "@playwright/test";

/**
 * Browser integration smoke tests (audit 17.2). Run in CI only:
 *   npm ci
 *   npm install --no-save @playwright/test
 *   npx playwright install chromium --with-deps
 *   npm run build && npx playwright test
 * The app itself is the production build served by `vite preview`.
 */
export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 60_000,
	retries: 1,
	use: {
		baseURL: "http://127.0.0.1:4173",
		viewport: { width: 412, height: 915 },
		trace: "retain-on-failure",
		video: "retain-on-failure",
	},
	webServer: {
		command: "npx vite preview --port 4173 --strictPort",
		reuseExistingServer: false,
		timeout: 60_000,
	},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
