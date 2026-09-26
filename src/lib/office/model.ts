/** Reflowable text extracted from formats Paperwren cannot lay out
 * page-faithfully (legacy .doc/.ppt, ODF text/slides, RTF). */

export interface Block {
	kind: "heading" | "para";
	text: string;
	/** Heading level 1-6. */
	level?: number;
}

export type Extracted =
	| { kind: "document"; blocks: Block[] }
	| { kind: "slides"; slides: Block[][] };

/** Split plain text into paragraphs, dropping empty runs. */
export function paragraphs(text: string): Block[] {
	return text
		.split(/\n/)
		.map((line) => line.replace(/[ \t]+$/g, ""))
		.filter(
			(line, i, all) =>
				line.trim() !== "" || (i > 0 && all[i - 1].trim() !== ""),
		)
		.map((line) => ({ kind: "para" as const, text: line }));
}
