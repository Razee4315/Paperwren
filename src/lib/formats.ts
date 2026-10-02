/**
 * The format registry: every file type Paperwren opens, its family,
 * names and media types. Recognising a file from its bytes lives in
 * sniff.ts, which only the viewer needs (it brings the unzip code).
 */

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
