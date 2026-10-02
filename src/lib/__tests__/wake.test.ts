import { afterEach, describe, expect, it, vi } from "vitest";
import { holdScreen } from "../wake";

const settle = () => new Promise((resolve) => setTimeout(resolve));

function fakeWakeLock(works = true) {
	const release = vi.fn(() => Promise.resolve());
	const request = vi.fn(() =>
		works ? Promise.resolve({ release }) : Promise.reject(new Error("no")),
	);
	Object.defineProperty(navigator, "wakeLock", {
		value: { request },
		configurable: true,
	});
	return { request, release };
}

function fakeBridge() {
	const keepAwake = vi.fn();
	window.__paperwrenAndroidExtras = {
		keepAwake,
	} as unknown as typeof window.__paperwrenAndroidExtras;
	return keepAwake;
}

afterEach(() => {
	Reflect.deleteProperty(navigator, "wakeLock");
	window.__paperwrenAndroidExtras = undefined;
});

describe("holdScreen", () => {
	it("takes a screen wake lock and gives it back", async () => {
		const lock = fakeWakeLock();
		const bridge = fakeBridge();
		const release = holdScreen();
		await settle();
		expect(lock.request).toHaveBeenCalledWith("screen");
		release();
		expect(lock.release).toHaveBeenCalledTimes(1);
		// The web lock worked: the shell was never asked.
		expect(bridge).not.toHaveBeenCalled();
	});

	it("uses the Android shell where the engine has no wake lock", () => {
		const bridge = fakeBridge();
		const release = holdScreen();
		expect(bridge).toHaveBeenLastCalledWith(true);
		release();
		expect(bridge).toHaveBeenLastCalledWith(false);
		expect(bridge).toHaveBeenCalledTimes(2);
	});

	it("falls back to the shell when the lock is refused", async () => {
		const lock = fakeWakeLock(false);
		const bridge = fakeBridge();
		const release = holdScreen();
		await settle();
		expect(lock.request).toHaveBeenCalled();
		expect(bridge).toHaveBeenLastCalledWith(true);
		release();
		expect(bridge).toHaveBeenLastCalledWith(false);
	});

	it("takes the lock again when the reader comes back to the app", async () => {
		const lock = fakeWakeLock();
		const release = holdScreen();
		await settle();
		document.dispatchEvent(new Event("visibilitychange"));
		await settle();
		expect(lock.request).toHaveBeenCalledTimes(2);
		release();
		document.dispatchEvent(new Event("visibilitychange"));
		await settle();
		expect(lock.request).toHaveBeenCalledTimes(2);
	});

	it("gives back a lock that arrives after the hold has ended", async () => {
		const lock = fakeWakeLock();
		holdScreen()();
		await settle();
		expect(lock.release).toHaveBeenCalledTimes(1);
	});

	it("does nothing, quietly, where neither exists", () => {
		expect(() => holdScreen()()).not.toThrow();
	});
});
