/**
 * The marks a reader makes on a PDF, kept by the app on this device:
 * highlights, ink, notes and text boxes, and a note about the document
 * as a whole. The file itself is never touched. They are found again
 * by what the file contains, so they follow it through a rename or a
 * move, and two files that happen to share a name stay apart.
 *
 * Each document has a key of its own in the app's store, with a list
 * beside them saying which there are. A document opened with a
 * password is not stored at all.
 */

import { backend } from "./backend";
import { sha512 } from "./office/sha";
import type { Markup } from "./pdfMarkup";

export type DocMark = Markup & {
	id: string;
	/** When it was made, to keep marks in order at one spot. */
	createdAt: number;
};

/** A page's scale for measuring: how long a point of the page is. */
export interface PageScale {
	perPoint: number;
	unit: string;
}

/** Each page's scale, by its index. A plan's sheets differ. */
export type Scales = Record<string, PageScale>;

/** What is kept for one document. */
export interface DocMarks {
	/** The content key, without the store's prefix. */
	key: string;
	name: string;
	/** About the document as a whole. */
	note: string;
	marks: DocMark[];
	scales?: Scales;
	updatedAt: number;
}

/** A line of the list of documents that have marks. */
export interface DocSummary {
	key: string;
	name: string;
	count: number;
	updatedAt: number;
}

export const PEN_COLORS = ["#111111", "#1a3c8c", "#c0392b", "#1f8a4c"];
export const MARKER_COLORS = [
	"#ffd93b",
	"#8ee06e",
	"#ff9ecb",
	"#7fd3ff",
	"#ffb07a",
];

const LIST_KEY = "marks_v1";
const docKey = (key: string) => `marks_${key}`;
/** How much of each end of a file its key is read from. */
const SAMPLE = 1 << 20;

