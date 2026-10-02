import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { niceTicks } from "../../screens/viewer/SlideChart";
import { type Chart, parsePptx } from "./parse";

const deck = () =>
	parsePptx(
		new Uint8Array(readFileSync("fixtures/viewer-regressions/charts.pptx")),
	);

function chartOn(slide: number): Chart {
	const el = deck().slides[slide].elements.find((e) => e.kind === "chart");
	if (el?.kind !== "chart") throw new Error(`no chart on slide ${slide + 1}`);
	return el.chart;
}

describe("slide charts", () => {
	it("reads clustered columns with their title, legend and cached values", () => {
		const chart = chartOn(0);
		if (chart.kind !== "cartesian") throw new Error("wrong kind");
		expect(chart.title).toBe("Quarterly results");
		expect(chart.legend).toBe(true);
		expect(chart.horizontal).toBe(false);
		expect(chart.stack).toBe("none");
		expect(chart.categories).toEqual(["Q1", "Q2", "Q3", "Q4"]);
		expect(chart.series.map((s) => [s.name, s.kind])).toEqual([
			["Revenue", "bar"],
			["Costs", "bar"],
		]);
		expect(chart.series[0].values).toEqual([120, 150, 170, 210]);
		// No colour in the file: consecutive theme accents.
		expect(chart.series[0].color).not.toBe(chart.series[1].color);
	});

	it("reads stacked sideways bars and lines", () => {
		const bars = chartOn(1);
		if (bars.kind !== "cartesian") throw new Error("wrong kind");
		expect(bars.horizontal).toBe(true);
		expect(bars.stack).toBe("stacked");
		const lines = chartOn(2);
		if (lines.kind !== "cartesian") throw new Error("wrong kind");
		expect(lines.series.every((s) => s.kind === "line")).toBe(true);
		expect(lines.series[1].values).toEqual([90, 100, 130, 140]);
	});

	it("reads pie slices and scatter points", () => {
		const pie = chartOn(3);
		if (pie.kind !== "pie") throw new Error("wrong kind");
		expect(pie.hole).toBe(0);
		expect(pie.slices.map((s) => [s.label, s.value])).toEqual([
			["Mobile", 0.62],
			["Desktop", 0.3],
			["Tablet", 0.08],
		]);
		expect(new Set(pie.slices.map((s) => s.color)).size).toBe(3);
		const scatter = chartOn(4);
		if (scatter.kind !== "scatter") throw new Error("wrong kind");
		expect(scatter.series[0].points).toEqual([
			{ x: 1, y: 2.1 },
			{ x: 2, y: 3.9 },
			{ x: 3, y: 6.2 },
			{ x: 4, y: 7.8 },
		]);
		expect(scatter.series[0].line).toBe(false);
	});

	it("leaves chart types it cannot draw as a labelled placeholder", () => {
		const radar = deck().slides[5].elements;
		expect(radar.some((e) => e.kind === "chart")).toBe(false);
		expect(
			radar.some((e) => e.kind === "placeholder" && e.label === "Chart"),
		).toBe(true);
	});
});

describe("niceTicks", () => {
	it("covers the range with round steps", () => {
		expect(niceTicks(0, 210)).toEqual([0, 50, 100, 150, 200, 250]);
		expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
		expect(niceTicks(-30, 70)).toEqual([-40, -20, 0, 20, 40, 60, 80]);
		expect(niceTicks(5, 5)).toEqual([5]);
	});
});
