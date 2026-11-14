import { describe, expect, it } from "vitest";
import {
	type FullscreenWindow,
	fitWhenSettled,
	untilSteady,
	windowFullscreen,
} from "../fullscreen";

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

	it("maximises again a window that turned full screen down", async () => {
		const { win, state, log } = fakeWindow(true);
		win.setFullscreen = async () => {
			throw new Error("refused");
		};
		const fs = windowFullscreen(win, { restoreMaximized: true });
		await fs.enter();
		expect(log).toEqual(["unmaximize", "maximize"]);
		expect(state).toEqual({ full: false, maximized: true });
		expect(fs.busy()).toBe(false);
		// Nothing left over to maximise on the way out.
		await fs.leave();
		expect(log).toEqual(["unmaximize", "maximize"]);
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

describe("waiting for the window to settle", () => {
	/** Frames 16 ms apart; `sizes` is what each frame reads, the last
	 * one kept. Resolves with how many frames it took. */
	async function settle(sizes: string[], options: { from?: string } = {}) {
		let t = 0;
		let n = 0;
		const queue: Array<() => void> = [];
		const done = untilSteady(() => sizes[Math.min(n, sizes.length - 1)], {
			...options,
			now: () => t,
			frame: (then) => queue.push(then),
		});
		let finished = false;
		done.then(() => {
			finished = true;
		});
		while (!finished && n < 100) {
			n++;
			t += 16;
			queue.shift()?.();
			await Promise.resolve();
		}
		return n;
	}

	it("waits for a size held two frames", async () => {
		// Restored on the way, then full screen.
		expect(await settle(["a", "b", "c", "c", "c"])).toBe(4);
	});

	it("waits longer while the window has not begun to change", async () => {
		expect(await settle(["a"], { from: "a" })).toBe(6);
		expect(await settle(["a"])).toBe(2);
	});

	it("gives up after 400 ms of a size that keeps changing", async () => {
		const changing = Array.from({ length: 100 }, (_, i) => String(i));
		expect(await settle(changing)).toBe(25);
	});
});

describe("a viewer's fit", () => {
	it("is done at once while full screen is not changing", () => {
		let fits = 0;
		const fit = fitWhenSettled(() => fits++);
		fit.run();
		fit.run();
		expect(fits).toBe(2);
		fit.stop();
	});
});
