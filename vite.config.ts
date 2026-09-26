import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

export default defineConfig({
	plugins: [react()],
	define: {
		"import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
	},
	clearScreen: false,
	resolve: {
		alias: { "@": path.resolve(__dirname, "./src") },
	},
	css: {
		modules: { localsConvention: "camelCaseOnly" },
	},
	server: {
		port: 1420,
		strictPort: true,
		host: "0.0.0.0",
		watch: { ignored: ["**/src-tauri/**"] },
	},
	worker: { format: "es" },
	build: {
		// Android System WebView and WebView2 are evergreen Chromium;
		// pdf.js 4 needs ES2022 features anyway.
		target: "chrome110",
		minify: process.env.TAURI_DEBUG ? false : "esbuild",
		sourcemap: !!process.env.TAURI_DEBUG,
		chunkSizeWarningLimit: 1500,
	},
});
