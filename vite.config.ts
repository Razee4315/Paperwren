import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

/**
 * `public/fixtures` holds sample documents for trying things out on
 * the dev server (it is not in git). Vite copies all of `public` into
 * a build, so a build made on a developer's machine would ship them,
 * megabytes of test files inside the app. They are taken back out.
 */
const dropFixtures = (): Plugin => ({
	name: "paperwren-drop-fixtures",
	apply: "build",
	closeBundle() {
		rmSync(path.resolve(__dirname, "dist/fixtures"), {
			recursive: true,
			force: true,
		});
	},
});

/**
 * pdf.js reads two sets of files while it draws: character maps (for
 * CJK text whose font is named but not embedded) and the standard
 * fonts (for files that rely on the base 14). The app is offline, so
 * they ship with it, under /pdfjs, and are served from the package in
 * development.
 */
const PDF_ASSETS = ["cmaps", "standard_fonts"];
const pdfAssets = (): Plugin => {
	const source = (dir: string) =>
		path.resolve(__dirname, "node_modules/pdfjs-dist", dir);
	return {
		name: "paperwren-pdf-assets",
		configureServer(server) {
			server.middlewares.use("/pdfjs", (req, res, next) => {
				const [, dir, file] = (req.url ?? "").split("?")[0].split("/");
				const wanted =
					PDF_ASSETS.includes(dir) && file && !file.includes("..")
						? path.join(source(dir), decodeURIComponent(file))
						: "";
				if (!wanted || !existsSync(wanted)) return next();
				res.setHeader("Content-Type", "application/octet-stream");
				res.end(readFileSync(wanted));
			});
		},
		closeBundle() {
			if (!existsSync(path.resolve(__dirname, "dist"))) return;
			for (const dir of PDF_ASSETS)
				cpSync(source(dir), path.resolve(__dirname, "dist/pdfjs", dir), {
					recursive: true,
				});
		},
	};
};

export default defineConfig({
	plugins: [react(), dropFixtures(), pdfAssets()],
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
