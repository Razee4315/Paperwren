import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

/** Load trace.ts as the desktop app (or a browser) would see it. */
async function load(tauri: boolean, on: boolean) {
	vi.resetModules();
	invoke.mockReset();
	invoke.mockImplementation(async (cmd: string) =>
		cmd === "trace_enabled" ? on : undefined,
	);
	if (tauri) window.__TAURI_INTERNALS__ = {};
	return import("../trace");
}

/** Let the queued marks go through. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("the start-up trace", () => {
	beforeEach(() => {
		Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
	});
	afterEach(() => {
		Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
	});

	it("does nothing in a browser", async () => {
		const { traceMark } = await load(false, true);
		traceMark("Home ready");
		await settle();
		expect(invoke).not.toHaveBeenCalled();
	});

	it("sends nothing to a shell that is not tracing", async () => {
		const { traceMark } = await load(true, false);
		traceMark("page loaded");
		traceMark("Home ready");
		await settle();
		expect(invoke.mock.calls.map((c) => c[0])).toEqual(["trace_enabled"]);
	});

	it("sends each milestone once, in order, to a shell that is tracing", async () => {
		const { traceMark } = await load(true, true);
		traceMark("page loaded");
		traceMark("Home ready");
		traceMark("page loaded");
		await settle();
		expect(invoke.mock.calls).toEqual([
			["trace_enabled"],
			["trace_mark", { name: "page loaded" }],
			["trace_mark", { name: "Home ready" }],
		]);
	});

	it("marks the first page once its canvas is in the page's wrapper", async () => {
		const { traceFirstPage } = await load(true, true);
		traceFirstPage();
		await settle();
		const wrapper = document.createElement("div");
		wrapper.className = "canvasWrapper";
		document.body.append(wrapper);
		// A canvas elsewhere is not a page.
		document.body.append(document.createElement("canvas"));
		await settle();
		expect(invoke).not.toHaveBeenCalledWith("trace_mark", expect.anything());
		wrapper.append(document.createElement("canvas"));
		await settle();
		expect(invoke).toHaveBeenCalledWith("trace_mark", {
			name: "first document page drawn",
		});
		wrapper.remove();
	});
});