/** A mark's id, good for as long as the mark is kept. */
export const newMarkId = () =>
	`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The two ends of a file and its size: enough to know it again, and
 * quick to read however large it is. A copy, so the file's own bytes
 * can go to pdf.js. */
export function fileSample(bytes: Uint8Array): Uint8Array {
	const size = new TextEncoder().encode(`:${bytes.byteLength}`);
	const whole = bytes.byteLength <= SAMPLE * 2;
	const body = whole ? bytes.byteLength : SAMPLE * 2;
	const out = new Uint8Array(body + size.length);
	if (whole) out.set(bytes);
	else {
		out.set(bytes.subarray(0, SAMPLE));
		out.set(bytes.subarray(bytes.byteLength - SAMPLE), SAMPLE);
	}
	out.set(size, body);
	return out;
}

/** The key of a file's sample. Its letters are ones a store key may
 * have, and short enough to fit one. */
export function contentKey(sample: Uint8Array): string {
	let hex = "";
	for (const byte of sha512(sample).subarray(0, 16))
		hex += byte.toString(16).padStart(2, "0");
	return hex;
}

const isPoint = (p: unknown): p is [number, number] =>
	Array.isArray(p) &&
	p.length === 2 &&
	Number.isFinite(p[0]) &&
	Number.isFinite(p[1]);

const isBox = (b: unknown) => {
	const box = b as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
	return (
		!!box &&
		Number.isFinite(box.x) &&
		Number.isFinite(box.y) &&
		Number.isFinite(box.w) &&
		Number.isFinite(box.h)
	);
};

/** A mark as read back; null when it is not one. */
export function validMark(raw: unknown): DocMark | null {
	const m = raw as Partial<Record<keyof DocMark | string, unknown>> | null;
	if (!m || typeof m.id !== "string" || !m.id) return null;
	if (!Number.isInteger(m.page) || (m.page as number) < 0) return null;
	const base = {
		id: m.id,
		page: m.page as number,
		createdAt: Number(m.createdAt) || 0,
	};
	const color = typeof m.color === "string" ? m.color : "#111111";
	switch (m.kind) {
		case "ink":
			if (!Array.isArray(m.points) || !m.points.every(isPoint)) return null;
			if (!m.points.length || !Number.isFinite(m.width)) return null;
			return {
				...base,
				kind: "ink",
				points: m.points as Array<[number, number]>,
				color,
				width: m.width as number,
				marker: m.marker === true || undefined,
			};
		case "highlight":
		case "underline":
		case "strike":
			if (!Array.isArray(m.boxes) || !m.boxes.every(isBox)) return null;
			if (!m.boxes.length) return null;
			return {
				...base,
				kind: m.kind,
				boxes: m.boxes as Array<{ x: number; y: number; w: number; h: number }>,
				color,
				text: typeof m.text === "string" ? m.text : "",
				note: typeof m.note === "string" && m.note ? m.note : undefined,
			};
		case "note":
			if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return null;
			if (typeof m.text !== "string") return null;
			return {
				...base,
				kind: "note",
				x: m.x as number,
				y: m.y as number,
				text: m.text,
			};
		case "text":
			if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) return null;
			if (!Number.isFinite(m.w) || !Number.isFinite(m.h)) return null;
			if (!Number.isFinite(m.size) || typeof m.text !== "string") return null;
			return {
				...base,
				kind: "text",
				x: m.x as number,
				y: m.y as number,
				w: m.w as number,
				h: m.h as number,
				size: m.size as number,
				text: m.text,
				color,
			};
		case "measure":
			if (!Array.isArray(m.points) || !m.points.every(isPoint)) return null;
			if ((m.points as unknown[]).length < 2) return null;
			return {
				...base,
				kind: "measure",
				points: m.points as Array<[number, number]>,
				closed: m.closed === true || undefined,
				color,
			};
		default:
			return null;
	}
}

function validScales(raw: unknown): Scales {
	const scales: Scales = {};
	if (!raw || typeof raw !== "object") return scales;
	for (const [page, value] of Object.entries(raw)) {
		const scale = value as Partial<PageScale> | null;
		if (
			/^\d+$/.test(page) &&
			scale &&
			Number.isFinite(scale.perPoint) &&
			(scale.perPoint as number) > 0 &&
			typeof scale.unit === "string"
		)
			scales[page] = { perPoint: scale.perPoint as number, unit: scale.unit };
	}
	return scales;
}

/** A document's record as read back, with whatever in it is sound. */
export function validDoc(raw: unknown, key: string): DocMarks | null {
	const doc = raw as Partial<DocMarks> | null;
	if (!doc || typeof doc !== "object") return null;
	return {
		key,
		name: typeof doc.name === "string" ? doc.name : "",
		note: typeof doc.note === "string" ? doc.note : "",
		marks: Array.isArray(doc.marks)
			? doc.marks.flatMap((mark) => validMark(mark) ?? [])
			: [],
		scales: validScales(doc.scales),
		updatedAt: Number(doc.updatedAt) || 0,
	};
}

function validList(raw: unknown): DocSummary[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(n): n is DocSummary =>
			!!n &&
			typeof n.key === "string" &&
			/^[0-9a-f]{32}$/.test(n.key) &&
			typeof n.name === "string" &&
			Number.isFinite(n.count) &&
			Number.isFinite(n.updatedAt),
	);
}

export const loadMarkList = async () =>
	validList(await backend.storeGet(LIST_KEY).catch(() => null));

export async function loadMarks(key: string): Promise<DocMarks | null> {
	return validDoc(await backend.storeGet(docKey(key)).catch(() => null), key);
}

// Windows of one document never race; the list is shared by them all,
// so its changes wait their turn.
let listing: Promise<unknown> = Promise.resolve();

function changeList(edit: (list: DocSummary[]) => DocSummary[]) {
	const next = listing
		.then(async () => {
			await backend.storeSet(LIST_KEY, edit(await loadMarkList()));
		})
		.catch(() => {});
	listing = next;
	return next;
}

/** Keep a document's record, or drop it once there is nothing in it. */
export async function saveMarks(doc: DocMarks): Promise<void> {
	const empty = !doc.marks.length && !doc.note.trim();
	await backend.storeSet(docKey(doc.key), empty ? null : doc);
	await changeList((list) => {
		const rest = list.filter((n) => n.key !== doc.key);
		if (empty) return rest;
		const { key, name, updatedAt } = doc;
		return [{ key, name, updatedAt, count: doc.marks.length }, ...rest];
	});
}

/** Every document's record: for a backup, and to undo clearing them. */
export async function allMarks(): Promise<DocMarks[]> {
	const docs: DocMarks[] = [];
	for (const { key } of await loadMarkList()) {
		const doc = await loadMarks(key);
		if (doc) docs.push(doc);
	}
	return docs;
}

/** Forget the marks of every document. Returns them, for Undo. */
export async function clearAllMarks(): Promise<DocMarks[]> {
	const docs = await allMarks();
	for (const { key } of docs) await backend.storeSet(docKey(key), null);
	await changeList(() => []);
	return docs;
}

/** Bring back records from a backup or an Undo. A document that is here
 * too keeps whichever copy was changed last. How many came in. */
export async function restoreMarks(docs: unknown[]): Promise<number> {
	let added = 0;
	for (const raw of docs) {
		const key = (raw as { key?: unknown } | null)?.key;
		if (typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key)) continue;
		const doc = validDoc(raw, key);
		if (!doc) continue;
		const here = await loadMarks(key);
		if (here && here.updatedAt >= doc.updatedAt) continue;
		await saveMarks(doc);
		added++;
	}
	return added;
}

/** How far down its page a mark starts. */
function topOf(mark: DocMark): number {
	switch (mark.kind) {
		case "ink":
		case "measure":
			return Math.min(...mark.points.map((p) => p[1]));
		case "note":
		case "text":
			return mark.y;
		default:
			return mark.boxes[0]?.y ?? 0;
	}
}

/** The marks in reading order: by page, then down it. */
export function sortMarks(marks: DocMark[]): DocMark[] {
	return [...marks].sort(
		(a, b) =>
			a.page - b.page || topOf(a) - topOf(b) || a.createdAt - b.createdAt,
	);
}

/** Marks that hold words: the rest are only drawn. */
export const hasWords = (mark: DocMark) =>
	mark.kind !== "ink" && mark.kind !== "measure";

/** The words a mark holds, or the words of the note on it. */
export function markText(mark: DocMark): string {
	if (mark.kind === "ink" || mark.kind === "measure") return "";
	return mark.text;
}

/** The document's note and marks as Markdown, in reading order.
 * `label` names a page as the document numbers it. */
export function marksToMarkdown(
	name: string,
	doc: Pick<DocMarks, "note" | "marks">,
	label: (page: number) => string,
): string {
	const title = name.replace(/\.pdf$/i, "");
	const lines = [`# ${title}`, ""];
	if (doc.note.trim()) lines.push(doc.note.trim(), "");
	for (const mark of sortMarks(doc.marks)) {
		const page = label(mark.page);
		if (mark.kind === "note" || mark.kind === "text") {
			lines.push(`- ${mark.text.replace(/\n+/g, " ")} (${page})`, "");
		} else if (mark.kind !== "ink" && mark.kind !== "measure") {
			lines.push(`> ${mark.text.replace(/\n+/g, " ")} (${page})`, "");
			if (mark.note) lines.push(mark.note, "");
		}
	}
	return `${lines.join("\n").trim()}\n`;
}
