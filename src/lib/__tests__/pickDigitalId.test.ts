import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A digital ID holds a private key: picking one must read it into
// memory and nothing else. No copy for the recent files (importPicked on
// a phone), no browser file store, no open request that could end up in
// the recent files.

const picked = { value: "" as string | null };
const read = vi.fn(async (_path: string) => new Uint8Array([48, 130, 1, 2]));
const stored = vi.fn(async () => {});

vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(async () => picked.value),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
	readFile: (path: string) => read(path),
	stat: vi.fn(async () => ({ size: 4 })),
}));
vi.mock("../fileStore", () => ({
	storedFilePut: stored,
	storedFileGet: vi.fn(async () => null),
	storedFileClear: vi.fn(async () => {}),
}));

const importPicked = vi.fn(() => true);

async function tauriBackend() {
	vi.resetModules();
	(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
	return (await import("../backend")).backend;
}

beforeEach(() => {
	read.mockClear();
	stored.mockClear();
	importPicked.mockClear();
});

afterEach(() => {
	// The shell is known by the name being there at all.
	Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
	window.__paperwrenAndroid = undefined;
});

describe("picking a digital ID", () => {
	it("reads a phone's content URI straight into memory, never importing it", async () => {
		window.__paperwrenAndroid = {
			displayName: () => "me.pfx",
			contentSize: () => 4,
			importPicked,
		};
		picked.value = "content://downloads/me.pfx";
		const backend = await tauriBackend();
		const id = await backend.pickDigitalId();
		expect(id?.name).toBe("me.pfx");
		expect(id?.bytes).toEqual(new Uint8Array([48, 130, 1, 2]));
		expect(read).toHaveBeenCalledWith("content://downloads/me.pfx");
		expect(importPicked).not.toHaveBeenCalled();
		expect(stored).not.toHaveBeenCalled();
		// Only a name and bytes: nothing that can be opened again later.
		expect(Object.keys(id ?? {}).sort()).toEqual(["bytes", "name"]);
	});

	it("reads a desktop path, named by its file", async () => {
		picked.value = "C:\\Users\\me\\Keys\\work.p12";
		const backend = await tauriBackend();
		const id = await backend.pickDigitalId();
		expect(id?.name).toBe("work.p12");
		expect(read).toHaveBeenCalledWith("C:\\Users\\me\\Keys\\work.p12");
		expect(stored).not.toHaveBeenCalled();
	});

	it("is nothing when the reader cancels", async () => {
		picked.value = null;
		const backend = await tauriBackend();
		expect(await backend.pickDigitalId()).toBeNull();
		expect(read).not.toHaveBeenCalled();
	});

	it("keeps nothing in a browser either", async () => {
		vi.resetModules();
		const { backend } = await import("../backend");
		window.__paperwrenTestDigitalId = new File(
			[new Uint8Array([1, 2, 3])],
			"test.pfx",
		);
		const id = await backend.pickDigitalId();
		expect(id?.name).toBe("test.pfx");
		expect(Array.from(id?.bytes ?? [])).toEqual([1, 2, 3]);
		expect(window.__paperwrenTestDigitalId).toBeUndefined();
		expect(stored).not.toHaveBeenCalled();
	});
});
