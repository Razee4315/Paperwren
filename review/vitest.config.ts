import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Only the review's own experiments; the app's suite keeps its config.
export default defineConfig({
	root,
	test: {
		environment: "node",
		include: ["review/**/*.test.ts"],
		testTimeout: 120_000,
	},
});
