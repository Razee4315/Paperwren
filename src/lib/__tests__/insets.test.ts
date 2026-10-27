import { afterEach, describe, expect, it } from "vitest";
import {
	applyInsets,
	followNativeInsets,
	parseInsets,
	toInsets,
} from "../insets";

const root = document.documentElement;
const inset = (side: string) =>
	root.style.getPropertyValue(`--native-inset-${side}`);

afterEach(() => {
	for (const side of ["top", "right", "bottom", "left"])
		root.style.removeProperty(`--native-inset-${side}`);
	window.__paperwrenAndroidExtras = undefined;
	window.__paperwrenInsets = undefined;
});

describe("system bar insets", () => {
	it("reads what the shell reports, and nothing else", () => {
		expect(parseInsets('{"top":24,"right":0,"bottom":48,"left":0}')).toEqual({
			top: 24,
			right: 0,
			bottom: 48,
			left: 0,
		});
		expect(parseInsets("null")).toBeNull();
		expect(parseInsets("")).toBeNull();
		expect(parseInsets("not json")).toBeNull();
		expect(toInsets({ top: -3, bottom: "48", left: Number.NaN })).toEqual({
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		});
	});

	it("hands the sizes to the CSS", () => {
		applyInsets({ top: 24.5, right: 0, bottom: 48, left: 0 });
		expect(inset("top")).toBe("24.5px");
		expect(inset("bottom")).toBe("48px");
		expect(inset("left")).toBe("0px");
	});

	it("follows the Android shell from the start and on every change", () => {
		window.__paperwrenAndroidExtras = {
			insets: () => '{"top":30,"right":0,"bottom":56,"left":0}',
		} as unknown as NonNullable<Window["__paperwrenAndroidExtras"]>;
		followNativeInsets();
		expect(inset("top")).toBe("30px");
		expect(inset("bottom")).toBe("56px");
		// A slide show hides the bars.
		window.__paperwrenInsets?.({ top: 0, right: 0, bottom: 0, left: 0 });
		expect(inset("top")).toBe("0px");
		expect(inset("bottom")).toBe("0px");
	});

	it("leaves a desktop or an older shell alone", () => {
		followNativeInsets();
		expect(inset("top")).toBe("");
		expect(window.__paperwrenInsets).toBeUndefined();
	});
});
