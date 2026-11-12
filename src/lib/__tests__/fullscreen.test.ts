import { describe, expect, it } from "vitest";
import { type FullscreenWindow, windowFullscreen } from "../fullscreen";

/** A window that keeps a log of what it was asked to do. */
function fakeWindow(maximized: boolean) {
	const state = { full: false, maximized };
	const log: string[] = [];
	const settle = () => new Promise((r) => setTimeout(r, 1));
	const win: FullscreenWindow = {
		isFullscreen: async () => state.full,
		isMaximized: async () => state.maximized,
		setFullscreen: async (on) => {
			await settle();
			log.push(on ? "full" : "unfull");
			state.full = on;
		},
		maximize: async () => {
			log.push("maximize");
			state.maximized = true;
		},
		unmaximize: async () => {
			log.push("unmaximize");
			state.maximized = false;
		},
	};
	return { win, state, log };
}

describe("the window's full screen", () => {
	it("restores a maximised window first on Windows, and maximises it after", async () => {
		const { win, state, log } = fakeWindow(true);
		const fs = windowFullscreen(win, { restoreMaximized: true });
		await fs.enter();
		expect(log).toEqual(["unmaximize", "full"]);
		expect(state).toEqual({ full: true, maximized: false });
		await fs.leave();
		expect(log).toEqual(["unmaximize", "full", "unfull", "maximize"]);
		expect(state).toEqual({ full: false, maximized: true });
	});

	it("leaves a window that was not maximised as it was", async () => {
		const { win, state, log } = fakeWindow(false);
		const fs = windowFullscreen(win, { restoreMaximized: true });
		await fs.toggle();
		await fs.toggle();
		expect(log).toEqual(["full", "unfull"]);
		expect(state).toEqual({ full: false, maximized: false });
	});

	it("goes straight to full screen where the system handles it (a Mac)", async () => {
		const { win, log } = fakeWindow(true);
		const fs = windowFullscreen(win, { restoreMaximized: false });
		await fs.enter();
		await fs.leave();
		expect(log).toEqual(["full", "unfull"]);
	});

	it("takes quick presses one at a time", async () => {
		const { win, state, log } = fakeWindow(true);
		const fs = windowFullscreen(win, { restoreMaximized: true });
		fs.toggle();
		expect(fs.busy()).toBe(false);
		const last = fs.toggle();
		await new Promise((r) => setTimeout(r, 0));
		expect(fs.busy()).toBe(true);
		await last;
		expect(fs.busy()).toBe(false);
		expect(log).toEqual(["unmaximize", "full", "unfull", "maximize"]);
		expect(state.maximized).toBe(true);
	});

	it("does nothing when asked for the state it is in", async () => {
		const { win, log } = fakeWindow(false);
		const fs = windowFullscreen(win, { restoreMaximized: true });
		await fs.leave();
		await fs.enter();
		await fs.enter();
		expect(log).toEqual(["full"]);
	});
});
