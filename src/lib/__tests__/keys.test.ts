import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (mac: boolean) => {
	vi.resetModules();
	vi.doMock("../env", () => ({ isMac: mac }));
	return import("../keys");
};

afterEach(() => vi.doUnmock("../env"));

describe("how shortcuts are written", () => {
	it("leaves them as they are on Windows", async () => {
		const { keys, FULLSCREEN_KEYS } = await load(false);
		expect(keys("Ctrl+O")).toBe("Ctrl+O");
		expect(keys("Alt+←")).toBe("Alt+←");
		expect(FULLSCREEN_KEYS).toBe("F11");
	});

	it("uses the Mac's own signs", async () => {
		const { keys, FULLSCREEN_KEYS } = await load(true);
		expect(keys("Ctrl+O")).toBe("⌘O");
		expect(keys("Ctrl++")).toBe("⌘+");
		expect(keys("Ctrl+-")).toBe("⌘-");
		expect(keys("Ctrl+] · Ctrl+[")).toBe("⌘] · ⌘[");
		expect(keys("Ctrl + · Ctrl - · Ctrl 0")).toBe("⌘+ · ⌘- · ⌘0");
		expect(keys("Ctrl+Page Up")).toBe("⌘Page Up");
		expect(keys("F3 · Shift+F3")).toBe("F3 · ⇧F3");
		expect(keys("Alt+←")).toBe("⌥←");
		expect(keys("F5")).toBe("F5");
		expect(FULLSCREEN_KEYS).toBe("⌃⌘F");
	});

	it("rewrites a shortcut inside a sentence", async () => {
		const { keys } = await load(true);
		expect(keys("Drop a file here, or press Ctrl+O.")).toBe(
			"Drop a file here, or press ⌘O.",
		);
	});

	it("knows the full-screen keys of each", async () => {
		const press = (init: KeyboardEventInit) =>
			new KeyboardEvent("keydown", init);
		const win = await load(false);
		expect(win.isFullscreenKey(press({ key: "F11" }))).toBe(true);
		expect(
			win.isFullscreenKey(press({ key: "f", ctrlKey: true, metaKey: true })),
		).toBe(false);
		const mac = await load(true);
		expect(
			mac.isFullscreenKey(press({ key: "f", ctrlKey: true, metaKey: true })),
		).toBe(true);
		expect(mac.isFullscreenKey(press({ key: "f", metaKey: true }))).toBe(false);
	});
});
