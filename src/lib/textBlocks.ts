/**
 * Long plain text in blocks of lines. Each block is a box of its own
 * that the browser may leave unlaid-out while it is far from the
 * screen (content-visibility), sized meanwhile by a guess at its
 * height.
 */

const BLOCK_LINES = 200;
/** The characters a wrapped line holds at most, for that guess. */
const ROW_CHARS = 96;

/** Text in blocks of lines, each with a guess at its height in lines.
 * The line break between two blocks is the break between the boxes. */
export function textBlocks(
	text: string,
	wrap: boolean,
): Array<{ text: string; rows: number }> {
	const lines = text.split("\n");
	const blocks: Array<{ text: string; rows: number }> = [];
	for (let at = 0; at < lines.length; at += BLOCK_LINES) {
		const group = lines.slice(at, at + BLOCK_LINES);
		let rows = 0;
		for (const line of group)
			rows += wrap ? Math.max(1, Math.ceil(line.length / ROW_CHARS)) : 1;
		let chunk = group.join("\n");
		// A block ending on an empty line keeps it: the last line break
		// of a box draws no line of its own.
		if (chunk === "" || chunk.endsWith("\n")) chunk += "\n";
		blocks.push({ text: chunk, rows });
	}
	return blocks;
}
