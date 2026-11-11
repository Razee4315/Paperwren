/**
 * docx-preview, with two things it gets wrong put right between its
 * reading of the file and its drawing of it.
 *
 * - A table's indent (w:tblInd) is looked for under names Word never
 *   writes ("left", "start"; Word writes "w"), so it is lost. Forms
 *   often pull a wide table into the left margin; without the indent it
 *   starts at the margin and runs off the page's right edge.
 * - A picture kept as EMF shows as a broken image. Most are a wrapper
 *   around one bitmap, which is shown instead (lib/office/emf.ts).
 * - A file with no page settings (some scripts and web exports write
 *   none) shows as a small box around its text. Word gives it its
 *   default page, and so does this.
 */
import { emfPicture } from "@/lib/office/emf";
import type { Options } from "docx-preview";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

interface Parsed {
	type?: string;
	cssStyle?: Record<string, string>;
	children?: Parsed[];
}

interface PageProps {
	pageSize?: { width?: string; height?: string; orientation?: string };
	pageMargins?: Record<string, string | undefined>;
}

interface ParsedDocument {
	documentPart?: {
		body?: Parsed & { props?: PageProps };
		_xmlDocument?: Document;
	};
	blobToURL?: (blob: Blob | null, path?: string) => unknown;
}

const child = (el: Element, name: string) =>
	Array.from(el.children).find(
		(c) => c.namespaceURI === W && c.localName === name,
	);

/** Each table's indent from the file's own XML, onto the parsed table,
 * matched in document order. Nothing changes if the two lists differ. */
export function indentTables(doc: ParsedDocument): number {
	const xml = doc.documentPart?._xmlDocument;
	const body = doc.documentPart?.body;
	if (!xml || !body) return 0;
	const sources = Array.from(xml.getElementsByTagNameNS(W, "tbl"));
	const tables: Parsed[] = [];
	const walk = (node: Parsed) => {
		if (node.type === "table") tables.push(node);
		for (const c of node.children ?? []) walk(c);
	};
	walk(body);
	if (!sources.length || tables.length !== sources.length) return 0;
	let moved = 0;
	sources.forEach((source, i) => {
		const props = child(source, "tblPr");
		const ind = props && child(props, "tblInd");
		if (!ind) return;
		const kind = ind.getAttributeNS(W, "type") || "dxa";
		const twips = Number(ind.getAttributeNS(W, "w"));
		if (kind !== "dxa" || !Number.isFinite(twips) || !twips) return;
		const style = tables[i].cssStyle ?? {};
		tables[i].cssStyle = style;
		// Centred, right-aligned and floating tables place themselves;
		// Word ignores the indent for those too.
		if (style["margin-left"] || style["margin-inline-start"] || style.float)
			return;
		style["margin-left"] = `${twips / 20}pt`;
		moved++;
	});
	return moved;
}

/** Where people print on Letter paper; everywhere else uses A4. */
const LETTER = /-(US|CA|MX|PH|CL|CO|VE|GT|CR|PA|DO|PR|SV|NI|HN|BO)$/i;

/** Word's own page for a document that names none: Letter or A4, as
 * the reader's region prints, with inch margins. In points. */
export function defaultPage(locale: string): Required<PageProps> {
	const letter = LETTER.test(locale);
	return {
		pageSize: {
			width: letter ? "612.00pt" : "595.30pt",
			height: letter ? "792.00pt" : "841.90pt",
		},
		pageMargins: {
			left: "72.00pt",
			right: "72.00pt",
			top: "72.00pt",
			bottom: "72.00pt",
			header: "36.00pt",
			footer: "36.00pt",
		},
	};
}

/** The document's page, where the file gives none (or only part of
 * one): Word's default. Returns whether anything was filled in. */
export function fillPage(doc: ParsedDocument, locale: string): boolean {
	const body = doc.documentPart?.body;
	if (!body) return false;
	const props = body.props ?? {};
	body.props = props;
	const page = defaultPage(locale);
	let filled = false;
	if (!props.pageSize?.width) {
		props.pageSize = { ...page.pageSize, ...props.pageSize };
		props.pageSize.width = page.pageSize.width;
		props.pageSize.height ||= page.pageSize.height;
		filled = true;
	}
	if (!props.pageMargins?.left) {
		props.pageMargins = { ...page.pageMargins, ...props.pageMargins };
		for (const [side, length] of Object.entries(page.pageMargins))
			props.pageMargins[side] ||= length;
		filled = true;
	}
	return filled;
}

/** Pictures stored as EMF shown from the bitmap inside, where there
 * is one. */
function showEmf(doc: ParsedDocument) {
	const original = doc.blobToURL;
	if (typeof original !== "function") return;
	doc.blobToURL = function (blob, path) {
		if (!blob || !path || !/\.emf$/i.test(path))
			return original.call(this, blob, path);
		return blob
			.arrayBuffer()
			.then((buffer) => {
				const picture = emfPicture(new Uint8Array(buffer));
				return picture
					? original.call(
							this,
							new Blob([picture.bytes as BlobPart], { type: picture.type }),
						)
					: original.call(this, blob, path);
			})
			.catch(() => original.call(this, blob, path));
	};
}

/** docx-preview's renderAsync, with the repairs above. `paper` is false
 * in Reading view, where widths are ignored and an indent would push a
 * table off the screen. */
export async function renderDocx(
	data: ArrayBuffer,
	into: HTMLElement,
	options: Partial<Options>,
	paper: boolean,
): Promise<void> {
	const docx = await import("docx-preview");
	const settings = { ...options, keepOrigin: true } as Partial<Options>;
	const doc = (await docx.parseAsync(data, settings)) as ParsedDocument;
	if (paper) {
		indentTables(doc);
		fillPage(doc, navigator.language || "en");
	}
	showEmf(doc);
	const nodes = await docx.renderDocument(doc, settings);
	into.innerHTML = "";
	for (const node of nodes) into.appendChild(node);
}
