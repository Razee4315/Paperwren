/**
 * Maths in Markdown, written as TeX the way GitHub and most notes apps
 * read it: `$x^2$` in a line, `$$ … $$` on lines of its own. Marked
 * leaves a placeholder holding the TeX as text; `drawMaths` sets it
 * once KaTeX has loaded, which happens only for a file that has any.
 */

import { Marked, type MarkedExtension, type Tokens } from "marked";

const escapeHtml = (text: string) =>
	text.replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
	);

const placeholder = (tex: string, block: boolean) =>
	block
		? `<div class="pw-math" data-display="block">${escapeHtml(tex)}</div>\n`
		: `<span class="pw-math">${escapeHtml(tex)}</span>`;

/**
 * `$…$` in a line counts only when the dollars hug the TeX, as in
 * `$x$`, and the closing one is not followed by a digit: "costs $5 and
 * $10" stays prose.
 */
const INLINE = /^\$(?!\s)((?:\\[\s\S]|[^\\$\n])+?)(?<!\s)\$(?![\d$])/;
const BLOCK = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/;

/** Where the next `$$` starting a line is. Marked asks again at each
 * block, with what is left of the file: a plain search for the two
 * characters is far quicker than a pattern there. */
function nextBlock(src: string): number | undefined {
	for (let at = src.indexOf("$$"); at !== -1; at = src.indexOf("$$", at + 1))
		if (at === 0 || src[at - 1] === "\n") return at;
	return undefined;
}

const mathBlock: NonNullable<MarkedExtension["extensions"]>[number] = {
	name: "mathBlock",
	level: "block",
	start: nextBlock,
	tokenizer(src) {
		const m = BLOCK.exec(src);
		if (m)
			return {
				type: "mathBlock",
				raw: m[0],
				text: m[1].trim(),
			} as Tokens.Generic;
	},
	renderer: (token) => placeholder(token.text, true),
};

const mathInline: NonNullable<MarkedExtension["extensions"]>[number] = {
	name: "mathInline",
	level: "inline",
	start: (src) => {
		const at = src.search(/(?<!\\)\$/);
		return at < 0 ? undefined : at;
	},
	tokenizer(src) {
		const m = INLINE.exec(src);
		if (m)
			return {
				type: "mathInline",
				raw: m[0],
				text: m[1],
			} as Tokens.Generic;
	},
	renderer: (token) => placeholder(token.text, false),
};

export const markdownMath: MarkedExtension = {
	extensions: [mathBlock, mathInline],
};

/**
 * The reader for a file's Markdown: maths read only where the file has
 * any. Marked looks for where each extension could start at every
 * block; in a long file without a `$$`, asking the block one at all
 * would make reading it slower the longer it is.
 */
const readers = new Map<string, Marked>();
export function markdownFor(text: string): Marked {
	const kind = text.includes("$$")
		? "both"
		: text.includes("$")
			? "inline"
			: "none";
	let reader = readers.get(kind);
	if (!reader) {
		reader =
			kind === "both"
				? new Marked(markdownMath)
				: kind === "inline"
					? new Marked({ extensions: [mathInline] })
					: new Marked();
		readers.set(kind, reader);
	}
	return reader;
}

/** Draws the maths placed in `root`, loading KaTeX first. TeX it cannot
 * read is shown as it was written, in its error colour. */
export async function drawMaths(root: HTMLElement): Promise<void> {
	const spots = [...root.querySelectorAll<HTMLElement>(".pw-math")];
	if (!spots.length) return;
	const [{ default: katex }] = await Promise.all([
		import("katex"),
		import("katex/dist/katex.min.css"),
	]);
	for (const spot of spots) {
		if (!spot.isConnected || spot.dataset.drawn) continue;
		const tex = spot.textContent ?? "";
		try {
			katex.render(tex, spot, {
				displayMode: spot.dataset.display === "block",
				throwOnError: false,
				// No \href, \url or \includegraphics: a file cannot reach out.
				trust: false,
				maxExpand: 1000,
				maxSize: 50,
			});
			spot.dataset.drawn = "1";
		} catch {
			spot.textContent = tex;
		}
	}
}
