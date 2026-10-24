/**
 * What an Office or OpenDocument file says about itself: its title and
 * author, when it was made and last changed and by whom, and how long
 * it is. Read from its properties (docProps/core.xml and app.xml, or an
 * OpenDocument's meta.xml), for Details.
 */

import type { FileFormat } from "./formats";
import { guardedUnzip } from "./safeZip";

export interface OfficeMeta {
	title?: string;
	subject?: string;
	author?: string;
	lastAuthor?: string;
	created?: Date;
	modified?: Date;
	application?: string;
	pages?: number;
	words?: number;
	slides?: number;
}

const ZIPPED: FileFormat[] = ["docx", "xlsx", "pptx", "odt", "ods", "odp"];
const PARTS = ["docProps/core.xml", "docProps/app.xml", "meta.xml"];

const utf8 = new TextDecoder("utf-8");

function first(doc: Document, names: string[]): string | undefined {
	for (const name of names) {
		const [prefix, local] = name.includes(":") ? name.split(":") : ["", name];
		const found =
			[...doc.getElementsByTagNameNS("*", local)].find(
				(el) => !prefix || el.prefix === prefix || el.nodeName === name,
			) ?? null;
		const text = found?.textContent?.replace(/\s+/g, " ").trim();
		if (text) return text;
	}
	return undefined;
}

function date(text: string | undefined): Date | undefined {
	if (!text) return undefined;
	const d = new Date(text);
	return Number.isNaN(d.getTime()) || d.getFullYear() < 1980 ? undefined : d;
}

function count(text: string | undefined): number | undefined {
	const n = text ? Number.parseInt(text, 10) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The properties of a zipped Office or OpenDocument file; empty for any
 * other file, or one whose properties cannot be read. */
export function readOfficeMeta(
	data: ArrayBuffer,
	format: FileFormat,
): OfficeMeta {
	if (!ZIPPED.includes(format)) return {};
	let parts: Record<string, Uint8Array>;
	try {
		parts = guardedUnzip(new Uint8Array(data), {
			filter: (f) => PARTS.includes(f.name),
		});
	} catch {
		return {};
	}
	const parse = (name: string) => {
		const bytes = parts[name];
		if (!bytes) return null;
		const doc = new DOMParser().parseFromString(
			utf8.decode(bytes),
			"application/xml",
		);
		return doc.getElementsByTagName("parsererror").length ? null : doc;
	};
	const meta: OfficeMeta = {};
	const core = parse("docProps/core.xml");
	if (core) {
		meta.title = first(core, ["dc:title"]);
		meta.subject = first(core, ["dc:subject"]);
		meta.author = first(core, ["dc:creator"]);
		meta.lastAuthor = first(core, ["cp:lastModifiedBy"]);
		meta.created = date(first(core, ["dcterms:created"]));
		meta.modified = date(first(core, ["dcterms:modified"]));
	}
	const app = parse("docProps/app.xml");
	if (app) {
		meta.application = first(app, ["Application"]);
		meta.pages = count(first(app, ["Pages"]));
		meta.words = count(first(app, ["Words"]));
		meta.slides = count(first(app, ["Slides"]));
	}
	const odf = parse("meta.xml");
	if (odf) {
		meta.title ??= first(odf, ["dc:title"]);
		meta.subject ??= first(odf, ["dc:subject"]);
		meta.author ??= first(odf, ["meta:initial-creator", "dc:creator"]);
		meta.lastAuthor ??= first(odf, ["dc:creator"]);
		meta.created ??= date(first(odf, ["meta:creation-date"]));
		meta.modified ??= date(first(odf, ["dc:date"]));
		meta.application ??= first(odf, ["meta:generator"])?.split("/")[0];
		const stats = odf.getElementsByTagNameNS("*", "document-statistic")[0];
		if (stats) {
			meta.pages ??= count(stats.getAttribute("meta:page-count") ?? undefined);
			meta.words ??= count(stats.getAttribute("meta:word-count") ?? undefined);
		}
	}
	return meta;
}
