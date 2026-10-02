/**
 * Glue between the legacy / OpenDocument slide readers and the slide
 * viewer: turns a parsed deck's picture bytes into blob URLs, and
 * builds a plain deck from text when a file's drawing cannot be read.
 */

import type { Para, Presentation, Slide, TextBody } from "../pptx/parse";
import type { Block } from "./model";
import type { RawDeck } from "./ppt";

/** Swap every "media:<n>" reference for a blob URL. */
export function materialize(raw: RawDeck): Presentation {
	const urls = raw.media.map((m) =>
		URL.createObjectURL(new Blob([m.bytes as BlobPart], { type: m.type })),
	);
	const url = (ref: string | null | undefined): string | null => {
		if (!ref?.startsWith("media:")) return null;
		return urls[Number(ref.slice(6))] ?? null;
	};
	for (const slide of raw.slides) {
		if (slide.background.startsWith("media:")) {
			const picture = url(slide.background);
			slide.background = picture
				? `center / 100% 100% no-repeat url("${picture}")`
				: "#ffffff";
		}
		for (const el of slide.elements) {
			if (el.kind === "image") el.src = url(el.src);
			else if (el.kind === "shape" && el.image)
				el.image = url(el.image) ?? undefined;
		}
	}
	return {
		width: raw.width,
		height: raw.height,
		slides: raw.slides,
		dispose() {
			for (const u of urls) URL.revokeObjectURL(u);
		},
	};
}

/** Slides from text alone (a title and its lines), for decks whose
 * drawing layer is unreadable. Better than refusing the file. */
export function textDeck(slides: Block[][]): RawDeck {
	const width = 960;
	const height = 540;
	const body = (paras: Para[], anchor: TextBody["anchor"]): TextBody => ({
		paras,
		anchor,
		insets: [9.6, 4.8, 9.6, 4.8],
		wrap: true,
		vertical: false,
	});
	const para = (text: string, size: number, bold: boolean): Para => ({
		runs: [
			{
				text,
				size,
				bold,
				italic: false,
				underline: false,
				strike: false,
				color: "#1b1b1f",
			},
		],
		align: "left",
		level: 0,
		indent: 0,
		spaceBefore: 0,
		spaceAfter: size * 0.35,
		endSize: size,
	});
	const out: Slide[] = slides.map((blocks) => {
		const [title, ...rest] = blocks.filter((b) => b.text.trim());
		const elements: Slide["elements"] = [];
		const frame = { rot: 0, flipH: false, flipV: false };
		if (title)
			elements.push({
				kind: "shape",
				x: 48,
				y: 28,
				w: width - 96,
				h: 96,
				...frame,
				geom: "rect",
				text: body([para(title.text, 40, true)], "middle"),
			});
		if (rest.length)
			elements.push({
				kind: "shape",
				x: 48,
				y: 136,
				w: width - 96,
				h: height - 164,
				...frame,
				geom: "rect",
				text: body(
					rest.map((b) => para(b.text, 24, false)),
					"top",
				),
			});
		return { background: "#ffffff", elements };
	});
	return { width, height, slides: out, media: [] };
}
