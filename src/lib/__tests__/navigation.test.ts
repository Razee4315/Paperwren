import { describe, expect, it } from "vitest";
import {
	backWouldConsume,
	initialNavigation,
	navigationReducer,
} from "../navigation";
import type { FileMeta } from "../types";

const file = (name: string): FileMeta => ({
	name,
	format: "pdf",
	size: 10,
	ref: name,
	source: name,
});

describe("navigationReducer Back priority", () => {
	it("does not consume Back at Home with nothing above", () => {
		expect(backWouldConsume(initialNavigation)).toBe(false);
		const next = navigationReducer(initialNavigation, { type: "handle-back" });
		expect(next).toBe(initialNavigation);
	});

	it("Home -> viewer -> Back returns Home, then Back is not consumed", () => {
		let s = navigationReducer(initialNavigation, {
			type: "push",
			screen: { kind: "viewer", file: file("a.pdf") },
		});
		expect(backWouldConsume(s)).toBe(true);
		s = navigationReducer(s, { type: "handle-back" });
		expect(s.screens).toHaveLength(1);
		expect(s.screens[0].kind).toBe("home");
		expect(backWouldConsume(s)).toBe(false);
	});

	it("settings subpage Back returns to Settings root before Home", () => {
		let s = navigationReducer(initialNavigation, {
			type: "open-settings",
			subpage: "appearance",
		});
		s = navigationReducer(s, { type: "handle-back" });
		expect(s.screens).toHaveLength(2);
		expect(s.screens[1]).toEqual({ kind: "settings", subpage: null });
		s = navigationReducer(s, { type: "handle-back" });
		expect(s.screens).toHaveLength(1);
		expect(backWouldConsume(s)).toBe(false);
	});

	it("dismisses the top overlay before popping a screen", () => {
		let s = navigationReducer(initialNavigation, {
			type: "push",
			screen: { kind: "viewer", file: file("a.pdf") },
		});
		s = navigationReducer(s, { type: "open-overlay", id: "pdf-tools" });
		s = navigationReducer(s, { type: "open-overlay", id: "pdf-outline" });
		s = navigationReducer(s, { type: "handle-back" });
		expect(s.overlays.map((o) => o.id)).toEqual(["pdf-tools"]);
		s = navigationReducer(s, { type: "handle-back" });
		expect(s.overlays).toHaveLength(0);
		expect(s.screens).toHaveLength(2);
		s = navigationReducer(s, { type: "handle-back" });
		expect(s.screens).toHaveLength(1);
	});

	it("stacks a second viewer instead of replacing the first", () => {
		let s = navigationReducer(initialNavigation, {
			type: "push",
			screen: { kind: "viewer", file: file("a.pdf") },
		});
		s = navigationReducer(s, {
			type: "push",
			screen: { kind: "viewer", file: file("b.pdf") },
		});
		expect(s.screens).toHaveLength(3);
		s = navigationReducer(s, { type: "handle-back" });
		expect(s.screens).toHaveLength(2);
		expect(s.screens[1]).toMatchObject({ kind: "viewer", file: file("a.pdf") });
	});

	it("replacing with home clears screens and overlays", () => {
		let s = navigationReducer(initialNavigation, {
			type: "push",
			screen: { kind: "viewer", file: file("a.pdf") },
		});
		s = navigationReducer(s, { type: "open-overlay", id: "pdf-tools" });
		s = navigationReducer(s, { type: "replace", screen: { kind: "home" } });
		expect(s.screens).toHaveLength(1);
		expect(s.overlays).toHaveLength(0);
	});

	it("ignores duplicate overlay ids", () => {
		let s = navigationReducer(initialNavigation, {
			type: "open-overlay",
			id: "x",
		});
		s = navigationReducer(s, { type: "open-overlay", id: "x" });
		expect(s.overlays).toHaveLength(1);
	});
});
