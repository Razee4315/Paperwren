/**
 * Text from pre-2007 binary Office files ([MS-DOC], [MS-PPT]). These
 * are compound (OLE/CFB) files; the caller supplies a stream lookup
 * so this module stays independent of the CFB reader.
 *
 * Fidelity: text and paragraph structure only. Layout, images and
 * formatting are out of scope; the viewer says so.
 */

import { type Block, type Extracted, paragraphs } from "./model";

export type StreamLookup = (name: string) => Uint8Array | null;

const cp1252 = new TextDecoder("windows-1252");
const utf16 = new TextDecoder("utf-16le");

function u16(b: Uint8Array, o: number) {
	return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
	return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** Word control characters -> plain text; field codes keep only
 * their displayed result. */
export function cleanWordText(raw: string): string {
	let out = "";
	// Field nesting: 0x13 begin, 0x14 separator, 0x15 end. Inside the
	// instruction part (before 0x14) text is hidden.
	const stack: boolean[] = [];
	for (const ch of raw) {
		const c = ch.charCodeAt(0);
		if (c === 0x13) {
			stack.push(true);
			continue;
		}
		if (c === 0x14) {
			if (stack.length) stack[stack.length - 1] = false;
			continue;
		}
		if (c === 0x15) {
			stack.pop();
			continue;
		}
		if (stack.some((hidden) => hidden)) continue;
		if (c === 0x0d || c === 0x0b || c === 0x0c) out += "\n";
		else if (c === 0x07) out += "\t";
		else if (c === 0x09 || c >= 0x20) out += ch;
	}
	return out.replace(/\t\n/g, "\n");
}

export function extractDoc(stream: StreamLookup): Extracted {
	const word = stream("WordDocument");
	if (!word || word.length < 0x1aa)
		throw new Error("corrupt: no WordDocument stream");
	if (u16(word, 0) !== 0xa5ec) throw new Error("corrupt: bad FIB");
	const flags = u16(word, 0x0a);
	if (flags & 0x0100) throw new Error("password: encrypted document");
	const table = stream(flags & 0x0200 ? "1Table" : "0Table");
	const fcClx = u32(word, 0x01a2);
	const lcbClx = u32(word, 0x01a6);
	let text = "";
	if (table && lcbClx > 0 && fcClx + lcbClx <= table.length) {
		let pos = fcClx;
		const end = fcClx + lcbClx;
		// Skip Prc entries, find the Pcdt piece table.
		while (pos < end && table[pos] === 0x01) pos += 3 + u16(table, pos + 1);
		if (table[pos] !== 0x02) throw new Error("corrupt: no piece table");
		const lcb = u32(table, pos + 1);
		const plc = pos + 5;
		const n = Math.floor((lcb - 4) / 12);
		for (let i = 0; i < n; i++) {
			const cpStart = u32(table, plc + i * 4);
			const cpEnd = u32(table, plc + (i + 1) * 4);
			const pcd = plc + (n + 1) * 4 + i * 8;
			const fcRaw = u32(table, pcd + 2);
			const compressed = (fcRaw & 0x40000000) !== 0;
			const chars = cpEnd - cpStart;
			if (chars <= 0) continue;
			if (compressed) {
				const fc = (fcRaw & 0x3fffffff) / 2;
				text += cp1252.decode(word.subarray(fc, fc + chars));
			} else {
				text += utf16.decode(word.subarray(fcRaw, fcRaw + chars * 2));
			}
		}
	} else {
		// Word 6/95 style: contiguous text between fcMin and fcMac.
		const fcMin = u32(word, 0x18);
		const fcMac = u32(word, 0x1c);
		text = cp1252.decode(word.subarray(fcMin, Math.min(fcMac, word.length)));
	}
	return { kind: "document", blocks: paragraphs(cleanWordText(text)) };
}

// [MS-PPT] record types.
const RT_SLIDE = 0x03ee;
const RT_NOTES = 0x03f0;
const RT_MAIN_MASTER = 0x03f8;
const RT_SLIDE_LIST_WITH_TEXT = 0x0ff0;
const RT_SLIDE_PERSIST_ATOM = 0x03f3;
const RT_TEXT_CHARS = 0x0fa0;
const RT_TEXT_BYTES = 0x0fa8;

export function extractPpt(stream: StreamLookup): Extracted {
	const doc = stream("PowerPoint Document");
	if (!doc) throw new Error("corrupt: no PowerPoint Document stream");
	const fromSlides: string[][] = [];
	const fromList: string[][] = [];
	let inList = false;

	const walk = (
		start: number,
		end: number,
		slide: string[] | null,
		depth: number,
	) => {
		let pos = start;
		while (pos + 8 <= end) {
			const verInst = u16(doc, pos);
			const type = u16(doc, pos + 2);
			const len = u32(doc, pos + 4);
			const body = pos + 8;
			const next = body + len;
			if (next > end || depth > 32) return;
			if ((verInst & 0x0f) === 0x0f) {
				if (type === RT_NOTES || type === RT_MAIN_MASTER) {
					// Speaker notes and master placeholders are not slide text.
				} else if (type === RT_SLIDE) {
					const group: string[] = [];
					fromSlides.push(group);
					walk(body, next, group, depth + 1);
				} else if (type === RT_SLIDE_LIST_WITH_TEXT && verInst >> 4 === 0) {
					inList = true;
					walk(body, next, null, depth + 1);
					inList = false;
				} else {
					walk(body, next, slide, depth + 1);
				}
			} else if (type === RT_SLIDE_PERSIST_ATOM && inList) {
				fromList.push([]);
			} else if (type === RT_TEXT_CHARS || type === RT_TEXT_BYTES) {
				const text = (type === RT_TEXT_CHARS ? utf16 : cp1252)
					.decode(doc.subarray(body, next))
					.replace(/\r|\v/g, "\n")
					.trim();
				if (text && text !== "*") {
					if (slide) slide.push(text);
					else if (inList && fromList.length)
						fromList[fromList.length - 1].push(text);
				}
			}
			pos = next;
		}
	};
	walk(0, doc.length, null, 0);

	const pick = fromSlides.some((s) => s.length) ? fromSlides : fromList;
	const slides = pick.map((texts) => {
		const blocks: Block[] = [];
		texts.forEach((t, i) => {
			const lines = paragraphs(t);
			if (i === 0 && lines.length)
				blocks.push(
					{ kind: "heading", level: 2, text: lines[0].text },
					...lines.slice(1),
				);
			else blocks.push(...lines);
		});
		return blocks;
	});
	return { kind: "slides", slides };
}
