import { afterEach, describe, expect, it } from "vitest";
import {
	comboOf,
	defaultKeys,
	hintFor,
	isReserved,
	keysFor,
	matches,
	normalizeShortcuts,
	setCustomShortcuts,
	shortcutLabel,
	whoHas,
} from "../shortcuts";

/** A key press, as the browser describes it. */
const press = (
	key: string,
	code: string,
	mods: Partial<
		Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>
	> = {},
	target?: Element,
) =>
	({
		key,
		code,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		target: target ?? document.body,
		...mods,
	}) as unknown as KeyboardEvent;

afterEach(() => setCustomShortcuts({}));

describe("comboOf", () => {
	it("names letters and digits by their place, whatever the layout", () => {
		expect(comboOf(press("r", "KeyR"))).toBe("R");
		// A Russian keyboard types "к" on the R key.
		expect(comboOf(press("к", "KeyR"))).toBe("R");
		expect(comboOf(press("R", "KeyR", { shiftKey: true }))).toBe("Shift+R");
		expect(comboOf(press("@", "Digit2", { shiftKey: true }))).toBe("Shift+2");
	});

	it("takes Ctrl and ⌘ alike, and writes the modifiers in one order", () => {
		expect(comboOf(press("u", "KeyU", { ctrlKey: true, shiftKey: true }))).toBe(
			"Ctrl+Shift+U",
		);
		expect(comboOf(press("]", "BracketRight", { metaKey: true }))).toBe(
			"Ctrl+]",
		);
	});

	it("keeps a symbol as typed, which already says Shift", () => {
		expect(comboOf(press("?", "Slash", { shiftKey: true }))).toBe("?");
		expect(
			comboOf(press("+", "Equal", { ctrlKey: true, shiftKey: true })),
		).toBe("Ctrl++");
	});

	it("names the other keys, and none for a modifier alone", () => {
		expect(comboOf(press("ArrowRight", "ArrowRight"))).toBe("ArrowRight");
		expect(comboOf(press(" ", "Space"))).toBe("Space");
		expect(comboOf(press("F5", "F5"))).toBe("F5");
		expect(comboOf(press("Shift", "ShiftLeft", { shiftKey: true }))).toBeNull();
		expect(
			comboOf(press("Control", "ControlLeft", { ctrlKey: true })),
		).toBeNull();
	});
});

describe("matches", () => {
	it("knows the shortcuts by their own keys", () => {
		expect(matches(press("ArrowRight", "ArrowRight"), "nextPage")).toBe(true);
		expect(matches(press("o", "KeyO", { ctrlKey: true }), "open")).toBe(true);
		expect(matches(press("=", "Equal", { ctrlKey: true }), "zoomIn")).toBe(
			true,
		);
		expect(matches(press("r", "KeyR"), "rotate")).toBe(true);
		expect(matches(press("R", "KeyR", { shiftKey: true }), "rotate")).toBe(
			false,
		);
	});

	it("follows the reader's keys, and a shortcut left with none", () => {
		setCustomShortcuts({ nextPage: ["Ctrl+]"], rotate: [] });
		expect(
			matches(press("]", "BracketRight", { ctrlKey: true }), "nextPage"),
		).toBe(true);
		expect(matches(press("ArrowRight", "ArrowRight"), "nextPage")).toBe(false);
		expect(matches(press("r", "KeyR"), "rotate")).toBe(false);
		// The others keep theirs.
		expect(matches(press("ArrowLeft", "ArrowLeft"), "prevPage")).toBe(true);
	});

	it("leaves a plain key to the field being typed in", () => {
		const field = document.createElement("input");
		expect(matches(press("r", "KeyR", {}, field), "rotate")).toBe(false);
		expect(
			matches(press("ArrowRight", "ArrowRight", {}, field), "nextPage"),
		).toBe(false);
		// Ctrl ones still work there.
		expect(matches(press("f", "KeyF", { ctrlKey: true }, field), "find")).toBe(
			true,
		);
	});
});

describe("choosing keys", () => {
	it("finds the shortcut that has keys now", () => {
		expect(whoHas("F", {})).toBe("fullscreen");
		expect(whoHas("F", {}, "fullscreen")).toBeNull();
		expect(whoHas("F", { fullscreen: ["F11"] })).toBeNull();
		expect(whoHas("Ctrl+]", {})).toBe("rotate");
	});

	it("keeps the keys that type, scroll, undo or close", () => {
		expect(isReserved("Space")).toBe(true);
		expect(isReserved("Escape")).toBe(true);
		expect(isReserved("Ctrl+Z")).toBe(true);
		expect(isReserved("Ctrl+3")).toBe(true);
		expect(isReserved("Ctrl+]")).toBe(false);
		expect(isReserved("J")).toBe(false);
	});

	it("says the keys as they are printed", () => {
		expect(shortcutLabel("ArrowRight")).toBe("→");
		expect(shortcutLabel("Ctrl++")).toBe("Ctrl++");
		expect(shortcutLabel("Ctrl+Shift+U")).toBe("Ctrl+Shift+U");
		expect(hintFor("find")).toBe("Ctrl+F");
		expect(hintFor("rotate")).toBe("Ctrl+]");
		setCustomShortcuts({ rotate: [] });
		expect(hintFor("rotate")).toBeUndefined();
	});

	it("reads back only what it can use", () => {
		expect(
			normalizeShortcuts({
				nextPage: ["Ctrl+]"],
				nope: ["X"],
				rotate: "R",
				find: [1, "Ctrl+F"],
			}),
		).toEqual({ nextPage: ["Ctrl+]"], find: ["Ctrl+F"] });
		expect(normalizeShortcuts(null)).toEqual({});
		expect(keysFor("find", { find: [] })).toEqual([]);
		expect(keysFor("find", {})).toEqual(defaultKeys("find"));
	});
});
