import type { ImageMetadata } from "astro";

const files = import.meta.glob<{ default: ImageMetadata }>(
	"../assets/shots/*.png",
	{ eager: true },
);

/** A captured app screenshot by file name, e.g. "light-home". */
export function shot(name: string): ImageMetadata {
	const file = files[`../assets/shots/${name}.png`];
	if (!file) throw new Error(`Missing screenshot: ${name}`);
	return file.default;
}
