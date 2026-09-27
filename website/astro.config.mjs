import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// Deployed origin and path. Defaults to GitHub Pages; set SITE_URL and
// BASE_PATH (e.g. "/") when the site moves to its own domain.
const site = process.env.SITE_URL || "https://razee4315.github.io";
const base = process.env.BASE_PATH || "/Paperwren";

export default defineConfig({
	site,
	base,
	trailingSlash: "always",
	integrations: [sitemap()],
	build: { format: "directory" },
	devToolbar: { enabled: false },
});
