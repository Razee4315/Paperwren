/**
 * Export Paperwren's SVG assets from the same geometry and components
 * the app renders, with fixed colours so they work outside the app
 * (README, store listing, launcher, file-manager previews).
 *
 * Usage: npx vite-node scripts/export-assets.tsx
 * Writes assets/icons/<format>.svg, assets/brand/{wren,app-icon,
 * app-icon-foreground}.svg and public/assets/icon.svg (favicon and
 * in-app logo). Then regenerate the launcher PNGs with
 * `npx tauri icon assets/brand/app-icon.svg --output src-tauri/icons`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ALL_FORMATS, kindOf } from "../src/lib/formats";
import { WREN, Wren, type WrenColors } from "../src/ui/Art";
import { FileIcon } from "../src/ui/FileIcon";

// The Paper theme's format colours.
const COLORS = {
	pdf: "#d2553f",
	doc: "#3c6db4",
	sheet: "#2f8a5b",
	slides: "#cf8420",
	text: "#7d65b0",
	other: "#7d65b0",
} as const;

/** Brand teal: the launcher tile and the Android adaptive background
 * (scripts/patch-android-icons.mjs). */
const TILE = "#2B6E66";

/** The wren in the Paper theme, for use on light backgrounds. */
const ON_LIGHT: WrenColors = {
	body: "#2b6e66",
	dark: "#1f5750",
	belly: "#8fbcb3",
	beak: "#e07a4f",
	eye: "#23221f",
};

/** The wren on the teal tile: a cream bird. */
const ON_TILE: WrenColors = {
	body: "#f6efe4",
	dark: "#174a44",
	belly: "#ffffff",
	beak: "#ec8a5a",
	eye: "#174a44",
};

const xml = (markup: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n${markup.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')}\n`;

/** Map every absolute "x y" pair of a path from the 64-grid into
 * 512px space. WREN paths use absolute commands only. */
const place = (d: string, s: number, ox: number, oy: number) =>
	d.replace(
		/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g,
		(_, x, y) =>
			`${+(Number(x) * s + ox).toFixed(1)} ${+(Number(y) * s + oy).toFixed(1)}`,
	);

/** The wren as 512px-space SVG elements. The 64-grid bird's visual
 * centre is about (32, 33); `s` is its scale. */
function wrenAt512(c: WrenColors, s: number): string {
	const ox = 256 - 32 * s;
	const oy = 256 - 33 * s;
	const p = (d: string) => place(d, s, ox, oy);
	const e = WREN.eye;
	return [
		`<path d="${p(WREN.tail)}" fill="${c.dark}"/>`,
		`<path d="${p(WREN.legs)}" stroke="${c.dark}" stroke-width="${+(WREN.legWidth * s).toFixed(1)}" stroke-linecap="round" fill="none"/>`,
		`<path d="${p(WREN.body)}" fill="${c.body}"/>`,
		`<path d="${p(WREN.belly)}" fill="${c.belly}"/>`,
		`<path d="${p(WREN.wing)}" fill="${c.dark}"/>`,
		`<path d="${p(WREN.beak)}" fill="${c.beak}"/>`,
		`<circle cx="${+(e.cx * s + ox).toFixed(1)}" cy="${+(e.cy * s + oy).toFixed(1)}" r="${+(e.r * s).toFixed(1)}" fill="${c.eye}"/>`,
	].join("\n    ");
}

const appIcon = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Paperwren">
  <rect width="512" height="512" rx="112" fill="${TILE}"/>
  <g>
    ${wrenAt512(ON_TILE, 5.4)}
  </g>
</svg>
`;

// Android adaptive foreground: transparent, inside the safe zone
// (scripts/check-icon-foreground.mjs). The outer group scale is what
// the checker reads.
const foreground = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Paperwren adaptive-icon foreground">
  <g transform="translate(61.4 61.4) scale(0.76)">
    ${wrenAt512(ON_TILE, 5.4)}
  </g>
</svg>
`;

mkdirSync("assets/icons", { recursive: true });
mkdirSync("assets/brand", { recursive: true });
for (const format of ALL_FORMATS) {
	const svg = renderToStaticMarkup(
		<FileIcon
			format={format}
			size={96}
			color={COLORS[kindOf(format)]}
			title={`${format.toUpperCase()} file`}
		/>,
	);
	writeFileSync(`assets/icons/${format}.svg`, xml(svg));
}
writeFileSync(
	"assets/brand/wren.svg",
	xml(
		renderToStaticMarkup(<Wren size={240} colors={ON_LIGHT} />).replace(
			/ class="[^"]*"/,
			"",
		),
	),
);
writeFileSync("assets/brand/app-icon.svg", appIcon);
writeFileSync("assets/brand/app-icon-foreground.svg", foreground);
writeFileSync("public/assets/icon.svg", appIcon);
console.log(
	`Exported ${ALL_FORMATS.length} file icons, the wren mark and the app icons.`,
);
