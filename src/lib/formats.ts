/**
 * The format registry: every file type Paperwren opens, how it is
 * recognised, and which viewer shows it. Bytes decide; the name is
 * only a hint (Android pickers hand out extension-less content URIs,
 * and file managers lie about extensions).
 */

import { unzipSync } from "fflate";

export type FileFormat =
	| "pdf"
	| "docx"
	| "doc"
	| "odt"
	| "rtf"
	| "xlsx"
	| "xls"
	| "ods"
	| "csv"
	| "pptx"
	| "ppt"
	| "odp"
	| "md"
	| "txt"
	| "unknown";

/** The family drives colour, icon, and filter chips. */
export type FormatKind = "pdf" | "doc" | "sheet" | "slides" | "text" | "other";

export const ALL_FORMATS: FileFormat[] = [
	"pdf",
	"docx",
	"doc",
	"odt",
	"rtf",
	"xlsx",
	"xls",
	"ods",
	"csv",
	"pptx",
	"ppt",
	"odp",
	"md",
	"txt",
	"unknown",
];

const EXTENSIONS: Record<string, FileFormat> = {
	pdf: "pdf",
	docx: "docx",
	docm: "docx",
	dotx: "docx",
	doc: "doc",
	odt: "odt",
	rtf: "rtf",
	xlsx: "xlsx",
	xlsm: "xlsx",
	xlsb: "xlsx",
	xltx: "xlsx",
	xls: "xls",
	ods: "ods",
	csv: "csv",
	tsv: "csv",
	pptx: "pptx",
	pptm: "pptx",
	ppsx: "pptx",
	ppt: "ppt",
	pps: "ppt",
	odp: "odp",
	md: "md",
	markdown: "md",
	txt: "txt",
	text: "txt",
	log: "txt",
	json: "txt",
	xml: "txt",
	yml: "txt",
	yaml: "txt",
	ini: "txt",
};

/** Extensions offered by the file picker. */
export const PICKER_EXTENSIONS = Object.keys(EXTENSIONS);

export function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function formatFromName(name: string): FileFormat {
	return EXTENSIONS[extensionOf(name)] ?? "unknown";
}

export function kindOf(format: FileFormat): FormatKind {
	switch (format) {
		case "pdf":
			return "pdf";
		case "docx":
		case "doc":
		case "odt":
		case "rtf":
			return "doc";
		case "xlsx":
		case "xls":
		case "ods":
		case "csv":
			return "sheet";
		case "pptx":
		case "ppt":
		case "odp":
			return "slides";
		case "md":
		case "txt":
			return "text";
		default:
			return "other";
	}
}

export const KIND_LABEL: Record<FormatKind, string> = {
	pdf: "PDF",
	doc: "Documents",
	sheet: "Sheets",
	slides: "Slides",
	text: "Text",
	other: "Other",
};

export function formatLabel(format: FileFormat): string {
	return format === "unknown" ? "FILE" : format.toUpperCase();
}

const FRIENDLY: Record<FormatKind, string> = {
	pdf: "PDF document",
	doc: "Document",
	sheet: "Spreadsheet",
	slides: "Presentation",
	text: "Text file",
	other: "File",
};

/** True for names that are really provider ids ("1234",
 * "msf:1234", "document:5521", "image%3A88"): no letters-only word. */
export function isOpaqueName(name: string): boolean {
	const stem = name.replace(/\.[a-z0-9]{1,5}$/i, "");
	if (!stem.trim()) return true;
	return !/[a-z]{2,}/i.test(
		stem.replace(/^(msf|document|raw|primary|image|video|audio)(%3a|:)/i, ""),
	);
}

/**
 * The name shown for a file whose provider did not tell us one.
 * A real name keeps its words and gains the right extension; an
 * opaque id becomes "PDF document.pdf" instead of "1234".
 */
export function friendlyName(raw: string, format: FileFormat): string {
	const ext = format === "unknown" ? "" : `.${format}`;
	if (isOpaqueName(raw)) return `${FRIENDLY[kindOf(format)]}${ext}`;
	return extensionOf(raw) ? raw : `${raw}${ext}`;
}

// ---------- Sniffing ----------

const latin1 = new TextDecoder("latin1");

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
	if (bytes.length < magic.length) return false;
	return magic.every((b, i) => bytes[i] === b);
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Contains the UTF-16LE encoding of `name` (OLE directory entries
 * store stream names that way). */
function hasUtf16(bytes: Uint8Array, name: string): boolean {
	const first = name.charCodeAt(0);
	const limit = bytes.length - name.length * 2;
	for (let i = 0; i <= limit; i++) {
		if (bytes[i] !== first || bytes[i + 1] !== 0) continue;
		let match = true;
		for (let j = 1; j < name.length; j++) {
			if (
				bytes[i + j * 2] !== name.charCodeAt(j) ||
				bytes[i + j * 2 + 1] !== 0
			) {
				match = false;
				break;
			}
		}
		if (match) return true;
	}
	return false;
}

function oleFamily(bytes: Uint8Array): FileFormat {
	if (hasUtf16(bytes, "WordDocument")) return "doc";
	if (hasUtf16(bytes, "PowerPoint Document")) return "ppt";
	if (hasUtf16(bytes, "Workbook") || hasUtf16(bytes, "Book")) return "xls";
	return "unknown";
}

function zipFamily(bytes: Uint8Array): FileFormat {
	try {
		const entries = unzipSync(bytes, {
			filter: (f) => f.name === "[Content_Types].xml" || f.name === "mimetype",
		});
		const odf = entries.mimetype && latin1.decode(entries.mimetype);
		if (odf) {
			if (odf.includes("opendocument.text")) return "odt";
			if (odf.includes("opendocument.spreadsheet")) return "ods";
			if (odf.includes("opendocument.presentation")) return "odp";
		}
		const types = entries["[Content_Types].xml"];
		if (types) {
			const xml = latin1.decode(types);
			if (xml.includes("wordprocessingml")) return "docx";
			if (xml.includes("spreadsheetml")) return "xlsx";
			if (xml.includes("presentationml")) return "pptx";
		}
	} catch {
		// Not a readable zip.
	}
	return "unknown";
}

function looksLikeText(head: Uint8Array): boolean {
	if (head.length === 0) return true;
	let control = 0;
	for (const c of head) {
		if (c === 0) return false;
		if (c < 9 || (c > 13 && c < 32)) control++;
	}
	return control / head.length < 0.05;
}

/**
 * Decide the real format from the bytes. The name refines only what
 * bytes cannot say (CSV vs Markdown vs plain text).
 */
export function sniffFormat(buffer: ArrayBuffer, nameHint = ""): FileFormat {
	const bytes = new Uint8Array(buffer);
	const head = bytes.subarray(0, 1024);
	const hinted = formatFromName(nameHint);

	// %PDF may be preceded by junk; the spec tolerates 1 KB of it.
	if (latin1.decode(head).includes("%PDF-")) return "pdf";
	if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return zipFamily(bytes);
	if (startsWith(bytes, OLE_MAGIC)) return oleFamily(bytes);
	if (latin1.decode(head.subarray(0, 5)) === "{\\rtf") return "rtf";

	const utf16 =
		startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff]);
	if (!utf16 && !looksLikeText(head)) return "unknown";
	if (hinted === "csv" || hinted === "md") return hinted;
	return "txt";
}
