/**
 * Recognising a file from its bytes. Bytes decide; the name is only a
 * hint (Android pickers hand out extension-less content URIs, and file
 * managers lie about extensions). Kept apart from the format registry
 * so Home's first paint does not carry the unzip code.
 */

import { type FileFormat, formatFromName } from "./formats";
import { guardedUnzip } from "./safeZip";

/** ISO media brands of pictures (the box after "ftyp"). */
const AVIF = ["avif", "avis"];
const HEIC = ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"];

/** A picture in an ISO media file (AVIF, HEIC): its brands decide. */
function isoPicture(bytes: Uint8Array): string | null {
	if (bytes.length < 16 || latin1.decode(bytes.subarray(4, 8)) !== "ftyp")
		return null;
	const size = Math.min(
		bytes.length,
		((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0,
	);
	const brands: string[] = [latin1.decode(bytes.subarray(8, 12))];
	for (let at = 16; at + 4 <= size; at += 4)
		brands.push(latin1.decode(bytes.subarray(at, at + 4)));
	if (brands.some((b) => AVIF.includes(b))) return "image/avif";
	if (brands.some((b) => HEIC.includes(b) || b === "mif1" || b === "msf1"))
		return "image/heic";
	return null;
}

/** An SVG drawing: XML text whose first element is <svg>. */
function isSvg(bytes: Uint8Array): boolean {
	const head = new TextDecoder("utf-8")
		.decode(bytes.subarray(0, 2048))
		.replace(/^\uFEFF/, "");
	return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
		head,
	);
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
	if (
		startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
		startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
	)
		return "image/tiff";
	const iso = isoPicture(bytes);
	if (iso) return iso;
	if (isSvg(bytes)) return "image/svg+xml";
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
 * store stream names that way). The engine's own search jumps to each
 * candidate first byte, which is several times faster than stepping
 * through a large file one byte at a time on the main thread. */
function hasUtf16(bytes: Uint8Array, name: string): boolean {
	const first = name.charCodeAt(0);
	const limit = bytes.length - name.length * 2;
	for (
		let i = bytes.indexOf(first);
		i !== -1 && i <= limit;
		i = bytes.indexOf(first, i + 1)
	) {
		if (bytes[i + 1] !== 0) continue;
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

/** Pictures a comic book archive is made of. */
export const COMIC_PAGE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
/** What else a comic archive carries: notes about it, not pages. */
const COMIC_NOTES = /(^|\/)(comicinfo\.xml|[^/]*\.(txt|nfo|sfv|url|md))$/i;

function zipFamily(bytes: Uint8Array): FileFormat {
	try {
		const names: string[] = [];
		const entries = guardedUnzip(bytes, {
			filter: (f) => {
				names.push(f.name);
				return f.name === "[Content_Types].xml" || f.name === "mimetype";
			},
		});
		const odf = entries.mimetype && latin1.decode(entries.mimetype);
		if (odf) {
			if (odf.includes("opendocument.text")) return "odt";
			if (odf.includes("opendocument.spreadsheet")) return "ods";
			if (odf.includes("opendocument.presentation")) return "odp";
			if (odf.includes("application/epub+zip")) return "epub";
		}
		const types = entries["[Content_Types].xml"];
		if (types) return ooxmlFamily(latin1.decode(types));
		// A comic book: an archive of pictures, and little else (what is
		// said about it: ComicInfo.xml, a note, a checksum list).
		const files = names.filter(
			(n) => !n.endsWith("/") && !isJunk(n) && !COMIC_NOTES.test(n),
		);
		const pages = files.filter((n) => COMIC_PAGE.test(n));
		if (pages.length && pages.length >= files.length * 0.8) return "cbz";
	} catch {
		// Not a readable zip.
	}
	return "unknown";
}

/** What an archive carries besides its contents (a Mac's resource
 * forks, a folder's thumbnails). */
export const isJunk = (name: string) =>
	/(^|\/)(__MACOSX\/|\.|Thumbs\.db$)/i.test(name);

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
