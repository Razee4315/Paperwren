/**
 * Magic-byte format sniffing (docs/10 section 3): file managers and
 * content providers lie about names constantly — on Android the
 * picker often hands over a numeric ID with no extension at all.
 * The bytes decide; the name is only a fallback hint.
 */

import type { FileFormat } from "@/components/FormatBadge";
import { unzipSync } from "fflate";

const decoder = new TextDecoder("latin1");

/** OOXML files are ZIPs whose members are deflate-compressed, so
 * the family marker is not plaintext in the head. Decompress only
 * [Content_Types].xml and read the family from it. */
function ooxmlFamily(bytes: ArrayBuffer): FileFormat | null {
	try {
		const entries = unzipSync(new Uint8Array(bytes), {
			filter: (file) => file.name === "[Content_Types].xml",
		});
		const xml = entries["[Content_Types].xml"];
		if (!xml) return null;
		const text = decoder.decode(xml);
		if (text.includes("wordprocessingml")) return "docx";
		if (text.includes("spreadsheetml")) return "xlsx";
		if (text.includes("presentationml")) return "pptx";
		return null;
	} catch {
		return null;
	}
}

/** PDFs open with %PDF-. Office OOXML files are ZIPs whose package
 * declares the family in [Content_Types].xml. */
export function sniffFormat(bytes: ArrayBuffer, name: string): FileFormat {
	const head = decoder.decode(bytes.slice(0, 1024));

	// Magic bytes first.
	if (head.startsWith("%PDF")) return "pdf";
	if (head.startsWith("PK")) {
		const family = ooxmlFamily(bytes);
		if (family) return family;
		// A zip without an Office marker: not a format we claim.
		return "unknown";
	}
	if (head.startsWith("{\\rtf")) return "unknown";

	// Text-ish formats: no magic, so take the extension when the
	// name carries one, else assume plain text over unknown.
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (ext === "md" || ext === "markdown") return "txt";
	if (ext === "csv") return "csv";
	if (ext === "txt") return "txt";
	if (ext === "docx" || ext === "xlsx" || ext === "pptx") {
		// Name claims OOXML but the bytes disagree (truncated file):
		// let the bytes win, the viewer will show the honest error.
		return "unknown";
	}
	if (ext === "pdf") return "unknown";

	// Binary heuristics: the OLE compound-document magic (pre-2007
	// Office) or a head dominated by control bytes means the file is
	// not text and not a format we claim.
	if (head.startsWith("\u00d0\u00cf\u0011\u00e0")) return "unknown";
	let control = 0;
	for (let i = 0; i < head.length; i++) {
		const c = head.charCodeAt(i);
		if ((c < 9 && c !== 0) || (c > 13 && c < 32)) control++;
	}
	if (head.length > 0 && control / head.length > 0.3) return "unknown";
	return "txt";
}

/** Pre-2007 Office binary formats open with the OLE compound
 * document magic; they get their own honest dialog. Detached
 * buffers (pdf.js took ownership) read as not-legacy instead of
 * throwing. */
export function isLegacyOffice(bytes: ArrayBuffer): boolean {
	try {
		const head = new Uint8Array(bytes.slice(0, 8));
		return (
			head[0] === 0xd0 &&
			head[1] === 0xcf &&
			head[2] === 0x11 &&
			head[3] === 0xe0
		);
	} catch {
		return false;
	}
}

/** Best-effort display name for content URIs whose last segment is
 * an opaque ID: falls back to a friendly label per sniffed format. */
export function displayNameFor(name: string, format: FileFormat): string {
	if (name.includes(".")) return name;
	const label: Record<FileFormat, string> = {
		pdf: "Document.pdf",
		docx: "Document.docx",
		xlsx: "Spreadsheet.xlsx",
		pptx: "Presentation.pptx",
		csv: "Data.csv",
		txt: "Text.txt",
		unknown: "File",
	};
	return label[format] ?? name;
}
