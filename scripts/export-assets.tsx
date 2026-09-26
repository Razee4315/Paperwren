/**
 * Export Paperwren's SVG assets from the same React components the
 * app renders, with fixed colours so they work outside the app
 * (README, store listing, file-manager previews).
 *
 * Usage: npx vite-node scripts/export-assets.tsx
 * Writes assets/icons/<format>.svg and assets/brand/wren.svg.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ALL_FORMATS, kindOf } from "../src/lib/formats";
import { Wren } from "../src/ui/Art";
import { FileIcon } from "../src/ui/FileIcon";

const COLORS = {
	pdf: "#f0443a",
	doc: "#2f6bff",
	sheet: "#0ea561",
	slides: "#f59109",
	text: "#7a6ff0",
	other: "#7a6ff0",
} as const;

// The light Sunset palette, for assets that use theme variables.
const VARS: Record<string, string> = {
	"var(--grad-a)": "#ff8a3d",
	"var(--grad-b)": "#f0447a",
	"var(--grad-c)": "#8b5cf6",
	"var(--text-2)": "#55535e",
};

const xml = (markup: string) => {
	let out = markup;
	for (const [v, hex] of Object.entries(VARS)) out = out.split(v).join(hex);
	// stop-color set through style works in every renderer; keep it.
	return `<?xml version="1.0" encoding="UTF-8"?>\n${out.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"')}\n`;
};

mkdirSync("assets/icons", { recursive: true });
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
	xml(renderToStaticMarkup(<Wren size={240} animate={false} />)),
);
console.log(`Exported ${ALL_FORMATS.length} file icons and the wren mark.`);
