import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePptx } from "./parse";

/**
 * A hand-built deck in the shape current PowerPoint and export tools
 * write: no layout, master or theme to lean on, freeform outlines, a
 * cropped round picture and a picture-filled shape.
 */

const NS =
	'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL =
	"http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rels = (...items: Array<[string, string, string]>) =>
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
		.map(
			([id, type, target]) =>
				`<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`,
		)
		.join("")}</Relationships>`;

const SLIDE = `<p:sld ${NS}><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Freeform"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm>
<a:custGeom><a:pathLst><a:path w="100" h="100">
<a:moveTo><a:pt x="0" y="50"/></a:moveTo>
<a:lnTo><a:pt x="50" y="0"/></a:lnTo>
<a:cubicBezTo><a:pt x="60" y="10"/><a:pt x="90" y="40"/><a:pt x="100" y="50"/></a:cubicBezTo>
<a:arcTo wR="50" hR="50" stAng="0" swAng="5400000"/>
<a:close/></a:path></a:pathLst></a:custGeom>
<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>
<p:pic><p:nvPicPr><p:cNvPr id="3" name="Photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId1"/><a:srcRect l="25000" r="25000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom></p:spPr></p:pic>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Filled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
<a:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:spPr>
<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"/><a:t>Caption</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;

function deck() {
	return zipSync({
		"ppt/presentation.xml": strToU8(
			`<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>`,
		),
		"ppt/_rels/presentation.xml.rels": strToU8(
			rels(["rId1", "slide", "slides/slide1.xml"]),
		),
		"ppt/slides/slide1.xml": strToU8(SLIDE),
		"ppt/slides/_rels/slide1.xml.rels": strToU8(
			rels(["rId1", "image", "../media/image1.png"]),
		),
		"ppt/media/image1.png": new Uint8Array([137, 80, 78, 71]),
	});
}

describe("parsePptx on a modern, master-less deck", () => {
	const original = URL.createObjectURL;
	beforeAll(() => {
		URL.createObjectURL = () => "blob:picture";
	});
	afterAll(() => {
		URL.createObjectURL = original;
	});

	it("shows slides even with no layout, master or theme", () => {
		const p = parsePptx(deck());
		expect(p.slides).toHaveLength(1);
		expect(p.width).toBe(960);
		expect(p.slides[0].elements).toHaveLength(3);
	});

	it("keeps freeform outlines instead of drawing a box", () => {
		const shape = parsePptx(deck()).slides[0].elements[0];
		if (shape.kind !== "shape") throw new Error("shape missing");
		expect(shape.fill).toBe("rgb(255, 0, 0)");
		expect(shape.paths).toHaveLength(1);
		const path = shape.paths?.[0];
		expect(path).toMatchObject({ w: 100, h: 100, fill: true, stroke: true });
		expect(
			path?.d.startsWith("M0 50L50 0C60 10 90 40 100 50A50 50 0 0 1 "),
		).toBe(true);
		// A quarter turn clockwise from (100, 50) around (50, 50) ends at (50, 100).
		const [ex, ey] = (path?.d.match(/A.* ([\d.e-]+) ([\d.e-]+)Z$/) ?? [])
			.slice(1)
			.map(Number);
		expect(ex).toBeCloseTo(50);
		expect(ey).toBeCloseTo(100);
	});

	it("keeps a picture's crop and round frame", () => {
		const pic = parsePptx(deck()).slides[0].elements[1];
		if (pic.kind !== "image") throw new Error("picture missing");
		expect(pic.src).toBe("blob:picture");
		expect(pic.crop).toEqual([0.25, 0, 0.25, 0]);
		expect(pic.round).toBe("ellipse");
	});

	it("reads picture fills on shapes", () => {
		const shape = parsePptx(deck()).slides[0].elements[2];
		if (shape.kind !== "shape") throw new Error("shape missing");
		expect(shape.image).toBe("blob:picture");
		expect(shape.text?.paras[0].runs[0].text).toBe("Caption");
	});
});
