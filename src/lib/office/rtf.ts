/**
 * Plain text from RTF. Handles groups, ignorable destinations,
 * \uN unicode escapes (with \ucN fallback skipping), \'hh bytes
 * (Windows-1252) and paragraph/line/tab control words.
 */

import { type Extracted, paragraphs } from "./model";

const SKIP_DESTINATIONS = new Set([
	"fonttbl",
	"colortbl",
	"stylesheet",
	"info",
	"pict",
	"object",
	"header",
	"footer",
	"headerl",
	"headerr",
	"footerl",
	"footerr",
	"footnote",
	"listtable",
	"listoverridetable",
	"rsidtbl",
	"generator",
	"xmlnstbl",
	"themedata",
	"colorschememapping",
	"latentstyles",
	"datastore",
	"fldinst",
]);

const cp1252 = new TextDecoder("windows-1252");

export function rtfToText(src: string): string {
	let out = "";
	let i = 0;
	// Per-group state: skipping, and the \uc fallback count.
	const stack: Array<{ skip: boolean; uc: number }> = [];
	let skip = false;
	let uc = 1;
	let pendingSkip = 0; // fallback characters to drop after \uN
	const bytes: number[] = [];
	const flushBytes = () => {
		if (bytes.length) {
			if (!skip) out += cp1252.decode(new Uint8Array(bytes));
			bytes.length = 0;
		}
	};
	const emit = (text: string) => {
		flushBytes();
		if (!skip) out += text;
	};

	while (i < src.length) {
		const ch = src[i];
		if (ch === "{") {
			flushBytes();
			stack.push({ skip, uc });
			i++;
			// {\* ...} is an ignorable destination.
			if (src.startsWith("\\*", i)) skip = true;
			continue;
		}
		if (ch === "}") {
			flushBytes();
			const prev = stack.pop();
			if (prev) {
				skip = prev.skip;
				uc = prev.uc;
			}
			i++;
			continue;
		}
		if (ch === "\\") {
			const next = src[i + 1];
			if (next === "'") {
				const hex = Number.parseInt(src.slice(i + 2, i + 4), 16);
				i += 4;
				if (pendingSkip > 0) {
					pendingSkip--;
					continue;
				}
				if (!Number.isNaN(hex)) bytes.push(hex);
				continue;
			}
			if (next === "\\" || next === "{" || next === "}") {
				emit(next);
				i += 2;
				continue;
			}
			if (next === "~") {
				emit(" ");
				i += 2;
				continue;
			}
			if (next === "\n" || next === "\r") {
				emit("\n");
				i += 2;
				continue;
			}
			const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i + 1, i + 40));
			if (!m) {
				i += 2;
				continue;
			}
			i += 1 + m[0].length;
			const word = m[1];
			const arg = m[2] === undefined ? undefined : Number(m[2]);
			if (SKIP_DESTINATIONS.has(word)) {
				flushBytes();
				skip = true;
			} else if (
				word === "par" ||
				word === "line" ||
				word === "sect" ||
				word === "page"
			) {
				emit("\n");
			} else if (word === "tab" || word === "cell") {
				emit("\t");
			} else if (word === "row") {
				emit("\n");
			} else if (word === "uc" && arg !== undefined) {
				uc = arg;
			} else if (word === "u" && arg !== undefined) {
				emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg));
				pendingSkip = uc;
			} else if (word === "emdash") emit("—");
			else if (word === "endash") emit("–");
			else if (word === "bullet") emit("•");
			else if (word === "lquote") emit("‘");
			else if (word === "rquote") emit("’");
			else if (word === "ldblquote") emit("“");
			else if (word === "rdblquote") emit("”");
			continue;
		}
		if (ch === "\r" || ch === "\n") {
			i++;
			continue;
		}
		if (pendingSkip > 0) {
			pendingSkip--;
			i++;
			continue;
		}
		emit(ch);
		i++;
	}
	flushBytes();
	return out.replace(/\t\n/g, "\n");
}

export function extractRtf(bytes: Uint8Array): Extracted {
	const src = new TextDecoder("latin1").decode(bytes);
	return { kind: "document", blocks: paragraphs(rtfToText(src)) };
}
