import { describe, expect, it } from "vitest";
import {
	type NavState,
	canGoBack,
	initialNav,
	navReducer,
} from "../navigation";
import type { OpenRequest } from "../types";

const req: OpenRequest = {
	id: "f1",
	name: "a.pdf",
	nameVerified: true,
	size: 1,
	reopen: { kind: "path", path: "/a.pdf" },
};

describe("navReducer", () => {
	it("stacks viewers and pops back to Home", () => {
		let s: NavState = navReducer(initialNav, {
			type: "push",
			screen: { kind: "viewer", request: req, key: 1 },
		});
		s = navReducer(s, {
			type: "push",
			screen: { kind: "viewer", request: req, key: 2 },
		});
		expect(s.screens).toHaveLength(3);
		s = navReducer(s, { type: "pop" });
		s = navReducer(s, { type: "pop" });
		expect(s).toEqual(initialNav);
		expect(navReducer(s, { type: "pop" })).toBe(s);
	});

	it("never stacks Settings on Settings", () => {
		const once = navReducer(initialNav, {
			type: "push",
			screen: { kind: "settings" },
		});
		expect(
			navReducer(once, { type: "push", screen: { kind: "settings" } }),
		).toBe(once);
	});

	it("tracks overlays without duplicates", () => {
		let s = navReducer(initialNav, { type: "overlay-open", id: "sheet" });
		s = navReducer(s, { type: "overlay-open", id: "sheet" });
		expect(s.overlays).toEqual(["sheet"]);
		expect(canGoBack(s)).toBe(true);
		s = navReducer(s, { type: "overlay-close", id: "sheet" });
		expect(canGoBack(s)).toBe(false);
	});

	it("puts one viewer in place of another, and never in place of Home", () => {
		const viewer = (key: number) =>
			({ kind: "viewer", request: req, key }) as const;
		let s: NavState = navReducer(initialNav, {
			type: "push",
			screen: viewer(1),
		});
		s = navReducer(s, { type: "replace", screen: viewer(2) });
		expect(s.screens).toHaveLength(2);
		expect(s.screens[1]).toMatchObject({ key: 2 });
		// Back leaves the viewer: no trail of replaced files behind it.
		s = navReducer(s, { type: "pop" });
		expect(s.screens).toEqual([{ kind: "home" }]);
		// With only Home on the stack, a replace opens on top of it.
		s = navReducer(s, { type: "replace", screen: viewer(3) });
		expect(s.screens.map((screen) => screen.kind)).toEqual(["home", "viewer"]);
	});
});
