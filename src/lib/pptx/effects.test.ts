import { readFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type SlideElement, parsePptx } from "./parse";

type Shape = Extract<SlideElement, { kind: "shape" }>;

describe("shadows, gradients and SmartArt", () => {
	const original = URL.createObjectURL;
	beforeAll(() => {
		URL.createObjectURL = () => "blob:test";
	});
	afterAll(() => {
		URL.createObjectURL = original;
	});
	const deck = () =>
		parsePptx(
			new Uint8Array(readFileSync("fixtures/viewer-regressions/effects.pptx")),
		);
	const shapes = (slide: number) =>
		deck().slides[slide].elements.filter((e): e is Shape => e.kind === "shape");

	it("reads an outer shadow as an offset, a blur and a colour", () => {
		const card = shapes(0).find((s) => s.geom === "roundRect");
		// 4.5pt at 45 degrees: 6px away, 4.24px each way; 6pt blur = 8px.
		expect(card?.shadow).toBe("4.24px 4.24px 8px rgba(0, 0, 0, 0.450)");
		const picture = deck().slides[0].elements.find((e) => e.kind === "image");
		expect(picture?.kind === "image" && picture.shadow).toBe(
			"4.24px 4.24px 8px rgba(0, 0, 0, 0.450)",
		);
		// No effect list, no shadow.
		expect(
			shapes(0).find((s) => s.geom === "triangle")?.shadow,
		).toBeUndefined();
	});

	it("keeps a gradient's stops and angle, whatever the outline", () => {
		const triangle = shapes(0).find((s) => s.geom === "triangle");
		expect(triangle?.gradient).toEqual({
			kind: "linear",
			angle: 90,
			stops: [
				{ at: 0, color: "rgb(43, 110, 102)" },
				{ at: 100, color: "rgb(242, 193, 78)" },
			],
		});
		const ball = shapes(0).find((s) => s.geom === "ellipse");
		expect(ball?.gradient?.kind).toBe("radial");
		expect(ball?.gradient?.stops.map((s) => s.color)).toEqual([
			"rgb(255, 255, 255)",
			"rgb(198, 40, 40)",
		]);
		const freeform = shapes(0).find((s) => s.paths);
		expect(freeform?.gradient).toMatchObject({ kind: "linear", angle: 0 });
		expect(freeform?.shadow).toBeDefined();
	});

	it("draws SmartArt from the shapes saved in its drawing part", () => {
		const all = deck().slides[1].elements;
		expect(all.some((e) => e.kind === "placeholder")).toBe(false);
		const boxes = shapes(1).filter((s) => s.geom === "roundRect");
		expect(boxes).toHaveLength(3);
		// Placed inside the frame: its corner plus each shape's own offset.
		expect(boxes.map((b) => Math.round(b.x))).toEqual([200, 400, 600]);
		expect(boxes.every((b) => Math.round(b.y) === 280)).toBe(true);
		expect(boxes[0]).toMatchObject({
			w: 160,
			h: 96,
			fill: "rgb(43, 110, 102)",
		});
		// Their text sits where the diagram says, in the style's colour.
		const labels = shapes(1).filter((s) => s.text);
		expect(labels.map((s) => s.text?.paras[0].runs[0].text)).toEqual([
			"Plan",
			"Build",
			"Ship",
		]);
		expect(labels[0].text?.paras[0].runs[0].color).toBe("rgb(255, 255, 255)");
		expect(labels[0]).toMatchObject({ x: 200, y: 280 });
	});

	it("falls back to a labelled box when no drawing was saved", () => {
		// The same slide, read without its drawing part.
		const files = unzipSync(
			new Uint8Array(readFileSync("fixtures/viewer-regressions/effects.pptx")),
			{ filter: (f) => f.name !== "ppt/diagrams/drawing1.xml" },
		);
		const slide = parsePptx(zipSync(files)).slides[1];
		const box = slide.elements.find((e) => e.kind === "placeholder");
		expect(box?.kind === "placeholder" && box.label).toBe("Diagram");
	});
});
