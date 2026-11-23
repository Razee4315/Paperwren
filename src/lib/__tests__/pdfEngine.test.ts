import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../pdfWorker?worker&url", () => ({ default: "/pdf.worker.mjs" }));

const loadAt = async (mobile: boolean) => {
	vi.resetModules();
	vi.doMock("../env", () => ({ isDesktop: !mobile, isTauri: false }));
	return await import("../pdfEngine");
};

afterEach(() => {
	vi.doUnmock("../env");
	vi.resetModules();
});

describe("pdfEngine document options", () => {
	it("downscales huge phone images instead of discarding them (#104)", async () => {
		const { documentOptions } = await loadAt(true);
		const viewOpts = documentOptions(true);
		expect(viewOpts.maxImageSize).toBe(-1);
		expect(viewOpts.canvasMaxAreaInBytes).toBe(64 * 1024 * 1024);
		expect(viewOpts.isImageDecoderSupported).toBe(false);

		const toolOpts = documentOptions(false);
		expect(toolOpts.maxImageSize).toBe(-1);
		expect(toolOpts.canvasMaxAreaInBytes).toBe(-1);
	});

	it("keeps desktop image sizing unbounded", async () => {
		const { documentOptions } = await loadAt(false);
		const viewOpts = documentOptions(true);
		expect(viewOpts.maxImageSize).toBe(-1);
		expect(viewOpts.canvasMaxAreaInBytes).toBe(-1);
	});
});

describe("pdfRange chunk sizing", () => {
	it("uses 256 KiB chunks to cut bridge roundtrips", async () => {
		vi.resetModules();
		const { RANGE_CHUNK } = await import("../pdfRange");
		expect(RANGE_CHUNK).toBe(256 * 1024);
	});
});
