import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { type SlideElement, parsePptx, parsePptxAsync } from "./parse";

const deck = () =>
	parsePptx(new Uint8Array(readFileSync("fixtures/sample.pptx")));

const texts = (els: SlideElement[]) =>
	els.flatMap((e) =>
		e.kind === "shape" && e.text
			? e.text.paras.map((p) => p.runs.map((r) => r.text).join(""))
			: [],
	);

describe("parsePptx", () => {
	it("reads slide size and order", () => {
		const p = deck();
		expect(p.width).toBe(960);
		expect(p.height).toBe(720);
		expect(p.slides).toHaveLength(3);
		expect(texts(p.slides[0].elements)).toContain("Quarterly Review");
	});

	it("inherits placeholder geometry and master text styles", () => {
		const title = deck().slides[0].elements.find(
			(e) => e.kind === "shape" && texts([e]).includes("Quarterly Review"),
		);
		expect(title?.kind).toBe("shape");
		if (title?.kind !== "shape") return;
		// The slide's title has no xfrm of its own; it comes from the layout.
		expect(title.w).toBeGreaterThan(400);
		expect(title.text?.paras[0].align).toBe("center");
		expect(title.text?.paras[0].runs[0].size).toBeGreaterThan(40);
	});

	it("keeps explicit fills, run formatting and bullet levels", () => {
		const els = deck().slides[1].elements;
		const box = els.find(
			(e) => e.kind === "shape" && texts([e]).includes("Green box"),
		);
		if (box?.kind !== "shape") throw new Error("box missing");
		expect(box.fill).toBe("rgb(31, 138, 76)");
		const run = box.text?.paras[0].runs[0];
		expect(run?.bold).toBe(true);
		expect(run?.size).toBeCloseTo((20 * 4) / 3);
		const body = els.find(
			(e) => e.kind === "shape" && texts([e]).includes("Churn down"),
		);
		if (body?.kind !== "shape") throw new Error("body missing");
		expect(body.text?.paras[1].level).toBe(1);
		expect(body.text?.paras[0].bullet).toBeTruthy();
	});

	it("reads tables and speaker notes", () => {
		const slide = deck().slides[2];
		const table = slide.elements.find((e) => e.kind === "table");
		if (table?.kind !== "table") throw new Error("table missing");
		expect(table.rows).toHaveLength(2);
		expect(table.rows[1].cells[1].text.paras[0].runs[0].text).toBe("R2C2");
		expect(slide.notes).toBe("Speaker note text");
	});
});

describe("parsePptxAsync", () => {
	const bytes = () =>
		new Uint8Array(readFileSync("fixtures/viewer-regressions/charts.pptx"));
	// Every step looks slow, so the reader pauses between all of them.
	const slowClock = () => {
		let now = 0;
		return vi.spyOn(performance, "now").mockImplementation(() => {
			now += 20;
			return now;
		});
	};

	it("reads the same deck as the one-go reader", async () => {
		const clock = slowClock();
		const deck = await parsePptxAsync(bytes());
		clock.mockRestore();
		const whole = parsePptx(bytes());
		expect(deck.slides.length).toBe(whole.slides.length);
		expect(JSON.stringify(deck.slides)).toBe(JSON.stringify(whole.slides));
	});

	it("stops at the next pause when aborted", async () => {
		const clock = slowClock();
		const abort = new AbortController();
		abort.abort();
		await expect(parsePptxAsync(bytes(), abort.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
		clock.mockRestore();
	});
});
