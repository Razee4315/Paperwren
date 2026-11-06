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
 * pdf.js reads three sets of files while it draws: character maps (for
 * CJK text whose font is named but not embedded), the standard fonts
 * (for files that rely on the base 14) and the icons of a note left on
 * a page. The app is offline, so they ship with it, under /pdfjs, and
 * are served from the package in development.
 */
const PDF_ASSETS: Record<string, string> = {
	cmaps: "cmaps",
	standard_fonts: "standard_fonts",
	images: "web/images",
};
/** Of pdf.js's images, only the notes' icons are drawn by the app. */
const shipped = (dir: string, file: string) =>
	dir !== "images" || /^annotation-.*\.svg$/.test(file);
const pdfAssets = (): Plugin => {
	const source = (dir: string) =>
		path.resolve(__dirname, "node_modules/pdfjs-dist", PDF_ASSETS[dir]);
	return {
		name: "paperwren-pdf-assets",
		configureServer(server) {
			server.middlewares.use("/pdfjs", (req, res, next) => {
				const [, dir, file] = (req.url ?? "").split("?")[0].split("/");
				const name = file ? decodeURIComponent(file) : "";
				const wanted =
					dir in PDF_ASSETS && name && !name.includes("..") && shipped(dir, name)
						? path.join(source(dir), name)
						: "";
				if (!wanted || !existsSync(wanted)) return next();
				res.setHeader(
					"Content-Type",
					name.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream",
				);
				res.end(readFileSync(wanted));
			});
		},
		closeBundle() {
			if (!existsSync(path.resolve(__dirname, "dist"))) return;
			for (const dir of Object.keys(PDF_ASSETS))
				cpSync(source(dir), path.resolve(__dirname, "dist/pdfjs", dir), {
					recursive: true,
					filter: (from) =>
						from === source(dir) || shipped(dir, path.basename(from)),
				});
		},
	};
};

/**
 * KaTeX names each of its fonts three times over (woff2, woff, ttf) and
 * Vite would ship all three. The app's webviews all read woff2, so the
 * other two are left out of its stylesheet.
 */
const mathFonts = (): Plugin => ({
	name: "paperwren-math-fonts",
	enforce: "pre",
	transform(code, id) {
		if (!/katex[\\/]dist[\\/]katex(\.min)?\.css/.test(id)) return;
		return code.replace(
			/,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g,
			"",
		);
	},
});

export default defineConfig({
	plugins: [react(), dropFixtures(), pdfAssets(), mathFonts()],
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
		// Not every Android WebView is kept up to date: phones without
		// Google Play (Huawei's HarmonyOS among them) can be years behind.
		// Syntax is lowered to Chrome 89 (the oldest that keeps top-level
		// await) and src/lib/compat.ts fills the missing built-ins.
		target: "chrome89",
		minify: process.env.TAURI_DEBUG ? false : "esbuild",
		sourcemap: !!process.env.TAURI_DEBUG,
		chunkSizeWarningLimit: 1500,
	},
});
