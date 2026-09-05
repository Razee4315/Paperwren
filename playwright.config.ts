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
		// Pin the host: vite otherwise binds localhost (::1 and 127.0.0.1
		// in an unpredictable order), which made the first test of a run
		// hit ERR_CONNECTION_REFUSED while the readiness probe passed.
		command: "node node_modules/vite/bin/vite.js preview --port 4173 --strictPort --host 127.0.0.1",
		reuseExistingServer: false,
		timeout: 60_000,
	},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
