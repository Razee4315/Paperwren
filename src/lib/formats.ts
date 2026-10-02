/**
 * The format registry: every file type Paperwren opens, how it is
 * recognised, and which viewer shows it. Bytes decide; the name is
 * only a hint (Android pickers hand out extension-less content URIs,
 * and file managers lie about extensions).
 */

import { unzipSync } from "fflate";
import { msg, t } from "./i18n";

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
	| "image"
	| "unknown";

/** The family drives colour, icon, and filter chips. */
export type FormatKind =
	| "pdf"
	| "doc"
	| "sheet"
	| "slides"
	| "text"
	| "image"
	| "other";

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
	"image",
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
	png: "image",
	jpg: "image",
	jpeg: "image",
	gif: "image",
	webp: "image",
	bmp: "image",
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
		case "image":
			return "image";
		default:
			return "other";
	}
}

const MB = 1024 * 1024;

/**
 * The size above which opening a file is slow, or more than a phone
 * can hold: the reader is asked first. A PDF is drawn page by page, so
 * it can be far larger than an Office file, which is unpacked and laid
 * out whole (and is several times its size once unpacked).
 */
export function largeFileLimit(format: FileFormat): number {
	switch (kindOf(format)) {
		case "pdf":
			return 200 * MB;
		case "image":
			return 60 * MB;
		case "other":
			return 100 * MB;
		default:
			return 40 * MB;
	}
}

/** Going by the name: the bytes have not been read yet. An unknown
 * size (some providers do not say) is never called large. */
export function isLargeFile(name: string, size: number): boolean {
	return size > largeFileLimit(formatFromName(name));
}

const KIND_LABEL: Record<FormatKind, string> = {
	pdf: msg("PDF"),
	doc: msg("Documents"),
	sheet: msg("Sheets"),
	slides: msg("Slides"),
	text: msg("Text"),
	image: msg("Pictures"),
	other: msg("Other"),
};

/** A family's name, in the interface language. */
export const kindLabel = (kind: FormatKind): string => t(KIND_LABEL[kind]);

export function formatLabel(format: FileFormat): string {
	return format === "unknown"
		? "FILE"
		: format === "image"
			? "IMG"
			: format.toUpperCase();
}

const FRIENDLY: Record<FormatKind, string> = {
	pdf: "PDF document",
	doc: "Document",
	sheet: "Spreadsheet",
	slides: "Presentation",
	text: "Text file",
	image: "Picture",
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
	// A picture's real type is in its bytes, not in "image".
	const ext = format === "unknown" || format === "image" ? "" : `.${format}`;
	if (isOpaqueName(raw)) return `${FRIENDLY[kindOf(format)]}${ext}`;
	return extensionOf(raw) ? raw : `${raw}${ext}`;
}

const MIME: Record<FileFormat, string> = {
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	doc: "application/msword",
	odt: "application/vnd.oasis.opendocument.text",
	rtf: "application/rtf",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	xls: "application/vnd.ms-excel",
	ods: "application/vnd.oasis.opendocument.spreadsheet",
	csv: "text/csv",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	ppt: "application/vnd.ms-powerpoint",
	odp: "application/vnd.oasis.opendocument.presentation",
	md: "text/markdown",
	txt: "text/plain",
	image: "image/*",
	unknown: "application/octet-stream",
};

const IMAGE_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
};

/** The media type other apps expect for a file of this format. A
 * picture's exact type comes from its name. */
export function mimeOf(format: FileFormat, name = ""): string {
	if (format === "image") return IMAGE_MIME[extensionOf(name)] ?? MIME.image;
	return MIME[format];
}

/** A picture's type from its first bytes, or null. */
export function sniffImageType(bytes: Uint8Array): string | null {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	)
		return "image/webp";
	// "BM" alone is two letters; a real bitmap also states its own size.
	if (startsWith(bytes, [0x42, 0x4d]) && bytes.length > 26) {
		const size =
			(bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24)) >>> 0;
		if (size === bytes.length || size === 0) return "image/bmp";
	}
	return null;
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

/**
 * A password-protected .docx/.xlsx/.pptx: not a zip but an OLE
 * container around the enciphered file. What it holds is only known
 * once it is unlocked (see office/crypto.ts).
 */
export function isEncryptedPackage(buffer: ArrayBuffer): boolean {
	const bytes = new Uint8Array(buffer);
	return (
		startsWith(bytes, OLE_MAGIC) &&
		hasUtf16(bytes, "EncryptedPackage") &&
		hasUtf16(bytes, "EncryptionInfo")
	);
}

function oleFamily(bytes: Uint8Array): FileFormat {
	if (hasUtf16(bytes, "WordDocument")) return "doc";
	if (hasUtf16(bytes, "PowerPoint Document")) return "ppt";
	if (hasUtf16(bytes, "Workbook") || hasUtf16(bytes, "Book")) return "xls";
	return "unknown";
}

/**
 * Which Office family a package is, from its [Content_Types].xml.
 * Only the MAIN part decides: a deck with a chart embeds a workbook
 * (and a report may embed a deck), so merely mentioning another
 * family's content type says nothing about the file itself.
 */
export function ooxmlFamily(xml: string): FileFormat {
	const families: Array<[FileFormat, RegExp, RegExp]> = [
		[
			"pptx",
			/(presentationml\.(presentation|slideshow|template)|ms-powerpoint\.[a-z.]+)\.main\+xml/i,
			/PartName="\/ppt\/presentation\.xml"/i,
		],
		[
			"docx",
			/(wordprocessingml\.(document|template)|ms-word\.[a-z.]+)\.main\+xml/i,
			/PartName="\/word\/document\.xml"/i,
		],
		[
			"xlsx",
			/(spreadsheetml\.(sheet|template)|ms-excel\.[a-z.]+)\.main(\+xml)?"/i,
			/PartName="\/xl\/workbook\.(xml|bin)"/i,
		],
	];
	for (const [format, mainType] of families)
		if (mainType.test(xml)) return format;
	for (const [format, , mainPart] of families)
		if (mainPart.test(xml)) return format;
	// Unusual writers: fall back to whichever family is named at all.
	if (xml.includes("presentationml")) return "pptx";
	if (xml.includes("wordprocessingml")) return "docx";
	if (xml.includes("spreadsheetml")) return "xlsx";
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
		if (types) return ooxmlFamily(latin1.decode(types));
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
	if (sniffImageType(bytes)) return "image";

	const utf16 =
		startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff]);
	if (!utf16 && !looksLikeText(head)) return "unknown";
	if (hinted === "csv" || hinted === "md") return hinted;
	return "txt";
}
